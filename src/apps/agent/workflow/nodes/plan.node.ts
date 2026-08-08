import { Injectable } from '@nestjs/common'
import { ContextBuilderService } from '../../memory/context-builder.service'
import { ToolRegistryService } from '../../tools/tool-registry.service'
import { MarketScreeningRequestError, parseMarketScreeningRequest } from '../market-screening-recovery'
import { WorkflowModelService } from '../workflow-model.service'
import type { ResearchPlan } from '../workflow.types'
import { WorkflowValidationError } from '../workflow.errors'
import type { WorkflowNodeExecutionContext, WorkflowNodeHandler } from './workflow-node'

@Injectable()
export class PlanNode implements WorkflowNodeHandler {
  readonly key = 'plan' as const

  constructor(
    private readonly models: WorkflowModelService,
    private readonly tools: ToolRegistryService,
    private readonly contexts: ContextBuilderService,
  ) {}

  async execute({ run, workflow, state, limits, stepId, workerId, signal }: WorkflowNodeExecutionContext) {
    if (!state.context) throw new WorkflowValidationError('plan 节点缺少已加载上下文')
    const modelProfile = state.modelProfile ?? this.models.resolveModelProfile(run)
    const enabledSnapshot = this.tools.freezeSnapshot()
    const selectedKeys = state.toolSelection ? new Set(state.toolSelection.toolKeys) : null
    const allowedEntries = enabledSnapshot.entries.filter(
      (pin) => workflow.toolAllowlist.includes(pin.key) && (!selectedKeys || selectedKeys.has(pin.key)),
    )
    let marketScreening
    try {
      marketScreening = parseMarketScreeningRequest(state.context.userText)
    } catch (error) {
      if (error instanceof MarketScreeningRequestError) throw new WorkflowValidationError(error.message)
      throw error
    }
    const screenStocks = allowedEntries.find((entry) => entry.key === 'screen_stocks')
    if (marketScreening && screenStocks) {
      const targets = marketScreening.scope === 'ALL_A' ? [null] : marketScreening.markets
      return {
        ...state,
        modelProfile,
        plan: {
          intent: 'market_buy_signal_ranking',
          summary:
            marketScreening.scope === 'ALL_A'
              ? '按全 A 股全样本买入信号排序'
              : `按${marketScreening.markets.join('、')}全样本买入信号排序`,
          toolCalls: targets.map((market) => ({
            id: market === null ? 'screen_all_a' : market === '科创板' ? 'screen_star_market' : 'screen_chinext_market',
            toolKey: 'screen_stocks' as const,
            toolVersion: screenStocks.version,
            input: {
              preset: 'buy_signal_ranking',
              ...(market ? { market } : {}),
              pageSize: marketScreening.perMarketLimit,
              minBuySignalCount: 1,
              sortBy: 'buySignalCount',
              sortOrder: 'desc',
            },
            dependsOn: [],
            optional: false,
          })),
        },
      }
    }
    const toolSchemas = this.tools.toModelSchemas({ entries: allowedEntries, signature: enabledSnapshot.signature })
    const maxOutputTokens = this.models.resolveMaxOutputTokens(modelProfile, state.budget, limits)
    const prepared = this.contexts.prepareModelCall({
      context: state.context,
      budget: this.models.resolveInputTokenBudget(modelProfile, state.budget, limits),
      purpose: 'PLAN',
      instruction:
        'Produce a short visible plan for the latest user message. Do not include hidden reasoning. For a dependent Tool input, bind a prior result with {"$toolResult":{"callId":"search","path":["results",0,"urlToken"]}}; callId must be listed in the current call dependsOn. Bind paths address Tool data directly, not a result wrapper. resolve_security data uses candidates, so its first security code is ["candidates",0,"tsCode"], never ["results",0,"tsCode"]. Search snippets select candidates only and never support factual claims. For 科创板 or 创业板 ranking, call screen_stocks once per requested market using market="科创板" or market="创业板". Never approximate either board with exchange because SSE and SZSE include main-board stocks; do not add an unscoped screen_stocks call.',
      stageData: { availableTools: toolSchemas },
    })
    const request = await this.models.generateStructured<ResearchPlan>({
      run,
      stepId,
      purpose: 'PLAN',
      messages: prepared.messages,
      contextManifest: prepared.manifest,
      responseSchema: restrictPlanSchema(workflow.planSchema, allowedEntries),
      maxOutputTokens,
      usage: state.budget,
      limits,
      workerId,
      signal,
      modelProfile,
    })
    return {
      ...state,
      modelProfile,
      context: prepared.context,
      plan: request.data,
      budget: request.usage,
      modelName: request.modelName,
      warnings: [...new Set([...state.warnings, ...prepared.warnings])],
    }
  }
}

function restrictPlanSchema(
  schema: Record<string, unknown>,
  allowedEntries: readonly { key: string; version: number }[],
): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(schema)) as Record<string, unknown>
  const properties = asRecord(clone.properties)
  const toolCalls = asRecord(properties.toolCalls)
  const item = asRecord(toolCalls.items)
  const itemProperties = asRecord(item.properties)
  const toolKey = asRecord(itemProperties.toolKey)
  const allowedKeys = [...new Set(allowedEntries.map((entry) => entry.key))]

  if (allowedKeys.length === 0) {
    toolCalls.maxItems = 0
  } else {
    itemProperties.toolKey = { ...toolKey, enum: allowedKeys }
  }
  item.properties = itemProperties
  toolCalls.items = item
  properties.toolCalls = toolCalls
  clone.properties = properties
  return clone
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}
