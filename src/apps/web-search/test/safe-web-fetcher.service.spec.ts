import { createServer, type Server } from 'node:http'
import { gzipSync } from 'node:zlib'
import { buildWebSearchConfig } from 'src/config/web-search.config'
import { SafeWebFetcherService } from '../safe-web-fetcher.service'
import { SsrfPolicyService } from '../ssrf-policy.service'

describe('SafeWebFetcherService', () => {
  let server: Server
  let baseUrl: string

  beforeAll(async () => {
    server = createServer((request, response) => {
      if (request.url === '/redirect-private') {
        response.writeHead(302, { Location: `${baseUrl.replace('127.0.0.1', 'localhost')}/ok` }).end()
        return
      }
      if (request.url === '/pdf') {
        response.writeHead(200, { 'Content-Type': 'application/pdf' }).end('%PDF')
        return
      }
      if (request.url === '/gzip-bomb') {
        const body = gzipSync('a'.repeat(20_000))
        response.writeHead(200, { 'Content-Type': 'text/html', 'Content-Encoding': 'gzip' }).end(body)
        return
      }
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end('<main><p>fixture ok</p></main>')
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('fixture server address unavailable')
    baseUrl = `http://127.0.0.1:${address.port}`
  })

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  })

  function fetcher(maxBytes = 16_384) {
    const config = {
      ...buildWebSearchConfig({}, 'test'),
      timeoutMs: 2_000,
      fetchMaxBytes: maxBytes,
      fetchMaxRedirects: 3,
    }
    const policy = new SsrfPolicyService({ resolve: jest.fn() }, { allowHttp: true, hosts: ['127.0.0.1'] })
    return new SafeWebFetcherService(config, policy, { log: jest.fn() } as never)
  }

  it('隔离 fixture 使用固定解析地址抓取，响应不携带 cookie/auth', async () => {
    const result = await fetcher().fetch(`${baseUrl}/ok`, new AbortController().signal)
    expect(result.body.toString()).toContain('fixture ok')
    expect(result.contentType).toBe('text/html')
    expect(result.redirectChain).toEqual([])
  })

  it('重定向每一跳重新执行 host/protocol policy', async () => {
    await expect(fetcher().fetch(`${baseUrl}/redirect-private`, new AbortController().signal)).rejects.toMatchObject({
      code: 'BLOCKED',
    })
  })

  it('拒绝 PDF MIME 与 gzip 解压炸弹', async () => {
    await expect(fetcher().fetch(`${baseUrl}/pdf`, new AbortController().signal)).rejects.toMatchObject({
      code: 'BLOCKED',
    })
    await expect(fetcher(1_024).fetch(`${baseUrl}/gzip-bomb`, new AbortController().signal)).rejects.toMatchObject({
      code: 'RESULT_TOO_LARGE',
    })
  })
})
