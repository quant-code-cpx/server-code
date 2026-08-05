import { Inject, Injectable, Optional } from '@nestjs/common'
import { AiModelCallStatus } from '@prisma/client'
import { AgentAuditRepository } from '../audit/agent-audit.repository'
import { AgentEventRepository } from '../execution/agent-event.repository'
import type { AgentExecutionRun } from '../execution/agent-run.repository'
import {
  MODEL_GATEWAY,
  ModelAbortError,
  ModelGatewayError,
  type ModelGatewayPort,
  type ModelMessageRole,
  type ModelPurpose,
  type ModelStructuredStreamObserver,
  type NormalizedMessage,
} from '../model-gateway/model-gateway.port'
import { ModelStreamPublicProjector, type PublicModelStreamEvent } from './model-stream-public-projector'
import { WorkflowBudgetService } from './workflow-budget.service'
import { WorkflowBudgetError, WorkflowCancelledError, WorkflowExecutionError } from './workflow.errors'
import type { WorkflowBudgetLimits, WorkflowBudgetUsage } from './workflow.types'
import type { ContextManifest } from './workflow.types'
import type { WorkflowModelProfile } from './workflow.types'
import { AgentCostService, type AgentCostEstimate } from '../observability/agent-cost.service'
import type { ModelDescriptor, ModelUsage } from '../model-gateway/model-gateway.port'
import { ModelContextBudgetService } from './model-context-budget.service'

export interface WorkflowModelCommand {
  run: AgentExecutionRun
  stepId: string
  purpose: ModelPurpose
  messages: NormalizedMessage[]
  contextManifest?: ContextManifest
  responseSchema: Record<string, unknown>
  promptVersionId?: string
  attemptCount?: number
  maxOutputTokens: number
  usage: WorkflowBudgetUsage
  limits: WorkflowBudgetLimits
  workerId?: string
  signal?: AbortSignal
  modelProfile?: WorkflowModelProfile
}

export interface WorkflowModelResult<T> {
  data: T
  usage: WorkflowBudgetUsage
  modelCallId: string
  modelName: string
  repaired: boolean
}

@Injectable()
export class WorkflowModelService {
  constructor(
    @Inject(MODEL_GATEWAY) private readonly gateway: ModelGatewayPort,
    private readonly audit: AgentAuditRepository,
    private readonly budgets: WorkflowBudgetService,
    private readonly contextBudgets: ModelContextBudgetService,
    @Optional() private readonly events?: AgentEventRepository,
    @Optional() private readonly costs?: AgentCostService,
  ) {}

  async generateStructured<T>(command: WorkflowModelCommand): Promise<WorkflowModelResult<T>> {
    const estimatedInputTokens = this.budgets.estimateInputTokens(command.messages)
    this.budgets.assertCanCallModel(command.usage, estimatedInputTokens, command.limits)
    const routeCandidates = command.modelProfile
      ? command.modelProfile.candidates.map((descriptor) => ({ descriptor, reasonCodes: ['RUN_PROFILE'] }))
      : this.resolveRouteCandidates(command)
    const candidates = routeCandidates.filter(
      ({ descriptor }) => estimatedInputTokens + command.maxOutputTokens <= descriptor.contextWindow,
    )
    if (candidates.length === 0) {
      throw new WorkflowBudgetError('当前上下文无法装入目标模型，请切换到上下文更大的模型', 6048)
    }

    for (let index = 0; index < candidates.length; index += 1) {
      const { descriptor } = candidates[index]
      const startedAt = Date.now()
      const call = await this.audit.beginModelCall({
        userId: command.run.userId,
        scopeId: command.run.id,
        runId: command.run.id,
        stepId: command.stepId,
        promptVersionId: command.promptVersionId ?? command.run.promptVersionId,
        provider: descriptor.provider,
        model: descriptor.model,
        purpose: command.purpose,
        request: {
          purpose: command.purpose,
          messageCount: command.messages.length,
          estimatedInputTokens,
          responseSchema: command.responseSchema,
          ...(command.contextManifest ? { contextManifest: command.contextManifest } : {}),
        },
        retryTerminal: true,
        attemptCount: (command.attemptCount ?? 1) + index,
      })

      if (call.status === AiModelCallStatus.SUCCEEDED) return restoreCompletedCall<T>(call, command.usage)
      if (call.status === AiModelCallStatus.FAILED || call.status === AiModelCallStatus.CANCELLED) {
        throw new WorkflowExecutionError('MODEL', call.errorCode ?? 6005, true, '模型调用已失败')
      }

      if (command.workerId && this.events) {
        await this.events.appendEvent(command.run.id, {
          workerId: command.workerId,
          eventType: 'model.started',
          stepId: command.stepId,
          traceId: command.run.traceId,
          payload: {
            modelCallId: call.id,
            provider: descriptor.provider,
            model: descriptor.model,
            purpose: command.purpose,
          },
        })
      }

      try {
        const streamObserver = this.createStreamObserver(command, call.id, {
          messageCount: command.messages.length,
          estimatedInputTokens,
          maxOutputTokens: command.maxOutputTokens,
          contextWindow: descriptor.contextWindow,
        })
        const result = await this.gateway.generateStructuredForModel<T>(
          createModelRequest(command, call.id),
          descriptor,
          command.signal,
          streamObserver,
        )
        const cost = this.estimateCost(descriptor, result.completion.usage)
        await this.audit.finishModelCall(command.run.userId, call.id, {
          output: { data: result.data, repaired: result.repaired },
          providerRequestId: result.completion.providerRequestId,
          inputTokens: result.completion.usage?.inputTokens,
          outputTokens: result.completion.usage?.outputTokens,
          cachedTokens: result.completion.usage?.cachedTokens,
          reasoningTokens: result.completion.usage?.reasoningTokens,
          cost: cost.amount,
          costCurrency: cost.currency,
          costEstimated: cost.estimated,
          latencyMs: Date.now() - startedAt,
          finishReason: result.completion.finishReason,
        })
        const usage = mergeUsage(command.usage, result.completion.usage, cost, command.limits)
        this.budgets.assertUsage(usage, command.limits)
        await this.appendModelCompletedEvent(command, call.id, descriptor, Date.now() - startedAt, result)
        return {
          data: result.data,
          usage,
          modelCallId: call.id,
          modelName: result.completion.model,
          repaired: result.repaired,
        }
      } catch (error) {
        const failure = {
          errorClass: error instanceof Error ? error.name : 'ModelError',
          errorCode: error instanceof ModelAbortError ? 6031 : modelErrorCode(error),
          errorMessage: error instanceof Error ? error.message : '模型调用失败',
          durationMs: Date.now() - startedAt,
        }
        if (error instanceof ModelAbortError) {
          await this.audit.cancelModelCall(command.run.userId, call.id, failure)
          throw new WorkflowCancelledError('模型调用已取消')
        }
        await this.audit.failModelCall(command.run.userId, call.id, failure)
        const willFallback = canFallbackToNextModel(error, index, candidates.length)
        await this.appendModelFailedEvent(command, call.id, descriptor, Date.now() - startedAt, error, willFallback)
        if (willFallback && error instanceof ModelGatewayError) {
          await this.appendFallbackEvent(command, descriptor, candidates[index + 1].descriptor, error.category)
          continue
        }
        if (error instanceof ModelGatewayError) {
          throw new WorkflowExecutionError('MODEL', modelErrorCode(error), error.retryable, error.message)
        }
        throw error
      }
    }
    throw new WorkflowExecutionError('MODEL', 6005, true, '模型供应商均不可用')
  }

  resolveInputTokenBudget(
    profile: WorkflowModelProfile,
    usage: WorkflowBudgetUsage,
    limits: WorkflowBudgetLimits,
  ): number {
    this.budgets.assertUsage(usage, limits)
    return this.contextBudgets.resolve(profile, usage, limits).inputBudget
  }

  resolveMaxOutputTokens(
    profile: WorkflowModelProfile,
    usage: WorkflowBudgetUsage,
    limits: WorkflowBudgetLimits,
  ): number {
    return this.contextBudgets.resolve(profile, usage, limits).maxOutputTokens
  }

  resolveModelProfile(run: AgentExecutionRun): WorkflowModelProfile {
    let route: ReturnType<ModelGatewayPort['select']>
    try {
      route = this.gateway.select({
        modelPolicy: run.modelPolicy,
        preferredModel: run.preferredModel,
        purpose: 'PLAN',
        messages: [modelMessage('user', 'route capability check')],
        responseSchema: { type: 'object', additionalProperties: false },
        maxOutputTokens: 1,
        deadlineAt: run.deadlineAt.toISOString(),
        dataClass: 'USER_PRIVATE',
        trace: { runId: run.id, modelCallId: 'route_profile', traceId: run.traceId },
      })
    } catch (error) {
      if (error instanceof ModelGatewayError) {
        throw new WorkflowExecutionError('MODEL', modelErrorCode(error), error.retryable, error.message)
      }
      throw error
    }
    return {
      selectedProvider: route.selected.provider,
      selectedModel: route.selected.model,
      candidates: route.candidates.map(({ descriptor }) => ({
        ...descriptor,
        capabilities: [...descriptor.capabilities],
        reasoningEfforts: [...descriptor.reasoningEfforts],
        dataClasses: [...descriptor.dataClasses],
      })),
    }
  }

  private resolveRouteCandidates(command: WorkflowModelCommand) {
    try {
      return this.gateway.select(createModelRequest(command, 'route_selection')).candidates
    } catch (error) {
      if (error instanceof ModelGatewayError) {
        throw new WorkflowExecutionError('MODEL', modelErrorCode(error), error.retryable, error.message)
      }
      throw error
    }
  }

  private async appendFallbackEvent(
    command: WorkflowModelCommand,
    from: { provider: string; model: string },
    to: { provider: string; model: string },
    reasonCode: string,
  ): Promise<void> {
    if (!command.workerId || !this.events) return
    await this.events.appendEvent(command.run.id, {
      workerId: command.workerId,
      eventType: 'model.fallback',
      stepId: command.stepId,
      traceId: command.run.traceId,
      payload: {
        fromProvider: from.provider,
        fromModel: from.model,
        toProvider: to.provider,
        toModel: to.model,
        reasonCode,
      },
    })
  }

  private createStreamObserver(
    command: WorkflowModelCommand,
    modelCallId: string,
    traceContext: {
      messageCount: number
      estimatedInputTokens: number
      maxOutputTokens: number
      contextWindow: number
    },
  ): ModelStructuredStreamObserver | undefined {
    if (!command.workerId || !this.events) return undefined
    const projector = new ModelStreamPublicProjector(command.purpose, modelCallId, traceContext, async (event) => {
      await this.appendPublicModelStreamEvent(command, event)
    })
    return async (event) => projector.observe(event)
  }

  private async appendPublicModelStreamEvent(
    command: WorkflowModelCommand,
    event: PublicModelStreamEvent,
  ): Promise<void> {
    if (!command.workerId || !this.events) return
    await this.events.appendEvent(command.run.id, {
      workerId: command.workerId,
      eventType: event.eventType,
      stepId: command.stepId,
      traceId: command.run.traceId,
      payload: event.payload,
    })
  }

  private async appendModelCompletedEvent<T>(
    command: WorkflowModelCommand,
    modelCallId: string,
    descriptor: ModelDescriptor,
    durationMs: number,
    result: { repaired: boolean; completion: { usage: ModelUsage | null; finishReason: string | null } },
  ): Promise<void> {
    if (!command.workerId || !this.events) return
    const usage = result.completion.usage
    await this.events.appendEvent(command.run.id, {
      workerId: command.workerId,
      eventType: 'model.completed',
      stepId: command.stepId,
      traceId: command.run.traceId,
      payload: {
        modelCallId,
        provider: descriptor.provider,
        model: descriptor.model,
        purpose: command.purpose,
        durationMs,
        repaired: result.repaired,
        finishReason: result.completion.finishReason,
        usage: usage
          ? {
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              ...(usage.cachedTokens == null ? {} : { cachedTokens: usage.cachedTokens }),
              ...(usage.reasoningTokens == null ? {} : { reasoningTokens: usage.reasoningTokens }),
            }
          : null,
      },
    })
  }

  private async appendModelFailedEvent(
    command: WorkflowModelCommand,
    modelCallId: string,
    descriptor: ModelDescriptor,
    durationMs: number,
    error: unknown,
    willFallback: boolean,
  ): Promise<void> {
    if (!command.workerId || !this.events) return
    await this.events.appendEvent(command.run.id, {
      workerId: command.workerId,
      eventType: 'model.failed',
      stepId: command.stepId,
      traceId: command.run.traceId,
      payload: {
        modelCallId,
        provider: descriptor.provider,
        model: descriptor.model,
        purpose: command.purpose,
        durationMs,
        error: publicModelStreamError(error),
        willFallback,
      },
    })
  }

  private estimateCost(descriptor: ModelDescriptor, usage: ModelUsage | null): AgentCostEstimate {
    return this.costs?.estimate(descriptor, usage) ?? estimateProviderCost(usage)
  }
}

function createModelRequest(command: WorkflowModelCommand, modelCallId: string) {
  return {
    modelPolicy: command.run.modelPolicy,
    preferredModel: command.run.preferredModel,
    purpose: command.purpose,
    messages: command.messages,
    responseSchema: command.responseSchema,
    maxOutputTokens: command.maxOutputTokens,
    deadlineAt: command.run.deadlineAt.toISOString(),
    dataClass: 'USER_PRIVATE' as const,
    trace: { runId: command.run.id, modelCallId, traceId: command.run.traceId },
  }
}

function restoreCompletedCall<T>(
  call: {
    id: string
    outputSummary: unknown
    inputTokens: number | null
    outputTokens: number | null
    cost: { toNumber(): number } | null
    costCurrency: string | null
    model: string
  },
  current: WorkflowBudgetUsage,
): WorkflowModelResult<T> {
  const output = asRecord(call.outputSummary)
  if (!('data' in output)) throw new WorkflowExecutionError('MODEL', 6005, true, '模型审计结果不可恢复')
  const currency = call.costCurrency ?? current.costCurrency
  if (currency !== current.costCurrency && (call.cost?.toNumber() ?? 0) > 0) {
    throw new WorkflowBudgetError('模型审计成本币种与 Run 预算不一致')
  }
  return {
    data: output.data as T,
    repaired: output.repaired === true,
    modelCallId: call.id,
    modelName: call.model,
    usage: {
      ...current,
      inputTokens: current.inputTokens + (call.inputTokens ?? 0),
      outputTokens: current.outputTokens + (call.outputTokens ?? 0),
      cost: current.cost + (call.cost?.toNumber() ?? 0),
    },
  }
}

function mergeUsage(
  current: WorkflowBudgetUsage,
  usage: ModelUsage | null,
  cost: AgentCostEstimate,
  limits: WorkflowBudgetLimits,
): WorkflowBudgetUsage {
  const amount = cost.amount ?? 0
  if (amount > 0 && cost.currency !== limits.costCurrency)
    throw new WorkflowBudgetError('模型成本币种与 Run 预算不一致')
  return {
    ...current,
    inputTokens: current.inputTokens + (usage?.inputTokens ?? 0),
    outputTokens: current.outputTokens + (usage?.outputTokens ?? 0),
    cost: current.cost + amount,
  }
}

function estimateProviderCost(usage: ModelUsage | null): AgentCostEstimate {
  const providerCost = usage?.providerCost
  const amount = providerCost ? Number(providerCost.amount) : Number.NaN
  if (Number.isFinite(amount) && amount >= 0 && providerCost && /^[A-Za-z]{3}$/.test(providerCost.currency)) {
    return {
      amount,
      currency: providerCost.currency.toUpperCase(),
      estimated: providerCost.estimated,
      source: 'provider',
      priceCatalogVersion: null,
    }
  }
  return { amount: null, currency: null, estimated: false, source: null, priceCatalogVersion: null }
}

function modelErrorCode(error: unknown): number {
  if (!(error instanceof ModelGatewayError)) return 6005
  if (error.category === 'RATE_LIMIT') return 6006
  if (error.category === 'TIMEOUT') return 6007
  if (error.category === 'CONTEXT_LENGTH') return 6048
  return 6005
}

function canFallbackToNextModel(error: unknown, index: number, candidateCount: number): boolean {
  return (
    error instanceof ModelGatewayError && error.retryable && !error.visibleOutput && index < candidateCount - 1
  )
}

function publicModelStreamError(error: unknown): {
  code: number
  message: string
  retryable: boolean
  category: 'AUTH' | 'MODEL' | 'TIMEOUT'
} {
  if (!(error instanceof ModelGatewayError)) {
    return { code: 6005, message: '模型调用失败', retryable: true, category: 'MODEL' }
  }
  return {
    code: modelErrorCode(error),
    message: error.message,
    retryable: error.retryable,
    category: error.category === 'AUTH' ? 'AUTH' : error.category === 'TIMEOUT' ? 'TIMEOUT' : 'MODEL',
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

export function modelMessage(role: ModelMessageRole, content: string): NormalizedMessage {
  return { role, content }
}
