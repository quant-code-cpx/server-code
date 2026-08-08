import { ModelGatewayError } from '../model-gateway.port'

const MAX_SSE_BUFFER_CHARS = 1_000_000

export async function* readProviderSseData(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): AsyncIterable<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let buffer = ''
  let dataLines: string[] = []
  try {
    while (true) {
      if (signal.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      if (buffer.length > MAX_SSE_BUFFER_CHARS) {
        throw new ModelGatewayError('INVALID_OUTPUT', false, 'SSE event 超过缓冲限制')
      }
      let newlineIndex = buffer.indexOf('\n')
      while (newlineIndex >= 0) {
        let line = buffer.slice(0, newlineIndex)
        buffer = buffer.slice(newlineIndex + 1)
        if (line.endsWith('\r')) line = line.slice(0, -1)
        if (line === '') {
          if (dataLines.length > 0) {
            yield dataLines.join('\n')
            dataLines = []
          }
        } else if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).trimStart())
        }
        newlineIndex = buffer.indexOf('\n')
      }
    }
    buffer += decoder.decode()
    if (buffer.endsWith('\r')) buffer = buffer.slice(0, -1)
    if (buffer.startsWith('data:')) dataLines.push(buffer.slice(5).trimStart())
    if (dataLines.length > 0) yield dataLines.join('\n')
  } catch (error) {
    if (error instanceof ModelGatewayError || signal.aborted) throw error
    throw new ModelGatewayError('UNAVAILABLE', true, '读取模型供应商响应流失败')
  } finally {
    reader.releaseLock()
  }
}

export async function mapProviderHttpError(response: Response): Promise<ModelGatewayError> {
  const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'))
  if (response.status === 401 || response.status === 403) {
    return new ModelGatewayError('AUTH', false, '模型供应商鉴权失败', response.status)
  }
  if (response.status === 429) {
    return new ModelGatewayError('RATE_LIMIT', true, '模型供应商限流', response.status, retryAfterMs)
  }
  if (response.status === 408) {
    return new ModelGatewayError('TIMEOUT', true, '模型供应商请求超时', response.status, retryAfterMs)
  }
  if (response.status >= 500) {
    const detail = await readBoundedDetail(response)
    const capabilityMessage = capabilityErrorMessage(detail)
    if (capabilityMessage) {
      return new ModelGatewayError(
        'CONTENT',
        false,
        withProviderHttpContext(`${capabilityMessage}；上游返回 HTTP ${response.status}`, response),
        response.status,
      )
    }
    return new ModelGatewayError(
      'UNAVAILABLE',
      true,
      withProviderHttpContext(`模型供应商返回 HTTP ${response.status}，请检查上游服务状态或协议兼容日志`, response),
      response.status,
      retryAfterMs,
    )
  }
  if ([400, 409, 413, 422].includes(response.status)) {
    const detail = await readBoundedDetail(response)
    if (isContextLengthError(detail)) {
      return new ModelGatewayError('CONTEXT_LENGTH', false, '请求超过目标模型的上下文窗口', response.status)
    }
    const capabilityMessage = capabilityErrorMessage(detail)
    if (capabilityMessage) {
      return new ModelGatewayError('CONTENT', false, capabilityMessage, response.status)
    }
    return new ModelGatewayError('CONTENT', false, '模型供应商拒绝请求内容', response.status)
  }
  return new ModelGatewayError('UNAVAILABLE', false, '模型供应商请求失败', response.status)
}

export function parseProviderEvent<T extends object>(data: string): T {
  try {
    const value: unknown = JSON.parse(data)
    if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('invalid shape')
    return value as T
  } catch {
    throw new ModelGatewayError('INVALID_OUTPUT', false, '模型供应商 SSE data 不是有效 JSON')
  }
}

export function nonNegativeInteger(value: unknown, name: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new ModelGatewayError('INVALID_OUTPUT', false, `模型 usage ${name} 非法`)
  }
  return value as number
}

async function readBoundedDetail(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 8_192).toLowerCase()
  } catch {
    return ''
  }
}

function isContextLengthError(value: string): boolean {
  return [
    'context_length_exceeded',
    'maximum context length',
    'max context length',
    'context window',
    'token limit exceeded',
    'prompt is too long',
    'input is too long',
    '请求的长度超过',
    '上下文长度',
  ].some((pattern) => value.includes(pattern))
}

function withProviderHttpContext(message: string, response: Response): string {
  const requestId = providerRequestId(response)
  return requestId ? `${message}（上游请求 ID：${requestId}）` : message
}

function providerRequestId(response: Response): string | null {
  const value =
    response.headers.get('x-request-id') ??
    response.headers.get('request-id') ??
    response.headers.get('openai-request-id')
  if (!value) return null
  const normalized = value.trim()
  return /^[A-Za-z0-9._:-]{1,160}$/.test(normalized) ? normalized : null
}

export function capabilityErrorMessage(value: string): string | null {
  if (!value || !isUnsupportedParameterError(value)) return null
  if (value.includes('parallel_tool_calls') || value.includes('parallel tool')) {
    return '模型供应商不支持并行工具调用，请关闭“并行工具”能力后重试'
  }
  if (
    value.includes('tool_choice') ||
    value.includes('function calling') ||
    value.includes('tool call') ||
    /\btools\b/.test(value)
  ) {
    return '模型供应商不支持工具调用，请关闭“工具调用”与“并行工具”能力后重试'
  }
  if (value.includes('response_format') || value.includes('json_schema') || value.includes('structured output')) {
    return '模型供应商不支持结构化输出，请关闭“结构化输出”能力后重试'
  }
  if (value.includes('reasoning_effort') || value.includes('reasoning effort')) {
    return '模型供应商不支持当前推理控制，请改为“跟随模型”或调整推理档位'
  }
  if (value.includes('image_url') || value.includes('image input') || value.includes('vision')) {
    return '模型供应商不支持视觉输入，请关闭“视觉输入”能力后重试'
  }
  return null
}

function isUnsupportedParameterError(value: string): boolean {
  return [
    'unsupported',
    'not supported',
    'does not support',
    'unknown parameter',
    'unknown field',
    'unrecognized',
    'unexpected parameter',
    'extra inputs are not permitted',
    'invalid parameter',
    '不支持',
    '未知参数',
    '无法识别',
    '不允许',
    '无效参数',
  ].some((pattern) => value.includes(pattern))
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1_000)
  const at = Date.parse(value)
  return Number.isNaN(at) ? undefined : Math.max(0, at - Date.now())
}
