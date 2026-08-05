import { Test } from '@nestjs/testing'
import { AiModelCallStatus } from '@prisma/client'
import { AgentAuditRepository } from '../../audit/agent-audit.repository'
import { AgentEventRepository } from '../../execution/agent-event.repository'
import { ModelAbortError, ModelGatewayError, MODEL_GATEWAY } from '../../model-gateway/model-gateway.port'
import type { AgentExecutionRun } from '../../execution/agent-run.repository'
import { WorkflowBudgetService } from '../workflow-budget.service'
import { WorkflowCancelledError } from '../workflow.errors'
import { WorkflowModelService, type WorkflowModelCommand } from '../workflow-model.service'
import { ModelContextBudgetService } from '../model-context-budget.service'

describe('WorkflowModelService', () => {
  const audit = {
    beginModelCall: jest.fn(),
    cancelModelCall: jest.fn(),
    failModelCall: jest.fn(),
    finishModelCall: jest.fn(),
  }
  const gateway = {
    getCapabilities: jest.fn(),
    select: jest.fn(),
    generateStructuredForModel: jest.fn(),
  }
  const events = { appendEvent: jest.fn() }
  const budgets = {
    estimateInputTokens: jest.fn(),
    assertCanCallModel: jest.fn(),
    assertUsage: jest.fn(),
  }
  const contextBudgets = { resolve: jest.fn() }

  let service: WorkflowModelService

  beforeEach(async () => {
    jest.clearAllMocks()
    audit.beginModelCall.mockResolvedValue({ id: 'model_call_1', status: AiModelCallStatus.PENDING })
    audit.cancelModelCall.mockResolvedValue({ id: 'model_call_1', status: AiModelCallStatus.CANCELLED })
    audit.failModelCall.mockResolvedValue({ id: 'model_call_1', status: AiModelCallStatus.FAILED })
    gateway.getCapabilities.mockReturnValue({ provider: 'fake', model: 'fake-v1', maxOutputTokens: 4_096 })
    gateway.select.mockReturnValue({
      candidates: [{ descriptor: { provider: 'fake', model: 'fake-v1', contextWindow: 32_768 } }],
      considered: [],
      selected: { provider: 'fake', model: 'fake-v1', contextWindow: 32_768 },
    })
    budgets.estimateInputTokens.mockReturnValue(10)
    contextBudgets.resolve.mockReturnValue({ inputBudget: 2_900, maxOutputTokens: 4_096 })

    const moduleRef = await Test.createTestingModule({
      providers: [
        WorkflowModelService,
        { provide: AgentAuditRepository, useValue: audit },
        { provide: AgentEventRepository, useValue: events },
        { provide: WorkflowBudgetService, useValue: budgets },
        { provide: ModelContextBudgetService, useValue: contextBudgets },
        { provide: MODEL_GATEWAY, useValue: gateway },
      ],
    }).compile()
    service = moduleRef.get(WorkflowModelService)
  })

  it('模型中止写入 CANCELLED 审计，不误记为 FAILED', async () => {
    gateway.generateStructuredForModel.mockRejectedValue(new ModelAbortError())

    await expect(service.generateStructured(command())).rejects.toBeInstanceOf(WorkflowCancelledError)

    expect(audit.cancelModelCall).toHaveBeenCalledWith(
      7,
      'model_call_1',
      expect.objectContaining({ errorClass: 'ModelAbortError', errorCode: 6031 }),
    )
    expect(audit.failModelCall).not.toHaveBeenCalled()
  })

  it('普通模型错误仍写入 FAILED 审计', async () => {
    gateway.generateStructuredForModel.mockRejectedValue(new ModelGatewayError('UNAVAILABLE', true, 'provider down'))

    await expect(service.generateStructured(command())).rejects.toThrow('provider down')

    expect(audit.failModelCall).toHaveBeenCalledWith(
      7,
      'model_call_1',
      expect.objectContaining({ errorClass: 'ModelGatewayError', errorMessage: 'provider down' }),
    )
    expect(audit.cancelModelCall).not.toHaveBeenCalled()
  })

  it('ModelCall 审计只记录 context manifest，不记录模型消息正文', async () => {
    gateway.generateStructuredForModel.mockResolvedValue({
      data: { ok: true },
      repaired: false,
      completion: {
        provider: 'fake',
        model: 'fake-v1',
        providerRequestId: null,
        usage: { inputTokens: 12, outputTokens: 3 },
        finishReason: 'stop',
      },
    })
    const input = command()
    input.messages = [{ role: 'user', content: 'MODEL_MESSAGE_CANARY_PRIVATE' }]
    input.contextManifest = {
      schemaVersion: 1,
      runId: 'run_1',
      conversationId: 'conversation_1',
      budgetTokens: 1_000,
      totalTokens: 12,
      contentHash: 'a'.repeat(64),
      segments: [{ kind: 'RECENT_MESSAGES', ids: ['message_1'], contentHash: 'b'.repeat(64), tokenCount: 12 }],
      warnings: [],
    }

    await service.generateStructured(input)

    const auditRequest = audit.beginModelCall.mock.calls[0][0].request
    expect(auditRequest.contextManifest).toEqual(input.contextManifest)
    expect(JSON.stringify(auditRequest)).not.toContain('MODEL_MESSAGE_CANARY_PRIVATE')
    expect(auditRequest).not.toHaveProperty('messages')
  })

  it('有执行租约时投影可诊断模型生命周期，不公开模型消息或推理文本', async () => {
    gateway.generateStructuredForModel.mockImplementation(async (_request, _model, _signal, observer) => {
      await observer({ type: 'ATTEMPT_STARTED', repairAttempt: 0 })
      await observer({
        type: 'CHUNK',
        repairAttempt: 0,
        chunk: { type: 'REASONING_ACTIVITY', characters: 64 },
      })
      await observer({
        type: 'CHUNK',
        repairAttempt: 0,
        chunk: { type: 'OUTPUT_TEXT_DELTA', text: '{"markdown":"公开草稿","claims":[]}' },
      })
      await observer({
        type: 'CHUNK',
        repairAttempt: 0,
        chunk: { type: 'COMPLETED', finishReason: 'stop' },
      })
      return {
        data: { markdown: '公开草稿', claims: [] },
        repaired: false,
        completion: {
          provider: 'fake',
          model: 'fake-v1',
          providerRequestId: null,
          usage: { inputTokens: 12, outputTokens: 3 },
          finishReason: 'stop',
        },
      }
    })
    const input = command()
    input.workerId = 'worker_1'

    await service.generateStructured(input)

    expect(events.appendEvent.mock.calls.map((call) => call[1].eventType)).toEqual([
      'model.started',
      'model.trace',
      'model.preview.reset',
      'model.trace',
      'model.activity',
      'model.preview.delta',
      'model.trace',
      'model.completed',
    ])
    const publicEvents = JSON.stringify(events.appendEvent.mock.calls)
    expect(publicEvents).not.toContain('reasoning_content')
    expect(publicEvents).not.toContain('分析贵州茅台')
    expect(events.appendEvent).toHaveBeenCalledWith(
      'run_1',
      expect.objectContaining({
        eventType: 'model.completed',
        payload: expect.objectContaining({
          modelCallId: 'model_call_1',
          durationMs: expect.any(Number),
          finishReason: 'stop',
          usage: { inputTokens: 12, outputTokens: 3 },
        }),
      }),
    )
  })

  it('按 Run 剩余额度与目标模型窗口较小值计算输入预算', () => {
    gateway.getCapabilities.mockReturnValue({
      provider: 'fake',
      model: 'small-v1',
      contextWindow: 4_096,
      maxOutputTokens: 2_048,
    })
    const input = command()
    input.usage.inputTokens = 100
    input.limits.maxInputTokens = 3_000

    expect(service.resolveInputTokenBudget(modelProfile(), input.usage, input.limits)).toBe(2_900)
    expect(contextBudgets.resolve).toHaveBeenCalledWith(modelProfile(), input.usage, input.limits)
  })

  it('使用模型感知预算器计算输出额度', () => {
    contextBudgets.resolve.mockReturnValue({ inputBudget: 2_900, maxOutputTokens: 6_144 })
    const input = command()

    expect(service.resolveMaxOutputTokens(modelProfile(), input.usage, input.limits)).toBe(6_144)
  })

  it('Run 模型画像按实际 AUTO 路由冻结，并在后续调用中不重新选择', async () => {
    gateway.select.mockReturnValue({
      candidates: [{ descriptor: modelProfile().candidates[0] }],
      considered: [],
      selected: modelProfile().candidates[0],
    })
    const input = command()
    const frozen = service.resolveModelProfile(input.run)
    gateway.select.mockClear()
    gateway.generateStructuredForModel.mockResolvedValue({
      data: { ok: true },
      repaired: false,
      completion: {
        provider: 'fake',
        model: 'fake-v1',
        providerRequestId: null,
        usage: { inputTokens: 12, outputTokens: 3 },
        finishReason: 'stop',
      },
    })

    await service.generateStructured({ ...input, modelProfile: frozen })

    expect(frozen).toMatchObject({ selectedModel: 'fake-v1' })
    expect(gateway.select).not.toHaveBeenCalled()
    expect(gateway.generateStructuredForModel).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ provider: 'fake', model: 'fake-v1' }),
      undefined,
      undefined,
    )
  })

  it('输入加预留输出超过目标模型窗口时在审计前返回明确的 6048', async () => {
    gateway.select.mockReturnValue({
      candidates: [{ descriptor: { provider: 'fake', model: 'tiny-v1', contextWindow: 100 } }],
      considered: [],
      selected: { provider: 'fake', model: 'tiny-v1', contextWindow: 100 },
    })
    const input = command()
    input.maxOutputTokens = 90
    budgets.estimateInputTokens.mockReturnValue(20)

    await expect(service.generateStructured(input)).rejects.toMatchObject({ agentCode: 6048 })
    expect(audit.beginModelCall).not.toHaveBeenCalled()
  })

  it('摘要调用可固定独立 Prompt 版本和 CAS 重算 attempt', async () => {
    gateway.generateStructuredForModel.mockResolvedValue({
      data: { summaryText: '摘要' },
      repaired: false,
      completion: {
        provider: 'fake',
        model: 'fake-v1',
        providerRequestId: null,
        usage: { inputTokens: 12, outputTokens: 3 },
        finishReason: 'stop',
      },
    })
    const input = command()
    input.purpose = 'SUMMARIZE'
    input.promptVersionId = 'summary_prompt_1'
    input.attemptCount = 2

    await service.generateStructured(input)

    expect(audit.beginModelCall).toHaveBeenCalledWith(
      expect.objectContaining({
        purpose: 'SUMMARIZE',
        promptVersionId: 'summary_prompt_1',
        attemptCount: 2,
      }),
    )
  })

  it('无可见输出的可重试失败切换模型，每次尝试独立审计', async () => {
    gateway.select.mockReturnValue({
      candidates: [
        { descriptor: { provider: 'primary', model: 'primary-v1', contextWindow: 32_768 } },
        { descriptor: { provider: 'secondary', model: 'secondary-v1', contextWindow: 32_768 } },
      ],
      considered: [],
      selected: { provider: 'primary', model: 'primary-v1', contextWindow: 32_768 },
    })
    audit.beginModelCall
      .mockResolvedValueOnce({ id: 'model_call_primary', status: AiModelCallStatus.PENDING })
      .mockResolvedValueOnce({ id: 'model_call_secondary', status: AiModelCallStatus.PENDING })
    gateway.generateStructuredForModel
      .mockRejectedValueOnce(new ModelGatewayError('UNAVAILABLE', true, 'primary down'))
      .mockResolvedValueOnce({
        data: { ok: true },
        repaired: false,
        completion: {
          provider: 'secondary',
          model: 'secondary-v1',
          providerRequestId: null,
          usage: { inputTokens: 12, outputTokens: 3 },
          finishReason: 'stop',
        },
      })
    const input = command()
    input.workerId = 'worker_1'

    const result = await service.generateStructured(input)

    expect(result.modelCallId).toBe('model_call_secondary')
    expect(audit.beginModelCall).toHaveBeenCalledTimes(2)
    expect(audit.beginModelCall.mock.calls[0][0]).toMatchObject({
      provider: 'primary',
      model: 'primary-v1',
      attemptCount: 1,
    })
    expect(audit.beginModelCall.mock.calls[1][0]).toMatchObject({
      provider: 'secondary',
      model: 'secondary-v1',
      attemptCount: 2,
    })
    expect(audit.failModelCall).toHaveBeenCalledWith(7, 'model_call_primary', expect.any(Object))
    expect(audit.finishModelCall).toHaveBeenCalledWith(7, 'model_call_secondary', expect.any(Object))
    expect(events.appendEvent).toHaveBeenCalledWith(
      'run_1',
      expect.objectContaining({
        eventType: 'model.fallback',
        payload: expect.objectContaining({
          fromModel: 'primary-v1',
          toModel: 'secondary-v1',
          reasonCode: 'UNAVAILABLE',
        }),
      }),
    )
    expect(events.appendEvent).toHaveBeenCalledWith(
      'run_1',
      expect.objectContaining({
        eventType: 'model.failed',
        payload: expect.objectContaining({
          modelCallId: 'model_call_primary',
          willFallback: true,
          error: expect.objectContaining({ code: 6005, category: 'MODEL' }),
        }),
      }),
    )
  })

  it('首个可见输出后的失败不切换模型', async () => {
    gateway.select.mockReturnValue({
      candidates: [
        { descriptor: { provider: 'primary', model: 'primary-v1', contextWindow: 32_768 } },
        { descriptor: { provider: 'secondary', model: 'secondary-v1', contextWindow: 32_768 } },
      ],
      considered: [],
      selected: { provider: 'primary', model: 'primary-v1', contextWindow: 32_768 },
    })
    audit.beginModelCall.mockResolvedValueOnce({ id: 'model_call_primary', status: AiModelCallStatus.PENDING })
    gateway.generateStructuredForModel.mockRejectedValueOnce(
      new ModelGatewayError('UNAVAILABLE', true, 'stream interrupted', undefined, undefined, true),
    )

    const input = command()
    input.workerId = 'worker_1'
    await expect(service.generateStructured(input)).rejects.toThrow('stream interrupted')

    expect(audit.beginModelCall).toHaveBeenCalledTimes(1)
    expect(events.appendEvent).not.toHaveBeenCalledWith(
      'run_1',
      expect.objectContaining({ eventType: 'model.fallback' }),
    )
    expect(events.appendEvent).toHaveBeenCalledWith(
      'run_1',
      expect.objectContaining({
        eventType: 'model.failed',
        payload: expect.objectContaining({ willFallback: false }),
      }),
    )
  })
})

function command(): WorkflowModelCommand {
  return {
    run: {
      id: 'run_1',
      userId: 7,
      promptVersionId: 'prompt_1',
      preferredModel: null,
      modelPolicy: 'AUTO',
      traceId: 'trace_1',
      deadlineAt: new Date(Date.now() + 60_000),
    } as unknown as AgentExecutionRun,
    stepId: 'step_1',
    purpose: 'SYNTHESIZE',
    messages: [{ role: 'user', content: '分析贵州茅台' }],
    responseSchema: { type: 'object' },
    maxOutputTokens: 128,
    usage: { steps: 1, toolCalls: 1, inputTokens: 0, outputTokens: 0, cost: 0, costCurrency: 'CNY' },
    limits: {
      maxSteps: 8,
      maxToolCalls: 4,
      maxParallelTools: 2,
      maxInputTokens: 10_000,
      maxCost: 10,
      costCurrency: 'CNY',
    },
  }
}

function modelProfile() {
  return {
    selectedProvider: 'fake',
    selectedModel: 'fake-v1',
    candidates: [
      {
        provider: 'fake',
        model: 'fake-v1',
        contextWindow: 32_768,
        maxOutputTokens: 4_096,
        capabilities: ['STREAMING', 'STRUCTURED_OUTPUT'] as const,
        reasoningEfforts: [] as const,
        dataClasses: ['USER_PRIVATE'] as const,
      },
    ],
  }
}
