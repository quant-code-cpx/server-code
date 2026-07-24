import { Test } from '@nestjs/testing'
import { AiModelCallStatus } from '@prisma/client'
import { AgentAuditRepository } from '../../audit/agent-audit.repository'
import { AgentEventRepository } from '../../execution/agent-event.repository'
import { ModelAbortError, ModelGatewayError, MODEL_GATEWAY } from '../../model-gateway/model-gateway.port'
import type { AgentExecutionRun } from '../../execution/agent-run.repository'
import { WorkflowBudgetService } from '../workflow-budget.service'
import { WorkflowCancelledError } from '../workflow.errors'
import { WorkflowModelService, type WorkflowModelCommand } from '../workflow-model.service'

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

  let service: WorkflowModelService

  beforeEach(async () => {
    jest.clearAllMocks()
    audit.beginModelCall.mockResolvedValue({ id: 'model_call_1', status: AiModelCallStatus.PENDING })
    audit.cancelModelCall.mockResolvedValue({ id: 'model_call_1', status: AiModelCallStatus.CANCELLED })
    audit.failModelCall.mockResolvedValue({ id: 'model_call_1', status: AiModelCallStatus.FAILED })
    gateway.getCapabilities.mockReturnValue({ provider: 'fake', model: 'fake-v1' })
    gateway.select.mockReturnValue({
      candidates: [{ descriptor: { provider: 'fake', model: 'fake-v1', contextWindow: 32_768 } }],
      considered: [],
      selected: { provider: 'fake', model: 'fake-v1', contextWindow: 32_768 },
    })
    budgets.estimateInputTokens.mockReturnValue(10)

    const moduleRef = await Test.createTestingModule({
      providers: [
        WorkflowModelService,
        { provide: AgentAuditRepository, useValue: audit },
        { provide: AgentEventRepository, useValue: events },
        { provide: WorkflowBudgetService, useValue: budgets },
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

  it('按 Run 剩余额度与目标模型窗口较小值计算输入预算', () => {
    gateway.getCapabilities.mockReturnValue({ provider: 'fake', model: 'small-v1', contextWindow: 4_096 })
    const input = command()
    input.usage.inputTokens = 100
    input.limits.maxInputTokens = 3_000

    expect(service.resolveInputTokenBudget(input.run, input.usage, input.limits, 1_000)).toBe(2_900)
  })

  it('输入加预留输出超过目标模型窗口时在审计前返回 6018', async () => {
    gateway.select.mockReturnValue({
      candidates: [{ descriptor: { provider: 'fake', model: 'tiny-v1', contextWindow: 100 } }],
      considered: [],
      selected: { provider: 'fake', model: 'tiny-v1', contextWindow: 100 },
    })
    const input = command()
    input.maxOutputTokens = 90
    budgets.estimateInputTokens.mockReturnValue(20)

    await expect(service.generateStructured(input)).rejects.toMatchObject({ agentCode: 6018 })
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

    await expect(service.generateStructured(command())).rejects.toThrow('stream interrupted')

    expect(audit.beginModelCall).toHaveBeenCalledTimes(1)
    expect(events.appendEvent).not.toHaveBeenCalledWith(
      'run_1',
      expect.objectContaining({ eventType: 'model.fallback' }),
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
