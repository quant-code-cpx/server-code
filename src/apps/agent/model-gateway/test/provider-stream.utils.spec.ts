import { ModelGatewayError } from '../model-gateway.port'
import {
  mapProviderHttpError,
  nonNegativeInteger,
  parseProviderEvent,
  readProviderSseData,
} from '../providers/provider-stream.utils'

describe('模型供应商流协议公共边界', () => {
  it('按 SSE 规范合并多行 data、兼容 CRLF，并保留末尾未空行终止的事件', async () => {
    const body = chunkedStream([
      'event: message\r\ndata: first\r\n',
      'data: second\r\n\r\n: heartbeat\n\n',
      'data: trailing',
    ])

    await expect(collectData(readProviderSseData(body, new AbortController().signal))).resolves.toEqual([
      'first\nsecond',
      'trailing',
    ])
  })

  it('中止、非法 UTF-8 与超大事件都必须终止读取且不伪装成正常完成', async () => {
    const aborted = new AbortController()
    aborted.abort(new Error('caller aborted'))
    await expect(
      collectData(readProviderSseData(chunkedStream(['data: ignored\n\n']), aborted.signal)),
    ).rejects.toThrow('caller aborted')

    const invalidUtf8 = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([0xc3, 0x28]))
        controller.close()
      },
    })
    await expect(collectData(readProviderSseData(invalidUtf8, new AbortController().signal))).rejects.toMatchObject({
      category: 'UNAVAILABLE',
      retryable: true,
    })

    const oversized = chunkedStream([`data: ${'x'.repeat(1_000_001)}`])
    await expect(collectData(readProviderSseData(oversized, new AbortController().signal))).rejects.toMatchObject({
      category: 'INVALID_OUTPUT',
      retryable: false,
    })
  })

  it.each([
    [401, undefined, 'AUTH', false, undefined],
    [403, undefined, 'AUTH', false, undefined],
    [429, '1.25', 'RATE_LIMIT', true, 1_250],
    [408, '2', 'TIMEOUT', true, 2_000],
    [503, 'invalid', 'UNAVAILABLE', true, undefined],
    [418, undefined, 'UNAVAILABLE', false, undefined],
  ])(
    'HTTP %i 映射为稳定网关错误分类并保留可重试语义',
    async (status, retryAfter, category, retryable, retryAfterMs) => {
      const headers = retryAfter ? { 'retry-after': retryAfter } : undefined
      const error = await mapProviderHttpError(new Response('', { status, headers }))

      expect(error).toMatchObject({ category, retryable, statusCode: status, retryAfterMs })
    },
  )

  it('上游 5xx 保留可安全定位的 HTTP 状态与请求 ID', async () => {
    const error = await mapProviderHttpError(
      new Response('', { status: 503, headers: { 'x-request-id': 'req_deepseek-v4_20260807' } }),
    )

    expect(error).toMatchObject({ category: 'UNAVAILABLE', retryable: true, statusCode: 503 })
    expect(error.message).toContain('HTTP 503')
    expect(error.message).toContain('req_deepseek-v4_20260807')
  })

  it('即使上游返回 5xx，已识别的协议不兼容也应给出可操作提示且不泄露原文', async () => {
    const error = await mapProviderHttpError(
      new Response('Unknown field: reasoning_effort PRIVATE_PROVIDER_CANARY', {
        status: 502,
        headers: { 'openai-request-id': 'req-safe-502' },
      }),
    )

    expect(error).toMatchObject({ category: 'CONTENT', retryable: false, statusCode: 502 })
    expect(error.message).toContain('请改为“跟随模型”或调整推理档位')
    expect(error.message).toContain('HTTP 502')
    expect(error.message).toContain('req-safe-502')
    expect(error.message).not.toContain('PRIVATE_PROVIDER_CANARY')
  })

  it('非法上游请求 ID 不进入公开错误信息', async () => {
    const error = await mapProviderHttpError(
      new Response('', { status: 500, headers: { 'x-request-id': 'request id with spaces/private' } }),
    )

    expect(error.message).toContain('HTTP 500')
    expect(error.message).not.toContain('request id with spaces/private')
  })

  it('HTTP Retry-After 日期被换算为非负毫秒，过期日期归零', async () => {
    const future = new Date(Date.now() + 2_000).toUTCString()
    const futureError = await mapProviderHttpError(
      new Response('', { status: 429, headers: { 'retry-after': future } }),
    )
    const expiredError = await mapProviderHttpError(
      new Response('', { status: 429, headers: { 'retry-after': 'Thu, 01 Jan 1970 00:00:00 GMT' } }),
    )

    expect(futureError.retryAfterMs).toBeGreaterThanOrEqual(0)
    expect(futureError.retryAfterMs).toBeLessThanOrEqual(2_000)
    expect(expiredError.retryAfterMs).toBe(0)
  })

  it('内容错误区分上下文超限与普通参数拒绝，并限制错误详情读取失败的影响', async () => {
    await expect(
      mapProviderHttpError(new Response('{"error":"maximum context length exceeded"}', { status: 400 })),
    ).resolves.toMatchObject({ category: 'CONTEXT_LENGTH', retryable: false })
    await expect(mapProviderHttpError(new Response('{"error":"bad schema"}', { status: 422 }))).resolves.toMatchObject({
      category: 'CONTENT',
      retryable: false,
    })

    const unreadable = {
      status: 409,
      headers: new Headers(),
      text: jest.fn().mockRejectedValue(new Error('body unavailable')),
    } as unknown as Response
    await expect(mapProviderHttpError(unreadable)).resolves.toMatchObject({ category: 'CONTENT' })
  })

  it.each([
    ['Unsupported parameter: parallel_tool_calls', '请关闭“并行工具”能力'],
    ['Unknown parameter: tools', '请关闭“工具调用”与“并行工具”能力'],
    ['response_format is not supported', '请关闭“结构化输出”能力'],
    ['Unknown field: reasoning_effort', '请改为“跟随模型”或调整推理档位'],
    ['Vision is not supported', '请关闭“视觉输入”能力'],
  ])('能力参数被供应商拒绝时返回可操作提示且不透传原文：%s', async (detail, expected) => {
    const error = await mapProviderHttpError(new Response(`${detail} PRIVATE_PROVIDER_CANARY`, { status: 400 }))

    expect(error).toMatchObject({ category: 'CONTENT', retryable: false, statusCode: 400 })
    expect(error.message).toContain(expected)
    expect(JSON.stringify(error)).not.toContain('PRIVATE_PROVIDER_CANARY')
  })

  it.each(['not-json', 'null', '[]', '"text"'])('SSE data %s 不是对象时拒绝进入协议状态机', (data) => {
    expect(() => parseProviderEvent(data)).toThrow(ModelGatewayError)
    expect(() => parseProviderEvent(data)).toThrow('不是有效 JSON')
  })

  it('SSE 对象与非负整数 usage 通过，负数、小数和缺失 usage 被拒绝', () => {
    expect(parseProviderEvent<{ type: string }>('{"type":"completed"}')).toEqual({ type: 'completed' })
    expect(nonNegativeInteger(0, 'input_tokens')).toBe(0)
    expect(nonNegativeInteger(12, 'output_tokens')).toBe(12)

    for (const value of [-1, 1.5, '2', undefined]) {
      expect(() => nonNegativeInteger(value, 'output_tokens')).toThrow('usage output_tokens 非法')
    }
  })
})

function chunkedStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
}

async function collectData(stream: AsyncIterable<string>): Promise<string[]> {
  const result: string[] = []
  for await (const item of stream) result.push(item)
  return result
}
