import { Injectable, Optional } from '@nestjs/common'
import { AiAgentRunStatus } from '@prisma/client'
import { LoggerService } from 'src/shared/logger/logger.service'
import { AgentMetricsService } from '../observability/agent-metrics.service'
import { AgentTracingService } from '../observability/agent-tracing.service'
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
    @Optional() private readonly tracing?: AgentTracingService,
    @Optional() private readonly metrics?: AgentMetricsService,
  ) {}

  async resume(runId: string, worker: AgentWorkerContext): Promise<WorkflowTerminalResult> {
    const startedAt = Date.now()
    const claimed = await this.runs.claimRun(runId, worker.workerId)
    const executionRun = await this.runs.findForExecution(claimed.id, worker.workerId)
    let workflowKey = 'unknown'
    try {
      const workflow = this.registry.resolvePublished(executionRun.workflowVersion, executionRun.promptVersion)
      workflowKey = workflow.key
      const result = await this.executeWorkflow(executionRun, workflow.key, () =>
        this.engine.execute({
          run: executionRun,
          workflow,
          workerId: worker.workerId,
          signal: worker.signal,
        }),
      )
      this.observeRun(workflowKey, result.status, Date.now() - startedAt)
      return result
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
        this.observeRun(workflowKey, 'CANCELLED', Date.now() - startedAt)
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
      this.observeRun(workflowKey, 'FAILED', Date.now() - startedAt)
      return { status: 'FAILED', runId: current.id }
    }
  }

  private executeWorkflow<T>(
    run: { id: string; traceId: string },
    workflow: string,
    work: () => Promise<T>,
  ): Promise<T> {
    if (!this.tracing) return work()
    return this.tracing.span('agent.workflow', { traceId: run.traceId, runId: run.id, workflow }, work)
  }

  private observeRun(workflow: string, status: 'COMPLETED' | 'FAILED' | 'CANCELLED', durationMs: number): void {
    try {
      this.metrics?.observeRun(workflow, status, durationMs)
    } catch (error) {
      this.logger.warn(
        { operation: 'agent.metrics.run', status, errorClass: error instanceof Error ? error.name : 'unknown' },
        AgentOrchestratorService.name,
      )
    }
  }
}

function normalizeError(error: unknown): WorkflowExecutionError {
  if (error instanceof WorkflowExecutionError) return error
  return new WorkflowExecutionError('INTERNAL', 6099, true, 'Agent 内部错误')
}

function publicCategory(error: WorkflowExecutionError) {
  if (error.category === 'MODEL') return 'MODEL'
  if (error.category === 'BUDGET' && [6018, 6047, 6048, 6049].includes(error.agentCode)) return 'MODEL'
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
