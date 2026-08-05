import { Inject, Injectable, Optional } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { AgentContextConfig, type IAgentContextConfig } from 'src/config/agent-context.config'
import { AgentMessageRepository } from '../conversation/agent-message.repository'
import type { PersistedAiMessage } from '../conversation/agent-conversation.types'
import type { AgentExecutionRun } from '../execution/agent-run.repository'
import { AgentEventRepository } from '../execution/agent-event.repository'
import { stableJson } from '../tools/tool-json'
import { WorkflowCancelledError, WorkflowExecutionError } from '../workflow/workflow.errors'
import type { WorkflowBudgetLimits, WorkflowBudgetUsage, WorkflowModelProfile } from '../workflow/workflow.types'
import { modelMessage, WorkflowModelService } from '../workflow/workflow-model.service'
import { ModelContextBudgetService, type ModelContextBudgetPlan } from '../workflow/model-context-budget.service'
import {
  CONVERSATION_SUMMARY_OUTPUT_SCHEMA,
  CONVERSATION_SUMMARY_PROMPT_V1,
  type ConversationSummaryFactOutput,
  type ConversationSummaryModelOutput,
} from './conversation-summary.prompt'
import { ConversationSummaryRepository, type PersistedConversationSummary } from './conversation-summary.repository'
import { ConversationSummaryService, isConversationSummaryContentValid } from './conversation-summary.service'
import { ContextTokenEstimator } from './context-token-estimator'
import { AgentSummaryValidationError, AgentSummaryVersionConflictError } from './memory-repository.errors'

export interface MaybeCompactConversationCommand {
  run: AgentExecutionRun
  modelProfile: WorkflowModelProfile
  stepId: string
  usage: WorkflowBudgetUsage
  limits: WorkflowBudgetLimits
  workerId?: string
  signal?: AbortSignal
  reason?: 'MODEL_CONTEXT_PRESSURE' | 'MODEL_SWITCH'
}

export type MaybeCompactConversationResult =
  | { status: 'CREATED'; summaryId: string; summaryVersion: number; usage: WorkflowBudgetUsage }
  | {
      status: 'SKIPPED'
      reason: 'DISABLED' | 'BELOW_THRESHOLD' | 'RANGE_ALREADY_COMPACTED'
      usage: WorkflowBudgetUsage
    }
  | {
      status: 'WARNING'
      warning:
        | 'SUMMARY_PROMPT_UNAVAILABLE'
        | 'SUMMARY_RANGE_INVALID'
        | 'SUMMARY_GENERATION_FAILED'
        | 'SUMMARY_OUTPUT_INVALID'
        | 'SUMMARY_VERSION_CONFLICT'
      usage: WorkflowBudgetUsage
    }

interface SummarySource {
  messages: PersistedAiMessage[]
  tokenCount: number
}

interface CompactionScan {
  anchorFound: boolean
  throughFound: boolean
  estimatedTokens: number
  protectedFromMessageId: string | null
  required: boolean
}

@Injectable()
export class ConversationSummaryGeneratorService {
  constructor(
    private readonly messages: AgentMessageRepository,
    private readonly summaries: ConversationSummaryRepository,
    private readonly summaryService: ConversationSummaryService,
    private readonly models: WorkflowModelService,
    private readonly estimator: ContextTokenEstimator,
    @Inject(AgentContextConfig.KEY) private readonly config: IAgentContextConfig,
    @Optional() private readonly contextBudgets?: ModelContextBudgetService,
    @Optional() private readonly events?: AgentEventRepository,
  ) {}

  async maybeCompact(command: MaybeCompactConversationCommand): Promise<MaybeCompactConversationResult> {
    if (this.config.summaryEnabled === false) {
      return { status: 'SKIPPED', reason: 'DISABLED', usage: command.usage }
    }
    let currentUsage = command.usage
    let attemptedThroughMessageId: string | null = null

    try {
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        const state = await this.summaries.findCurrentState(command.run.userId, command.run.conversationId)
        const currentSummary =
          state.currentSummary && isConversationSummaryContentValid(state.currentSummary) ? state.currentSummary : null
        if (
          attempt > 1 &&
          attemptedThroughMessageId &&
          currentSummary?.throughMessageId === attemptedThroughMessageId
        ) {
          return { status: 'SKIPPED', reason: 'RANGE_ALREADY_COMPACTED', usage: currentUsage }
        }

        const plan = this.resolveBudgetPlan(command, currentUsage)
        const scan = await this.scanForCompaction(command, currentSummary, plan)
        if (!scan.anchorFound || !scan.throughFound) {
          await this.failRequiredCompaction(command, '会话历史范围无效，无法为目标模型整理上下文')
        }
        if (!scan.required || !scan.protectedFromMessageId) {
          return {
            status: 'SKIPPED',
            reason: attempt > 1 ? 'RANGE_ALREADY_COMPACTED' : 'BELOW_THRESHOLD',
            usage: currentUsage,
          }
        }

        const prompt = await this.summaries.findPublishedPrompt(
          CONVERSATION_SUMMARY_PROMPT_V1.promptKey,
          CONVERSATION_SUMMARY_PROMPT_V1.version,
          CONVERSATION_SUMMARY_PROMPT_V1.contentHash,
        )
        if (!prompt) await this.failRequiredCompaction(command, '会话整理 Prompt 不可用，请稍后重试')

        const source = await this.loadSource(
          command,
          currentSummary,
          scan.protectedFromMessageId,
          plan,
          prompt.template,
        )
        if (source.messages.length === 0) {
          await this.failRequiredCompaction(command, '当前输入无法压缩到目标模型的上下文范围')
        }
        await this.appendCompactionEvent(command, 'context.compaction.started', {
          model: command.modelProfile.selectedModel,
          reason: command.reason ?? 'MODEL_CONTEXT_PRESSURE',
          estimatedTokens: scan.estimatedTokens,
          targetTokens: plan.compactionTargetTokens,
        })

        let generated
        try {
          generated = await this.models.generateStructured<ConversationSummaryModelOutput>({
            run: command.run,
            stepId: command.stepId,
            purpose: 'SUMMARIZE',
            messages: [
              modelMessage('system', prompt.template),
              modelMessage('user', renderSummaryInput(currentSummary, source.messages)),
            ],
            responseSchema: CONVERSATION_SUMMARY_OUTPUT_SCHEMA,
            promptVersionId: prompt.id,
            attemptCount: attempt,
            maxOutputTokens: plan.summaryOutputTokens,
            usage: currentUsage,
            limits: command.limits,
            workerId: command.workerId,
            signal: command.signal,
            modelProfile: command.modelProfile,
          })
        } catch (error) {
          if (error instanceof WorkflowCancelledError) throw error
          await this.failRequiredCompaction(command, '会话整理失败，请重试或切换到上下文更大的模型')
        }
        currentUsage = generated.usage

        let output: ConversationSummaryModelOutput
        try {
          output = validateSummaryOutput(generated.data, currentSummary, source.messages)
        } catch (error) {
          if (!(error instanceof AgentSummaryValidationError)) throw error
          await this.failRequiredCompaction(command, '会话整理结果校验失败，请重试')
        }

        attemptedThroughMessageId = source.messages.at(-1)!.id
        try {
          const created = await this.summaryService.commit(command.run.userId, command.run.conversationId, {
            expectedSummaryVersion: state.summaryVersion,
            fromMessageId: currentSummary?.fromMessageId ?? source.messages[0].id,
            throughMessageId: attemptedThroughMessageId,
            summaryText: output.summaryText,
            facts: output.facts as unknown as Prisma.InputJsonValue[],
            sourceMessageIds: output.sourceMessageIds,
            promptVersionId: prompt.id,
            modelName: generated.modelName,
            sourceTokenCount: (currentSummary?.sourceTokenCount ?? 0) + source.tokenCount,
          })
          await this.appendCompactionEvent(command, 'context.compaction.completed', {
            model: command.modelProfile.selectedModel,
            summaryVersion: created.version,
            sourceMessageCount: source.messages.length,
            sourceTokenCount: source.tokenCount,
          })
          return { status: 'CREATED', summaryId: created.id, summaryVersion: created.version, usage: currentUsage }
        } catch (error) {
          if (error instanceof AgentSummaryVersionConflictError) {
            if (attempt === 1) continue
            await this.failRequiredCompaction(command, '会话正在被其他请求整理，请稍后重试')
          }
          await this.failRequiredCompaction(command, '会话整理结果保存失败，请稍后重试')
        }
      }
    } catch (error) {
      if (error instanceof WorkflowCancelledError || error instanceof WorkflowExecutionError) throw error
      await this.failRequiredCompaction(command, '会话整理失败，请重试或切换到上下文更大的模型')
    }

    return { status: 'WARNING', warning: 'SUMMARY_VERSION_CONFLICT', usage: currentUsage }
  }

  private resolveBudgetPlan(
    command: MaybeCompactConversationCommand,
    usage: WorkflowBudgetUsage,
  ): ModelContextBudgetPlan {
    const planner = this.contextBudgets ?? new ModelContextBudgetService(this.config)
    return planner.resolve(command.modelProfile, usage, command.limits)
  }

  private async scanForCompaction(
    command: MaybeCompactConversationCommand,
    currentSummary: PersistedConversationSummary | null,
    plan: ModelContextBudgetPlan,
  ): Promise<CompactionScan> {
    let beforeMessageId: string | null = null
    let estimatedTokens = 0
    let protectedTokens = 0
    let protectedFromMessageId: string | null = null
    let hasOlderThanProtected = false

    while (true) {
      const page = await this.messages.listCompletedContextRange(command.run.userId, command.run.conversationId, {
        afterMessageId: currentSummary?.throughMessageId ?? null,
        throughMessageId: command.run.triggerMessageId,
        beforeMessageId,
        limit: this.config.queryPageSize,
      })
      if (!page.anchorFound || !page.throughFound || page.cursorFound === false) {
        return {
          anchorFound: page.anchorFound,
          throughFound: page.throughFound,
          estimatedTokens,
          protectedFromMessageId,
          required: false,
        }
      }
      for (const message of [...page.items].reverse()) {
        const messageTokens = this.estimateMessage(message)
        estimatedTokens += messageTokens
        if (protectedFromMessageId == null || protectedTokens + messageTokens <= plan.compactionTargetTokens) {
          protectedTokens += messageTokens
          protectedFromMessageId = message.id
        } else {
          hasOlderThanProtected = true
        }
        if (estimatedTokens > plan.compactionTriggerTokens && hasOlderThanProtected) {
          return { anchorFound: true, throughFound: true, estimatedTokens, protectedFromMessageId, required: true }
        }
      }
      if (!page.hasMore || !page.nextBeforeMessageId) break
      beforeMessageId = page.nextBeforeMessageId
    }
    return { anchorFound: true, throughFound: true, estimatedTokens, protectedFromMessageId, required: false }
  }

  private async loadSource(
    command: MaybeCompactConversationCommand,
    currentSummary: PersistedConversationSummary | null,
    protectedFromMessageId: string,
    plan: ModelContextBudgetPlan,
    promptTemplate: string,
  ): Promise<SummarySource> {
    const selected: PersistedAiMessage[] = []
    let tokenCount = 0
    let cursorAfterMessageId: string | null = null
    while (true) {
      const page = await this.messages.listCompletedSummarySourcePage(command.run.userId, command.run.conversationId, {
        afterMessageId: currentSummary?.throughMessageId ?? null,
        throughMessageId: command.run.triggerMessageId,
        protectedFromMessageId,
        cursorAfterMessageId,
        limit: this.config.queryPageSize,
      })
      if (!page.anchorFound || !page.throughFound || page.cursorFound === false) return { messages: [], tokenCount: 0 }
      for (const message of page.items) {
        const tentative = [...selected, message]
        const inputTokens = this.estimator.estimateMessages([
          modelMessage('system', promptTemplate),
          modelMessage('user', renderSummaryInput(currentSummary, tentative)),
        ])
        if (inputTokens > plan.summaryInputBudget) return { messages: selected, tokenCount }
        selected.push(message)
        tokenCount += this.estimateMessage(message)
      }
      if (!page.hasMore || !page.nextBeforeMessageId) break
      cursorAfterMessageId = page.nextBeforeMessageId
    }
    return { messages: selected, tokenCount }
  }

  private estimateMessage(message: PersistedAiMessage): number {
    return this.estimator.estimateMessages([{ role: message.role, content: messageContent(message) }])
  }

  private async failRequiredCompaction(command: MaybeCompactConversationCommand, message: string): Promise<never> {
    await this.appendCompactionEvent(command, 'context.compaction.failed', {
      model: command.modelProfile.selectedModel,
      code: 6047,
      retryable: true,
      message,
    })
    throw new WorkflowExecutionError('MODEL', 6047, true, message)
  }

  private async appendCompactionEvent(
    command: MaybeCompactConversationCommand,
    eventType: 'context.compaction.started' | 'context.compaction.completed' | 'context.compaction.failed',
    payload: Record<string, unknown>,
  ): Promise<void> {
    if (!command.workerId || !this.events) return
    await this.events.appendEvent(command.run.id, {
      workerId: command.workerId,
      eventType,
      stepId: command.stepId,
      traceId: command.run.traceId,
      payload,
    })
  }
}

function renderSummaryInput(
  currentSummary: PersistedConversationSummary | null,
  messages: readonly PersistedAiMessage[],
): string {
  return `<untrusted-summary-input>${safeJson({
    previousSummary: currentSummary
      ? {
          summaryText: currentSummary.summaryText,
          facts: currentSummary.facts,
          sourceMessageIds: currentSummary.sourceMessageIds,
        }
      : null,
    messages: messages.map((message) => ({
      id: message.id,
      role: message.role,
      content: messageContent(message),
    })),
  })}</untrusted-summary-input>`
}

function validateSummaryOutput(
  value: unknown,
  currentSummary: PersistedConversationSummary | null,
  messages: readonly PersistedAiMessage[],
): ConversationSummaryModelOutput {
  const output = requireExactRecord(value, ['facts', 'sourceMessageIds', 'summaryText'], '摘要输出')
  const summaryText = requireBoundedText(output.summaryText, 'summaryText', 6_000)
  if (!Array.isArray(output.facts) || output.facts.length > 100) {
    throw new AgentSummaryValidationError('facts 必须是不超过 100 项的数组')
  }
  if (!Array.isArray(output.sourceMessageIds) || output.sourceMessageIds.length === 0) {
    throw new AgentSummaryValidationError('sourceMessageIds 必须为非空数组')
  }

  const sourceContent = buildSourceContent(currentSummary, messages)
  const sourceOrder = [...sourceContent.keys()]
  const normalizedSourceIds = normalizeSourceIds(output.sourceMessageIds, sourceOrder, 512)
  const sourceIdSet = new Set(normalizedSourceIds)
  const facts = output.facts.map((entry, index) => {
    const fact = requireExactRecord(entry, ['sourceMessageIds', 'text'], `facts[${index}]`)
    const text = requireBoundedText(fact.text, `facts[${index}].text`, 1_000)
    if (!Array.isArray(fact.sourceMessageIds) || fact.sourceMessageIds.length === 0) {
      throw new AgentSummaryValidationError(`facts[${index}].sourceMessageIds 必须为非空数组`)
    }
    const sourceMessageIds = normalizeSourceIds(fact.sourceMessageIds, sourceOrder, 20)
    if (sourceMessageIds.some((id) => !sourceIdSet.has(id))) {
      throw new AgentSummaryValidationError(`facts[${index}] 引用了顶层 sourceMessageIds 之外的消息`)
    }
    assertAnchorsTraceable(text, sourceMessageIds.map((id) => sourceContent.get(id) ?? '').join('\n'))
    return { text, sourceMessageIds }
  })
  assertAnchorsTraceable(summaryText, [...sourceContent.values()].join('\n'))
  return { summaryText, facts, sourceMessageIds: normalizedSourceIds }
}

function buildSourceContent(
  currentSummary: PersistedConversationSummary | null,
  messages: readonly PersistedAiMessage[],
): Map<string, string> {
  const content = new Map<string, string>()
  if (currentSummary) {
    for (const id of currentSummary.sourceMessageIds as string[]) content.set(id, currentSummary.summaryText)
    for (const value of currentSummary.facts as unknown[]) {
      if (!isFactOutput(value)) continue
      for (const id of value.sourceMessageIds) {
        if (!content.has(id)) continue
        content.set(id, `${content.get(id)}\n${value.text}`)
      }
    }
  }
  for (const message of messages) content.set(message.id, messageContent(message))
  return content
}

function normalizeSourceIds(value: unknown[], sourceOrder: string[], maximum: number): string[] {
  if (value.length > maximum || value.some((id) => typeof id !== 'string')) {
    throw new AgentSummaryValidationError(`sourceMessageIds 必须是不超过 ${maximum} 项的字符串数组`)
  }
  const requested = new Set(value as string[])
  if (requested.size !== value.length) throw new AgentSummaryValidationError('sourceMessageIds 不能重复')
  const normalized = sourceOrder.filter((id) => requested.has(id))
  if (normalized.length !== requested.size) throw new AgentSummaryValidationError('sourceMessageIds 包含范围外消息')
  return normalized
}

function assertAnchorsTraceable(text: string, source: string): void {
  const normalizedSource = normalizeAnchor(source)
  for (const anchor of extractAnchors(text)) {
    if (!normalizedSource.includes(normalizeAnchor(anchor))) {
      throw new AgentSummaryValidationError(`摘要锚点无法回溯：${anchor.slice(0, 40)}`)
    }
  }
}

function extractAnchors(value: string): string[] {
  const anchors = new Set<string>()
  const patterns = [
    /\b\d{6}\.(?:SH|SZ|BJ)\b/giu,
    /(?:19|20)\d{2}(?:[-/.]\d{1,2}){1,2}/gu,
    /[-+]?\d+(?:,\d{3})*(?:\.\d+)?(?:%|亿元|万元|元|万|亿|股|点|倍)?/gu,
  ]
  for (const pattern of patterns) for (const match of value.matchAll(pattern)) anchors.add(match[0])
  for (const match of value.matchAll(/[“"「『]([^”"」』]{1,100})[”"」』]/gu)) anchors.add(match[1])
  return [...anchors]
}

function normalizeAnchor(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[\s,，]/gu, '')
    .toLowerCase()
}

function requireExactRecord(value: unknown, expectedKeys: string[], name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AgentSummaryValidationError(`${name} 必须为对象`)
  }
  const keys = Object.keys(value as Record<string, unknown>).sort()
  if (keys.join(',') !== [...expectedKeys].sort().join(',')) {
    throw new AgentSummaryValidationError(`${name} 字段不符合严格 Schema`)
  }
  return value as Record<string, unknown>
}

function requireBoundedText(value: unknown, name: string, maximum: number): string {
  if (typeof value !== 'string') throw new AgentSummaryValidationError(`${name} 必须为字符串`)
  const normalized = value.trim()
  if (!normalized || normalized.length > maximum) {
    throw new AgentSummaryValidationError(`${name} 长度必须为 1-${maximum}`)
  }
  return normalized
}

function isFactOutput(value: unknown): value is ConversationSummaryFactOutput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return typeof record.text === 'string' && Array.isArray(record.sourceMessageIds)
}

function messageContent(message: PersistedAiMessage): string {
  return message.contentText ?? stableJson(message.contentBlocks)
}

function safeJson(value: unknown): string {
  return stableJson(value).replace(/[<>&]/g, (character) => {
    if (character === '<') return '\\u003c'
    if (character === '>') return '\\u003e'
    return '\\u0026'
  })
}
