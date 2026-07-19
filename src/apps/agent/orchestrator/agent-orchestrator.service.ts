import { Injectable } from '@nestjs/common'
import { AiAgentRunStatus } from '@prisma/client'
import { LoggerService } from 'src/shared/logger/logger.service'
import { AgentRunRepository } from '../execution/agent-run.repository'
import { WorkflowEngineService } from '../workflow/workflow-engine.service'
import { WorkflowCancelledError, WorkflowExecutionError, WorkflowLeaseError } from '../workflow/workflow.errors'
import { WorkflowRegistryService } from '../workflow/workflow-registry.service'
import type { WorkflowTerminalResult } from '../workflow/workflow.types'

export interface AgentWorkerContext {
  workerId: string
  signal?: AbortSignal
}

@Injectable()
export class AgentOrchestratorService {
  constructor(
    private readonly runs: AgentRunRepository,
    private readonly registry: WorkflowRegistryService,
    private readonly engine: WorkflowEngineService,
    private readonly logger: LoggerService,
  ) {}

  async resume(runId: string, worker: AgentWorkerContext): Promise<WorkflowTerminalResult> {
    const startedAt = Date.now()
    const claimed = await this.runs.claimRun(runId, worker.workerId)
    const executionRun = await this.runs.findForExecution(claimed.id, worker.workerId)
    try {
      const workflow = this.registry.resolvePublished(executionRun.workflowVersion, executionRun.promptVersion)
      return await this.engine.execute({
        run: executionRun,
        workflow,
        workerId: worker.workerId,
        signal: worker.signal,
      })
    } catch (error) {
      const current = await this.runs.findById(executionRun.userId, executionRun.id)
      if (current.status === AiAgentRunStatus.CANCEL_REQUESTED) {
        await this.runs.transition(current.id, {
          workerId: worker.workerId,
          expectedVersion: current.statusVersion,
          targetStatus: AiAgentRunStatus.CANCELLED,
          event: {
            eventType: 'agent.cancelled',
            traceId: current.traceId,
            payload: { cancelledBy: 'USER', reason: current.cancelReason ?? '用户取消' },
          },
        })
        return { status: 'CANCELLED', runId: current.id }
      }
      if (
        current.status !== AiAgentRunStatus.RUNNING ||
        error instanceof WorkflowLeaseError ||
        (error instanceof WorkflowCancelledError && worker.signal?.aborted)
      ) {
        throw error
      }
      const normalized = normalizeError(error)
      await this.runs.transition(current.id, {
        workerId: worker.workerId,
        expectedVersion: current.statusVersion,
        targetStatus: AiAgentRunStatus.FAILED,
        event: {
          eventType: 'agent.failed',
          traceId: current.traceId,
          payload: {
            error: {
              code: normalized.agentCode,
              message: normalized.message,
              retryable: normalized.retryable,
              category: publicCategory(normalized),
            },
            failedStep: currentStepFromError(error),
            retryable: normalized.retryable,
          },
        },
        errorCode: normalized.agentCode,
        errorClass: normalized.category,
        errorMessage: normalized.message,
      })
      this.logger.warn(
        {
          operation: 'agentOrchestrator.resume',
          runId: current.id,
          status: 'FAILED',
          errorClass: normalized.category,
          durationMs: Date.now() - startedAt,
        },
        AgentOrchestratorService.name,
      )
      return { status: 'FAILED', runId: current.id }
    }
  }
}

function normalizeError(error: unknown): WorkflowExecutionError {
  if (error instanceof WorkflowExecutionError) return error
  return new WorkflowExecutionError('INTERNAL', 6099, true, 'Agent 内部错误')
}

function publicCategory(error: WorkflowExecutionError) {
  if (error.category === 'MODEL') return 'MODEL'
  if (error.category === 'TOOL') return 'TOOL'
  if (error.category === 'TIMEOUT') return 'TIMEOUT'
  if (error.category === 'VALIDATION' || error.category === 'VERSION' || error.category === 'CITATION') {
    return 'VALIDATION'
  }
  return 'INTERNAL'
}

function currentStepFromError(error: unknown): string | null {
  return error && typeof error === 'object' && 'stepKey' in error && typeof error.stepKey === 'string'
    ? error.stepKey
    : null
}
