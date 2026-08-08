import type { AgentModelProviderConfig } from 'src/config/model.config'
import { ModelGatewayError, type ModelChunk, type ProviderModelRequest } from '../model-gateway.port'
import { AnthropicMessagesProvider } from '../providers/anthropic-messages.provider'
import { OpenAiResponsesProvider } from '../providers/openai-responses.provider'

describe('原生模型协议适配器', () => {
  it('OpenAI Responses 使用官方 input_tokens 端点计数完整请求并追加安全余量', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ input_tokens: 100 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const provider = new OpenAiResponsesProvider(config('openai-responses'), fetchMock)

    const count = await provider.countInputTokens!(
      request({
        tools: [
          {
            name: 'lookup',
            description: '查询行情',
            parameters: { type: 'object', properties: { code: { type: 'string' } }, required: ['code'] },
          },
        ],
        responseSchema: {
          type: 'object',
          properties: { answer: { type: 'string' } },
          required: ['answer'],
          additionalProperties: false,
        },
      }),
      new AbortController().signal,
    )

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(url).toBe('https://provider.example/v1/responses/input_tokens')
    expect(body).not.toHaveProperty('stream')
    expect(body).not.toHaveProperty('max_output_tokens')
    expect(body.tools).toEqual([expect.objectContaining({ name: 'lookup' })])
    expect(body.text).toEqual(expect.objectContaining({ format: expect.objectContaining({ type: 'json_schema' }) }))
    expect(count).toEqual({
      inputTokens: 132,
      rawInputTokens: 100,
      safetyMarginTokens: 32,
      source: 'OPENAI_INPUT_TOKENS_API',
      exact: true,
    })
  })

  it('Anthropic Messages 使用官方 count_tokens 端点计数完整请求并追加安全余量', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ input_tokens: 200 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const provider = new AnthropicMessagesProvider(config('anthropic-messages'), fetchMock)

    const count = await provider.countInputTokens!(
      request({
        messages: [
          { role: 'system', content: '只依据事实回答。' },
          { role: 'user', content: '比较两家公司。' },
        ],
        tools: [
          {
            name: 'lookup',
            description: '查询财务数据',
            parameters: { type: 'object', properties: { code: { type: 'string' } } },
          },
        ],
      }),
      new AbortController().signal,
    )

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(url).toBe('https://provider.example/v1/messages/count_tokens')
    expect(body).not.toHaveProperty('stream')
    expect(body).not.toHaveProperty('max_tokens')
    expect(body.system).toBe('只依据事实回答。')
    expect(body.tools).toEqual([expect.objectContaining({ name: 'lookup' })])
    expect(count).toEqual({
      inputTokens: 232,
      rawInputTokens: 200,
      safetyMarginTokens: 32,
      source: 'ANTHROPIC_COUNT_TOKENS_API',
      exact: true,
    })
  })

  it('OpenAI Responses 翻译 xhigh 推理、严格结构化输出并解析流事件', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      sseResponse([
        { type: 'response.created', response: { id: 'resp-1' } },
        { type: 'response.reasoning_summary_text.delta', delta: 'hidden reasoning' },
        { type: 'response.output_text.delta', delta: '{"score":7}' },
        {
          type: 'response.completed',
          response: {
            id: 'resp-1',
            status: 'completed',
            usage: {
              input_tokens: 11,
              output_tokens: 7,
              input_tokens_details: { cached_tokens: 3 },
              output_tokens_details: { reasoning_tokens: 2 },
            },
          },
        },
      ]),
    )
    const provider = new OpenAiResponsesProvider(config('openai-responses'), fetchMock)

    const chunks = await collect(
      provider.stream(
        request({
          reasoning: { mode: 'EFFORT', effort: 'XHIGH' },
          responseSchema: {
            type: 'object',
            additionalProperties: false,
            properties: { score: { type: 'integer' } },
            required: ['score'],
          },
        }),
        new AbortController().signal,
      ),
    )

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(String(init.body)) as {
      reasoning: unknown
      text: { format: Record<string, unknown> }
    }
    expect(url).toBe('https://provider.example/v1/responses')
    expect(body.reasoning).toEqual({ effort: 'xhigh' })
    expect(body.text.format).toMatchObject({ type: 'json_schema', strict: true })
    expect(chunks).toContainEqual({ type: 'REASONING_ACTIVITY', characters: 'hidden reasoning'.length })
    expect(JSON.stringify(chunks)).not.toContain('hidden reasoning')
    expect(chunks).toContainEqual({
      type: 'USAGE',
      usage: { inputTokens: 11, outputTokens: 7, cachedTokens: 3, reasoningTokens: 2 },
    })
    expect(chunks).toContainEqual({ type: 'COMPLETED', finishReason: 'completed', providerRequestId: 'resp-1' })
  })

  it('Anthropic Messages 使用 x-api-key、adaptive effort，并合并工具参数与 usage', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      sseResponse([
        { type: 'message_start', message: { id: 'msg-1', usage: { input_tokens: 5 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'OK' } },
        {
          type: 'content_block_start',
          index: 1,
          content_block: { type: 'tool_use', id: 'tool-1', name: 'lookup', input: {} },
        },
        { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"code":' } },
        { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '"600000"}' } },
        { type: 'content_block_stop', index: 1 },
        { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 9 } },
        { type: 'message_stop' },
      ]),
    )
    const provider = new AnthropicMessagesProvider(config('anthropic-messages'), fetchMock)

    const chunks = await collect(
      provider.stream(
        request({
          reasoning: { mode: 'EFFORT', effort: 'MAX' },
          tools: [
            {
              name: 'lookup',
              description: 'lookup data',
              parameters: { type: 'object', properties: { code: { type: 'string' } } },
            },
          ],
        }),
        new AbortController().signal,
      ),
    )

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const headers = new Headers(init.headers)
    const body = JSON.parse(String(init.body)) as {
      thinking: unknown
      output_config: unknown
    }
    expect(url).toBe('https://provider.example/v1/messages')
    expect(headers.get('x-api-key')).toBe('test-key')
    expect(headers.has('authorization')).toBe(false)
    expect(body.thinking).toEqual({ type: 'adaptive' })
    expect(body.output_config).toEqual({ effort: 'max' })
    expect(chunks).toContainEqual({ type: 'OUTPUT_TEXT_DELTA', text: 'OK' })
    expect(chunks).toContainEqual({
      type: 'TOOL_CALL_COMPLETED',
      index: 1,
      providerToolCallId: 'tool-1',
      name: 'lookup',
      arguments: { code: '600000' },
    })
    expect(chunks).toContainEqual({ type: 'USAGE', usage: { inputTokens: 5, outputTokens: 9 } })
  })

  it('OpenAI Responses 暴露配置声明的模型和能力，并拒绝不完整凭证', () => {
    const provider = new OpenAiResponsesProvider(config('openai-responses'), jest.fn())

    expect(provider.listModels()).toEqual([
      expect.objectContaining({ provider: 'openai-responses-deployment', model: 'model-1' }),
    ])
    expect(provider.supports('model-1', ['STREAMING', 'TOOL_CALLING'])).toBe(true)
    expect(provider.supports('other-model', ['STREAMING'])).toBe(false)
    expect(provider.supports('model-1', ['VISION'])).toBe(false)
    expect(() => new OpenAiResponsesProvider({ ...config('openai-responses'), apiKey: null }, jest.fn())).toThrow(
      '配置不完整',
    )
  })

  it('OpenAI Responses 翻译完整消息历史、工具定义、温度和并行工具开关', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(
        sseResponse([{ type: 'response.completed', response: { id: 'resp-history', status: 'completed' } }]),
      )
    const provider = new OpenAiResponsesProvider(config('openai-responses'), fetchMock)

    await collect(
      provider.stream(
        request({
          messages: [
            { role: 'user', content: 'start' },
            {
              role: 'assistant',
              content: '',
              toolCalls: [{ providerToolCallId: 'call-1', name: 'lookup', arguments: { code: '600000' } }],
            },
            { role: 'tool', content: '{"price":10}', toolCallId: 'call-1' },
          ],
          temperature: 0.2,
          reasoning: { mode: 'DISABLED' },
          tools: [
            {
              name: 'lookup',
              description: 'lookup data',
              parameters: { type: 'object', properties: { code: { type: 'string' } } },
            },
          ],
          metadata: { parallelToolCalls: false },
        }),
        new AbortController().signal,
      ),
    )

    const init = fetchMock.mock.calls[0][1] as RequestInit
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(init).toMatchObject({ method: 'POST', redirect: 'error' })
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer test-key')
    expect(body).toMatchObject({
      temperature: 0.2,
      reasoning: { effort: 'none' },
      tool_choice: 'auto',
      parallel_tool_calls: false,
    })
    expect(body.input).toEqual([
      { role: 'user', content: 'start' },
      { role: 'assistant', content: '' },
      { type: 'function_call', call_id: 'call-1', name: 'lookup', arguments: '{"code":"600000"}' },
      { type: 'function_call_output', call_id: 'call-1', output: '{"price":10}' },
    ])
    expect(body.tools).toEqual([expect.objectContaining({ type: 'function', name: 'lookup', strict: true })])
  })

  it('OpenAI Responses 合并工具调用增量，完成时不会重复发出已完成调用', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      sseResponse([
        {
          type: 'response.output_item.added',
          output_index: 2,
          item: { id: 'item-1', call_id: 'call-1', type: 'function_call', name: 'lookup', arguments: '' },
        },
        { type: 'response.function_call_arguments.delta', item_id: 'item-1', delta: '{"code":' },
        { type: 'response.function_call_arguments.delta', item_id: 'item-1', delta: '"600000"}' },
        {
          type: 'response.function_call_arguments.done',
          item_id: 'item-1',
          name: 'lookup',
          arguments: '{"code":"600000"}',
        },
        { type: 'response.completed', response: { id: 'resp-tools', status: 'completed' } },
      ]),
    )
    const provider = new OpenAiResponsesProvider(config('openai-responses'), fetchMock)

    const chunks = await collect(provider.stream(request(), new AbortController().signal))

    expect(chunks.filter((chunk) => chunk.type === 'TOOL_CALL_DELTA')).toEqual([
      { type: 'TOOL_CALL_DELTA', index: 2, providerToolCallId: 'call-1', argumentsDelta: '{"code":' },
      { type: 'TOOL_CALL_DELTA', index: 2, providerToolCallId: 'call-1', argumentsDelta: '"600000"}' },
    ])
    expect(chunks.filter((chunk) => chunk.type === 'TOOL_CALL_COMPLETED')).toEqual([
      {
        type: 'TOOL_CALL_COMPLETED',
        index: 2,
        providerToolCallId: 'call-1',
        name: 'lookup',
        arguments: { code: '600000' },
      },
    ])
  })

  it('OpenAI Responses 在 response.completed 时补全尚未收到 done 的工具调用', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      sseResponse([
        {
          type: 'response.output_item.added',
          item: { type: 'function_call', name: 'lookup', arguments: '{"code":"000001"}' },
        },
        {
          type: 'response.completed',
          response: { id: 'resp-incomplete-reason', incomplete_details: { reason: 'max_output_tokens' } },
        },
      ]),
    )
    const provider = new OpenAiResponsesProvider(config('openai-responses'), fetchMock)

    const chunks = await collect(provider.stream(request(), new AbortController().signal))

    expect(chunks).toContainEqual({
      type: 'TOOL_CALL_COMPLETED',
      index: 0,
      providerToolCallId: 'item-0',
      name: 'lookup',
      arguments: { code: '000001' },
    })
    expect(chunks).toContainEqual({
      type: 'COMPLETED',
      finishReason: 'max_output_tokens',
      providerRequestId: 'resp-incomplete-reason',
    })
  })

  it.each([
    [{ type: 'response.function_call_arguments.delta', item_id: 'missing', delta: '{}' }, '缺少起始事件'],
    [{ type: 'response.function_call_arguments.done', item_id: 'missing', arguments: '{}' }, '缺少起始事件'],
    [{ type: 'response.failed' }, '返回流式错误'],
    [{ type: 'error' }, '返回流式错误'],
  ])('OpenAI Responses 对失序或失败事件立即终止：%o', async (event, message) => {
    const provider = new OpenAiResponsesProvider(
      config('openai-responses'),
      jest.fn().mockResolvedValue(sseResponse([event])),
    )

    await expect(collect(provider.stream(request(), new AbortController().signal))).rejects.toThrow(message)
  })

  it.each([
    ['not-json', '不是完整 JSON'],
    ['[]', '格式非法'],
    ['null', '格式非法'],
  ])('OpenAI Responses 拒绝非法工具参数 %s', async (argumentsText, message) => {
    const provider = new OpenAiResponsesProvider(
      config('openai-responses'),
      jest.fn().mockResolvedValue(
        sseResponse([
          {
            type: 'response.output_item.added',
            item: { id: 'item-1', type: 'function_call', name: 'lookup', arguments: argumentsText },
          },
          { type: 'response.completed', response: { status: 'completed' } },
        ]),
      ),
    )

    await expect(collect(provider.stream(request(), new AbortController().signal))).rejects.toThrow(message)
  })

  it('OpenAI Responses 拒绝缺少工具名、缺少 toolCallId 与不支持的 Token budget', async () => {
    const missingName = new OpenAiResponsesProvider(
      config('openai-responses'),
      jest.fn().mockResolvedValue(
        sseResponse([
          { type: 'response.output_item.added', item: { id: 'item-1', type: 'function_call', arguments: '{}' } },
          { type: 'response.completed', response: { status: 'completed' } },
        ]),
      ),
    )
    await expect(collect(missingName.stream(request(), new AbortController().signal))).rejects.toThrow('格式非法')

    const provider = new OpenAiResponsesProvider(config('openai-responses'), jest.fn())
    await expect(
      collect(
        provider.stream(request({ messages: [{ role: 'tool', content: 'result' }] }), new AbortController().signal),
      ),
    ).rejects.toThrow('缺少 toolCallId')
    await expect(
      collect(
        provider.stream(
          request({ reasoning: { mode: 'TOKEN_BUDGET', budgetTokens: 128 } }),
          new AbortController().signal,
        ),
      ),
    ).rejects.toThrow('不支持 Token budget')
  })

  it('OpenAI Responses 将网络、鉴权、空响应体、非法 usage 与提前断流映射为稳定错误', async () => {
    const networkProvider = new OpenAiResponsesProvider(
      config('openai-responses'),
      jest.fn().mockRejectedValue(new Error('socket closed')),
    )
    await expect(collect(networkProvider.stream(request(), new AbortController().signal))).rejects.toMatchObject({
      category: 'UNAVAILABLE',
      retryable: true,
    })

    const authProvider = new OpenAiResponsesProvider(
      config('openai-responses'),
      jest.fn().mockResolvedValue(new Response('', { status: 401 })),
    )
    await expect(collect(authProvider.stream(request(), new AbortController().signal))).rejects.toMatchObject({
      category: 'AUTH',
      retryable: false,
    })

    const emptyBodyProvider = new OpenAiResponsesProvider(
      config('openai-responses'),
      jest.fn().mockResolvedValue(new Response(null, { status: 200 })),
    )
    await expect(collect(emptyBodyProvider.stream(request(), new AbortController().signal))).rejects.toThrow(
      '未返回响应流',
    )

    const invalidUsageProvider = new OpenAiResponsesProvider(
      config('openai-responses'),
      jest.fn().mockResolvedValue(
        sseResponse([
          {
            type: 'response.completed',
            response: { status: 'completed', usage: { input_tokens: -1, output_tokens: 1 } },
          },
        ]),
      ),
    )
    await expect(collect(invalidUsageProvider.stream(request(), new AbortController().signal))).rejects.toThrow(
      'usage input_tokens 非法',
    )

    const interruptedProvider = new OpenAiResponsesProvider(
      config('openai-responses'),
      jest.fn().mockResolvedValue(sseResponse([{ type: 'response.output_text.delta', delta: 'partial' }])),
    )
    await expect(collect(interruptedProvider.stream(request(), new AbortController().signal))).rejects.toThrow(
      '响应流提前中断',
    )
  })

  it('OpenAI Responses 保留调用方中止原因与已归一化网关错误', async () => {
    const aborted = new AbortController()
    aborted.abort(new Error('cancelled by caller'))
    const abortedProvider = new OpenAiResponsesProvider(
      config('openai-responses'),
      jest.fn().mockRejectedValue(new Error('fetch aborted')),
    )
    await expect(collect(abortedProvider.stream(request(), aborted.signal))).rejects.toThrow('fetch aborted')

    const normalized = new ModelGatewayError('TIMEOUT', true, 'deadline exceeded')
    const normalizedProvider = new OpenAiResponsesProvider(
      config('openai-responses'),
      jest.fn().mockRejectedValue(normalized),
    )
    await expect(collect(normalizedProvider.stream(request(), new AbortController().signal))).rejects.toBe(normalized)
  })
})

function config(kind: AgentModelProviderConfig['kind']): AgentModelProviderConfig {
  return {
    id: `${kind}-deployment`,
    kind,
    displayName: kind,
    defaultModel: 'model-1',
    priority: 10,
    costTier: 'MEDIUM',
    baseUrl: 'https://provider.example/v1',
    apiKey: 'test-key',
    timeoutMs: 30000,
    maxRetries: 0,
    retryBaseMs: 0,
    descriptor: {
      contextWindow: 128000,
      maxOutputTokens: 8192,
      capabilities: ['STREAMING', 'STRUCTURED_OUTPUT', 'TOOL_CALLING', 'REASONING_EFFORT'],
      reasoningEfforts: ['LOW', 'HIGH', 'XHIGH', 'MAX'],
      dataClasses: ['PUBLIC'],
    },
  }
}

function request(overrides: Partial<ProviderModelRequest> = {}): ProviderModelRequest {
  return {
    model: 'model-1',
    modelPolicy: 'MANUAL',
    purpose: 'VERIFY',
    messages: [{ role: 'user', content: 'test' }],
    maxOutputTokens: 128,
    deadlineAt: new Date(Date.now() + 10000).toISOString(),
    trace: { runId: 'run-1', modelCallId: 'call-1', traceId: 'trace-1' },
    ...overrides,
  }
}

function sseResponse(events: object[]): Response {
  const body = `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')}data: [DONE]\n\n`
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

async function collect(stream: AsyncIterable<ModelChunk>): Promise<ModelChunk[]> {
  const chunks: ModelChunk[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}
