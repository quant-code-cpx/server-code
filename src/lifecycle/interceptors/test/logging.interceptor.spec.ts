import { ExecutionContext } from '@nestjs/common'
import { firstValueFrom } from 'rxjs'
import { LoggingInterceptor } from '../logging.interceptor'
import { LoggerService } from 'src/shared/logger/logger.service'
import { RequestContextService } from 'src/shared/context/request-context.service'
import { makeCallHandler, makeCallHandlerWithError } from 'test/helpers/call-handler'

// ── 工厂函数 ──────────────────────────────────────────────────────────────────

function makeLogger() {
  return {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    devLog: jest.fn(),
  } as unknown as jest.Mocked<LoggerService>
}

function makeContext(overrides: {
  method?: string
  url?: string
  ip?: string
  body?: Record<string, unknown>
  userAgent?: string
  statusCode?: number
} = {}): ExecutionContext {
  const { method = 'POST', url = '/api/test', ip = '127.0.0.1', body = {}, userAgent = 'jest', statusCode = 200 } = overrides
  const request = {
    method,
    url,
    ip,
    body,
    get: jest.fn((header: string) => (header === 'user-agent' ? userAgent : undefined)),
  }
  const response = { statusCode }
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext
}

describe('LoggingInterceptor', () => {
  afterEach(() => jest.clearAllMocks())

  // ── sanitizeBody 行为（通过 interceptor 间接测试） ─────────────────────────

  describe('sanitizeBody() — via interceptor with logHttpBody=true', () => {
    it('[DATA] 一级 password 字段被脱敏为 "***"', async () => {
      const logger = makeLogger()
      const interceptor = new LoggingInterceptor(logger, true)
      const ctx = makeContext({ body: { username: 'admin', password: '123456' } })

      await firstValueFrom(interceptor.intercept(ctx, makeCallHandler({})))

      const logArg = logger.log.mock.calls[0][0] as Record<string, unknown>
      expect((logArg.body as Record<string, unknown>).password).toBe('***')
      expect((logArg.body as Record<string, unknown>).username).toBe('admin')
    })

    it('[DATA] 多个敏感字段全部脱敏：password/token/secret/captchaCode', async () => {
      const logger = makeLogger()
      const interceptor = new LoggingInterceptor(logger, true)
      const sensitiveBody = { password: 'p', token: 't', secret: 's', captchaCode: 'c', name: 'keep-me' }
      const ctx = makeContext({ body: sensitiveBody })

      await firstValueFrom(interceptor.intercept(ctx, makeCallHandler({})))

      const logged = (logger.log.mock.calls[0][0] as Record<string, unknown>).body as Record<string, unknown>
      expect(logged.password).toBe('***')
      expect(logged.token).toBe('***')
      expect(logged.secret).toBe('***')
      expect(logged.captchaCode).toBe('***')
      expect(logged.name).toBe('keep-me')
    })

    it('[BUG P5-B3] 嵌套敏感字段不被脱敏（浅层处理缺陷）', async () => {
      // 当前 sanitizeBody 只做一层 Object.assign，不递归处理嵌套对象
      // 正确行为应为：{ user: { password: '***' } }
      const logger = makeLogger()
      const interceptor = new LoggingInterceptor(logger, true)
      const ctx = makeContext({ body: { user: { password: '123', name: 'admin' } } })

      await firstValueFrom(interceptor.intercept(ctx, makeCallHandler({})))

      const logged = (logger.log.mock.calls[0][0] as Record<string, unknown>).body as Record<string, unknown>
      // 记录当前（有缺陷的）行为：嵌套 password 未被脱敏
      expect((logged.user as Record<string, unknown>).password).toBe('123')
      // 修复后应改为: expect((logged.user as Record<string, unknown>).password).toBe('***')
    })

    it('[EDGE] body 为空对象 → 不写入 body 字段', async () => {
      const logger = makeLogger()
      const interceptor = new LoggingInterceptor(logger, true)
      const ctx = makeContext({ body: {} })

      await firstValueFrom(interceptor.intercept(ctx, makeCallHandler({})))

      const logArg = logger.log.mock.calls[0][0] as Record<string, unknown>
      // Object.keys({}).length === 0 → body 不被记录
      expect(logArg.body).toBeUndefined()
    })
  })

  // ── [BIZ] 路径排除 ────────────────────────────────────────────────────────

  describe('[BIZ] 健康检查路径排除', () => {
    const excludedPaths = ['/health', '/ready', '/api/health', '/api/ready']

    it.each(excludedPaths)('[BIZ] %s 路径不记录日志', async (url) => {
      const logger = makeLogger()
      const interceptor = new LoggingInterceptor(logger)
      const ctx = makeContext({ url })

      await firstValueFrom(interceptor.intercept(ctx, makeCallHandler({})))

      expect(logger.log).not.toHaveBeenCalled()
      expect(logger.warn).not.toHaveBeenCalled()
    })

    it('[BUG P5-B4] /health-check 路径被 startsWith("/health") 意外排除', async () => {
      // 当前逻辑：EXCLUDED_PATHS.some(p => url.startsWith(p))
      // '/health-check'.startsWith('/health') = true → 被排除
      // 正确行为应该只排除精确健康检查路径
      const logger = makeLogger()
      const interceptor = new LoggingInterceptor(logger)
      const ctx = makeContext({ url: '/health-check' })

      await firstValueFrom(interceptor.intercept(ctx, makeCallHandler({})))

      // 记录当前（有缺陷的）行为：/health-check 被意外排除，日志未记录
      expect(logger.log).not.toHaveBeenCalled()
      // 修复后应改为: expect(logger.log).toHaveBeenCalled()
    })
  })

  // ── [BIZ] 正常请求日志 ────────────────────────────────────────────────────

  describe('[BIZ] 正常请求日志', () => {
    it('[BIZ] 成功响应 → 用 log() 记录 method/url/statusCode/latency 等字段', async () => {
      const logger = makeLogger()
      const interceptor = new LoggingInterceptor(logger)
      const ctx = makeContext({ method: 'POST', url: '/api/users/list', statusCode: 200 })

      // 注入上下文
      await RequestContextService.run({ traceId: 'trace-abc', userId: 42 }, async () => {
        await firstValueFrom(interceptor.intercept(ctx, makeCallHandler({})))
      })

      expect(logger.log).toHaveBeenCalledTimes(1)
      const logArg = logger.log.mock.calls[0][0] as Record<string, unknown>
      expect(logArg.message).toBe('POST /api/users/list 200 0ms')
      expect(logArg.statusCode).toBe(200)
      expect(logArg.traceId).toBe('trace-abc')
      expect(logArg.userId).toBe(42)
      expect(typeof logArg.latency).toBe('number')
      expect(logger.log.mock.calls[0][1]).toBe('HTTP')
    })

    it('[BIZ] logHttpBody=false（默认）→ 不记录 body 字段', async () => {
      const logger = makeLogger()
      const interceptor = new LoggingInterceptor(logger, false)
      const ctx = makeContext({ body: { name: 'test', password: '123' } })

      await firstValueFrom(interceptor.intercept(ctx, makeCallHandler({})))

      const logArg = logger.log.mock.calls[0][0] as Record<string, unknown>
      expect(logArg.body).toBeUndefined()
    })

    it('[BIZ] logHttpBody=true → 记录脱敏后的请求体', async () => {
      const logger = makeLogger()
      const interceptor = new LoggingInterceptor(logger, true)
      const ctx = makeContext({ body: { name: 'test', password: 'secret' } })

      await firstValueFrom(interceptor.intercept(ctx, makeCallHandler({})))

      const logArg = logger.log.mock.calls[0][0] as Record<string, unknown>
      expect(logArg.body).toBeDefined()
      expect((logArg.body as Record<string, unknown>).name).toBe('test')
      expect((logArg.body as Record<string, unknown>).password).toBe('***')
    })

    it('[ERR] 错误响应 → 使用 warn() 级别记录，包含 error 信息', async () => {
      const logger = makeLogger()
      const interceptor = new LoggingInterceptor(logger)
      const ctx = makeContext({ url: '/api/test' })
      const boom = new Error('downstream error')

      await expect(
        firstValueFrom(interceptor.intercept(ctx, makeCallHandlerWithError(boom))),
      ).rejects.toThrow('downstream error')

      expect(logger.warn).toHaveBeenCalledTimes(1)
      const warnArg = logger.warn.mock.calls[0][0] as Record<string, unknown>
      expect(warnArg.error).toBe('downstream error')
      expect((warnArg.message as string)).toContain('ERROR')
      expect(logger.log).not.toHaveBeenCalled()
    })
  })
})
