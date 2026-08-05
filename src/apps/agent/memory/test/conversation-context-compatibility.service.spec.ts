import { Test } from '@nestjs/testing'
import { AgentContextConfig, buildAgentContextConfig } from 'src/config/agent-context.config'
import { AgentExecutionConfig, buildAgentExecutionConfig } from 'src/config/agent-execution.config'
import { AgentMessageRepository } from '../../conversation/agent-message.repository'
import type { PersistedAiMessage } from '../../conversation/agent-conversation.types'
import type { ModelDescriptor } from '../../model-gateway/model-gateway.port'
import { ModelContextBudgetService } from '../../workflow/model-context-budget.service'
import { ConversationContextCompatibilityService } from '../conversation-context-compatibility.service'
import { ConversationSummaryRepository } from '../conversation-summary.repository'
import { ContextTokenEstimator } from '../context-token-estimator'

describe('ConversationContextCompatibilityService', () => {
  let service: ConversationContextCompatibilityService
  let messages: { findLatestCompletedUserMessage: jest.Mock; listCompletedContextRange: jest.Mock }
  let summaries: { findCurrent: jest.Mock }

  beforeEach(async () => {
    messages = {
      findLatestCompletedUserMessage: jest.fn(),
      listCompletedContextRange: jest.fn(),
    }
    summaries = { findCurrent: jest.fn().mockResolvedValue(null) }
    const moduleRef = await Test.createTestingModule({
      providers: [
        ConversationContextCompatibilityService,
        ModelContextBudgetService,
        ContextTokenEstimator,
        { provide: AgentMessageRepository, useValue: messages },
        { provide: ConversationSummaryRepository, useValue: summaries },
        { provide: AgentContextConfig.KEY, useValue: buildAgentContextConfig({}) },
        { provide: AgentExecutionConfig.KEY, useValue: buildAgentExecutionConfig({}) },
      ],
    }).compile()
    service = moduleRef.get(ConversationContextCompatibilityService)
  })

  it('空会话切换模型直接 READY', async () => {
    messages.findLatestCompletedUserMessage.mockResolvedValue(null)

    await expect(service.assess(7, 'conversation_1', profile())).resolves.toMatchObject({
      status: 'READY',
      willAutoCompactOnNextRun: false,
      targetModel: 'small-v1',
    })
  })

  it('AUTO 预检按 fallback 候选中的最小窗口评估', async () => {
    messages.findLatestCompletedUserMessage.mockResolvedValue(null)
    const selected = { ...descriptor(), model: 'large-v1', contextWindow: 32_768, maxOutputTokens: 8_192 }
    const fallback = descriptor()

    await expect(
      service.assess(7, 'conversation_1', {
        selectedProvider: selected.provider,
        selectedModel: selected.model,
        candidates: [selected, fallback],
      }),
    ).resolves.toMatchObject({ targetModel: 'large-v1', contextWindow: 4_096 })
  })

  it('大上下文切到小模型且历史超过动态触发线时明确告知下一轮自动压缩', async () => {
    messages.findLatestCompletedUserMessage.mockResolvedValue(message('current', '当前问题'))
    messages.listCompletedContextRange.mockResolvedValue({
      anchorFound: true,
      throughFound: true,
      cursorFound: true,
      hasMore: false,
      nextBeforeMessageId: null,
      items: [message('old', '旧'.repeat(1_500)), message('current', '新'.repeat(1_500))],
    })

    await expect(service.assess(7, 'conversation_1', profile())).resolves.toMatchObject({
      status: 'COMPACTION_REQUIRED',
      willAutoCompactOnNextRun: true,
      message: expect.stringContaining('原始消息不会删除'),
    })
  })

  it('最近一条输入本身超过小模型预算时返回 INCOMPATIBLE 而不是静默切换', async () => {
    messages.findLatestCompletedUserMessage.mockResolvedValue(message('current', '大'.repeat(4_000)))
    messages.listCompletedContextRange.mockResolvedValue({
      anchorFound: true,
      throughFound: true,
      cursorFound: true,
      hasMore: false,
      nextBeforeMessageId: null,
      items: [message('current', '大'.repeat(4_000))],
    })

    await expect(service.assess(7, 'conversation_1', profile())).resolves.toMatchObject({
      status: 'INCOMPATIBLE',
      willAutoCompactOnNextRun: false,
      message: expect.stringContaining('上下文更大的模型'),
    })
  })
})

function descriptor(): ModelDescriptor {
  return {
    provider: 'fake',
    model: 'small-v1',
    contextWindow: 4_096,
    maxOutputTokens: 2_048,
    capabilities: ['STREAMING', 'STRUCTURED_OUTPUT'],
    reasoningEfforts: [],
    dataClasses: ['USER_PRIVATE'],
  }
}

function profile() {
  const selected = descriptor()
  return { selectedProvider: selected.provider, selectedModel: selected.model, candidates: [selected] }
}

function message(id: string, contentText: string): PersistedAiMessage {
  return { id, role: 'USER', contentText, contentBlocks: [] } as unknown as PersistedAiMessage
}
