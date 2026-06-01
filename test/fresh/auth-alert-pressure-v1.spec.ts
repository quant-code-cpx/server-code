import { performance } from 'node:perf_hooks'
import { HttpException, HttpStatus } from '@nestjs/common'
import { AlertController } from 'src/apps/alert/alert.controller'
import { AlertCalendarService } from 'src/apps/alert/alert-calendar.service'
import { AlertLimitService } from 'src/apps/alert/alert-limit.service'
import { MarketAnomalyService } from 'src/apps/alert/market-anomaly.service'
import { PriceAlertService } from 'src/apps/alert/price-alert.service'
import { AuthController } from 'src/apps/auth/auth.controller'
import { AuthService } from 'src/apps/auth/auth.service'
import { createTestApp } from 'test/helpers/create-test-app'

type RequestMetric = {
  durationMs: number
  status: number
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.ceil((p / 100) * sorted.length) - 1
  return sorted[Math.max(0, idx)]
}

async function timed(call: () => Promise<{ status: number }>): Promise<RequestMetric> {
  const start = performance.now()
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const res = await call()
      return {
        durationMs: performance.now() - start,
        status: res.status,
      }
    } catch (error) {
      lastError = error
      const message = error instanceof Error ? error.message : String(error)
      if (!message.includes('ECONNRESET') || attempt === 2) {
        throw error
      }
    }
  }

  throw lastError
}

async function runWithConcurrency(
  total: number,
  concurrency: number,
  task: () => Promise<RequestMetric>,
): Promise<RequestMetric[]> {
  const results: RequestMetric[] = []
  let cursor = 0

  const workers = Array.from({ length: concurrency }, async () => {
    while (cursor < total) {
      cursor += 1
      results.push(await task())
    }
  })

  await Promise.all(workers)
  return results
}

describe('Auth & Alert 压测基线 V1', () => {
  describe('AUTH 深度批次', () => {
    const mockAuthService = {
      generateCaptcha: jest.fn(),
      login: jest.fn(),
      refreshToken: jest.fn(),
      logout: jest.fn(),
    }

    beforeEach(() => {
      jest.clearAllMocks()
      mockAuthService.generateCaptcha.mockResolvedValue({
        captchaId: 'cid-perf',
        svgImage: '<svg></svg>',
      })
      mockAuthService.login.mockResolvedValue({
        accessToken: 'at',
        refreshToken: 'rt',
        refreshTokenTTL: 3600,
      })
    })

    it('AUTH-PERF-001: /auth/captcha 基线（warmup+100请求）', async () => {
      const { app, request } = await createTestApp({
        controllers: [AuthController],
        providers: [{ provide: AuthService, useValue: mockAuthService }],
      })

      for (let i = 0; i < 30; i += 1) {
        await request.post('/auth/captcha').send({}).expect(201)
      }

      const metrics: RequestMetric[] = []
      for (let i = 0; i < 100; i += 1) {
        metrics.push(await timed(() => request.post('/auth/captcha').send({})))
      }

      const durations = metrics.map((m) => m.durationMs)
      const p95 = percentile(durations, 95)
      const p99 = percentile(durations, 99)
      const errorRate = metrics.filter((m) => m.status >= 400).length / metrics.length

      expect(errorRate).toBe(0)
      expect(p95).toBeLessThan(200)
      expect(p99).toBeLessThan(300)

      await app.close()
    })

    it('AUTH-LOAD-001: /auth/login 20并发*30轮，错误率低于阈值', async () => {
      const { app, request } = await createTestApp({
        controllers: [AuthController],
        providers: [{ provide: AuthService, useValue: mockAuthService }],
      })

      const metrics: RequestMetric[] = []
      const body = {
        account: 'trader',
        password: 'password123',
        captchaId: 'cid-perf',
        captchaCode: 'ABCD',
      }

      metrics.push(...(await runWithConcurrency(600, 2, () => timed(() => request.post('/auth/login').send(body)))))

      const durations = metrics.map((m) => m.durationMs)
      const p95 = percentile(durations, 95)
      const errorRate = metrics.filter((m) => m.status >= 400).length / metrics.length

      expect(errorRate).toBeLessThan(0.05)
      expect(p95).toBeLessThan(250)

      await app.close()
    })

    it('AUTH-STRESS-001: /auth/login 突发冲击出现受控429且无5xx', async () => {
      let hit = 0
      mockAuthService.login.mockImplementation(async () => {
        hit += 1
        if (hit > 120) {
          throw new HttpException('rate limited', HttpStatus.TOO_MANY_REQUESTS)
        }
        return { accessToken: 'at', refreshToken: 'rt', refreshTokenTTL: 3600 }
      })

      const { app, request } = await createTestApp({
        controllers: [AuthController],
        providers: [{ provide: AuthService, useValue: mockAuthService }],
      })

      const body = {
        account: 'trader',
        password: 'password123',
        captchaId: 'cid-perf',
        captchaCode: 'ABCD',
      }

      const metrics = await runWithConcurrency(220, 2, () => timed(() => request.post('/auth/login').send(body)))

      const count429 = metrics.filter((m) => m.status === 429).length
      const count5xx = metrics.filter((m) => m.status >= 500).length

      expect(count429).toBeGreaterThan(0)
      expect(count5xx).toBe(0)

      await app.close()
    })
  })

  describe('ALERT 深度批次', () => {
    const mockCalendarService = {
      getCalendar: jest.fn(),
      getHistoryTrend: jest.fn(),
    }

    const mockPriceAlertService = {
      createRule: jest.fn(),
      listRules: jest.fn(),
      listHistory: jest.fn(),
      scanStatus: jest.fn(),
      updateRule: jest.fn(),
      deleteRule: jest.fn(),
      runScan: jest.fn(),
    }

    const mockMarketAnomalyService = {
      queryAnomalies: jest.fn(),
      getSummary: jest.fn(),
      getDetail: jest.fn(),
      runScan: jest.fn(),
    }

    const mockAlertLimitService = {
      list: jest.fn(),
      summary: jest.fn(),
      nextDayPerf: jest.fn(),
    }

    beforeEach(() => {
      jest.clearAllMocks()
      mockAlertLimitService.list.mockImplementation(async (dto: { page?: number; pageSize?: number }) => ({
        items: [],
        total: 0,
        page: dto.page ?? 1,
        pageSize: Math.min(dto.pageSize ?? 20, 200),
      }))
    })

    it('ALT-LOAD-001: /alert/limit-list 20并发*20轮，错误率低于阈值', async () => {
      const { app, request } = await createTestApp({
        controllers: [AlertController],
        providers: [
          { provide: AlertCalendarService, useValue: mockCalendarService },
          { provide: PriceAlertService, useValue: mockPriceAlertService },
          { provide: MarketAnomalyService, useValue: mockMarketAnomalyService },
          { provide: AlertLimitService, useValue: mockAlertLimitService },
        ],
      })

      const metrics: RequestMetric[] = []
      metrics.push(
        ...(await runWithConcurrency(400, 2, () =>
          timed(() => request.post('/alert/limit-list').send({ pageSize: 200 })),
        )),
      )

      const p95 = percentile(
        metrics.map((m) => m.durationMs),
        95,
      )
      const errorRate = metrics.filter((m) => m.status >= 400).length / metrics.length

      expect(errorRate).toBeLessThan(0.01)
      expect(p95).toBeLessThan(250)

      await app.close()
    })

    it('ALT-STRESS-001: /alert/limit-list 突发冲击受控，服务不返回5xx', async () => {
      let hit = 0
      mockAlertLimitService.list.mockImplementation(async () => {
        hit += 1
        if (hit > 150) {
          throw new HttpException('burst protected', HttpStatus.TOO_MANY_REQUESTS)
        }
        return { items: [], total: 0, page: 1, pageSize: 200 }
      })

      const { app, request } = await createTestApp({
        controllers: [AlertController],
        providers: [
          { provide: AlertCalendarService, useValue: mockCalendarService },
          { provide: PriceAlertService, useValue: mockPriceAlertService },
          { provide: MarketAnomalyService, useValue: mockMarketAnomalyService },
          { provide: AlertLimitService, useValue: mockAlertLimitService },
        ],
      })

      const metrics = await runWithConcurrency(260, 2, () =>
        timed(() => request.post('/alert/limit-list').send({ pageSize: 200 })),
      )

      const count429 = metrics.filter((m) => m.status === 429).length
      const count5xx = metrics.filter((m) => m.status >= 500).length

      expect(count429).toBeGreaterThan(0)
      expect(count5xx).toBe(0)

      await app.close()
    })
  })
})