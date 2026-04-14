import { ExecutionContext } from '@nestjs/common'
import { firstValueFrom } from 'rxjs'
import { HttpMetricsInterceptor } from '../http-metrics.interceptor'
import { makeCallHandler, makeCallHandlerWithError } from 'test/helpers/call-handler'

// ── 工厂函数 ──────────────────────────────────────────────────────────────────

function makeMetrics() {
  const endTimer = jest.fn()
  const durationHistogram = { startTimer: jest.fn().mockReturnValue(endTimer) }
  const requestCounter = { inc: jest.fn() }
  const errorCounter = { inc: jest.fn() }
  return { durationHistogram, requestCounter, errorCounter, endTimer }
}

function makeInterceptor(metrics = makeMetrics()): { interceptor: HttpMetricsInterceptor; metrics: ReturnType<typeof makeMetrics> } {
  const interceptor = new HttpMetricsInterceptor(
    metrics.durationHistogram as never,
    metrics.requestCounter as never,
    metrics.errorCounter as never,
  )
  return { interceptor, metrics }
}

function makeContext(overrides: {
  method?: string
  url?: string
  statusCode?: number
  route?: { path: string } | undefined
} = {}): ExecutionContext {
  const { method = 'POST', url = '/api/test', statusCode = 200 } = overrides
  const hasRoute = 'route' in overrides
  const request: Record<string, unknown> = { method, url }
  if (hasRoute) {
    request.route = overrides.route
  } else {
    request.route = { path: url }
  }
  const response = { statusCode }
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext
}

// ── 测试用例 ──────────────────────────────────────────────────────────────────

describe('HttpMetricsInterceptor', () => {
  afterEach(() => jest.clearAllMocks())

  describe('[BIZ] 正常请求计量', () => {
    it('[BIZ] 200 成功响应 → 记录 durationHistogram + requestCounter，不记录 errorCounter', async () => {
      const { interceptor, metrics } = makeInterceptor()
      const ctx = makeContext({ method: 'POST', url: '/api/test', statusCode: 200 })

      await firstValueFrom(interceptor.intercept(ctx, makeCallHandler({})))

      expect(metrics.durationHistogram.startTimer).toHaveBeenCalledWith({
        method: 'POST',
        route: '/api/test',
      })
      expect(metrics.requestCounter.inc).toHaveBeenCalledWith({
        method: 'POST',
        route: '/api/test',
        status_code: '200',
      })
      expect(metrics.errorCounter.inc).not.toHaveBeenCalled()
    })

    it('[BIZ] endTimer 被调用（记录请求耗时）', async () => {
      const { interceptor, metrics } = makeInterceptor()
      const ctx = makeContext({ statusCode: 200 })

      await firstValueFrom(interceptor.intercept(ctx, makeCallHandler({})))

      expect(metrics.endTimer).toHaveBeenCalledWith(
        expect.objectContaining({ status_code: '200' }),
      )
    })

    it('[BIZ] 4xx 错误响应 → 同时记录 requestCounter + errorCounter', async () => {
      const { interceptor, metrics } = makeInterceptor()
      const ctx = makeContext({ statusCode: 400 })

      await firstValueFrom(interceptor.intercept(ctx, makeCallHandler({})))

      expect(metrics.requestCounter.inc).toHaveBeenCalledWith(
        expect.objectContaining({ status_code: '400' }),
      )
      expect(metrics.errorCounter.inc).toHaveBeenCalledWith(
        expect.objectContaining({ status_code: '400' }),
      )
    })
  })

  describe('[ERR] 异常路径计量', () => {
    it('[ERR] 抛出带 status=500 的异常 → 记录 error + request counter', async () => {
      const { interceptor, metrics } = makeInterceptor()
      const ctx = makeContext()
      const error: { status: number; message: string } = { status: 500, message: 'server error' }

      await expect(firstValueFrom(interceptor.intercept(ctx, makeCallHandlerWithError(error)))).rejects.toEqual(error)

      expect(metrics.requestCounter.inc).toHaveBeenCalledWith(
        expect.objectContaining({ status_code: '500' }),
      )
      expect(metrics.errorCounter.inc).toHaveBeenCalledWith(
        expect.objectContaining({ status_code: '500' }),
      )
    })

    it('[ERR] 抛出无 status 字段的 Error → 默认 status_code = "500"', async () => {
      const { interceptor, metrics } = makeInterceptor()
      const ctx = makeContext()

      await expect(
        firstValueFrom(interceptor.intercept(ctx, makeCallHandlerWithError(new Error('boom')))),
      ).rejects.toThrow('boom')

      expect(metrics.errorCounter.inc).toHaveBeenCalledWith(
        expect.objectContaining({ status_code: '500' }),
      )
    })
  })

  describe('[BIZ] 排除路径', () => {
    const excludedPaths = ['/metrics', '/health', '/ready', '/api/health', '/api/ready']

    it.each(excludedPaths)('[BIZ] %s 路径 → 不记录任何指标', async (url) => {
      const { interceptor, metrics } = makeInterceptor()
      const ctx = makeContext({ url })

      await firstValueFrom(interceptor.intercept(ctx, makeCallHandler({})))

      expect(metrics.durationHistogram.startTimer).not.toHaveBeenCalled()
      expect(metrics.requestCounter.inc).not.toHaveBeenCalled()
    })

    it('[BUG P5-B9] /metrics-export 被 startsWith("/metrics") 前缀误排除（不记录指标）', async () => {
      // 当前行为：/metrics-export 被排除，不记录指标
      // 正确行为：应该记录指标（仅排除 /metrics 精确路径）
      const { interceptor, metrics } = makeInterceptor()
      const ctx = makeContext({ url: '/metrics-export' })

      await firstValueFrom(interceptor.intercept(ctx, makeCallHandler({})))

      // 记录当前（有缺陷的）行为：/metrics-export 被意外排除
      expect(metrics.durationHistogram.startTimer).not.toHaveBeenCalled()
      // 修复后应改为: expect(metrics.durationHistogram.startTimer).toHaveBeenCalled()
    })
  })

  describe('[BUG P5-B8] 路由提取回退', () => {
    it('[BUG P5-B8] 无匹配路由（request.route=undefined）→ 回退到完整 URL（含路径参数，风险：基数爆炸）', async () => {
      // 404 场景：request.route 为 undefined → extractRoute 回退到 request.url
      // 若 url 包含动态 ID，每个请求产生不同 label → Prometheus 基数爆炸
      const { interceptor, metrics } = makeInterceptor()
      const ctx = makeContext({ url: '/api/unknown/12345?q=test', route: undefined })

      await firstValueFrom(interceptor.intercept(ctx, makeCallHandler({})))

      // 记录当前（有缺陷的）行为：route label 为完整 URL 而非路由模式
      expect(metrics.durationHistogram.startTimer).toHaveBeenCalledWith(
        expect.objectContaining({ route: '/api/unknown/12345?q=test' }),
      )
      // 建议修复：route = 'UNKNOWN' 作为兜底，避免基数爆炸
    })

    it('[BIZ] request.route.path 存在时使用路由模式而非真实 URL', async () => {
      const { interceptor, metrics } = makeInterceptor()
      // route.path = '/api/stock/:id'（路由模式），url = '/api/stock/123'（真实路径）
      const ctx = makeContext({ url: '/api/stock/123', route: { path: '/api/stock/:id' } })

      await firstValueFrom(interceptor.intercept(ctx, makeCallHandler({})))

      // 使用路由模式，不包含动态 ID
      expect(metrics.durationHistogram.startTimer).toHaveBeenCalledWith(
        expect.objectContaining({ route: '/api/stock/:id' }),
      )
    })
  })
})
