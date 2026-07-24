import { createHash } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { AiMemoryCategory, AiMemorySensitivity, AiMemoryStatus, AiMessageRole } from '@prisma/client'
import { buildAgentContextConfig } from 'src/config/agent-context.config'
import { canonicalJson } from '../../conversation/agent-conversation.utils'
import type { PersistedAiMessage } from '../../conversation/agent-conversation.types'
import type { AgentExecutionRun } from '../../execution/agent-run.repository'
import type { PersistedConversationSummary } from '../conversation-summary.repository'
import type { PersistedUserMemory } from '../user-memory.repository'
import type { FactPacket, FrozenWorkflowDefinition } from '../../workflow/workflow.types'
import { ContextBuilderService } from '../context-builder.service'
import { ContextTokenEstimator } from '../context-token-estimator'

describe('ContextBuilderService', () => {
  const now = new Date('2026-07-21T08:00:00.000Z')
  const config = { maxTokens: 5_000, recentMessageCount: 20, maxPageContextBytes: 20_000 }
  let messages: { listCompletedContextRange: jest.Mock }
  let summaries: { findCurrent: jest.Mock }
  let memories: { listActive: jest.Mock }
  let builder: ContextBuilderService

  beforeEach(() => {
    messages = {
      listCompletedContextRange: jest.fn().mockResolvedValue({
        anchorFound: true,
        throughFound: true,
        hasMore: false,
        items: [message('m3', AiMessageRole.USER, '分析 600519.SH', 3)],
      }),
    }
    summaries = { findCurrent: jest.fn().mockResolvedValue(null) }
    memories = { listActive: jest.fn().mockResolvedValue([]) }
    builder = new ContextBuilderService(
      messages as never,
      summaries as never,
      memories as never,
      new ContextTokenEstimator(),
      config as never,
    )
  })

  it('按系统、Prompt、页面状态、摘要、最近消息、Tool、有效记忆固定顺序构建模型输入', async () => {
    const summary = validSummary()
    summaries.findCurrent.mockResolvedValue(summary)
    messages.listCompletedContextRange.mockResolvedValue({
      anchorFound: true,
      throughFound: true,
      hasMore: false,
      items: [message('m3', AiMessageRole.USER, '继续比较现金流', 3)],
    })
    memories.listActive.mockResolvedValue([activeMemory('mem_constraint', { maxDrawdown: 0.15 })])

    const context = await builder.build({ run: run(), workflow: workflow(), budget: 2_000, now })
    expect(context.allowedCapabilities).toEqual(['INTERNAL_DATA'])
    const prepared = builder.prepareModelCall({
      context,
      budget: 2_000,
      purpose: 'PLAN',
      instruction: '生成研究计划',
      stageData: { availableTools: [{ name: 'get_stock_overview' }] },
      toolFacts: [fact('tool_1', '2026-07-21')],
    })

    expect(prepared.messages.map((entry) => entry.role)).toEqual([
      'system',
      'system',
      'user',
      'user',
      'user',
      'user',
      'user',
    ])
    expect(prepared.messages.map((entry) => segmentType(entry.content))).toEqual([
      'system_policy',
      'workflow_prompt',
      'page_and_state',
      'conversation_summary',
      'recent_messages',
      'completed_tool_facts',
      'active_user_memories',
    ])
    expect(prepared.messages[4].content.match(/继续比较现金流/g)).toHaveLength(1)
    expect(prepared.manifest.segments.map((segment) => segment.kind)).toEqual([
      'SYSTEM_POLICY',
      'WORKFLOW_PROMPT',
      'PAGE_AND_STATE',
      'CONVERSATION_SUMMARY',
      'RECENT_MESSAGES',
      'COMPLETED_TOOL_FACTS',
      'ACTIVE_USER_MEMORIES',
    ])
    expect(prepared.manifest.totalTokens).toBeLessThanOrEqual(2_000)
  })

  it('把同租户检索报告写入有界 context/manifest，并按检索结果提升相关记忆顺序', async () => {
    const olderRelevant = activeMemory('memory_relevant', { riskStyle: 'low drawdown' })
    const newerOther = {
      ...activeMemory('memory_other', { language: 'zh-CN' }),
      updatedAt: new Date(now.getTime() + 1),
    }
    memories.listActive.mockResolvedValue([newerOther, olderRelevant])
    const retrieval = {
      search: jest.fn().mockResolvedValue({
        requestedMode: 'hybrid',
        effectiveMode: 'hybrid',
        fallback: false,
        latencyMs: 8,
        embeddingInputTokens: 6,
        hits: [
          {
            sourceType: 'MEMORY',
            sourceId: 'memory_relevant',
            chunkIndex: 0,
            content: '低回撤偏好',
            contentHash: 'a'.repeat(64),
            citationIds: [],
            scores: { fts: 0, vector: 0.9, hybrid: 0.585 },
            metadata: {},
          },
          {
            sourceType: 'REPORT',
            sourceId: 'report_owner',
            chunkIndex: 1,
            content: '经营现金流稳定但估值偏高。',
            contentHash: 'b'.repeat(64),
            citationIds: ['citation_owner'],
            scores: { fts: 0.1, vector: 0.8, hybrid: 0.75 },
            metadata: { title: '现金流与估值' },
          },
        ],
      }),
    }
    const retrievalBuilder = new ContextBuilderService(
      messages as never,
      summaries as never,
      memories as never,
      new ContextTokenEstimator(),
      config as never,
      retrieval,
    )

    const context = await retrievalBuilder.build({ run: run(), workflow: workflow(), budget: 2_000, now })
    const prepared = retrievalBuilder.prepareModelCall({
      context,
      budget: 2_000,
      purpose: 'PLAN',
      instruction: '生成研究计划',
    })

    expect(retrieval.search).toHaveBeenCalledWith(
      1,
      '分析 600519.SH',
      { sourceTypes: ['MEMORY', 'REPORT'], dataCutoff: null },
      5,
    )
    expect(context.activeMemories.map((memory) => memory.id)).toEqual(['memory_relevant', 'memory_other'])
    expect(context.retrievedSources).toHaveLength(1)
    expect(prepared.manifest.segments.find((segment) => segment.kind === 'RETRIEVED_SOURCES')?.ids).toEqual([
      'report_owner',
      'citation_owner',
    ])
    expect(
      prepared.messages.find((message) => segmentType(message.content) === 'retrieved_sources')?.content,
    ).toContain('经营现金流稳定但估值偏高')
  })

  it('检索不可用时记录 warning 并继续生成原有上下文', async () => {
    const retrieval = { search: jest.fn().mockRejectedValue(new Error('retrieval unavailable')) }
    const retrievalBuilder = new ContextBuilderService(
      messages as never,
      summaries as never,
      memories as never,
      new ContextTokenEstimator(),
      config as never,
      retrieval,
    )

    const context = await retrievalBuilder.build({ run: run(), workflow: workflow(), budget: 2_000, now })

    expect(context.retrievedSources).toEqual([])
    expect(context.warnings).toContain('RETRIEVAL_UNAVAILABLE')
    expect(context.recentMessages.at(-1)?.content).toBe('分析 600519.SH')
  })

  it('超预算先裁最旧完整消息，保留当前问题且不改写原消息', async () => {
    const oldContent = `旧消息-${'a'.repeat(400)}`
    const currentContent = '当前问题：分析贵州茅台'
    const source = [
      message('m1', AiMessageRole.USER, oldContent, 1),
      message('m2', AiMessageRole.ASSISTANT, `旧回答-${'b'.repeat(400)}`, 2),
      message('m3', AiMessageRole.USER, currentContent, 3),
    ]
    messages.listCompletedContextRange.mockResolvedValue({
      anchorFound: true,
      throughFound: true,
      hasMore: false,
      items: source,
    })
    const context = await builder.build({ run: run(), workflow: workflow(), budget: 2_000, now })
    const minimum = builder.prepareModelCall({
      context: { ...context, recentMessages: [context.recentMessages.at(-1)!] },
      budget: 2_000,
      purpose: 'PLAN',
      instruction: '生成研究计划',
    }).manifest.totalTokens
    const prepared = builder.prepareModelCall({
      context,
      budget: minimum + 10,
      purpose: 'PLAN',
      instruction: '生成研究计划',
    })

    const payload = prepared.messages.find((entry) => segmentType(entry.content) === 'recent_messages')!.content
    expect(payload).toContain(currentContent)
    expect(payload).not.toContain(oldContent)
    expect(prepared.warnings).toContain('RECENT_MESSAGES_TRIMMED')
    expect(source[0].contentText).toBe(oldContent)
  })

  it('系统规则、Prompt 和当前问题本身仍超预算时返回 AI_CONTEXT_TOO_LARGE', async () => {
    messages.listCompletedContextRange.mockResolvedValue({
      anchorFound: true,
      throughFound: true,
      hasMore: false,
      items: [message('m3', AiMessageRole.USER, '中'.repeat(2_000), 3)],
    })
    const context = await builder.build({ run: run('中'.repeat(2_000)), workflow: workflow(), budget: 4_000, now })

    expect(() =>
      builder.prepareModelCall({ context, budget: 40, purpose: 'PLAN', instruction: '生成研究计划' }),
    ).toThrow(expect.objectContaining({ agentCode: 6018, message: expect.stringContaining('Token') }))
  })

  it('摘要 hash 损坏时排除摘要、从原始消息回退并记录 warning', async () => {
    summaries.findCurrent.mockResolvedValue({ ...validSummary(), contentHash: '0'.repeat(64) })

    const context = await builder.build({ run: run(), workflow: workflow(), budget: 2_000, now })

    expect(context.summary).toBeNull()
    expect(context.warnings).toEqual(expect.arrayContaining(['SUMMARY_INVALID', 'SUMMARY_FALLBACK']))
    expect(messages.listCompletedContextRange).toHaveBeenCalledWith(
      1,
      'conversation_1',
      expect.objectContaining({ afterMessageId: null, throughMessageId: 'm3' }),
    )
  })

  it('摘要消息锚点不属于当前会话时安全回退，不拼接摘要', async () => {
    summaries.findCurrent.mockResolvedValue(validSummary())
    messages.listCompletedContextRange
      .mockResolvedValueOnce({ anchorFound: false, throughFound: true, hasMore: false, items: [] })
      .mockResolvedValueOnce({
        anchorFound: true,
        throughFound: true,
        hasMore: false,
        items: [message('m3', AiMessageRole.USER, '分析 600519.SH', 3)],
      })

    const context = await builder.build({ run: run(), workflow: workflow(), budget: 2_000, now })

    expect(context.summary).toBeNull()
    expect(context.warnings).toEqual(expect.arrayContaining(['SUMMARY_RANGE_INVALID', 'SUMMARY_FALLBACK']))
    expect(messages.listCompletedContextRange).toHaveBeenCalledTimes(2)
  })

  it('摘要竞态覆盖当前问题时回退原始消息，当前问题仍只出现一次', async () => {
    summaries.findCurrent.mockResolvedValue({ ...validSummary(), throughMessageId: 'm3' })
    messages.listCompletedContextRange
      .mockResolvedValueOnce({ anchorFound: true, throughFound: true, hasMore: false, items: [] })
      .mockResolvedValueOnce({
        anchorFound: true,
        throughFound: true,
        hasMore: false,
        items: [message('m3', AiMessageRole.USER, '当前问题不可丢', 3)],
      })

    const context = await builder.build({ run: run('当前问题不可丢'), workflow: workflow(), budget: 2_000, now })

    expect(context.summary).toBeNull()
    expect(context.userText).toBe('当前问题不可丢')
    expect(context.warnings).toEqual(expect.arrayContaining(['SUMMARY_RANGE_INVALID', 'SUMMARY_FALLBACK']))
  })

  it('只加载 repository 返回的 active memory，并按旧截止日排除未来领域事实', async () => {
    memories.listActive.mockResolvedValue([
      activeMemory('mem_old', { asOf: '2024-12-31', thesis: '旧事实' }),
      activeMemory('mem_future', { asOf: '2025-01-02', thesis: '未来事实' }),
      activeMemory('mem_preference', { language: 'zh-CN' }, AiMemoryCategory.PREFERENCE),
    ])
    const currentRun = run()
    currentRun.inputSnapshot = {
      conversationState: { acceptedDataCutoffs: { default: '2024-12-31' } },
    }

    const context = await builder.build({ run: currentRun, workflow: workflow(), budget: 2_000, now })

    expect(memories.listActive).toHaveBeenCalledWith(1, now)
    expect(context.activeMemories.map((memory) => memory.id)).toEqual(['mem_old', 'mem_preference'])
    expect(context.warnings).toContain('MEMORY_AFTER_CUTOFF_EXCLUDED')
  })

  it('Tool fact 截止日边界保留等于 D，排除晚于 D', async () => {
    const currentRun = run()
    currentRun.inputSnapshot = {
      conversationState: { acceptedDataCutoffs: { default: '2024-12-31' } },
    }
    const context = await builder.build({ run: currentRun, workflow: workflow(), budget: 2_000, now })
    const prepared = builder.prepareModelCall({
      context,
      budget: 2_000,
      purpose: 'SYNTHESIZE',
      instruction: '生成回答',
      toolFacts: [fact('tool_equal', '2024-12-31'), fact('tool_future', '2025-01-01')],
    })

    const toolSegment = prepared.messages.find((entry) => segmentType(entry.content) === 'completed_tool_facts')
    expect(toolSegment?.content).toContain('tool_equal')
    expect(toolSegment?.content).not.toContain('tool_future')
    expect(prepared.warnings).toContain('TOOL_FACT_AFTER_CUTOFF_EXCLUDED')
  })

  it('conversation state 超限被摘要化时仍以原始结构化截止日过滤未来记忆', async () => {
    const currentRun = run()
    currentRun.inputSnapshot = {
      conversationState: {
        acceptedDataCutoffs: { default: '2024-12-31' },
        oversized: 'x'.repeat(25_000),
      },
    }
    memories.listActive.mockResolvedValue([activeMemory('mem_future', { asOf: '2025-01-01', thesis: '未来事实' })])

    const context = await builder.build({ run: currentRun, workflow: workflow(), budget: 2_000, now })

    expect(context.conversationState).toMatchObject({ truncated: true })
    expect(context.dataCutoff).toBe('2024-12-31')
    expect(context.activeMemories).toEqual([])
  })

  it('manifest 只保存 ID/hash/token，不复制摘要、消息、Tool 或记忆原值', async () => {
    const canary = 'CANARY_PRIVATE_VALUE_7f13'
    const summary = validSummary(canary)
    summaries.findCurrent.mockResolvedValue(summary)
    messages.listCompletedContextRange.mockResolvedValue({
      anchorFound: true,
      throughFound: true,
      hasMore: false,
      items: [message('m3', AiMessageRole.USER, canary, 3)],
    })
    memories.listActive.mockResolvedValue([activeMemory('mem_1', { note: canary })])
    const context = await builder.build({ run: run(canary), workflow: workflow(), budget: 2_000, now })
    const prepared = builder.prepareModelCall({
      context,
      budget: 2_000,
      purpose: 'SYNTHESIZE',
      instruction: '生成回答',
      toolFacts: [{ ...fact('tool_1', '2026-07-21'), summary: canary }],
    })

    const serialized = JSON.stringify(prepared.manifest)
    expect(serialized).not.toContain(canary)
    expect(serialized).toContain(summary.id)
    expect(serialized).toContain('mem_1')
    expect(serialized).toContain('tool_1')
  })

  it('同一输入重复构建得到相同模型消息与 manifest hash', async () => {
    const context = await builder.build({ run: run(), workflow: workflow(), budget: 2_000, now })
    const left = builder.prepareModelCall({
      context,
      budget: 2_000,
      purpose: 'PLAN',
      instruction: '生成研究计划',
    })
    const right = builder.prepareModelCall({
      context,
      budget: 2_000,
      purpose: 'PLAN',
      instruction: '生成研究计划',
    })

    expect(right.messages).toEqual(left.messages)
    expect(right.manifest.contentHash).toBe(left.manifest.contentHash)
    expect(right.manifest.totalTokens).toBe(left.manifest.totalTokens)
  })

  it('PERF：200 消息、100 memory、50 Tool facts 重复构建记录 p50/p95/p99', async () => {
    const perfMessages = Array.from({ length: 200 }, (_, index) =>
      message(
        `perf_message_${index + 1}`,
        index % 2 === 0 ? AiMessageRole.USER : AiMessageRole.ASSISTANT,
        `消息 ${index + 1}`,
        index + 1,
      ),
    )
    const perfMemories = Array.from({ length: 100 }, (_, index) =>
      activeMemory(`perf_memory_${index + 1}`, { preference: `value-${index + 1}` }, AiMemoryCategory.PREFERENCE),
    )
    const perfFacts = Array.from({ length: 50 }, (_, index) => fact(`perf_tool_${index + 1}`, '2026-07-21'))
    messages.listCompletedContextRange.mockResolvedValue({
      anchorFound: true,
      throughFound: true,
      hasMore: false,
      items: perfMessages,
    })
    memories.listActive.mockResolvedValue(perfMemories)
    const perfBuilder = new ContextBuilderService(
      messages as never,
      summaries as never,
      memories as never,
      new ContextTokenEstimator(),
      { maxTokens: 100_000, recentMessageCount: 200, maxPageContextBytes: 20_000 } as never,
    )
    const perfRun = run()
    perfRun.triggerMessageId = 'perf_message_200'
    perfRun.triggerMessage = { id: 'perf_message_200', contentText: '消息 200' } as never
    const context = await perfBuilder.build({ run: perfRun, workflow: workflow(), budget: 100_000, now })
    const samples: number[] = []
    for (let index = 0; index < 20; index += 1) {
      const startedAt = performance.now()
      const prepared = perfBuilder.prepareModelCall({
        context,
        budget: 100_000,
        purpose: 'SYNTHESIZE',
        instruction: '生成回答',
        toolFacts: perfFacts,
      })
      samples.push(performance.now() - startedAt)
      expect(prepared.manifest.totalTokens).toBeLessThanOrEqual(100_000)
      expect(JSON.stringify(prepared.manifest)).not.toContain('value-100')
    }
    samples.sort((left, right) => left - right)
    const percentile = (ratio: number) => samples[Math.min(samples.length - 1, Math.ceil(samples.length * ratio) - 1)]
    const metrics = { p50Ms: percentile(0.5), p95Ms: percentile(0.95), p99Ms: percentile(0.99) }
    expect(Number.isFinite(metrics.p95Ms)).toBe(true)
  })
})

describe('ContextTokenEstimator', () => {
  it('对 ASCII、中文和 emoji 做确定性保守估算', () => {
    const estimator = new ContextTokenEstimator()
    expect(estimator.estimateText('abcd')).toBe(1)
    expect(estimator.estimateText('中文')).toBe(2)
    expect(estimator.estimateText('😀')).toBe(1)
    expect(estimator.estimateMessages([{ role: 'user', content: '中文abcd' }])).toBeGreaterThanOrEqual(7)
  })
})

describe('AgentContextConfig 摘要阈值', () => {
  it('默认启用双阈值，并允许 feature flag 关闭', () => {
    expect(buildAgentContextConfig({})).toMatchObject({
      summaryEnabled: true,
      summaryMinMessageCount: 8,
      summaryTriggerTokens: 2_048,
      summaryMaxSourceTokens: 8_192,
      summaryMaxMessageCount: 500,
      summaryMaxOutputTokens: 1_024,
    })
    expect(buildAgentContextConfig({ AGENT_SUMMARY_ENABLED: 'false' }).summaryEnabled).toBe(false)
  })

  it('最大摘要来源 token/消息数不能小于触发阈值', () => {
    expect(() =>
      buildAgentContextConfig({ AGENT_SUMMARY_TRIGGER_TOKENS: '2048', AGENT_SUMMARY_MAX_SOURCE_TOKENS: '1024' }),
    ).toThrow('AGENT_SUMMARY_MAX_SOURCE_TOKENS')
    expect(() =>
      buildAgentContextConfig({ AGENT_SUMMARY_MIN_MESSAGE_COUNT: '8', AGENT_SUMMARY_MAX_MESSAGE_COUNT: '7' }),
    ).toThrow('AGENT_SUMMARY_MAX_MESSAGE_COUNT')
  })
})

function run(userText = '分析 600519.SH'): AgentExecutionRun {
  return {
    id: 'run_1',
    userId: 1,
    conversationId: 'conversation_1',
    triggerMessageId: 'm3',
    responseMessageId: 'm4',
    inputSnapshot: {
      allowedCapabilities: ['INTERNAL_DATA'],
      allowedScopes: ['MARKET_DATA'],
      pageContext: { route: '/stock/600519.SH' },
      conversationState: { primarySecurity: '600519.SH', acceptedDataCutoffs: {} },
    },
    triggerMessage: { id: 'm3', contentText: userText },
    user: { role: 'USER', status: 'ACTIVE' },
    promptVersion: {
      id: 'prompt_1',
      promptKey: 'stock_research_system',
      version: 1,
      template: 'WORKFLOW_PROMPT_CANARY',
      contentHash: 'a'.repeat(64),
    },
    workflowVersion: { id: 'workflow_version_1' },
  } as unknown as AgentExecutionRun
}

function workflow(): FrozenWorkflowDefinition {
  return {
    key: 'stock_research',
    version: 1,
    contentHash: 'b'.repeat(64),
    promptContentHash: 'a'.repeat(64),
    prompt: { key: 'stock_research_system', version: 1, template: 'WORKFLOW_PROMPT_CANARY' },
  } as unknown as FrozenWorkflowDefinition
}

function message(id: string, role: AiMessageRole, contentText: string, second: number): PersistedAiMessage {
  return {
    id,
    role,
    contentText,
    createdAt: new Date(Date.UTC(2026, 6, 21, 8, 0, second)),
  } as unknown as PersistedAiMessage
}

function validSummary(summaryText = '已讨论贵州茅台盈利质量'): PersistedConversationSummary {
  const facts = [{ entity: '600519.SH' }]
  const sourceMessageIds = ['m1', 'm2']
  return {
    id: 'summary_1',
    conversationId: 'conversation_1',
    fromMessageId: 'm1',
    throughMessageId: 'm2',
    version: 1,
    summaryText,
    facts,
    sourceMessageIds,
    promptVersionId: 'prompt_old',
    modelName: 'summary-model',
    sourceTokenCount: 800,
    contentHash: createHash('sha256').update(canonicalJson({ facts, sourceMessageIds, summaryText })).digest('hex'),
    createdAt: new Date('2026-07-21T07:00:00.000Z'),
  } as unknown as PersistedConversationSummary
}

function activeMemory(
  id: string,
  value: Record<string, unknown>,
  category: AiMemoryCategory = AiMemoryCategory.DOMAIN_FACT,
): PersistedUserMemory {
  return {
    id,
    userId: 1,
    category,
    key: id,
    value,
    sensitivity: AiMemorySensitivity.NORMAL,
    status: AiMemoryStatus.CONFIRMED,
    sourceConversationId: 'conversation_1',
    sourceMessageId: 'm3',
    confidence: 1,
    version: 1,
    validFrom: new Date('2024-01-01T00:00:00.000Z'),
    confirmedAt: new Date('2024-01-01T00:00:00.000Z'),
    expiresAt: new Date('2027-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-07-21T07:00:00.000Z'),
  } as unknown as PersistedUserMemory
}

function fact(toolCallId: string, dataAsOf: string): FactPacket {
  return {
    factId: `fact_${toolCallId}`,
    toolCallId,
    toolKey: 'get_stock_overview',
    title: '个股概览',
    sourceType: 'DATABASE',
    sourceIds: ['source_1'],
    summary: '{"close":1500,"unit":"CNY"}',
    retrievedAt: '2026-07-21T08:00:00.000Z',
    asOf: { dataAsOf },
    timezone: 'Asia/Shanghai',
    warnings: [],
  }
}

function segmentType(content: string): string | null {
  const match = content.match(/^<context-segment type="([^"]+)">/)
  return match?.[1] ?? null
}
