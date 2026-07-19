import { Inject, Injectable } from '@nestjs/common'
import { AiModelCallStatus } from '@prisma/client'
import { AgentAuditRepository } from '../audit/agent-audit.repository'
import type { AgentExecutionRun } from '../execution/agent-run.repository'
import {
  MODEL_GATEWAY,
  ModelAbortError,
  ModelGatewayError,
  type ModelGatewayPort,
  type ModelMessageRole,
  type ModelPurpose,
  type NormalizedMessage,
} from '../model-gateway/model-gateway.port'
import { WorkflowBudgetService } from './workflow-budget.service'
import { WorkflowBudgetError, WorkflowCancelledError, WorkflowExecutionError } from './workflow.errors'
import type { WorkflowBudgetLimits, WorkflowBudgetUsage } from './workflow.types'

export interface WorkflowModelCommand {
  run: AgentExecutionRun
  stepId: string
  purpose: ModelPurpose
  messages: NormalizedMessage[]
  responseSchema: Record<string, unknown>
  maxOutputTokens: number
  usage: WorkflowBudgetUsage
  limits: WorkflowBudgetLimits
  signal?: AbortSignal
}

export interface WorkflowModelResult<T> {
  data: T
  usage: WorkflowBudgetUsage
  modelName: string
  repaired: boolean
}

@Injectable()
export class WorkflowModelService {
  constructor(
    @Inject(MODEL_GATEWAY) private readonly gateway: ModelGatewayPort,
    private readonly audit: AgentAuditRepository,
    private readonly budgets: WorkflowBudgetService,
  ) {}

  async generateStructured<T>(command: WorkflowModelCommand): Promise<WorkflowModelResult<T>> {
    const estimatedInputTokens = this.budgets.estimateInputTokens(command.messages)
    this.budgets.assertCanCallModel(command.usage, estimatedInputTokens, command.limits)
    const descriptor = this.gateway.getCapabilities(command.run.preferredModel)
    const startedAt = Date.now()
    const call = await this.audit.beginModelCall({
      userId: command.run.userId,
      scopeId: command.run.id,
      runId: command.run.id,
      stepId: command.stepId,
      promptVersionId: command.run.promptVersionId,
      provider: descriptor.provider,
      model: descriptor.model,
      purpose: command.purpose,
      request: {
        purpose: command.purpose,
        messageCount: command.messages.length,
        estimatedInputTokens,
        responseSchema: command.responseSchema,
      },
    })

    if (call.status === AiModelCallStatus.SUCCEEDED) return restoreCompletedCall<T>(call, command.usage)
    if (call.status === AiModelCallStatus.FAILED || call.status === AiModelCallStatus.CANCELLED) {
      throw new WorkflowExecutionError('MODEL', call.errorCode ?? 6005, true, '模型调用已失败')
    }

    let result
    try {
      result = await this.gateway.generateStructured<T>(
        {
          modelPolicy: command.run.modelPolicy,
          preferredModel: command.run.preferredModel,
          purpose: command.purpose,
          messages: command.messages,
          responseSchema: command.responseSchema,
          maxOutputTokens: command.maxOutputTokens,
          deadlineAt: command.run.deadlineAt.toISOString(),
          dataClass: 'USER_PRIVATE',
          trace: { runId: command.run.id, modelCallId: call.id, traceId: command.run.traceId },
        },
        command.signal,
      )
    } catch (error) {
      await this.audit.failModelCall(command.run.userId, call.id, {
        errorClass: error instanceof Error ? error.name : 'ModelError',
        errorCode: modelErrorCode(error),
        errorMessage: error instanceof Error ? error.message : '模型调用失败',
        durationMs: Date.now() - startedAt,
      })
      if (error instanceof ModelAbortError) throw new WorkflowCancelledError('模型调用已取消')
      if (error instanceof ModelGatewayError) {
        throw new WorkflowExecutionError('MODEL', modelErrorCode(error), error.retryable, error.message)
      }
      throw error
    }
    const providerCost = result.completion.usage?.providerCost
    await this.audit.finishModelCall(command.run.userId, call.id, {
      output: { data: result.data, repaired: result.repaired },
      providerRequestId: result.completion.providerRequestId,
      inputTokens: result.completion.usage?.inputTokens,
      outputTokens: result.completion.usage?.outputTokens,
      cachedTokens: result.completion.usage?.cachedTokens,
      reasoningTokens: result.completion.usage?.reasoningTokens,
      cost: providerCost?.amount,
      costCurrency: providerCost?.currency,
      costEstimated: providerCost?.estimated ?? false,
      latencyMs: Date.now() - startedAt,
      finishReason: result.completion.finishReason,
    })
    const usage = mergeUsage(command.usage, result.completion.usage, command.limits)
    this.budgets.assertUsage(usage, command.limits)
    return { data: result.data, usage, modelName: result.completion.model, repaired: result.repaired }
  }
}

function restoreCompletedCall<T>(
  call: {
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
  usage: {
    inputTokens: number
    outputTokens: number
    providerCost?: { amount: string; currency: string }
  } | null,
  limits: WorkflowBudgetLimits,
): WorkflowBudgetUsage {
  const amount = Number(usage?.providerCost?.amount ?? 0)
  const currency = usage?.providerCost?.currency?.toUpperCase() ?? current.costCurrency
  if (amount > 0 && currency !== limits.costCurrency) throw new WorkflowBudgetError('模型成本币种与 Run 预算不一致')
  return {
    ...current,
    inputTokens: current.inputTokens + (usage?.inputTokens ?? 0),
    outputTokens: current.outputTokens + (usage?.outputTokens ?? 0),
    cost: current.cost + (Number.isFinite(amount) ? amount : 0),
  }
}

function modelErrorCode(error: unknown): number {
  if (!(error instanceof ModelGatewayError)) return 6005
  if (error.category === 'RATE_LIMIT') return 6006
  if (error.category === 'TIMEOUT') return 6007
  return 6005
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

export function modelMessage(role: ModelMessageRole, content: string): NormalizedMessage {
  return { role, content }
}
