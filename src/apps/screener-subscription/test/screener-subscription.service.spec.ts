import { BadRequestException, NotFoundException } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { Prisma, SubscriptionFrequency, SubscriptionRunStatus, SubscriptionStatus } from '@prisma/client'
import { ScreenerSubscriptionService } from '../screener-subscription.service'
import { PrismaService } from 'src/shared/prisma.service'
import { SCREENER_SUBSCRIPTION_QUEUE, ScreenerSubscriptionJobName } from 'src/constant/queue.constant'
import { createMockPrismaService } from 'test/helpers/prisma-mock'
import { getQueueToken } from '@nestjs/bullmq'
import {
  buildSubscriptionQueueJobId,
  MANUAL_TRIGGER_COOLDOWN_MS,
  MAX_CONSECUTIVE_FAILS,
} from '../constants/subscription.constant'
import { RuleFingerprintService, RuleNormalizerService } from '../rule'
import { MetricCatalogService } from '../metric-catalog'
import { SubscriptionEvaluatorRegistry } from '../evaluator'
import { SubscriptionDataReadinessService } from '../subscription-data-readiness.service'

describe('ScreenerSubscriptionService', () => {
  let service: ScreenerSubscriptionService
  let prisma: ReturnType<typeof createMockPrismaService>
  let queue: { add: jest.Mock; addBulk: jest.Mock }
  let ruleNormalizer: jest.Mocked<
    Pick<RuleNormalizerService, 'normalizeLegacyStockScreeningRule' | 'normalizeRuleSpec' | 'normalizeTriggerSpec'>
  >
  let ruleFingerprint: jest.Mocked<Pick<RuleFingerprintService, 'create'>>
  let metricCatalog: jest.Mocked<Pick<MetricCatalogService, 'list'>>
  let evaluatorRegistry: jest.Mocked<Pick<SubscriptionEvaluatorRegistry, 'get'>>
  let dataReadiness: jest.Mocked<Pick<SubscriptionDataReadinessService, 'checkStockScreening' | 'checkRule'>>

  beforeEach(async () => {
    prisma = createMockPrismaService()
    queue = { add: jest.fn().mockResolvedValue({ id: 'job-1' }), addBulk: jest.fn().mockResolvedValue([]) }
    ruleNormalizer = {
      normalizeLegacyStockScreeningRule: jest.fn().mockImplementation(
        (filters) =>
          ({
            type: 'STOCK_SCREENING',
            version: 1,
            universe: { type: 'ALL_A', excludeSt: true, excludeSuspended: true, excludeBse: false },
            filters,
          }) as never,
      ),
      normalizeRuleSpec: jest.fn().mockImplementation((ruleSpec) => ruleSpec as never),
      normalizeTriggerSpec: jest.fn().mockReturnValue({
        mode: 'ENTER',
        notifyOnInitialMatch: false,
        eventWindow: 'CURRENT_TRADE_DATE',
        cooldownTradingDays: 0,
        maxHitsPerNotification: 20,
      } as never),
    }
    ruleFingerprint = { create: jest.fn().mockReturnValue({ fingerprint: 'legacy-rule-fingerprint' } as never) }
    metricCatalog = { list: jest.fn().mockReturnValue({ catalogVersion: 'catalog-v1-test', metrics: [] }) }
    evaluatorRegistry = { get: jest.fn() }
    dataReadiness = {
      checkStockScreening: jest.fn().mockResolvedValue({
        ready: true,
        tradeDate: '20260803',
        dataVersions: { MARKET_DAILY: '20260803' },
        missing: [],
      }),
      checkRule: jest.fn().mockResolvedValue({
        ready: true,
        tradeDate: '20260803',
        dataVersions: { MARKET_DAILY: '20260803' },
        missing: [],
      }),
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScreenerSubscriptionService,
        { provide: PrismaService, useValue: prisma },
        { provide: getQueueToken(SCREENER_SUBSCRIPTION_QUEUE), useValue: queue },
        { provide: RuleNormalizerService, useValue: ruleNormalizer },
        { provide: RuleFingerprintService, useValue: ruleFingerprint },
        { provide: MetricCatalogService, useValue: metricCatalog },
        { provide: SubscriptionEvaluatorRegistry, useValue: evaluatorRegistry },
        { provide: SubscriptionDataReadinessService, useValue: dataReadiness },
      ],
    }).compile()

    service = module.get(ScreenerSubscriptionService)
  })

  afterEach(() => {
    jest.useRealTimers()
    jest.clearAllMocks()
  })

  // ── findAll ───────────────────────────────────────────────────────────────

  it('findAll — 返回用户所有订阅（含策略信息）', async () => {
    const subscriptions = [
      { id: 1, strategyId: null },
      { id: 2, strategyId: null },
    ]
    prisma.screenerSubscription.findMany.mockResolvedValue(subscriptions as never)

    const result = await service.findAll(1)
    expect(result.subscriptions).toHaveLength(2)
    expect(result.subscriptions[0]).toMatchObject({ id: 1, strategyName: null, strategyStatus: null })
    expect(prisma.screenerSubscription.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 1 } }))
  })

  // ── create ────────────────────────────────────────────────────────────────

  it('create — 用 filters → 直接创建订阅', async () => {
    prisma.screenerSubscription.count.mockResolvedValue(0)
    const created = { id: 1, strategyId: null }
    prisma.screenerSubscription.create.mockResolvedValue(created as never)

    const result = await service.create(1, { name: '订阅1', filters: { minPe: 10 } })
    expect(result).toMatchObject({ id: 1, strategyName: null })
    expect(prisma.screenerSubscription.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ ruleFingerprint: 'legacy-rule-fingerprint' }) }),
    )
    expect(ruleNormalizer.normalizeLegacyStockScreeningRule).toHaveBeenCalledWith({ minPe: 10 })
  })

  it('create — 用 strategyId → 取策略 filters', async () => {
    prisma.screenerSubscription.count.mockResolvedValue(0)
    prisma.screenerStrategy.findFirst.mockResolvedValue({ id: 5, filters: { minPe: 5 } } as never)
    prisma.screenerSubscription.create.mockResolvedValue({ id: 2 } as never)

    await service.create(1, { name: '订阅2', strategyId: 5 })
    expect(prisma.screenerStrategy.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 5, userId: 1 } }),
    )
    expect(prisma.screenerSubscription.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ filters: { minPe: 5 } }) }),
    )
  })

  it('create — strategyId 不存在 → NotFoundException', async () => {
    prisma.screenerSubscription.count.mockResolvedValue(0)
    prisma.screenerStrategy.findFirst.mockResolvedValue(null)

    await expect(service.create(1, { name: '订阅', strategyId: 99 })).rejects.toThrow(NotFoundException)
  })

  it('create — 超上限 → BadRequestException', async () => {
    prisma.screenerSubscription.count.mockResolvedValue(10)
    await expect(service.create(1, { name: 'x', filters: {} })).rejects.toThrow(BadRequestException)
  })

  it('create — strategyId 和 filters 均未提供 → BadRequestException', async () => {
    prisma.screenerSubscription.count.mockResolvedValue(0)
    await expect(service.create(1, { name: 'x' })).rejects.toThrow(BadRequestException)
  })

  it('create — ruleSpec 与 legacy source 同传 → RULE_SOURCE_CONFLICT', async () => {
    prisma.screenerSubscription.count.mockResolvedValue(0)
    await expect(
      service.create(1, { name: 'x', ruleSpec: { type: 'STOCK_SCREENING' }, filters: {} }),
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'RULE_SOURCE_CONFLICT' }) })
  })

  // ── update ────────────────────────────────────────────────────────────────

  it('update — 存在 → 更新并返回（含策略信息）', async () => {
    prisma.screenerSubscription.findFirst.mockResolvedValue({ id: 1 } as never)
    const updated = { id: 1, name: '新名称', strategyId: null }
    prisma.screenerSubscription.update.mockResolvedValue(updated as never)

    const result = await service.update(1, 1, { name: '新名称' })
    expect(result).toMatchObject({ id: 1, name: '新名称' })
  })

  it('update — 不存在 → NotFoundException', async () => {
    prisma.screenerSubscription.findFirst.mockResolvedValue(null)
    await expect(service.update(1, 99, {})).rejects.toThrow(NotFoundException)
  })

  it('update — 筛选条件语义变化时递增 ruleVersion 并清空旧基线', async () => {
    prisma.screenerSubscription.findFirst.mockResolvedValue({
      id: 1,
      filters: { minPe: 10, maxPb: 2 },
      strategyId: null,
      ruleVersion: 4,
      lastRunAt: new Date('2026-08-01T12:00:00.000Z'),
      lastEvaluatedTradeDate: '20260801',
      lastRunResult: { matchCount: 3 },
      lastMatchCodes: ['000001.SZ', '000002.SZ'],
    } as never)
    prisma.screenerSubscription.update.mockResolvedValue({ id: 1, strategyId: null } as never)
    ruleFingerprint.create
      .mockReturnValueOnce({ fingerprint: 'changed-rule-fingerprint' } as never)
      .mockReturnValueOnce({ fingerprint: 'legacy-rule-fingerprint' } as never)

    await service.update(1, 1, { filters: { minPe: 15, maxPb: 2 } })

    expect(prisma.screenerSubscription.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 1 },
        data: expect.objectContaining({
          filters: { minPe: 15, maxPb: 2 },
          ruleVersion: { increment: 1 },
          ruleFingerprint: 'changed-rule-fingerprint',
          lastRunAt: null,
          lastEvaluatedTradeDate: null,
          lastRunResult: Prisma.DbNull,
          lastMatchCodes: [],
        }),
      }),
    )
    expect(ruleNormalizer.normalizeLegacyStockScreeningRule).toHaveBeenCalledWith({ minPe: 15, maxPb: 2 })
  })

  it('update — 仅对象 key 顺序变化时指纹相同，不重置基线或规则版本', async () => {
    prisma.screenerSubscription.findFirst.mockResolvedValue({
      id: 1,
      filters: { minPe: 10, maxPb: 2 },
      strategyId: null,
      ruleFingerprint: 'legacy-rule-fingerprint',
    } as never)
    prisma.screenerSubscription.update.mockResolvedValue({ id: 1, strategyId: null } as never)

    await service.update(1, 1, { filters: { maxPb: 2, minPe: 10 } })

    const updateInput = prisma.screenerSubscription.update.mock.calls[0][0]
    expect(updateInput.data).not.toHaveProperty('ruleVersion')
    expect(updateInput.data).not.toHaveProperty('lastMatchCodes')
    expect(ruleNormalizer.normalizeLegacyStockScreeningRule).toHaveBeenCalled()
    expect(ruleFingerprint.create).toHaveBeenCalled()
  })

  // ── remove ────────────────────────────────────────────────────────────────

  it('remove — 存在 → 删除并返回成功消息', async () => {
    prisma.screenerSubscription.findFirst.mockResolvedValue({ id: 1 } as never)
    prisma.screenerSubscription.delete.mockResolvedValue({} as never)

    const result = await service.remove(1, 1)
    expect(result.message).toBeDefined()
  })

  it('remove — 不存在 → NotFoundException', async () => {
    prisma.screenerSubscription.findFirst.mockResolvedValue(null)
    await expect(service.remove(1, 99)).rejects.toThrow(NotFoundException)
  })

  // ── pause / resume ────────────────────────────────────────────────────────

  it('pause — 存在 → 更新状态为 PAUSED 并返回订阅', async () => {
    const updated = { id: 1, status: SubscriptionStatus.PAUSED }
    prisma.screenerSubscription.findFirst.mockResolvedValue({ id: 1 } as never)
    prisma.screenerSubscription.update.mockResolvedValue(updated as never)

    const result = await service.pause(1, 1)
    expect(result).toMatchObject({ id: 1 })
    expect(prisma.screenerSubscription.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: SubscriptionStatus.PAUSED } }),
    )
  })

  it('pause — 不存在 → NotFoundException', async () => {
    prisma.screenerSubscription.findFirst.mockResolvedValue(null)
    await expect(service.pause(1, 99)).rejects.toThrow(NotFoundException)
  })

  it('resume — 存在 → 更新状态为 ACTIVE，consecutiveFails 清零并返回订阅', async () => {
    const updated = { id: 1, status: SubscriptionStatus.ACTIVE, consecutiveFails: 0 }
    prisma.screenerSubscription.findFirst.mockResolvedValue({ id: 1 } as never)
    prisma.screenerSubscription.update.mockResolvedValue(updated as never)

    const result = await service.resume(1, 1)
    expect(result).toMatchObject({ id: 1 })
    expect(prisma.screenerSubscription.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: SubscriptionStatus.ACTIVE, consecutiveFails: 0 },
      }),
    )
  })

  it('resume — 不存在 → NotFoundException', async () => {
    prisma.screenerSubscription.findFirst.mockResolvedValue(null)
    await expect(service.resume(1, 99)).rejects.toThrow(NotFoundException)
  })

  // ── manualRun ─────────────────────────────────────────────────────────────

  it('manualRun — 以当前 ruleVersion 和已锁定交易日创建可重试单订阅 job', async () => {
    prisma.screenerSubscription.findFirst.mockResolvedValue({ id: 1, lastRunAt: null, ruleVersion: 7 } as never)
    prisma.$queryRaw.mockResolvedValue([{ cal_date: new Date('2026-08-02T16:00:00.000Z') }] as never)

    const result = await service.manualRun(1, 1)
    expect(queue.add).toHaveBeenCalledWith(
      ScreenerSubscriptionJobName.EXECUTE_SUBSCRIPTION,
      { subscriptionId: 1, tradeDate: '20260803', ruleVersion: 7 },
      {
        jobId: buildSubscriptionQueueJobId(1, '20260803', 7),
        attempts: MAX_CONSECUTIVE_FAILS + 1,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: 50,
        removeOnFail: true,
      },
    )
    expect(result.jobId).toBe('job-1')
  })

  it('manualRun — 上次运行距今超过冷却时间 → 正常加入队列', async () => {
    const lastRunAt = new Date(Date.now() - MANUAL_TRIGGER_COOLDOWN_MS - 1000)
    prisma.screenerSubscription.findFirst.mockResolvedValue({ id: 1, lastRunAt, ruleVersion: 2 } as never)
    prisma.$queryRaw.mockResolvedValue([{ cal_date: new Date('2026-08-02T16:00:00.000Z') }] as never)

    const result = await service.manualRun(1, 1)
    expect(result.jobId).toBeDefined()
  })

  it('manualRun — 冷却期内 → HttpException (COOLDOWN)', async () => {
    const lastRunAt = new Date(Date.now() - 10_000) // 10s ago, < 5 min cooldown
    prisma.screenerSubscription.findFirst.mockResolvedValue({ id: 1, lastRunAt } as never)

    await expect(service.manualRun(1, 1)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'COOLDOWN' }),
    })
    expect(queue.add).not.toHaveBeenCalled()
  })

  it('manualRun — 不存在 → NotFoundException', async () => {
    prisma.screenerSubscription.findFirst.mockResolvedValue(null)
    await expect(service.manualRun(1, 99)).rejects.toThrow(NotFoundException)
  })

  it('retryDataNotReadyRuns — 仅补投递当前规则版本的 skipped run', async () => {
    prisma.screenerSubscriptionLog.findMany.mockResolvedValue([
      {
        id: 11,
        subscriptionId: 1,
        tradeDate: '20260803',
        ruleVersion: 2,
        subscription: { ruleVersion: 2 },
      },
      {
        id: 12,
        subscriptionId: 2,
        tradeDate: '20260803',
        ruleVersion: 1,
        subscription: { ruleVersion: 2 },
      },
    ] as never)

    await expect(service.retryDataNotReadyRuns()).resolves.toBe(1)

    expect(prisma.screenerSubscriptionLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: SubscriptionRunStatus.SKIPPED_DATA_NOT_READY }),
      }),
    )
    expect(queue.addBulk).toHaveBeenCalledWith([
      expect.objectContaining({
        name: ScreenerSubscriptionJobName.EXECUTE_SUBSCRIPTION,
        data: { subscriptionId: 1, tradeDate: '20260803', ruleVersion: 2, recovery: true },
        opts: expect.objectContaining({
          jobId: buildSubscriptionQueueJobId(1, '20260803', 2),
          priority: 1,
        }),
      }),
    ])
  })

  // ── 交易日 dispatcher ─────────────────────────────────────────────────────

  it('getDispatchFrequencies — 休市日不调度任何频率', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-02T12:00:00+08:00'))
    prisma.$queryRaw.mockResolvedValueOnce([] as never)

    await expect(service.getDispatchFrequencies()).resolves.toBeNull()
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1)
  })

  it('getDispatchFrequencies — 普通交易日只调度 DAILY', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-03T12:00:00+08:00'))
    prisma.$queryRaw
      .mockResolvedValueOnce([{ cal_date: new Date('2026-08-02T16:00:00.000Z') }] as never)
      .mockResolvedValueOnce([{ cal_date: new Date('2026-08-03T16:00:00.000Z') }] as never)

    await expect(service.getDispatchFrequencies()).resolves.toEqual({
      tradeDate: '20260803',
      frequencies: [SubscriptionFrequency.DAILY],
    })
  })

  it('getDispatchFrequencies — 周最后交易日包含 WEEKLY，不依赖自然周一', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-07T12:00:00+08:00'))
    prisma.$queryRaw
      .mockResolvedValueOnce([{ cal_date: new Date('2026-08-06T16:00:00.000Z') }] as never)
      .mockResolvedValueOnce([{ cal_date: new Date('2026-08-09T16:00:00.000Z') }] as never)

    await expect(service.getDispatchFrequencies()).resolves.toEqual({
      tradeDate: '20260807',
      frequencies: [SubscriptionFrequency.DAILY, SubscriptionFrequency.WEEKLY],
    })
  })

  it('getDispatchFrequencies — 月最后交易日包含 MONTHLY，即使不是自然月初', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-31T12:00:00+08:00'))
    prisma.$queryRaw
      .mockResolvedValueOnce([{ cal_date: new Date('2026-08-30T16:00:00.000Z') }] as never)
      .mockResolvedValueOnce([{ cal_date: new Date('2026-08-31T16:00:00.000Z') }] as never)

    await expect(service.getDispatchFrequencies()).resolves.toEqual({
      tradeDate: '20260831',
      frequencies: [SubscriptionFrequency.DAILY, SubscriptionFrequency.MONTHLY],
    })
  })

  // ── getLogs ───────────────────────────────────────────────────────────────

  it('getLogs — 返回分页日志（含股票元数据）', async () => {
    prisma.screenerSubscription.findFirst.mockResolvedValue({ id: 1 } as never)
    const logs = [
      { id: 1, newEntryCodes: [], exitCodes: [] },
      { id: 2, newEntryCodes: [], exitCodes: [] },
    ]
    prisma.screenerSubscriptionLog.findMany.mockResolvedValue(logs as never)
    prisma.screenerSubscriptionLog.count.mockResolvedValue(2)

    const result = await service.getLogs(1, 1, { page: 1, pageSize: 20 })
    expect(result.total).toBe(2)
    expect(result.page).toBe(1)
    expect(result.pageSize).toBe(20)
    expect(result.logs).toHaveLength(2)
    expect(result.logs[0]).toMatchObject({ id: 1, newEntries: [], exits: [] })
  })

  it('getLogs — 订阅不存在 → NotFoundException', async () => {
    prisma.screenerSubscription.findFirst.mockResolvedValue(null)
    await expect(service.getLogs(1, 99, {})).rejects.toThrow(NotFoundException)
  })

  it('preview — 完整集合只截断展示，证据与数据版本可联调', async () => {
    const evaluator = {
      evaluate: jest.fn().mockResolvedValue({
        asOfTradeDate: '20260803',
        universeCount: 3,
        matchedCodes: ['000001.SZ', '000002.SZ', '000003.SZ'],
        dataVersions: { MARKET_DAILY: 'asOf:20260803' },
        warnings: [],
      }),
      explain: jest
        .fn()
        .mockResolvedValue([{ tsCode: '000001.SZ', kind: 'MATCH', reason: '命中', details: { minPeTtm: 10 } }]),
    }
    evaluatorRegistry.get.mockReturnValue(evaluator as never)
    prisma.$queryRaw.mockResolvedValue([] as never)
    const ruleSpec = {
      type: 'STOCK_SCREENING',
      version: 1,
      universe: { type: 'ALL_A', excludeSt: true, excludeSuspended: true, excludeBse: false },
      filters: { minPeTtm: 10 },
    }

    const result = await service.preview(1, { ruleSpec, tradeDate: '20260803', limit: 1 })

    expect(result).toMatchObject({ matchedCount: 3, truncated: true, catalogVersion: 'catalog-v1-test' })
    expect(result.matchedStocks).toHaveLength(1)
    expect(evaluator.explain).toHaveBeenCalledWith(expect.anything(), ruleSpec, [
      { tsCode: '000001.SZ', kind: 'MATCH' },
    ])
  })

  it('getHits — 按 user/subscription/log 过滤并序列化 BigInt', async () => {
    prisma.screenerSubscription.findFirst.mockResolvedValue({ id: 1 } as never)
    prisma.screenerSubscriptionHit.findMany.mockResolvedValue([
      {
        id: BigInt(7),
        subscriptionId: 1,
        logId: 3,
        tradeDate: '20260803',
        evidence: { reason: '命中' },
      },
    ] as never)
    prisma.screenerSubscriptionHit.count.mockResolvedValue(1)

    const result = await service.getHits(1, { id: 1, logId: 3 })

    expect(result.hits[0]?.id).toBe('7')
    expect(prisma.screenerSubscriptionHit.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { subscriptionId: 1, logId: 3 } }),
    )
  })
})
