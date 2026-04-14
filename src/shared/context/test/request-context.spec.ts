import { Request, Response, NextFunction } from 'express'
import { RequestContextService } from '../request-context.service'
import { RequestContextMiddleware } from '../request-context.middleware'

// ── RequestContextService ─────────────────────────────────────────────────────

describe('RequestContextService', () => {
  describe('run() + getCurrentContext()', () => {
    it('[BIZ] run 内部可获取上下文', () => {
      RequestContextService.run({ traceId: 'abc123' }, () => {
        expect(RequestContextService.getCurrentContext()).toEqual(
          expect.objectContaining({ traceId: 'abc123' }),
        )
      })
    })

    it('[BIZ] run 外部获取上下文 → undefined', () => {
      // 在所有 run() 调用之外，AsyncLocalStorage.getStore() 返回 undefined
      // Jest 每个测试用例的 it() 回调运行在独立的同步帧中；
      // 前一个 run() 的 ALS 上下文已随其回调执行完毕而消失（ALS 上下文生命周期与 async 执行链绑定）
      const result = RequestContextService.getCurrentContext()
      expect(result).toBeUndefined()
    })

    it('[DATA] 嵌套 run 覆盖内层上下文，外层上下文恢复', () => {
      RequestContextService.run({ traceId: 'outer' }, () => {
        expect(RequestContextService.getTraceId()).toBe('outer')

        RequestContextService.run({ traceId: 'inner' }, () => {
          expect(RequestContextService.getTraceId()).toBe('inner')
        })

        // 内层 run 结束后，恢复外层上下文
        expect(RequestContextService.getTraceId()).toBe('outer')
      })
    })

    it('[DATA] 并发请求上下文隔离 — 两个 Promise 各自 run 不互相污染', async () => {
      const results: string[] = []

      await Promise.all([
        new Promise<void>((resolve) =>
          RequestContextService.run({ traceId: 'req-1' }, async () => {
            // 等待下一个 microtask（让 req-2 有机会写入自己的上下文）
            await new Promise((r) => setTimeout(r, 5))
            results.push(RequestContextService.getTraceId()!)
            resolve()
          }),
        ),
        new Promise<void>((resolve) =>
          RequestContextService.run({ traceId: 'req-2' }, () => {
            results.push(RequestContextService.getTraceId()!)
            resolve()
          }),
        ),
      ])

      // 两个并发请求的 traceId 不互相污染
      expect(results).toHaveLength(2)
      expect(results).toContain('req-1')
      expect(results).toContain('req-2')
    })
  })

  describe('setUserId()', () => {
    it('[BIZ] 在有效上下文中设置 userId', () => {
      RequestContextService.run({ traceId: 'ctx-test' }, () => {
        RequestContextService.setUserId(42)
        expect(RequestContextService.getCurrentContext()?.userId).toBe(42)
      })
    })

    it('[BUG P5-B7] 无上下文时 setUserId 静默无操作（不抛出异常）', () => {
      // 在 run() 外调用 setUserId → ctx = undefined → 静默跳过
      // 这是有意设计（Cron Job / WebSocket 没有 HTTP 上下文），但调用方无法感知
      expect(() => RequestContextService.setUserId(99)).not.toThrow()
    })
  })

  describe('getTraceId()', () => {
    it('[BIZ] 在 run 内部返回当前 traceId', () => {
      RequestContextService.run({ traceId: 'xyz-456' }, () => {
        expect(RequestContextService.getTraceId()).toBe('xyz-456')
      })
    })

    it('[EDGE] 无上下文时返回 undefined', () => {
      // 在 run() 之外，getStore() 返回 undefined
      // 由于并发测试，此处只能在 ALS 未运行的同步上下文中测试
      const id = RequestContextService.getTraceId()
      // 只能断言不崩溃，值可能是 undefined（若无上下文）
      // 在非 run 的同步调用中确实为 undefined
      expect(id).toBeUndefined()
    })
  })
})

// ── RequestContextMiddleware ──────────────────────────────────────────────────

describe('RequestContextMiddleware', () => {
  let middleware: RequestContextMiddleware
  let capturedTraceId: string | undefined

  beforeEach(() => {
    middleware = new RequestContextMiddleware()
    capturedTraceId = undefined
  })

  function runMiddleware(headers: Record<string, string> = {}): Promise<void> {
    const req = {
      method: 'POST',
      originalUrl: '/api/test',
      headers,
    } as unknown as Request
    const res = { setHeader: jest.fn() } as unknown as Response
    let nextCalled = false

    return new Promise((resolve) => {
      const next: NextFunction = () => {
        // next() 是在 run() 回调内部调用的，所以此时上下文已注入
        capturedTraceId = RequestContextService.getTraceId()
        nextCalled = true
        resolve()
      }
      middleware.use(req, res, next)
      // 防御：如果 next 在同步中未调用，立即 resolve（实际不会发生）
      if (!nextCalled) setTimeout(resolve, 50)
    })
  }

  it('[BIZ] 优先使用 x-trace-id 请求头作为 traceId', async () => {
    await runMiddleware({ 'x-trace-id': 'upstream-trace-123' })
    expect(capturedTraceId).toBe('upstream-trace-123')
  })

  it('[BIZ] 其次使用 x-request-id 请求头作为 traceId', async () => {
    await runMiddleware({ 'x-request-id': 'request-456' })
    expect(capturedTraceId).toBe('request-456')
  })

  it('[BIZ] 无 header 时自动生成 16 位 hex traceId', async () => {
    await runMiddleware({})
    expect(capturedTraceId).toBeDefined()
    expect(capturedTraceId).toMatch(/^[0-9a-f]{16}$/)
  })

  it('[BIZ] 设置响应头 X-Trace-Id', async () => {
    const req = { method: 'GET', originalUrl: '/ping', headers: { 'x-trace-id': 'resp-trace' } } as unknown as Request
    const mockSetHeader = jest.fn()
    const res = { setHeader: mockSetHeader } as unknown as Response

    await new Promise<void>((resolve) => {
      middleware.use(req, res, () => resolve())
    })

    expect(mockSetHeader).toHaveBeenCalledWith('X-Trace-Id', 'resp-trace')
  })

  it('[BIZ] x-trace-id 优先级高于 x-request-id', async () => {
    await runMiddleware({ 'x-trace-id': 'primary', 'x-request-id': 'secondary' })
    expect(capturedTraceId).toBe('primary')
  })
})
