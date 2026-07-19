import { Injectable } from '@nestjs/common'
import { TOOL_ERROR_AGENT_CODE, ToolExecutionError } from '../tools/contracts/tool-error'
import type { ToolResult } from '../tools/contracts/tool-result'
import { ToolExecutorService } from '../tools/tool-executor.service'
import { stableJson } from '../tools/tool-json'
import { ToolRegistryService } from '../tools/tool-registry.service'
import type { AgentExecutionRun } from '../execution/agent-run.repository'
import type {
  CompiledResearchPlan,
  FactPacket,
  LoadedWorkflowContext,
  WorkflowBudgetLimits,
  WorkflowBudgetUsage,
} from './workflow.types'
import { WorkflowBudgetService } from './workflow-budget.service'
import { WorkflowCancelledError, WorkflowExecutionError, WorkflowValidationError } from './workflow.errors'

export interface AuthorizedToolPlan {
  plan: CompiledResearchPlan
  snapshotSignature: string
  allowedTools: CompiledResearchPlan['toolPins'][number]['key'][]
}

export interface WorkflowToolExecutionResult {
  facts: FactPacket[]
  warnings: string[]
  usage: WorkflowBudgetUsage
}

@Injectable()
export class WorkflowToolService {
  constructor(
    private readonly registry: ToolRegistryService,
    private readonly executor: ToolExecutorService,
    private readonly budgets: WorkflowBudgetService,
  ) {}

  authorize(plan: CompiledResearchPlan): AuthorizedToolPlan {
    const snapshot = this.registry.freezeSnapshot(plan.toolPins)
    for (const pin of snapshot.entries) {
      const definition = this.registry.get(pin.key, pin.version)
      if (definition.policy.sideEffect !== 'READ' || !definition.policy.idempotent) {
        throw new WorkflowValidationError(`MVP 工作流仅允许幂等 READ Tool：${pin.key}`)
      }
    }
    return {
      plan,
      snapshotSignature: snapshot.signature,
      allowedTools: snapshot.entries.map((pin) => pin.key),
    }
  }

  async execute(command: {
    run: AgentExecutionRun
    stepId: string
    authorized: AuthorizedToolPlan
    context: LoadedWorkflowContext
    usage: WorkflowBudgetUsage
    limits: WorkflowBudgetLimits
    signal?: AbortSignal
  }): Promise<WorkflowToolExecutionResult> {
    this.budgets.assertCanPlanToolCalls(command.usage, command.authorized.plan.toolCalls.length, command.limits)
    const callsById = new Map(command.authorized.plan.toolCalls.map((call) => [call.id, call]))
    const invocationIndex = new Map(command.authorized.plan.toolCalls.map((call, index) => [call.id, index]))
    const facts: FactPacket[] = []
    const warnings: string[] = []
    let attempted = 0

    for (const level of command.authorized.plan.executionLevels) {
      const outcomes = await mapLimit(level, command.limits.maxParallelTools, async (id) => {
        if (command.signal?.aborted) throw new WorkflowCancelledError()
        const call = callsById.get(id)
        if (!call) throw new WorkflowValidationError(`已编译 Tool 调用不存在：${id}`)
        const callNumber = attempted
        attempted += 1
        try {
          const result = await this.executor.execute(
            {
              toolKey: call.toolKey,
              toolVersion: call.toolVersion,
              logicalNodeKey: 'execute_tools',
              invocationIndex: invocationIndex.get(id) ?? callNumber,
              input: call.input,
            },
            {
              userId: command.context.userId,
              role: command.context.role,
              userStatus: command.context.userStatus,
              scopeId: command.run.id,
              conversationId: command.context.conversationId,
              runId: command.run.id,
              stepId: command.stepId,
              traceId: command.run.traceId,
              workflowAllowedTools: command.authorized.allowedTools,
              allowedScopes: command.context.allowedScopes,
              callsUsed: command.usage.toolCalls + callNumber,
              deadlineAt: command.run.deadlineAt,
              parentSignal: command.signal,
              maxConcurrentCalls: command.limits.maxParallelTools,
            },
          )
          return { call, result }
        } catch (error) {
          if (error instanceof ToolExecutionError && error.result.code === 'CANCELLED') {
            throw new WorkflowCancelledError()
          }
          if (!call.optional) throw normalizeToolError(error)
          return { call, error }
        }
      })

      for (const outcome of outcomes) {
        if ('result' in outcome) facts.push(toFactPacket(outcome.call.id, outcome.result))
        else warnings.push(`可选 Tool ${outcome.call.toolKey} 失败：${safeErrorMessage(outcome.error)}`)
      }
    }

    const usage = { ...command.usage, toolCalls: command.usage.toolCalls + attempted }
    this.budgets.assertUsage(usage, command.limits)
    return { facts, warnings, usage }
  }
}

function toFactPacket(planCallId: string, result: ToolResult): FactPacket {
  return {
    factId: `fact_${planCallId}`,
    toolCallId: result.toolCallId,
    toolKey: result.toolKey,
    title: result.toolKey,
    sourceType: result.provenance.sourceType,
    sourceIds: [...result.citationSourceIds],
    summary: stableJson(result.data).slice(0, 8_000),
    retrievedAt: result.provenance.asOf.retrievedAt,
    asOf: Object.fromEntries(
      Object.entries(result.provenance.asOf).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    ),
    timezone: result.provenance.timezone,
    warnings: result.warnings.map((warning) => warning.message),
  }
}

function normalizeToolError(error: unknown): WorkflowExecutionError {
  if (error instanceof WorkflowExecutionError) return error
  if (error instanceof ToolExecutionError) {
    return new WorkflowExecutionError(
      'TOOL',
      TOOL_ERROR_AGENT_CODE[error.result.code],
      error.result.retryable,
      error.result.message,
    )
  }
  return new WorkflowExecutionError('TOOL', 6099, true, 'Tool 执行失败')
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof ToolExecutionError) return error.result.message
  if (error instanceof WorkflowExecutionError) return error.message
  return 'Tool 执行失败'
}

async function mapLimit<T, R>(items: readonly T[], limit: number, handler: (item: T) => Promise<R>): Promise<R[]> {
  if (items.length === 0) return []
  const output = new Array<R>(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      output[index] = await handler(items[index])
    }
  })
  await Promise.all(workers)
  return output
}
