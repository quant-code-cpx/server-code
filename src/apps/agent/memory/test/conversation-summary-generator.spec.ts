import { createHash } from 'node:crypto'
import { AiMessageRole, AiVersionStatus } from '@prisma/client'
import { canonicalJson } from '../../conversation/agent-conversation.utils'
import type { PersistedAiMessage } from '../../conversation/agent-conversation.types'
import type { AgentExecutionRun } from '../../execution/agent-run.repository'
import { WorkflowCancelledError } from '../../workflow/workflow.errors'
import type { WorkflowBudgetLimits, WorkflowBudgetUsage } from '../../workflow/workflow.types'
import { WorkflowModelService } from '../../workflow/workflow-model.service'
import { ConversationSummaryGeneratorService } from '../conversation-summary-generator.service'
import { ConversationSummaryRepository } from '../conversation-summary.repository'
import { ConversationSummaryService } from '../conversation-summary.service'
import { ContextTokenEstimator } from '../context-token-estimator'
import { AgentSummaryVersionConflictError } from '../memory-repository.errors'

describe('ConversationSummaryGeneratorService', () => {
  const config = {
    maxTokens: 16_384,
    recentMessageCount: 20,
    maxPageContextBytes: 20_000,
    summaryEnabled: true,
    summaryMinMessageCount: 8,
    summaryTriggerTokens: 2_048,
    summaryMaxSourceTokens: 8_192,
    summaryMaxMessageCount: 500,
    summaryMaxOutputTokens: 1_024,
  }
  const prompt = {
    id: 'summary_prompt_1',
    promptKey: 'conversation_summary',
    version: 1,
    status: AiVersionStatus.PUBLISHED,
    template: '只根据输入生成严格 JSON 摘要',
    contentHash: 'a'.repeat(64),
  }
  let summaries: {
    findCurrentState: jest.Mock
    findPublishedPrompt: jest.Mock
  }
  let commits: { commit: jest.Mock }
  let messages: { listCompletedSummaryCandidates: jest.Mock }
  let models: { generateStructured: jest.Mock }
  let service: ConversationSummaryGeneratorService

  beforeEach(() => {
    summaries = {
      findCurrentState: jest.fn().mockResolvedValue({ summaryVersion: 0, currentSummary: null }),
      findPublishedPrompt: jest.fn().mockResolvedValue(prompt),
    }
    commits = {
      commit: jest.fn().mockResolvedValue({ id: 'summary_1', version: 1 }),
    }
    messages = {
      listCompletedSummaryCandidates: jest.fn().mockResolvedValue({
        anchorFound: true,
        throughFound: true,
        hasMore: false,
        items: sourceMessages(8, 252),
      }),
    }
    models = {
      generateStructured: jest.fn().mockResolvedValue({
        data: validOutput(sourceMessages(8, 252)),
        usage: usage({ inputTokens: 2_100, outputTokens: 120 }),
        modelCallId: 'model_call_1',
        modelName: 'fake-summary-v1',
        repaired: false,
      }),
    }
    service = new ConversationSummaryGeneratorService(
      messages as never,
      summaries as unknown as ConversationSummaryRepository,
      commits as unknown as ConversationSummaryService,
      models as unknown as WorkflowModelService,
      new ContextTokenEstimator(),
      config as never,
    )
  })

  it('feature flag 关闭时零 DB、零模型调用并保留原 usage', async () => {
    service = new ConversationSummaryGeneratorService(
      messages as never,
      summaries as unknown as ConversationSummaryRepository,
      commits as unknown as ConversationSummaryService,
      models as unknown as WorkflowModelService,
      new ContextTokenEstimator(),
      { ...config, summaryEnabled: false } as never,
    )

    await expect(service.maybeCompact(command())).resolves.toEqual({
      status: 'SKIPPED',
      reason: 'DISABLED',
      usage: usage(),
    })
    expect(summaries.findCurrentState).not.toHaveBeenCalled()
    expect(models.generateStructured).not.toHaveBeenCalled()
  })

  it('RS-EDGE-001：消息数或 token 未同时达到阈值时不调用模型', async () => {
    messages.listCompletedSummaryCandidates.mockResolvedValue({
      anchorFound: true,
      throughFound: true,
      hasMore: false,
      items: sourceMessages(7, 400),
    })

    const result = await service.maybeCompact(command())

    expect(result).toMatchObject({ status: 'SKIPPED', reason: 'BELOW_THRESHOLD', usage: usage() })
    expect(models.generateStructured).not.toHaveBeenCalled()
    expect(commits.commit).not.toHaveBeenCalled()
  })

  it('RS-EDGE-002：8 条且恰好 2048 token 时生成 version 1，当前问题不进入模型输入', async () => {
    const sources = sourceMessages(8, 252)
    messages.listCompletedSummaryCandidates.mockResolvedValue({
      anchorFound: true,
      throughFound: true,
      hasMore: false,
      items: sources,
    })
    models.generateStructured.mockResolvedValue({
      data: validOutput(sources),
      usage: usage({ inputTokens: 2_100, outputTokens: 120 }),
      modelCallId: 'model_call_1',
      modelName: 'fake-summary-v1',
      repaired: false,
    })

    const result = await service.maybeCompact(command())

    expect(result).toMatchObject({ status: 'CREATED', summaryId: 'summary_1', summaryVersion: 1 })
    expect(models.generateStructured).toHaveBeenCalledWith(
      expect.objectContaining({
        purpose: 'SUMMARIZE',
        promptVersionId: prompt.id,
        attemptCount: 1,
        maxOutputTokens: 1_024,
      }),
    )
    const serializedMessages = JSON.stringify(models.generateStructured.mock.calls[0][0].messages)
    expect(serializedMessages).not.toContain('CURRENT_TRIGGER_CANARY')
    expect(commits.commit).toHaveBeenCalledWith(
      7,
      'conversation_1',
      expect.objectContaining({
        expectedSummaryVersion: 0,
        fromMessageId: 'source_1',
        throughMessageId: 'source_8',
        promptVersionId: prompt.id,
        sourceTokenCount: 2_048,
      }),
    )
  })

  it('RS-BIZ-002：增量输入只带当前摘要一次，并保留旧事实来源', async () => {
    const sources = sourceMessages(8, 252, 9)
    const currentSummary = persistedSummary({
      sourceMessageIds: ['source_1'],
      summaryText: '600519.SH 在 2026-07-20 收盘 1490 元',
      facts: [{ text: '600519.SH 在 2026-07-20 收盘 1490 元', sourceMessageIds: ['source_1'] }],
    })
    summaries.findCurrentState.mockResolvedValue({ summaryVersion: 1, currentSummary })
    messages.listCompletedSummaryCandidates.mockResolvedValue({
      anchorFound: true,
      throughFound: true,
      hasMore: false,
      items: sources,
    })
    const output = {
      summaryText: '600519.SH 已比较两个交易日',
      facts: [
        { text: '600519.SH 在 2026-07-20 收盘 1490 元', sourceMessageIds: ['source_1'] },
        { text: '新增消息保持原结论', sourceMessageIds: ['source_9'] },
      ],
      sourceMessageIds: ['source_1', 'source_9'],
    }
    models.generateStructured.mockResolvedValue({
      data: output,
      usage: usage({ inputTokens: 2_200, outputTokens: 150 }),
      modelCallId: 'model_call_1',
      modelName: 'fake-summary-v1',
      repaired: false,
    })

    await service.maybeCompact(command())

    const serialized = JSON.stringify(models.generateStructured.mock.calls[0][0].messages)
    expect(serialized.match(/600519\.SH 在 2026-07-20 收盘 1490 元/g)).toHaveLength(2)
    expect(commits.commit).toHaveBeenCalledWith(
      7,
      'conversation_1',
      expect.objectContaining({
        expectedSummaryVersion: 1,
        fromMessageId: 'source_1',
        throughMessageId: 'source_16',
        sourceMessageIds: ['source_1', 'source_9'],
        sourceTokenCount: 4_096,
      }),
    )
  })

  it('RS-DATA-001：新数字无法回溯时拒绝提交并保留已消耗 usage', async () => {
    models.generateStructured.mockResolvedValue({
      data: {
        summaryText: '新增收益率 999%',
        facts: [{ text: '新增收益率 999%', sourceMessageIds: ['source_1'] }],
        sourceMessageIds: ['source_1'],
      },
      usage: usage({ inputTokens: 2_100, outputTokens: 30 }),
      modelCallId: 'model_call_1',
      modelName: 'fake-summary-v1',
      repaired: false,
    })

    const result = await service.maybeCompact(command())

    expect(result).toEqual({
      status: 'WARNING',
      warning: 'SUMMARY_OUTPUT_INVALID',
      usage: usage({ inputTokens: 2_100, outputTokens: 30 }),
    })
    expect(commits.commit).not.toHaveBeenCalled()
  })

  it.each([
    {
      name: '额外字段',
      output: {
        summaryText: '摘要',
        facts: [{ text: '事实', sourceMessageIds: ['source_1'] }],
        sourceMessageIds: ['source_1'],
        hidden: true,
      },
    },
    {
      name: '范围外来源',
      output: {
        summaryText: '摘要',
        facts: [{ text: '事实', sourceMessageIds: ['other_tenant_message'] }],
        sourceMessageIds: ['other_tenant_message'],
      },
    },
    {
      name: '重复来源',
      output: {
        summaryText: '摘要',
        facts: [{ text: '事实', sourceMessageIds: ['source_1'] }],
        sourceMessageIds: ['source_1', 'source_1'],
      },
    },
  ])('RS-ERR-003/SEC-002：$name 被严格校验拒绝', async ({ output }) => {
    models.generateStructured.mockResolvedValue({
      data: output,
      usage: usage({ inputTokens: 2_100, outputTokens: 30 }),
      modelCallId: 'model_call_1',
      modelName: 'fake-summary-v1',
      repaired: false,
    })

    await expect(service.maybeCompact(command())).resolves.toMatchObject({
      status: 'WARNING',
      warning: 'SUMMARY_OUTPUT_INVALID',
    })
    expect(commits.commit).not.toHaveBeenCalled()
  })

  it('RS-DATA-002：合法来源按真实消息顺序规范化', async () => {
    models.generateStructured.mockResolvedValue({
      data: {
        summaryText: '摘要',
        facts: [{ text: '事实', sourceMessageIds: ['source_2', 'source_1'] }],
        sourceMessageIds: ['source_2', 'source_1'],
      },
      usage: usage({ inputTokens: 2_100, outputTokens: 30 }),
      modelCallId: 'model_call_1',
      modelName: 'fake-summary-v1',
      repaired: false,
    })

    await service.maybeCompact(command())

    expect(commits.commit).toHaveBeenCalledWith(
      7,
      'conversation_1',
      expect.objectContaining({
        sourceMessageIds: ['source_1', 'source_2'],
        facts: [{ text: '事实', sourceMessageIds: ['source_1', 'source_2'] }],
      }),
    )
  })

  it('RS-ERR-001：专用发布态 Prompt 缺失时不调用模型并安全降级', async () => {
    summaries.findPublishedPrompt.mockResolvedValue(null)

    await expect(service.maybeCompact(command())).resolves.toEqual({
      status: 'WARNING',
      warning: 'SUMMARY_PROMPT_UNAVAILABLE',
      usage: usage(),
    })
    expect(models.generateStructured).not.toHaveBeenCalled()
  })

  it('RS-ERR-002：模型失败不提交摘要，返回脱敏 warning', async () => {
    models.generateStructured.mockRejectedValue(new Error('SECRET_PROVIDER_BODY'))

    const result = await service.maybeCompact(command())

    expect(result).toEqual({ status: 'WARNING', warning: 'SUMMARY_GENERATION_FAILED', usage: usage() })
    expect(JSON.stringify(result)).not.toContain('SECRET_PROVIDER_BODY')
    expect(commits.commit).not.toHaveBeenCalled()
  })

  it('RS-ERR-004：用户取消向上终止，不降级成普通 warning', async () => {
    models.generateStructured.mockRejectedValue(new WorkflowCancelledError('用户取消'))

    await expect(service.maybeCompact(command())).rejects.toBeInstanceOf(WorkflowCancelledError)
  })

  it('RS-RACE-001：CAS 冲突后发现同一范围已覆盖，幂等跳过且不重算', async () => {
    commits.commit.mockRejectedValueOnce(new AgentSummaryVersionConflictError())
    summaries.findCurrentState
      .mockResolvedValueOnce({ summaryVersion: 0, currentSummary: null })
      .mockResolvedValueOnce({
        summaryVersion: 1,
        currentSummary: persistedSummary({ version: 1, throughMessageId: 'source_8' }),
      })

    const result = await service.maybeCompact(command())

    expect(result).toMatchObject({ status: 'SKIPPED', reason: 'RANGE_ALREADY_COMPACTED' })
    expect(models.generateStructured).toHaveBeenCalledTimes(1)
  })

  it('RS-RACE-003：连续两次 CAS 冲突时最多重算一次', async () => {
    const secondSources = sourceMessages(8, 252, 9)
    commits.commit.mockRejectedValue(new AgentSummaryVersionConflictError())
    summaries.findCurrentState
      .mockResolvedValueOnce({ summaryVersion: 0, currentSummary: null })
      .mockResolvedValueOnce({
        summaryVersion: 1,
        currentSummary: persistedSummary({ version: 1, throughMessageId: 'source_4', sourceTokenCount: 1_024 }),
      })
    messages.listCompletedSummaryCandidates
      .mockResolvedValueOnce({ anchorFound: true, throughFound: true, hasMore: true, items: sourceMessages(8, 252) })
      .mockResolvedValueOnce({ anchorFound: true, throughFound: true, hasMore: false, items: secondSources })
    models.generateStructured
      .mockResolvedValueOnce({
        data: validOutput(sourceMessages(8, 252)),
        usage: usage({ inputTokens: 2_100, outputTokens: 120 }),
        modelCallId: 'model_call_1',
        modelName: 'fake-summary-v1',
        repaired: false,
      })
      .mockResolvedValueOnce({
        data: validOutput(secondSources),
        usage: usage({ inputTokens: 4_300, outputTokens: 250 }),
        modelCallId: 'model_call_2',
        modelName: 'fake-summary-v1',
        repaired: false,
      })

    const result = await service.maybeCompact(command())

    expect(result).toEqual({
      status: 'WARNING',
      warning: 'SUMMARY_VERSION_CONFLICT',
      usage: usage({ inputTokens: 4_300, outputTokens: 250 }),
    })
    expect(models.generateStructured).toHaveBeenCalledTimes(2)
    expect(models.generateStructured.mock.calls[1][0]).toMatchObject({ attemptCount: 2 })
  })

  it('RS-RACE-002：模型生成期间到达的新消息不混入已冻结范围', async () => {
    const sources = sourceMessages(8, 252)
    const gate = deferred<void>()
    messages.listCompletedSummaryCandidates.mockResolvedValue({
      anchorFound: true,
      throughFound: true,
      hasMore: false,
      items: sources,
    })
    models.generateStructured.mockImplementation(async () => {
      await gate.promise
      return {
        data: validOutput(sources),
        usage: usage({ inputTokens: 2_100, outputTokens: 120 }),
        modelCallId: 'model_call_1',
        modelName: 'fake-summary-v1',
        repaired: false,
      }
    })
    const pending = service.maybeCompact(command())
    await waitFor(() => models.generateStructured.mock.calls.length === 1)
    sources.push(...sourceMessages(1, 252, 9))
    gate.resolve()

    await pending

    const modelInput = JSON.stringify(models.generateStructured.mock.calls[0][0].messages)
    expect(modelInput).not.toContain('source_9')
    expect(commits.commit).toHaveBeenCalledWith(
      7,
      'conversation_1',
      expect.objectContaining({ throughMessageId: 'source_8' }),
    )
  })
})

function command() {
  return {
    run: {
      id: 'run_1',
      userId: 7,
      conversationId: 'conversation_1',
      triggerMessageId: 'trigger_current',
      promptVersionId: 'workflow_prompt_1',
      preferredModel: null,
      modelPolicy: 'AUTO',
      traceId: 'trace_1',
      deadlineAt: new Date(Date.now() + 60_000),
      triggerMessage: { id: 'trigger_current', contentText: 'CURRENT_TRIGGER_CANARY' },
    } as unknown as AgentExecutionRun,
    stepId: 'step_load_context',
    usage: usage(),
    limits: limits(),
  }
}

function sourceMessages(count: number, contentLength: number, start = 1): PersistedAiMessage[] {
  return Array.from({ length: count }, (_, index) => {
    const sequence = start + index
    return {
      id: `source_${sequence}`,
      role: index % 2 === 0 ? AiMessageRole.USER : AiMessageRole.ASSISTANT,
      version: 1,
      contentText: '中'.repeat(contentLength),
      contentBlocks: [],
      createdAt: new Date(Date.UTC(2026, 6, 21, 8, 0, sequence)),
    } as unknown as PersistedAiMessage
  })
}

function validOutput(messages: PersistedAiMessage[]) {
  return {
    summaryText: '保留原结论',
    facts: [{ text: '保留原结论', sourceMessageIds: [messages[0].id] }],
    sourceMessageIds: [messages[0].id],
  }
}

function persistedSummary(overrides: Record<string, unknown> = {}) {
  const summary = {
    id: 'summary_current',
    conversationId: 'conversation_1',
    fromMessageId: 'source_1',
    throughMessageId: 'source_8',
    version: 1,
    summaryText: '旧摘要',
    facts: [{ text: '旧事实', sourceMessageIds: ['source_1'] }],
    sourceMessageIds: ['source_1'],
    promptVersionId: 'old_prompt',
    modelName: 'old-model',
    sourceTokenCount: 2_048,
    createdAt: new Date('2026-07-21T07:00:00.000Z'),
    ...overrides,
  }
  return {
    ...summary,
    contentHash: createHash('sha256')
      .update(
        canonicalJson({
          facts: summary.facts,
          sourceMessageIds: summary.sourceMessageIds,
          summaryText: summary.summaryText,
        }),
      )
      .digest('hex'),
  }
}

function usage(overrides: Partial<WorkflowBudgetUsage> = {}): WorkflowBudgetUsage {
  return { steps: 1, toolCalls: 0, inputTokens: 0, outputTokens: 0, cost: 0, costCurrency: 'CNY', ...overrides }
}

function limits(): WorkflowBudgetLimits {
  return {
    maxSteps: 8,
    maxToolCalls: 10,
    maxParallelTools: 3,
    maxInputTokens: 50_000,
    maxCost: 10,
    costCurrency: 'CNY',
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolver) => {
    resolve = resolver
  })
  return { promise, resolve }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
  throw new Error('等待模型调用超时')
}
