import { Inject, Injectable } from '@nestjs/common'
import { AgentContextConfig, type IAgentContextConfig } from 'src/config/agent-context.config'
import { AgentExecutionConfig, type IAgentExecutionConfig } from 'src/config/agent-execution.config'
import { AgentMessageRepository } from '../conversation/agent-message.repository'
import type { ModelDescriptor } from '../model-gateway/model-gateway.port'
import { stableJson } from '../tools/tool-json'
import { ModelContextBudgetService } from '../workflow/model-context-budget.service'
import type { WorkflowModelProfile } from '../workflow/workflow.types'
import { ConversationSummaryRepository } from './conversation-summary.repository'
import { isConversationSummaryContentValid } from './conversation-summary.service'
import { ContextTokenEstimator } from './context-token-estimator'

export type ConversationContextCompatibilityStatus = 'READY' | 'COMPACTION_REQUIRED' | 'INCOMPATIBLE'

export interface ConversationContextCompatibility {
  status: ConversationContextCompatibilityStatus
  targetModel: string
  contextWindow: number
  estimatedRecentTokens: number
  triggerTokens: number
  targetTokens: number
  willAutoCompactOnNextRun: boolean
  message: string
}

@Injectable()
export class ConversationContextCompatibilityService {
  constructor(
    private readonly messages: AgentMessageRepository,
    private readonly summaries: ConversationSummaryRepository,
    private readonly estimator: ContextTokenEstimator,
    private readonly budgets: ModelContextBudgetService,
    @Inject(AgentContextConfig.KEY) private readonly contextConfig: IAgentContextConfig,
    @Inject(AgentExecutionConfig.KEY) private readonly executionConfig: IAgentExecutionConfig,
  ) {}

  async assess(
    userId: number,
    conversationId: string,
    profile: WorkflowModelProfile,
  ): Promise<ConversationContextCompatibility> {
    const plan = this.budgets.resolve(
      profile,
      { steps: 0, toolCalls: 0, inputTokens: 0, outputTokens: 0, cost: 0, costCurrency: 'CNY' },
      {
        maxSteps: 1,
        maxToolCalls: 0,
        maxParallelTools: 1,
        maxCumulativeInputTokens: this.executionConfig.maxCumulativeInputTokens,
        inputTokenGuardrailSource: this.executionConfig.inputTokenGuardrailSource,
        maxCost: this.executionConfig.maxCostPerRun,
        costCurrency: 'CNY',
      },
    )
    const descriptor =
      profile.candidates.find(
        (candidate) => candidate.provider === profile.selectedProvider && candidate.model === profile.selectedModel,
      ) ?? profile.candidates[0]
    const latest = await this.messages.findLatestCompletedUserMessage(userId, conversationId)
    if (!latest) return result('READY', descriptor, 0, plan, false, '新模型可直接用于下一轮对话')

    const persistedSummary = await this.summaries.findCurrent(userId, conversationId)
    const currentSummary =
      persistedSummary && isConversationSummaryContentValid(persistedSummary) ? persistedSummary : null
    let beforeMessageId: string | null = null
    let estimatedRecentTokens = 0
    let messageCount = 0
    while (true) {
      const page = await this.messages.listCompletedContextRange(userId, conversationId, {
        afterMessageId: currentSummary?.throughMessageId ?? null,
        throughMessageId: latest.id,
        beforeMessageId,
        limit: this.contextConfig.queryPageSize,
      })
      if (!page.anchorFound || !page.throughFound || page.cursorFound === false) {
        return result(
          'INCOMPATIBLE',
          descriptor,
          estimatedRecentTokens,
          plan,
          false,
          '会话历史范围异常，暂时不能安全切换模型',
        )
      }
      for (const message of page.items) {
        estimatedRecentTokens += this.estimator.estimateMessages([
          { role: message.role, content: message.contentText ?? stableJson(message.contentBlocks) },
        ])
        messageCount += 1
      }
      if (estimatedRecentTokens > plan.compactionTriggerTokens) break
      if (!page.hasMore || !page.nextBeforeMessageId) break
      beforeMessageId = page.nextBeforeMessageId
    }

    if (messageCount === 1 && estimatedRecentTokens > plan.inputBudget) {
      return result(
        'INCOMPATIBLE',
        descriptor,
        estimatedRecentTokens,
        plan,
        false,
        '最近一条用户输入本身超过新模型限制，请缩短输入或选择上下文更大的模型',
      )
    }
    if (estimatedRecentTokens > plan.compactionTriggerTokens && messageCount > 1) {
      return result(
        'COMPACTION_REQUIRED',
        descriptor,
        estimatedRecentTokens,
        plan,
        true,
        '下一轮发送前会自动整理历史会话，原始消息不会删除',
      )
    }
    return result('READY', descriptor, estimatedRecentTokens, plan, false, '新模型可直接用于下一轮对话')
  }
}

function result(
  status: ConversationContextCompatibilityStatus,
  descriptor: ModelDescriptor,
  estimatedRecentTokens: number,
  plan: ReturnType<ModelContextBudgetService['resolve']>,
  willAutoCompactOnNextRun: boolean,
  message: string,
): ConversationContextCompatibility {
  return {
    status,
    targetModel: descriptor.model,
    contextWindow: plan.contextWindow,
    estimatedRecentTokens,
    triggerTokens: plan.compactionTriggerTokens,
    targetTokens: plan.compactionTargetTokens,
    willAutoCompactOnNextRun,
    message,
  }
}
