import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { buildModelConfig, type IModelConfig, type ModelConfigEnvironment } from 'src/config/model.config'
import { LoggerService } from 'src/shared/logger/logger.service'
import { ModelCapabilityRegistry } from '../model-capability.registry'
import {
  ModelAbortError,
  type ModelChunk,
  type ModelGatewayObserver,
  type ModelProvider,
  type ModelRequest,
  type ProviderModelRequest,
} from '../model-gateway.port'
import { ModelGatewayService } from '../model-gateway.service'
import { FakeModelProvider } from '../providers/fake-model.provider'
import { OpenAiCompatibleProvider } from '../providers/openai-compatible.provider'

type MockHandler = (
  request: IncomingMessage,
  response: ServerResponse,
  body: Record<string, unknown>,
) => void | Promise<void>

describe('Model Gateway 配置', () => {
  it('开发默认 fake；OpenAI-compatible 缺 key/base URL/model/capability 时拒绝', () => {
    expect(buildModelConfig({}, 'development').provider).toBe('fake')
    expect(() => buildModelConfig({ AGENT_MODEL_PROVIDER: 'openai-compatible' }, 'development')).toThrow(
      'AGENT_MODEL_BASE_URL',
    )
    expect(() =>
      buildModelConfig(
        {
          AGENT_MODEL_PROVIDER: 'openai-compatible',
          AGENT_MODEL_BASE_URL: 'http://127.0.0.1:3009/v1',
          AGENT_MODEL_DEFAULT: 'test-model',
          AGENT_MODEL_CAPABILITIES: 'STREAMING',
          AGENT_MODEL_CONTEXT_WINDOW: '8192',
          AGENT_MODEL_MAX_OUTPUT_TOKENS: '1024',
          AGENT_MODEL_DATA_CLASSES: 'PUBLIC',
        },
        'development',
      ),
    ).toThrow('AGENT_MODEL_API_KEY')
  })

  it('生产强制 HTTPS origin allowlist，禁止 HTTP 和 URL userinfo/query', () => {
    const base = {
      AGENT_MODEL_PROVIDER: 'openai-compatible',
      AGENT_MODEL_API_KEY: 'test-only-key',
      AGENT_MODEL_DEFAULT: 'test-model',
      AGENT_MODEL_CAPABILITIES: 'STREAMING',
      AGENT_MODEL_CONTEXT_WINDOW: '8192',
      AGENT_MODEL_MAX_OUTPUT_TOKENS: '1024',
      AGENT_MODEL_DATA_CLASSES: 'PUBLIC',
    }
    expect(() => buildModelConfig({ ...base, AGENT_MODEL_BASE_URL: 'http://127.0.0.1/v1' }, 'production')).toThrow(
      'HTTP base URL',
    )
    expect(() =>
      buildModelConfig(
        {
          ...base,
          AGENT_MODEL_BASE_URL: 'https://api.example.com/v1',
          AGENT_MODEL_BASE_URL_ALLOWLIST: 'https://other.example.com',
        },
        'production',
      ),
    ).toThrow('ALLOWLIST')
    expect(() =>
      buildModelConfig(
        {
          ...base,
          AGENT_MODEL_BASE_URL: 'https://api.example.com/v1',
          AGENT_MODEL_BASE_URL_ALLOWLIST: 'not-an-origin',
        },
        'production',
      ),
    ).toThrow('AGENT_MODEL_BASE_URL_ALLOWLIST 包含无效 origin')
    expect(
      buildModelConfig(
        {
          ...base,
          AGENT_MODEL_BASE_URL: 'https://api.example.com/v1',
          AGENT_MODEL_BASE_URL_ALLOWLIST: 'https://api.example.com',
        },
        'production',
      ).baseUrl,
    ).toBe('https://api.example.com/v1')
  })
})

describe('Model Gateway provider contract 与 OpenAI-compatible adapter', () => {
  let server: Server
  let baseUrl: string
  let handler: MockHandler
  const requests: Array<{ headers: IncomingMessage['headers']; body: Record<string, unknown>; url: string }> = []
  const logger = {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as LoggerService
  const observer = { record: jest.fn() } as unknown as ModelGatewayObserver

  beforeAll(async () => {
    server = createServer((request, response) => {
      const chunks: Buffer[] = []
      request.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      request.on('end', () => {
        const bodyText = Buffer.concat(chunks).toString('utf8')
        const body = bodyText ? (JSON.parse(bodyText) as Record<string, unknown>) : {}
        requests.push({ headers: request.headers, body, url: request.url ?? '' })
        Promise.resolve(handler(request, response, body)).catch(() => response.destroy())
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address() as AddressInfo
    baseUrl = `http://127.0.0.1:${address.port}/v1`
  })

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  })

  beforeEach(() => {
    requests.length = 0
    jest.clearAllMocks()
    handler = (_request, response) => sendTextStream(response, 'contract-ok')
  })

  it('同一基础 contract 在 fake 与 OpenAI-compatible provider 均通过', async () => {
    const fakeConfig = buildModelConfig({}, 'test') as IModelConfig
    const openAiConfig = makeOpenAiConfig(baseUrl)
    const providers: Array<{ provider: ModelProvider; config: IModelConfig }> = [
      { provider: new FakeModelProvider(fakeConfig), config: fakeConfig },
      { provider: new OpenAiCompatibleProvider(openAiConfig), config: openAiConfig },
    ]

    for (const item of providers) {
      const chunks = await collect(createService(item.provider, item.config).stream(baseRequest()))
      expect(chunks.some((chunk) => chunk.type === 'OUTPUT_TEXT_DELTA')).toBe(true)
      expect(chunks.some((chunk) => chunk.type === 'USAGE')).toBe(true)
      expect(chunks.some((chunk) => chunk.type === 'COMPLETED')).toBe(true)
    }
  })

  it('fake structured output 正确生成 nullable 与日期 schema 值', async () => {
    const fakeConfig = buildModelConfig({}, 'test') as IModelConfig
    const service = createService(new FakeModelProvider(fakeConfig), fakeConfig)
    const result = await service.generateStructured<{ cutoff: string | null; tradeDate: string }>(
      baseRequest({
        responseSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['cutoff', 'tradeDate'],
          properties: {
            cutoff: { type: ['string', 'null'], format: 'date' },
            tradeDate: { type: 'string', format: 'date' },
          },
        },
      }),
    )

    expect(result.data).toEqual({ cutoff: null, tradeDate: '2000-01-01' })
  })

  it('SSE 跨 UTF-8 字节分片，并合并乱序 index 的 Tool fragments、usage 与 request ID', async () => {
    handler = async (_request, response, body) => {
      expect(body.stream).toBe(true)
      expect(body.stream_options).toEqual({ include_usage: true })
      expect(body.tools).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'function', function: expect.objectContaining({ strict: true }) }),
        ]),
      )
      const payload = [
        sse({
          id: 'provider-request-1',
          choices: [
            {
              index: 0,
              delta: {
                content: '你',
                tool_calls: [
                  { index: 1, id: 'call-1', function: { name: 'get_stock_overview', arguments: '{"tsCode":"6' } },
                ],
              },
              finish_reason: null,
            },
          ],
        }),
        sse({
          choices: [
            {
              index: 0,
              delta: { tool_calls: [{ index: 1, function: { arguments: '00000.SH"}' } }] },
              finish_reason: 'tool_calls',
            },
          ],
        }),
        sse({
          choices: [],
          usage: {
            prompt_tokens: 11,
            completion_tokens: 7,
            prompt_tokens_details: { cached_tokens: 3 },
            completion_tokens_details: { reasoning_tokens: 2 },
          },
        }),
        'data: [DONE]\n\n',
      ].join('')
      await writeAcrossUtf8Boundary(response, payload, '你')
    }
    const request = baseRequest({
      tools: [
        {
          name: 'get_stock_overview',
          description: '查询股票概览',
          parameters: {
            type: 'object',
            properties: { tsCode: { type: 'string' } },
            required: ['tsCode'],
            additionalProperties: false,
          },
        },
      ],
    })
    const chunks = await collect(createOpenAiService(baseUrl).stream(request))

    expect(chunks.filter((chunk) => chunk.type === 'OUTPUT_TEXT_DELTA')).toEqual([
      { type: 'OUTPUT_TEXT_DELTA', text: '你' },
    ])
    expect(chunks).toContainEqual({
      type: 'TOOL_CALL_COMPLETED',
      index: 1,
      providerToolCallId: 'call-1',
      name: 'get_stock_overview',
      arguments: { tsCode: '600000.SH' },
    })
    expect(chunks).toContainEqual({
      type: 'USAGE',
      usage: { inputTokens: 11, outputTokens: 7, cachedTokens: 3, reasoningTokens: 2 },
    })
    expect(chunks).toContainEqual({
      type: 'COMPLETED',
      finishReason: 'tool_calls',
      providerRequestId: 'provider-request-1',
    })
    expect(requests[0].headers.authorization).toBe('Bearer test-api-key')
    expect(requests[0].url).toBe('/v1/chat/completions')
  })

  it.each([429, 503])('HTTP %i 在首个输出前有限重试，日志不含 key/prompt/raw body', async (status) => {
    let calls = 0
    handler = (_request, response) => {
      calls += 1
      if (calls === 1) {
        response.writeHead(status, { 'content-type': 'application/json', 'retry-after': '0' })
        response.end('{"secret":"raw-provider-body"}')
        return
      }
      sendTextStream(response, 'retry-ok')
    }
    const service = createOpenAiService(baseUrl)
    const chunks = await collect(
      service.stream(baseRequest({ messages: [{ role: 'user', content: 'private-prompt-value' }] })),
    )
    const logs = JSON.stringify([
      ...(logger.log as unknown as jest.Mock).mock.calls,
      ...(logger.warn as unknown as jest.Mock).mock.calls,
    ])

    expect(calls).toBe(2)
    expect(chunks).toContainEqual(expect.objectContaining({ type: 'COMPLETED' }))
    expect(logs).not.toContain('test-api-key')
    expect(logs).not.toContain('private-prompt-value')
    expect(logs).not.toContain('raw-provider-body')
  })

  it('已有可见 delta 后断流不重试，避免拼接两个 attempt', async () => {
    let calls = 0
    handler = (_request, response) => {
      calls += 1
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.write(sse({ choices: [{ index: 0, delta: { content: 'partial' }, finish_reason: null }] }))
      setTimeout(() => response.destroy(), 5)
    }
    const stream = createOpenAiService(baseUrl).stream(baseRequest())

    await expect(collect(stream)).rejects.toMatchObject({ category: 'UNAVAILABLE' })
    expect(calls).toBe(1)
  })

  it('禁止 HTTP redirect，Prompt body 不会发送到跳转目标', async () => {
    handler = (_request, response) => {
      response.writeHead(307, { location: '/redirect-target' })
      response.end()
    }

    await expect(
      collect(createOpenAiService(`${baseUrl}/redirect`, { AGENT_MODEL_MAX_RETRIES: '0' }).stream(baseRequest())),
    ).rejects.toMatchObject({ category: 'UNAVAILABLE' })
    expect(requests.map((request) => request.url)).toEqual(['/v1/redirect/chat/completions'])
  })

  it('运行时拒绝非法枚举、message role、trace 和请求数量', async () => {
    const service = createOpenAiService(baseUrl)
    const cases: Array<[string, ModelRequest]> = [
      ['modelPolicy', baseRequest({ modelPolicy: 'INVALID' as ModelRequest['modelPolicy'] })],
      ['purpose', baseRequest({ purpose: 'INVALID' as ModelRequest['purpose'] })],
      ['reasoningEffort', baseRequest({ reasoningEffort: 'INVALID' as ModelRequest['reasoningEffort'] })],
      ['dataClass', baseRequest({ dataClass: 'INVALID' as ModelRequest['dataClass'] })],
      [
        'message role',
        baseRequest({ messages: [{ role: 'invalid' as ModelRequest['messages'][number]['role'], content: 'x' }] }),
      ],
      [
        'trace keys',
        baseRequest({
          trace: { runId: 'run_test_1', modelCallId: 'model_call_test_1', extra: 'trace_test_1' } as never,
        }),
      ],
      [
        'message count',
        baseRequest({ messages: Array.from({ length: 1_001 }, () => ({ role: 'user', content: 'x' })) }),
      ],
      [
        'tool count',
        baseRequest({
          tools: Array.from({ length: 65 }, (_, index) => ({
            name: `tool_${index}`,
            description: 'test',
            parameters: { type: 'object', additionalProperties: false },
          })),
        }),
      ],
    ]

    for (const [, request] of cases) {
      await expect(collect(service.stream(request))).rejects.toMatchObject({ category: 'CONTENT' })
    }
    expect(requests).toHaveLength(0)
  })

  it('provider I/O 前严格编译 response 和 Tool JSON Schema', async () => {
    const service = createOpenAiService(baseUrl)
    const requestsWithInvalidSchema = [
      baseRequest({ responseSchema: { type: 'array' } }),
      baseRequest({
        tools: [
          {
            name: 'invalid_schema_tool',
            description: 'test',
            parameters: { type: 'object', unknownStrictKeyword: true },
          },
        ],
      }),
    ]

    for (const request of requestsWithInvalidSchema) {
      await expect(collect(service.stream(request))).rejects.toMatchObject({
        category: 'INVALID_OUTPUT',
        retryable: false,
      })
    }
    expect(requests).toHaveLength(0)
  })

  it('provider request 映射错误保持 INVALID_OUTPUT，不误分类为网络错误', async () => {
    const config = makeOpenAiConfig(baseUrl)
    const provider = new OpenAiCompatibleProvider(config)
    const request = {
      ...baseRequest({ messages: [{ role: 'tool', content: 'result-without-tool-call-id' }] }),
      model: config.defaultModel,
    } as ProviderModelRequest

    await expect(collect(provider.stream(request, new AbortController().signal))).rejects.toMatchObject({
      category: 'INVALID_OUTPUT',
      retryable: false,
    })
    expect(requests).toHaveLength(0)
  })

  it('timeout 中止 HTTP；用户 AbortSignal 映射为 ModelAbortError', async () => {
    let requestStarted: (() => void) | null = null
    const started = new Promise<void>((resolve) => (requestStarted = resolve))
    handler = () => requestStarted?.()
    const timeoutService = createOpenAiService(baseUrl, {
      AGENT_MODEL_TIMEOUT_MS: '100',
      AGENT_MODEL_MAX_RETRIES: '0',
    })
    await expect(collect(timeoutService.stream(baseRequest()))).rejects.toMatchObject({ category: 'TIMEOUT' })

    const controller = new AbortController()
    const abortPromise = collect(createOpenAiService(baseUrl).stream(baseRequest(), controller.signal))
    await started
    controller.abort()
    await expect(abortPromise).rejects.toBeInstanceOf(ModelAbortError)
  })

  it('结构化输出严格校验；首次非法只 repair 一次', async () => {
    let calls = 0
    handler = (_request, response, body) => {
      calls += 1
      if (calls === 2) {
        expect(body.messages).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ role: 'user', content: expect.stringContaining('strictly matches') }),
          ]),
        )
      }
      sendTextStream(response, calls === 1 ? '{"score":"bad"}' : '{"score":7}')
    }
    const result = await createOpenAiService(baseUrl).generateStructured<{ score: number }>(structuredRequest())

    expect(calls).toBe(2)
    expect(result.data).toEqual({ score: 7 })
    expect(result.repaired).toBe(true)
    expect(requests[0].body.response_format).toEqual(
      expect.objectContaining({ type: 'json_schema', json_schema: expect.objectContaining({ strict: true }) }),
    )
  })

  it('repair 后仍非法返回 INVALID_OUTPUT；不进行第三次调用', async () => {
    let calls = 0
    handler = (_request, response) => {
      calls += 1
      sendTextStream(response, '{"score":"still-invalid"}')
    }

    await expect(createOpenAiService(baseUrl).generateStructured(structuredRequest())).rejects.toMatchObject({
      category: 'INVALID_OUTPUT',
      retryable: false,
    })
    expect(calls).toBe(2)
  })

  it('content refusal 与不完整 Tool arguments 分类为不可重试错误', async () => {
    handler = (_request, response) =>
      sendEvents(response, [
        { choices: [{ index: 0, delta: { refusal: 'blocked' }, finish_reason: 'content_filter' }] },
      ])
    await expect(collect(createOpenAiService(baseUrl).stream(baseRequest()))).rejects.toMatchObject({
      category: 'CONTENT',
      retryable: false,
    })

    handler = (_request, response) =>
      sendEvents(response, [
        {
          choices: [
            {
              index: 0,
              delta: { tool_calls: [{ index: 0, id: 'bad-call', function: { name: 'tool', arguments: '{"x":' } }] },
              finish_reason: 'tool_calls',
            },
          ],
        },
      ])
    await expect(collect(createOpenAiService(baseUrl).stream(baseRequest()))).rejects.toMatchObject({
      category: 'INVALID_OUTPUT',
      retryable: false,
    })
  })

  it('AUTH 错误不重试，错误对象不暴露响应 body', async () => {
    let calls = 0
    handler = (_request, response) => {
      calls += 1
      response.writeHead(401, { 'content-type': 'application/json' })
      response.end('{"message":"credential test-api-key rejected"}')
    }
    let caught: unknown
    try {
      await collect(createOpenAiService(baseUrl).stream(baseRequest()))
    } catch (error) {
      caught = error
    }

    expect(caught).toMatchObject({ category: 'AUTH', retryable: false, statusCode: 401 })
    expect(JSON.stringify(caught)).not.toContain('test-api-key')
    expect(calls).toBe(1)
  })

  function createOpenAiService(base: string, overrides: ModelConfigEnvironment = {}): ModelGatewayService {
    const config = makeOpenAiConfig(base, overrides)
    return createService(new OpenAiCompatibleProvider(config), config)
  }

  function createService(provider: ModelProvider, config: IModelConfig): ModelGatewayService {
    return new ModelGatewayService(provider, new ModelCapabilityRegistry(provider), config, logger, observer)
  }
})

function makeOpenAiConfig(baseUrl: string, overrides: ModelConfigEnvironment = {}): IModelConfig {
  return buildModelConfig(
    {
      AGENT_MODEL_PROVIDER: 'openai-compatible',
      AGENT_MODEL_BASE_URL: baseUrl,
      AGENT_MODEL_API_KEY: 'test-api-key',
      AGENT_MODEL_DEFAULT: 'test-model',
      AGENT_MODEL_TIMEOUT_MS: '2_000'.replace('_', ''),
      AGENT_MODEL_MAX_RETRIES: '2',
      AGENT_MODEL_RETRY_BASE_MS: '0',
      AGENT_MODEL_CAPABILITIES: 'STREAMING,STRUCTURED_OUTPUT,TOOL_CALLING',
      AGENT_MODEL_CONTEXT_WINDOW: '8192',
      AGENT_MODEL_MAX_OUTPUT_TOKENS: '2048',
      AGENT_MODEL_REASONING_EFFORTS: 'LOW,MEDIUM,HIGH',
      AGENT_MODEL_DATA_CLASSES: 'PUBLIC,USER_PRIVATE',
      ...overrides,
    },
    'test',
  ) as IModelConfig
}

function baseRequest(overrides: Partial<ModelRequest> = {}): ModelRequest {
  return {
    modelPolicy: 'AUTO',
    purpose: 'SYNTHESIZE',
    messages: [{ role: 'user', content: 'analyze 600000.SH' }],
    maxOutputTokens: 256,
    deadlineAt: new Date(Date.now() + 10_000).toISOString(),
    trace: { runId: 'run_test_1', modelCallId: 'model_call_test_1', traceId: 'trace_test_1' },
    ...overrides,
  }
}

function structuredRequest(): ModelRequest {
  return baseRequest({
    responseSchema: {
      type: 'object',
      properties: { score: { type: 'integer', minimum: 0, maximum: 10 } },
      required: ['score'],
      additionalProperties: false,
    },
  })
}

async function collect(stream: AsyncIterable<ModelChunk>): Promise<ModelChunk[]> {
  const chunks: ModelChunk[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

function sse(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`
}

function sendTextStream(response: ServerResponse, text: string): void {
  sendEvents(response, [
    { id: 'provider-text-1', choices: [{ index: 0, delta: { content: text }, finish_reason: 'stop' }] },
    { choices: [], usage: { prompt_tokens: 5, completion_tokens: 3 } },
  ])
}

function sendEvents(response: ServerResponse, events: unknown[]): void {
  response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' })
  for (const event of events) response.write(sse(event))
  response.end('data: [DONE]\n\n')
}

async function writeAcrossUtf8Boundary(response: ServerResponse, payload: string, target: string): Promise<void> {
  response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' })
  const bytes = Buffer.from(payload, 'utf8')
  const targetBytes = Buffer.from(target, 'utf8')
  const index = bytes.indexOf(targetBytes)
  response.write(bytes.subarray(0, index + 1))
  await new Promise<void>((resolve) => setImmediate(resolve))
  response.end(bytes.subarray(index + 1))
}

jest.setTimeout(30_000)
