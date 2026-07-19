import { Inject, Injectable } from '@nestjs/common'
import {
  AiAgentRunStatus,
  AiAgentStepStatus,
  AiConclusionLevel,
  AiSourceType,
  type AiAgentRun,
  type AiAgentStep,
} from '@prisma/client'
import { AgentExecutionConfig, type IAgentExecutionConfig } from 'src/config/agent-execution.config'
import { LoggerService } from 'src/shared/logger/logger.service'
import type { AttachCitationInput } from '../audit/citation.repository'
import { AgentRunCompletionRepository } from '../execution/agent-run-completion.repository'
import { AgentRunRepository, type AgentExecutionRun } from '../execution/agent-run.repository'
import { CompleteNode } from './nodes/complete.node'
import { ExecuteToolsNode } from './nodes/execute-tools.node'
import { LoadContextNode } from './nodes/load-context.node'
import { PersistNode } from './nodes/persist.node'
import { PlanNode } from './nodes/plan.node'
import { AuthorizeToolsNode } from './nodes/authorize-tools.node'
import { SynthesizeNode } from './nodes/synthesize.node'
import { ValidateCitationsNode } from './nodes/validate-citations.node'
import type { WorkflowNodeHandler } from './nodes/workflow-node'
import { WorkflowBudgetService } from './workflow-budget.service'
import {
  WorkflowCancelledError,
  WorkflowExecutionError,
  WorkflowLeaseError,
  WorkflowTimeoutError,
  WorkflowValidationError,
} from './workflow.errors'
import type {
  FrozenWorkflowDefinition,
  WorkflowCheckpoint,
  WorkflowExecutionState,
  WorkflowTerminalResult,
} from './workflow.types'

export interface ExecuteWorkflowCommand {
  run: AgentExecutionRun
  workflow: FrozenWorkflowDefinition
  workerId: string
  signal?: AbortSignal
}

@Injectable()
export class WorkflowEngineService {
  private readonly handlers: ReadonlyMap<string, WorkflowNodeHandler>

  constructor(
    private readonly runs: AgentRunRepository,
    private readonly completion: AgentRunCompletionRepository,
    private readonly budgets: WorkflowBudgetService,
    @Inject(AgentExecutionConfig.KEY) private readonly config: IAgentExecutionConfig,
    private readonly logger: LoggerService,
    loadContext: LoadContextNode,
    plan: PlanNode,
    authorizeTools: AuthorizeToolsNode,
    executeTools: ExecuteToolsNode,
    synthesize: SynthesizeNode,
    validateCitations: ValidateCitationsNode,
    persist: PersistNode,
    complete: CompleteNode,
  ) {
    this.handlers = new Map(
      [loadContext, plan, authorizeTools, executeTools, synthesize, validateCitations, persist, complete].map(
        (handler) => [handler.key, handler],
      ),
    )
  }

  async execute(command: ExecuteWorkflowCommand): Promise<WorkflowTerminalResult> {
    const startedAt = Date.now()
    const limits = this.budgets.resolveLimits(command.workflow, command.run.budget)
    if (limits.maxSteps < command.workflow.nodes.length) {
      throw new WorkflowValidationError('Run 步数预算不足以执行固定工作流')
    }
    let checkpoint = restoreCheckpoint(command.run, command.workflow, this.budgets.initialUsage(limits))
    let checkpointVersion = command.run.checkpointVersion

    for (let index = checkpoint.nextNodeIndex; index < command.workflow.nodes.length; index += 1) {
      const node = command.workflow.nodes[index]
      const handler = this.handlers.get(node.key)
      if (!handler) throw new WorkflowValidationError(`Workflow node handler 未注册：${node.key}`)
      await this.guard(command.run.userId, command.run.id, command.workerId, command.signal)
      this.budgets.assertCanStartStep(checkpoint.state.budget, limits)

      const step = await this.runs.createStep(command.run.id, command.workerId, {
        stepKey: node.key,
        kind: node.kind,
        ordinal: index,
        input: { workflowHash: command.workflow.contentHash, nodeKey: node.key },
      })

      if (step.status === AiAgentStepStatus.COMPLETED) {
        checkpoint = restoreCompletedStep(step, checkpoint, index)
        const saved = await this.runs.saveCheckpoint(command.run.id, {
          workerId: command.workerId,
          expectedCheckpointVersion: checkpointVersion,
          checkpoint,
        })
        checkpointVersion = saved.checkpointVersion
        continue
      }
      if (step.status === AiAgentStepStatus.PENDING) {
        await this.runs.transitionStep(command.run.id, step.id, {
          workerId: command.workerId,
          targetStatus: AiAgentStepStatus.RUNNING,
          event: {
            eventType: 'agent.progress',
            traceId: command.run.traceId,
            payload: { stepKey: node.key, label: node.label, completed: index, total: command.workflow.nodes.length },
          },
        })
      } else if (step.status !== AiAgentStepStatus.RUNNING) {
        throw new WorkflowValidationError(`Workflow Step ${node.key} 处于不可恢复状态：${step.status}`)
      }

      let stepCompleted = false
      try {
        const nextState = await this.withLeaseHeartbeat(command, (signal) =>
          handler.execute({
            run: command.run,
            workflow: command.workflow,
            state: checkpoint.state,
            limits,
            stepId: step.id,
            signal,
          }),
        )
        const currentRun = await this.guard(command.run.userId, command.run.id, command.workerId, command.signal)
        const completedState = {
          ...nextState,
          budget: { ...nextState.budget, steps: nextState.budget.steps + 1 },
        }
        this.budgets.assertUsage(completedState.budget, limits)

        if (node.key === 'complete') {
          await this.completeRun(command, currentRun, step, completedState)
          this.logger.log(
            {
              operation: 'workflow.execute',
              workflowKey: command.workflow.key,
              workflowVersion: command.workflow.version,
              runId: command.run.id,
              durationMs: Date.now() - startedAt,
              status: 'COMPLETED',
            },
            WorkflowEngineService.name,
          )
          return { status: 'COMPLETED', runId: command.run.id, finalMessageId: command.run.responseMessageId }
        }

        await this.runs.transitionStep(command.run.id, step.id, {
          workerId: command.workerId,
          targetStatus: AiAgentStepStatus.COMPLETED,
          event: completedNodeEvent(
            command.run,
            node.key,
            node.label,
            index,
            command.workflow.nodes.length,
            completedState,
          ),
          output: { state: completedState },
        })
        stepCompleted = true
        checkpoint = {
          ...checkpoint,
          nextNodeIndex: index + 1,
          state: completedState,
        }
        const saved = await this.runs.saveCheckpoint(command.run.id, {
          workerId: command.workerId,
          expectedCheckpointVersion: checkpointVersion,
          checkpoint,
        })
        checkpointVersion = saved.checkpointVersion
      } catch (error) {
        if (!stepCompleted) await this.finishErroredStep(command, step, error)
        throw error
      }
    }
    throw new WorkflowValidationError('Workflow 未生成终态')
  }

  private async completeRun(
    command: ExecuteWorkflowCommand,
    currentRun: AiAgentRun,
    step: AiAgentStep,
    state: WorkflowExecutionState,
  ): Promise<void> {
    const finalization = state.finalization
    if (!finalization) throw new WorkflowValidationError('最终持久化载荷缺失')
    const citations: AttachCitationInput[] = finalization.citations.map((citation) => ({
      publicId: citation.publicId,
      blockId: citation.blockId,
      claimKey: citation.claimKey,
      conclusionLevel: AiConclusionLevel[citation.conclusionLevel],
      locator: citation.locator,
      searchSourceId: citation.searchSourceId,
      toolCallId: citation.toolCallId,
      sourceType: citation.sourceType ? AiSourceType[citation.sourceType] : undefined,
      sourceTitle: citation.sourceTitle,
      retrievedAt: new Date(citation.retrievedAt),
    }))
    await this.completion.complete(command.run.id, {
      userId: command.run.userId,
      workerId: command.workerId,
      stepId: step.id,
      expectedRunStatusVersion: currentRun.statusVersion,
      traceId: command.run.traceId,
      responseMessageId: command.run.responseMessageId,
      contentText: finalization.contentText,
      contentBlocks: finalization.contentBlocks,
      citations,
      modelName: finalization.modelName,
      tokenCount: finalization.tokenCount,
      resultSummary: {
        workflowKey: command.workflow.key,
        workflowVersion: command.workflow.version,
        factCount: state.facts.length,
        warningCount: state.warnings.length,
        budget: state.budget,
      },
      completedEventPayload: {
        finalMessageId: command.run.responseMessageId,
        usage: {
          inputTokens: state.budget.inputTokens,
          outputTokens: state.budget.outputTokens,
          totalTokens: state.budget.inputTokens + state.budget.outputTokens,
        },
        cost: { amount: state.budget.cost, currency: state.budget.costCurrency },
        dataCutoff: finalization.dataCutoff,
        warnings: [...new Set([...state.warnings, ...(state.draft?.warnings ?? [])])],
      },
      stepOutput: { completed: true, finalMessageId: command.run.responseMessageId },
    })
  }

  private async guard(userId: number, runId: string, workerId: string, signal?: AbortSignal): Promise<AiAgentRun> {
    const run = await this.runs.findById(userId, runId)
    if (run.status === AiAgentRunStatus.CANCEL_REQUESTED) throw new WorkflowCancelledError()
    if (run.status !== AiAgentRunStatus.RUNNING) throw new WorkflowLeaseError(`Agent Run 状态 ${run.status} 不可执行`)
    if (run.deadlineAt.getTime() <= Date.now()) throw new WorkflowTimeoutError()
    if (run.leaseOwner !== workerId || !run.leaseExpiresAt || run.leaseExpiresAt.getTime() <= Date.now()) {
      throw new WorkflowLeaseError()
    }
    if (signal?.aborted) throw new WorkflowCancelledError('Worker 执行信号已取消')
    return run
  }

  private async withLeaseHeartbeat<T>(
    command: ExecuteWorkflowCommand,
    handler: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    await this.runs.heartbeat(command.run.id, command.workerId)
    const controller = new AbortController()
    const onParentAbort = () => controller.abort(command.signal?.reason)
    command.signal?.addEventListener('abort', onParentAbort, { once: true })
    let heartbeatError: WorkflowLeaseError | null = null
    let heartbeatPending: Promise<void> = Promise.resolve()
    const heartbeatEveryMs = Math.max(1_000, Math.floor(this.config.leaseMs / 3))
    const timer = setInterval(() => {
      heartbeatPending = heartbeatPending.then(async () => {
        if (heartbeatError) return
        try {
          await this.runs.heartbeat(command.run.id, command.workerId)
        } catch {
          heartbeatError = new WorkflowLeaseError('Agent Run heartbeat 失败')
          controller.abort(heartbeatError)
        }
      })
    }, heartbeatEveryMs)
    timer.unref?.()
    try {
      const result = await handler(controller.signal)
      await heartbeatPending
      if (heartbeatError) throw heartbeatError
      return result
    } catch (error) {
      await heartbeatPending
      if (heartbeatError) throw heartbeatError
      throw error
    } finally {
      clearInterval(timer)
      command.signal?.removeEventListener('abort', onParentAbort)
    }
  }

  private async finishErroredStep(command: ExecuteWorkflowCommand, step: AiAgentStep, error: unknown): Promise<void> {
    let run: AiAgentRun
    try {
      run = await this.runs.findById(command.run.userId, command.run.id)
    } catch {
      return
    }
    const leaseValid =
      run.leaseOwner === command.workerId && Boolean(run.leaseExpiresAt && run.leaseExpiresAt.getTime() > Date.now())
    if (!leaseValid) return
    if (run.status === AiAgentRunStatus.CANCEL_REQUESTED) {
      await this.runs.transitionStep(command.run.id, step.id, {
        workerId: command.workerId,
        targetStatus: AiAgentStepStatus.CANCELLED,
        event: {
          eventType: 'agent.progress',
          traceId: command.run.traceId,
          payload: {
            stepKey: step.stepKey,
            label: '已取消',
            completed: step.ordinal,
            total: command.workflow.nodes.length,
          },
        },
      })
      return
    }
    if (run.status !== AiAgentRunStatus.RUNNING || command.signal?.aborted || error instanceof WorkflowLeaseError)
      return
    const normalized = normalizeWorkflowError(error)
    await this.runs.transitionStep(command.run.id, step.id, {
      workerId: command.workerId,
      targetStatus: AiAgentStepStatus.FAILED,
      event: {
        eventType: 'agent.progress',
        traceId: command.run.traceId,
        payload: {
          stepKey: step.stepKey,
          label: '执行失败',
          completed: step.ordinal,
          total: command.workflow.nodes.length,
        },
      },
      errorCode: normalized.agentCode,
      errorClass: normalized.category,
      errorMessage: normalized.message,
    })
  }
}

function restoreCheckpoint(
  run: AgentExecutionRun,
  workflow: FrozenWorkflowDefinition,
  initialBudget: WorkflowExecutionState['budget'],
): WorkflowCheckpoint {
  const raw = asRecord(run.checkpoint)
  if (Object.keys(raw).length === 0) {
    return {
      schemaVersion: 1,
      workflowKey: workflow.key,
      workflowVersion: workflow.version,
      workflowHash: workflow.contentHash,
      nextNodeIndex: 0,
      state: {
        context: null,
        plan: null,
        compiledPlan: null,
        toolSnapshotSignature: null,
        facts: [],
        draft: null,
        modelName: null,
        finalization: null,
        warnings: [],
        citationRepairAttempts: 0,
        budget: initialBudget,
      },
    }
  }
  if (
    raw.schemaVersion !== 1 ||
    raw.workflowKey !== workflow.key ||
    raw.workflowVersion !== workflow.version ||
    raw.workflowHash !== workflow.contentHash
  ) {
    throw new WorkflowValidationError('Workflow checkpoint 版本不匹配')
  }
  if (
    !Number.isInteger(raw.nextNodeIndex) ||
    (raw.nextNodeIndex as number) < 0 ||
    (raw.nextNodeIndex as number) > workflow.nodes.length
  ) {
    throw new WorkflowValidationError('Workflow checkpoint nextNodeIndex 非法')
  }
  const state = asRecord(raw.state) as unknown as WorkflowExecutionState
  if (!state.budget || typeof state.budget !== 'object')
    throw new WorkflowValidationError('Workflow checkpoint budget 缺失')
  return raw as unknown as WorkflowCheckpoint
}

function restoreCompletedStep(step: AiAgentStep, checkpoint: WorkflowCheckpoint, index: number): WorkflowCheckpoint {
  const output = asRecord(step.outputSummary)
  const state = asRecord(output.state) as unknown as WorkflowExecutionState
  if (!state.budget) throw new WorkflowValidationError(`已完成 Step ${step.stepKey} 缺少可恢复状态`)
  return { ...checkpoint, nextNodeIndex: index + 1, state }
}

function completedNodeEvent(
  run: AgentExecutionRun,
  nodeKey: string,
  label: string,
  index: number,
  total: number,
  state: WorkflowExecutionState,
) {
  if (nodeKey === 'plan' && state.plan) {
    return {
      eventType: 'agent.planning',
      traceId: run.traceId,
      payload: {
        intent: state.plan.intent,
        capabilities: state.context?.allowedCapabilities ?? [],
        planSummary: state.plan.summary,
      },
    }
  }
  return {
    eventType: 'agent.progress',
    traceId: run.traceId,
    payload: { stepKey: nodeKey, label, completed: index + 1, total },
  }
}

function normalizeWorkflowError(error: unknown): WorkflowExecutionError {
  if (error instanceof WorkflowExecutionError) return error
  return new WorkflowExecutionError('INTERNAL', 6099, true, 'Agent 工作流执行失败')
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}
