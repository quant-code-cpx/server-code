import { Test, TestingModule } from '@nestjs/testing'
import { Job } from 'bullmq'
import { SubscriptionFrequency, SubscriptionStatus } from '@prisma/client'
import { ScreenerSubscriptionProcessor } from '../screener-subscription.processor'
import { PrismaService } from 'src/shared/prisma.service'
import { StockService } from 'src/apps/stock/stock.service'
import { EventsGateway } from 'src/websocket/events.gateway'
import { ScreenerSubscriptionJobName } from 'src/constant/queue.constant'
import { MAX_CONSECUTIVE_FAILS } from '../constants/subscription.constant'
import { createMockPrismaService } from 'test/helpers/prisma-mock'

// ── Job 工厂 ──────────────────────────────────────────────────────────────────

function makeJob<T>(name: string, data: T): jest.Mocked<Job<T>> {
  return {
    id: 'job-1',
    name,
    data,
    updateProgress: jest.fn(),
  } as unknown as jest.Mocked<Job<T>>
}

// ── 活跃订阅 builder ──────────────────────────────────────────────────────────

function buildSub(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    userId: 10,
    name: '测试订阅',
    status: SubscriptionStatus.ACTIVE,
    filters: { minPe: 10 },
    sortBy: null,
    sortOrder: null,
    lastMatchCodes: [],
    consecutiveFails: 0,
    ...overrides,
  }
}

describe('ScreenerSubscriptionProcessor', () => {
  let processor: ScreenerSubscriptionProcessor
  let prisma: ReturnType<typeof createMockPrismaService>
  let stockService: jest.Mocked<Pick<StockService, 'screener'>>
  let eventsGateway: jest.Mocked<Pick<EventsGateway, 'emitToUser'>>

  beforeEach(async () => {
    prisma = createMockPrismaService()
    stockService = { screener: jest.fn() }
    eventsGateway = { emitToUser: jest.fn() }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScreenerSubscriptionProcessor,
        { provide: PrismaService, useValue: prisma },
        { provide: StockService, useValue: stockService },
        { provide: EventsGateway, useValue: eventsGateway },
      ],
    }).compile()

    processor = module.get(ScreenerSubscriptionProcessor)
  })

  afterEach(() => jest.clearAllMocks())

  // ── EXECUTE_SUBSCRIPTION ──────────────────────────────────────────────────

  describe('execute_subscription', () => {
    it('成功命中新股票 → 更新订阅、写日志、emitToUser', async () => {
      const sub = buildSub({ lastMatchCodes: ['000001.SZ'] })
      prisma.screenerSubscription.findUnique.mockResolvedValue(sub as never)
      prisma.screenerSubscription.update.mockResolvedValue({} as never)
      prisma.screenerSubscriptionLog.create.mockResolvedValue({} as never)
      stockService.screener.mockResolvedValue({ items: [{ tsCode: '000001.SZ' }, { tsCode: '000002.SZ' }] } as never)

      const job = makeJob(ScreenerSubscriptionJobName.EXECUTE_SUBSCRIPTION, {
        subscriptionId: 1,
        tradeDate: '2026-04-09',
      })
      await processor.process(job)

      expect(prisma.screenerSubscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 1 },
          data: expect.objectContaining({
            consecutiveFails: 0,
            lastMatchCodes: ['000001.SZ', '000002.SZ'],
          }),
        }),
      )
      expect(prisma.screenerSubscriptionLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            subscriptionId: 1,
            matchCount: 2,
            newEntryCount: 1, // 000002.SZ is new
            exitCount: 0,
          }),
        }),
      )
      expect(eventsGateway.emitToUser).toHaveBeenCalledWith(
        sub.userId,
        'screener_subscription_alert',
        expect.objectContaining({ subscriptionId: 1, newEntryCodes: ['000002.SZ'] }),
      )
    })

    it('无新增股票 → 不推送 WS 消息', async () => {
      const sub = buildSub({ lastMatchCodes: ['000001.SZ'] })
      prisma.screenerSubscription.findUnique.mockResolvedValue(sub as never)
      prisma.screenerSubscription.update.mockResolvedValue({} as never)
      prisma.screenerSubscriptionLog.create.mockResolvedValue({} as never)
      stockService.screener.mockResolvedValue({ items: [{ tsCode: '000001.SZ' }] } as never)

      const job = makeJob(ScreenerSubscriptionJobName.EXECUTE_SUBSCRIPTION, {
        subscriptionId: 1,
        tradeDate: '2026-04-09',
      })
      await processor.process(job)

      expect(eventsGateway.emitToUser).not.toHaveBeenCalled()
    })

    it('退出股票 → 日志中 exitCodes 正确', async () => {
      const sub = buildSub({ lastMatchCodes: ['000001.SZ', '000002.SZ'] })
      prisma.screenerSubscription.findUnique.mockResolvedValue(sub as never)
      prisma.screenerSubscription.update.mockResolvedValue({} as never)
      prisma.screenerSubscriptionLog.create.mockResolvedValue({} as never)
      stockService.screener.mockResolvedValue({ items: [{ tsCode: '000001.SZ' }] } as never)

      const job = makeJob(ScreenerSubscriptionJobName.EXECUTE_SUBSCRIPTION, {
        subscriptionId: 1,
        tradeDate: '2026-04-09',
      })
      await processor.process(job)

      expect(prisma.screenerSubscriptionLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ exitCount: 1, exitCodes: ['000002.SZ'] }),
        }),
      )
    })

    it('订阅不存在 → 直接返回，不调用 screener', async () => {
      prisma.screenerSubscription.findUnique.mockResolvedValue(null)
      const job = makeJob(ScreenerSubscriptionJobName.EXECUTE_SUBSCRIPTION, {
        subscriptionId: 99,
        tradeDate: '2026-04-09',
      })
      await processor.process(job)
      expect(stockService.screener).not.toHaveBeenCalled()
    })

    it('订阅已非 ACTIVE → 直接返回', async () => {
      prisma.screenerSubscription.findUnique.mockResolvedValue(buildSub({ status: SubscriptionStatus.PAUSED }) as never)
      const job = makeJob(ScreenerSubscriptionJobName.EXECUTE_SUBSCRIPTION, {
        subscriptionId: 1,
        tradeDate: '2026-04-09',
      })
      await processor.process(job)
      expect(stockService.screener).not.toHaveBeenCalled()
    })

    it('screener 抛出 → consecutiveFails+1，写入失败日志', async () => {
      const sub = buildSub({ consecutiveFails: 0 })
      prisma.screenerSubscription.findUnique.mockResolvedValue(sub as never)
      prisma.screenerSubscription.update.mockResolvedValue({} as never)
      prisma.screenerSubscriptionLog.create.mockResolvedValue({} as never)
      stockService.screener.mockRejectedValue(new Error('screener failed'))

      const job = makeJob(ScreenerSubscriptionJobName.EXECUTE_SUBSCRIPTION, {
        subscriptionId: 1,
        tradeDate: '2026-04-09',
      })
      await processor.process(job)

      expect(prisma.screenerSubscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ consecutiveFails: 1 }),
        }),
      )
      expect(prisma.screenerSubscriptionLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ success: false, errorMessage: 'screener failed' }),
        }),
      )
    })

    it(`连续失败达 ${MAX_CONSECUTIVE_FAILS} 次 → 状态改为 ERROR`, async () => {
      const sub = buildSub({ consecutiveFails: MAX_CONSECUTIVE_FAILS - 1 })
      prisma.screenerSubscription.findUnique.mockResolvedValue(sub as never)
      prisma.screenerSubscription.update.mockResolvedValue({} as never)
      prisma.screenerSubscriptionLog.create.mockResolvedValue({} as never)
      stockService.screener.mockRejectedValue(new Error('fail again'))

      const job = makeJob(ScreenerSubscriptionJobName.EXECUTE_SUBSCRIPTION, {
        subscriptionId: 1,
        tradeDate: '2026-04-09',
      })
      await processor.process(job)

      expect(prisma.screenerSubscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: SubscriptionStatus.ERROR }),
        }),
      )
    })
  })

  // ── BATCH_EXECUTE ─────────────────────────────────────────────────────────

  describe('batch_execute', () => {
    it('查询所有 ACTIVE+DAILY 订阅，逐一执行', async () => {
      const subs = [buildSub({ id: 1 }), buildSub({ id: 2 })]
      prisma.screenerSubscription.findMany.mockResolvedValueOnce(subs as never)
      // 每次 findUnique 返回对应订阅
      prisma.screenerSubscription.findUnique
        .mockResolvedValueOnce(subs[0] as never)
        .mockResolvedValueOnce(subs[1] as never)
      prisma.screenerSubscription.update.mockResolvedValue({} as never)
      prisma.screenerSubscriptionLog.create.mockResolvedValue({} as never)
      stockService.screener.mockResolvedValue({ list: [] } as never)

      const job = makeJob(ScreenerSubscriptionJobName.BATCH_EXECUTE, {
        frequency: SubscriptionFrequency.DAILY,
        tradeDate: '2026-04-09',
      })
      await processor.process(job)

      expect(prisma.screenerSubscription.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: SubscriptionStatus.ACTIVE, frequency: SubscriptionFrequency.DAILY },
        }),
      )
      expect(stockService.screener).toHaveBeenCalledTimes(2)
    })

    it('单个订阅执行失败 → 不影响其他订阅', async () => {
      const subs = [buildSub({ id: 1 }), buildSub({ id: 2 })]
      prisma.screenerSubscription.findMany.mockResolvedValueOnce(subs as never)
      prisma.screenerSubscription.findUnique
        .mockResolvedValueOnce(subs[0] as never)
        .mockResolvedValueOnce(subs[1] as never)
      prisma.screenerSubscription.update.mockResolvedValue({} as never)
      prisma.screenerSubscriptionLog.create.mockResolvedValue({} as never)
      stockService.screener.mockRejectedValueOnce(new Error('sub1 fail')).mockResolvedValueOnce({ list: [] } as never)

      const job = makeJob(ScreenerSubscriptionJobName.BATCH_EXECUTE, {
        frequency: SubscriptionFrequency.DAILY,
        tradeDate: '2026-04-09',
      })
      await expect(processor.process(job)).resolves.not.toThrow()
      expect(stockService.screener).toHaveBeenCalledTimes(2)
    })

    it('无活跃订阅 → 不调用 screener', async () => {
      prisma.screenerSubscription.findMany.mockResolvedValueOnce([])
      const job = makeJob(ScreenerSubscriptionJobName.BATCH_EXECUTE, {
        frequency: SubscriptionFrequency.WEEKLY,
        tradeDate: '2026-04-07',
      })
      await processor.process(job)
      expect(stockService.screener).not.toHaveBeenCalled()
    })
  })

  // ── 未知 job ──────────────────────────────────────────────────────────────

  it('process(unknown-job) — 直接返回，不抛出', async () => {
    const job = makeJob('unknown', {})
    await expect(processor.process(job)).resolves.not.toThrow()
    expect(stockService.screener).not.toHaveBeenCalled()
  })
})
