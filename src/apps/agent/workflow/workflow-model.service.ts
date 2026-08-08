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
  type ModelTokenCountEstimate,
  type NormalizedMessage,
} from '../model-gateway/model-gateway.port'
import { ModelStreamPublicProjector, type PublicModelStreamEvent } from './model-stream-public-projector'
import { WorkflowBudgetService } from './workflow-budget.service'
import { WorkflowBudgetError, WorkflowCancelledError, WorkflowExecutionError } from './workflow.errors'
import type { WorkflowBudgetLimits, WorkflowBudgetUsage } from './workflow.types'
import type { ContextManifest } from './workflow.types'
import type { WorkflowModelProfile } from './workflow.types'
import { AgentCostService, type AgentCostEstimate } from '../observability/agent-cost.service'
import type { ModelDescriptor, ModelReasoningIntent, ModelUsage } from '../model-gateway/model-gateway.port'
import { ModelContextBudgetService } from './model-context-budget.service'
import { estimateModelRequestTokens } from '../model-gateway/model-token-estimator'

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
    const routeCandidates = command.modelProfile
      ? command.modelProfile.candidates.map((descriptor) => ({ descriptor, reasonCodes: ['RUN_PROFILE'] }))
      : this.resolveRouteCandidates(command)
    const candidates = routeCandidates
    let preflightBudgetError: WorkflowBudgetError | null = null
    let rejectedByContext = 0

    for (let index = 0; index < candidates.length; index += 1) {
      const { descriptor } = candidates[index]
      const reasoning = resolvePurposeReasoning(command.purpose, descriptor)
      const preflightRequest = createModelRequest(command, `preflight_${command.stepId}_${index}`, reasoning)
      const tokenCount = await this.countInputTokens(preflightRequest, descriptor, command.signal)
      const estimatedInputTokens = tokenCount.inputTokens
      if (estimatedInputTokens + command.maxOutputTokens > descriptor.contextWindow) {
        rejectedByContext += 1
        continue
      }
      // Gateway 最多会做一次结构化修复。显式 Run 护栏必须在请求前为该最坏路径留位。
      const runInputReservationTokens =
        estimatedInputTokens * 2 + Math.min(command.maxOutputTokens, descriptor.maxOutputTokens)
      try {
        this.budgets.assertCanCallModel(command.usage, runInputReservationTokens, command.limits)
      } catch (error) {
        if (error instanceof WorkflowBudgetError) {
          preflightBudgetError = error
          continue
        }
        throw error
      }
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
          inputTokenCountSource: tokenCount.source,
          inputTokenCountExact: tokenCount.exact,
          inputTokenSafetyMarginTokens: tokenCount.safetyMarginTokens,
          runInputReservationTokens,
          runMaxCumulativeInputTokens: command.limits.maxCumulativeInputTokens,
          runInputTokensUsedBeforeCall: command.usage.inputTokens,
          runInputGuardrailSource: command.limits.inputTokenGuardrailSource,
          maxOutputTokens: command.maxOutputTokens,
          contextWindow: descriptor.contextWindow,
          capabilities: [...(descriptor.capabilities ?? [])],
          reasoning: reasoning ?? { mode: 'AUTO' },
          dataClass: 'USER_PRIVATE',
          responseSchema: command.responseSchema,
          ...(command.contextManifest ? { contextManifest: command.contextManifest } : {}),
        },
        retryTerminal: true,
        attemptCount: (command.attemptCount ?? 1) + index,
      })

      if (call.status === AiModelCallStatus.SUCCEEDED) {
        const restored = restoreCompletedCall<T>(call, command.usage)
        restored.usage = withAccountingWarnings(restored.usage, command.limits)
        return restored
      }
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

      let providerCompleted = false
      try {
        const streamObserver = this.createStreamObserver(command, call.id, {
          messageCount: command.messages.length,
          estimatedInputTokens,
          inputTokenCountSource: tokenCount.source,
          inputTokenCountExact: tokenCount.exact,
          inputTokenSafetyMarginTokens: tokenCount.safetyMarginTokens,
          runInputReservationTokens,
          runMaxCumulativeInputTokens: command.limits.maxCumulativeInputTokens,
          runInputTokensUsedBeforeCall: command.usage.inputTokens,
          runInputGuardrailSource: command.limits.inputTokenGuardrailSource,
          maxOutputTokens: command.maxOutputTokens,
          contextWindow: descriptor.contextWindow,
        })
        const result = await this.gateway.generateStructuredForModel<T>(
          createModelRequest(command, call.id, reasoning),
          descriptor,
          command.signal,
          streamObserver,
        )
        providerCompleted = true
        const accountedUsage =
          result.completion.usage ?? ({ inputTokens: estimatedInputTokens, outputTokens: 0 } satisfies ModelUsage)
        const cost = this.estimateCost(descriptor, accountedUsage)
        await this.audit.finishModelCall(command.run.userId, call.id, {
          output: { data: result.data, repaired: result.repaired },
          providerRequestId: result.completion.providerRequestId,
          inputTokens: accountedUsage.inputTokens,
          outputTokens: accountedUsage.outputTokens,
          cachedTokens: result.completion.usage?.cachedTokens,
          reasoningTokens: result.completion.usage?.reasoningTokens,
          cost: cost.amount,
          costCurrency: cost.currency,
          costEstimated: cost.estimated,
          latencyMs: Date.now() - startedAt,
          finishReason: result.completion.finishReason,
        })
        const usage = withAccountingWarnings(
          mergeUsage(command.usage, accountedUsage, cost, command.limits),
          command.limits,
        )
        await this.appendModelCompletedEvent(
          command,
          call.id,
          descriptor,
          Date.now() - startedAt,
          result,
          result.completion.usage ? 'PROVIDER_ACTUAL' : 'PREFLIGHT_ESTIMATE',
          usage.accountingWarnings ?? [],
        )
        return {
          data: result.data,
          usage,
          modelCallId: call.id,
          modelName: result.completion.model,
          repaired: result.repaired,
        }
      } catch (error) {
        // Provider 已完成后发生的是本地预算、审计或事件错误，不能把成功模型调用覆盖为 FAILED。
        if (providerCompleted) throw error
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
    if (preflightBudgetError) throw preflightBudgetError
    if (rejectedByContext === candidates.length) {
      throw new WorkflowBudgetError('当前请求与最大输出预留无法装入目标模型单次上下文窗口', 6048)
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
    const snapshot = parseRunModelProfile(run.budget)
    if (snapshot) return snapshot
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
      schemaVersion: 1,
      snapshottedAt: new Date().toISOString(),
      source: 'LEGACY_RUNTIME',
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

  private async countInputTokens(
    request: ReturnType<typeof createModelRequest>,
    descriptor: ModelDescriptor,
    signal?: AbortSignal,
  ): Promise<ModelTokenCountEstimate> {
    return this.gateway.countInputTokensForModel
      ? this.gateway.countInputTokensForModel(request, descriptor, signal)
      : estimateModelRequestTokens(request)
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
      inputTokenCountSource: ModelTokenCountEstimate['source']
      inputTokenCountExact: boolean
      inputTokenSafetyMarginTokens: number
      runInputReservationTokens: number
      runMaxCumulativeInputTokens: number | null
      runInputTokensUsedBeforeCall: number
      runInputGuardrailSource: WorkflowBudgetLimits['inputTokenGuardrailSource']
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

  private async appendModelCompletedEvent(
    command: WorkflowModelCommand,
    modelCallId: string,
    descriptor: ModelDescriptor,
    durationMs: number,
    result: { repaired: boolean; completion: { usage: ModelUsage | null; finishReason: string | null } },
    usageSource: 'PROVIDER_ACTUAL' | 'PREFLIGHT_ESTIMATE',
    accountingWarnings: string[],
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
        usageSource,
        accountingWarnings,
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

function createModelRequest(command: WorkflowModelCommand, modelCallId: string, reasoning?: ModelReasoningIntent) {
  return {
    modelPolicy: command.run.modelPolicy,
    preferredModel: command.run.preferredModel,
    purpose: command.purpose,
    messages: command.messages,
    responseSchema: command.responseSchema,
    maxOutputTokens: command.maxOutputTokens,
    ...(reasoning ? { reasoning } : {}),
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
  usage: ModelUsage,
  cost: AgentCostEstimate,
  limits: WorkflowBudgetLimits,
): WorkflowBudgetUsage {
  const amount = cost.amount ?? 0
  if (amount > 0 && cost.currency !== limits.costCurrency)
    throw new WorkflowBudgetError('模型成本币种与 Run 预算不一致')
  return {
    ...current,
    inputTokens: current.inputTokens + usage.inputTokens,
    outputTokens: current.outputTokens + usage.outputTokens,
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
  if (!(error instanceof ModelGatewayError) || !error.retryable || index >= candidateCount - 1) return false
  // Strict-JSON retries have already discarded the invalid draft. The next model starts a new
  // preview attempt, so a malformed model response is safe to replace rather than fail the run.
  return !error.visibleOutput || error.category === 'INVALID_OUTPUT'
}

function resolvePurposeReasoning(purpose: ModelPurpose, descriptor: ModelDescriptor): ModelReasoningIntent | undefined {
  void purpose
  return descriptor.defaultReasoning
}

function withAccountingWarnings(usage: WorkflowBudgetUsage, limits: WorkflowBudgetLimits): WorkflowBudgetUsage {
  const warnings = new Set(usage.accountingWarnings ?? [])
  if (limits.maxCumulativeInputTokens != null && usage.inputTokens > limits.maxCumulativeInputTokens) {
    warnings.add(
      `模型调用已成功；真实累计输入 ${usage.inputTokens} Token 超过 Run 成本护栏 ${limits.maxCumulativeInputTokens}，已正确记账，后续模型调用将在发送前停止`,
    )
  }
  if (usage.cost > limits.maxCost) {
    warnings.add('模型调用已成功；真实成本超过 Run 成本护栏，已正确记账，后续模型调用将在发送前停止')
  }
  return warnings.size > 0 ? { ...usage, accountingWarnings: [...warnings] } : usage
}

function parseRunModelProfile(rawBudget: unknown): WorkflowModelProfile | null {
  const raw = asRecord(asRecord(rawBudget).modelProfile)
  if (raw.schemaVersion !== 1 || !Array.isArray(raw.candidates) || raw.candidates.length === 0) return null
  const candidates = raw.candidates.filter(isModelDescriptor).map((candidate) => ({
    ...candidate,
    ...(candidate.defaultReasoning ? { defaultReasoning: { ...candidate.defaultReasoning } } : {}),
    capabilities: [...candidate.capabilities],
    reasoningEfforts: [...candidate.reasoningEfforts],
    dataClasses: [...candidate.dataClasses],
  }))
  if (candidates.length !== raw.candidates.length) {
    throw new WorkflowExecutionError('MODEL', 6048, false, 'Run 模型能力快照无效')
  }
  return {
    schemaVersion: 1,
    snapshottedAt: typeof raw.snapshottedAt === 'string' ? raw.snapshottedAt : undefined,
    source: 'RUN_CREATION',
    selectedProvider: typeof raw.selectedProvider === 'string' ? raw.selectedProvider : candidates[0].provider,
    selectedModel: typeof raw.selectedModel === 'string' ? raw.selectedModel : candidates[0].model,
    candidates,
  }
}

function isModelDescriptor(value: unknown): value is ModelDescriptor {
  const item = asRecord(value)
  return (
    typeof item.provider === 'string' &&
    typeof item.model === 'string' &&
    Number.isInteger(item.contextWindow) &&
    (item.contextWindow as number) > 0 &&
    Number.isInteger(item.maxOutputTokens) &&
    (item.maxOutputTokens as number) > 0 &&
    Array.isArray(item.capabilities) &&
    Array.isArray(item.reasoningEfforts) &&
    Array.isArray(item.dataClasses)
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
