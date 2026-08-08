import { createServer, type Server } from 'node:http'
import { DefaultNewsHttpTransport } from '../providers/default-news-http.transport'

describe('News Provider localhost 协议集成', () => {
  let server: Server
  let baseUrl: string
  const transport = new DefaultNewsHttpTransport()

  beforeAll(async () => {
    server = createServer((request, response) => {
      if (request.url === '/rate-limited') {
        response.writeHead(429, { 'content-type': 'application/json', 'retry-after': '45' })
        response.end('{}')
        return
      }
      if (request.url === '/html') {
        response.writeHead(200, { 'content-type': 'text/html' })
        response.end('<html>not json</html>')
        return
      }
      if (request.url === '/unavailable') {
        response.writeHead(503, { 'content-type': 'application/json' })
        response.end('{}')
        return
      }
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end('{"ok":true}')
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('fixture server address unavailable')
    baseUrl = `http://127.0.0.1:${address.port}`
  })

  afterAll(
    async () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  )

  it('NEWS-ERR-003: 429 分类可重试并保留有界 Retry-After', async () => {
    await expect(request('/rate-limited')).rejects.toEqual(
      expect.objectContaining({ code: 'UPSTREAM_RATE_LIMITED', retryable: true, retryAfterMs: 45_000 }),
    )
  })

  it('NEWS-ERR-004/006: 5xx 可重试，HTTP 200 HTML 视为 schema 漂移且不重试', async () => {
    await expect(request('/unavailable')).rejects.toEqual(
      expect.objectContaining({ code: 'UPSTREAM_UNAVAILABLE', retryable: true }),
    )
    await expect(request('/html')).rejects.toEqual(
      expect.objectContaining({ code: 'UPSTREAM_SCHEMA_CHANGED', retryable: false }),
    )
  })

  it('合法 JSON 正常解析', async () => {
    await expect(request('/ok')).resolves.toEqual({ ok: true })
  })

  function request(path: string): Promise<Record<string, unknown>> {
    return transport.requestJson({ url: `${baseUrl}${path}`, method: 'GET', timeoutMs: 1_000 })
  }
})
