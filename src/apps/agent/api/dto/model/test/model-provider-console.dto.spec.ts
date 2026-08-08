import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { CreateModelConnectionDto, CreateModelDeploymentDto } from '../model-provider-console.dto'

describe('模型供应商控制台 DTO', () => {
  it('中文显示名、ASCII connection key 与带点模型 ID 可通过校验', async () => {
    const connection = plainToInstance(CreateModelConnectionDto, {
      connectionKey: 'fishxcode-relay',
      adapterKind: 'openai-chat-compatible',
      displayName: '中转站',
      baseUrl: 'https://api.fishxcode.com/v1',
      apiKey: 'secret',
    })
    const deployment = plainToInstance(CreateModelDeploymentDto, {
      connectionId: 'connection-1',
      modelId: 'gpt-5.6-sol',
      displayName: 'GPT 5.6 Sol',
      priority: 10,
      costTier: 'HIGH',
      contextWindow: 256000,
      maxOutputTokens: 54000,
      capabilities: ['STREAMING', 'REASONING_EFFORT'],
      reasoningMode: 'EFFORT',
      reasoningEfforts: ['LOW', 'XHIGH', 'MAX', 'vendor_ultra'],
      defaultReasoningEffort: 'MAX',
      dataClasses: ['PUBLIC'],
      timeoutMs: 120000,
      maxRetries: 2,
      retryBaseMs: 200,
    })

    await expect(validate(connection)).resolves.toEqual([])
    await expect(validate(deployment)).resolves.toEqual([])
  })

  it('中文 connection key 被字段级规则拒绝', async () => {
    const dto = plainToInstance(CreateModelConnectionDto, {
      connectionKey: '中转站',
      adapterKind: 'openai-responses',
      displayName: '中转站',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'secret',
    })

    const errors = await validate(dto)

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          property: 'connectionKey',
          constraints: expect.objectContaining({ matches: expect.stringContaining('connectionKey') }),
        }),
      ]),
    )
  })

  it.each(['openai/gpt-5.6', 'vendor:model@2026', 'gemini-2.5-pro'])(
    '模型 ID %s 使用独立安全字符规则',
    async (modelId) => {
      const dto = plainToInstance(CreateModelDeploymentDto, {
        connectionId: 'connection-1',
        modelId,
        displayName: '模型',
        priority: 10,
        costTier: 'MEDIUM',
        contextWindow: 128000,
        maxOutputTokens: 8192,
        capabilities: ['STREAMING'],
        reasoningMode: 'AUTO',
        reasoningEfforts: [],
        dataClasses: ['PUBLIC'],
        timeoutMs: 120000,
        maxRetries: 2,
        retryBaseMs: 200,
      })

      expect((await validate(dto)).find((error) => error.property === 'modelId')).toBeUndefined()
    },
  )
})
