/**
 * DataQualityService — 单元测试
 *
 * 覆盖要点：
 * - checkTimeliness: 未知数据集 → warn；full-refresh 策略；
 *   日频数据最新 → pass；严重滞后 → fail；无数据 → warn
 * - checkCompleteness: 未知数据集 → warn；日频数据完整 → pass；
 *   日频数据缺失 >10% → fail；事件型策略 → null
 * - runAllChecksAndCollect: Redis 锁已占用 → 返回 []；锁获取成功 → 返回报告列表
 * - writeCheckResult: 写入 dataQualityCheck 表
 */

import { DataQualityService } from '../data-quality.service'
import { SyncHelperService } from '../../sync-helper.service'
import { CrossTableCheckService } from '../cross-table-check.service'
import { PrismaService } from 'src/shared/prisma.service'

// ── mock 工厂 ─────────────────────────────────────────────────────────────────

function buildPrismaMock() {
  const modelMock = () => ({
    count: jest.fn(async () => 100),
    findFirst: jest.fn(async () => ({ syncedAt: new Date() })),
    findMany: jest.fn(async () => []),
  })

  return new Proxy(
    {
      dataQualityCheck: {
        create: jest.fn(async () => undefined),
        findMany: jest.fn(async () => []),
        findFirst: jest.fn(async () => null),
      },
      suspendD: {
        findMany: jest.fn(async () => []),
      },
      stockBasic: {
        count: jest.fn(async () => 100),
        findFirst: jest.fn(async () => ({ syncedAt: new Date() })),
        findMany: jest.fn(async () => []),
      },
      dataValidationLog: {
        findMany: jest.fn(async () => []),
      },
    } as Record<string, unknown>,
    {
      get(target, prop: string) {
        if (prop in target) return target[prop]
        return modelMock()
      },
    },
  )
}

function buildHelperMock() {
  return {
    syncTimeZone: 'Asia/Shanghai',
    getLatestDateString: jest.fn(async () => '20250401'),
    resolveLatestCompletedTradeDate: jest.fn(async () => '20250401'),
    compareDateString: jest.fn(() => 0),
    getOpenTradeDatesBetween: jest.fn(async () => ['20250324', '20250325', '20250326']),
    formatDate: jest.fn((d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '')),
    toDate: jest.fn((s: string) => new Date(s.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'))),
    getCurrentShanghaiDateString: jest.fn(() => '20250401'),
    addDays: jest.fn((_date: string, _n: number) => '20250301'),
    buildRecentQuarterPeriods: jest.fn(() => ['20241231', '20240930']),
    getPeriodEndTradeDates: jest.fn(async () => []),
  }
}

function buildCrossTableMock() {
  return {
    runRecentCrossChecks: jest.fn(async () => []),
  }
}

function buildRedisMock() {
  return {
    set: jest.fn(async () => 'OK'),
    get: jest.fn(async () => null),
    del: jest.fn(async () => 1),
  }
}

function createService(
  prisma = buildPrismaMock(),
  helper = buildHelperMock(),
  crossTable = buildCrossTableMock(),
  redis = buildRedisMock(),
): DataQualityService {
  // @ts-ignore 局部 mock，跳过 DI
  return new DataQualityService(prisma as PrismaService, helper as SyncHelperService, crossTable as CrossTableCheckService, redis)
}

// ══════════════════════════════════════════════════════════════════════════════
// 测试套件
// ══════════════════════════════════════════════════════════════════════════════

describe('DataQualityService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  // ── checkTimeliness ────────────────────────────────────────────────────────

  describe('checkTimeliness()', () => {
    it('未知数据集 → 返回 warn 报告', async () => {
      const service = createService()
      const report = await service.checkTimeliness('nonExistent')
      expect(report.status).toBe('warn')
      expect(report.checkType).toBe('timeliness')
      expect(report.message).toContain('nonExistent')
    })

    it('full-refresh 数据集（stockBasic）→ 有数据时返回 pass', async () => {
      const prisma = buildPrismaMock()
      // stockBasic.count() 返回 100（非空），findFirst 返回最近同步记录
      ;(prisma.stockBasic as any).count.mockResolvedValue(100)
      ;(prisma.stockBasic as any).findFirst.mockResolvedValue({ syncedAt: new Date() })
      const service = createService(prisma)
      const report = await service.checkTimeliness('stockBasic')
      expect(report.status).toBe('pass')
      expect(report.checkType).toBe('timeliness')
    })

    it('full-refresh 数据集（stockBasic）→ 空表时返回 fail', async () => {
      const prisma = buildPrismaMock()
      ;(prisma.stockBasic as any).count.mockResolvedValue(0)
      const service = createService(prisma)
      const report = await service.checkTimeliness('stockBasic')
      expect(report.status).toBe('fail')
    })

    it('日频数据集（daily）数据最新（lag=0）→ pass', async () => {
      const helper = buildHelperMock()
      helper.compareDateString.mockReturnValue(0)
      const service = createService(undefined, helper)
      const report = await service.checkTimeliness('daily')
      expect(report.status).toBe('pass')
    })

    it('日频数据集（daily）严重滞后（lag=10）→ fail', async () => {
      const helper = buildHelperMock()
      // lag > failThreshold(7) → fail
      helper.compareDateString.mockReturnValue(10)
      const service = createService(undefined, helper)
      const report = await service.checkTimeliness('daily')
      expect(report.status).toBe('fail')
    })

    it('日频数据集（daily）轻度滞后（lag=5）→ warn', async () => {
      const helper = buildHelperMock()
      // warnThreshold=3, failThreshold=7 → 5 在 warn 区间
      helper.compareDateString.mockReturnValue(5)
      const service = createService(undefined, helper)
      const report = await service.checkTimeliness('daily')
      expect(report.status).toBe('warn')
    })

    it('日频数据集无最新日期 → warn', async () => {
      const helper = buildHelperMock()
      helper.getLatestDateString.mockResolvedValue(null)
      const service = createService(undefined, helper)
      const report = await service.checkTimeliness('daily')
      expect(report.status).toBe('warn')
      expect(report.message).toContain('暂无数据')
    })

    it('财务事件型数据集（dividend）→ 有数据时返回 pass', async () => {
      const prisma = buildPrismaMock()
      // dividend model: count() returns > 0
      const service = createService(prisma)
      const report = await service.checkTimeliness('dividend')
      // financial-event 策略：有数据 → pass
      expect(report.status).toBe('pass')
    })
  })

  // ── checkCompleteness ─────────────────────────────────────────────────────

  describe('checkCompleteness()', () => {
    it('未知数据集 → 返回 warn 报告', async () => {
      const service = createService()
      const report = await service.checkCompleteness('nonExistent', '20250301', '20250401')
      expect(report).not.toBeNull()
      expect(report!.status).toBe('warn')
    })

    it('event-trade-date 策略（suspendD）→ 返回 null', async () => {
      const service = createService()
      const report = await service.checkCompleteness('suspendD', '20250301', '20250401')
      expect(report).toBeNull()
    })

    it('event-date-field 策略（shareFloat）→ 返回 null', async () => {
      const service = createService()
      const report = await service.checkCompleteness('shareFloat', '20250301', '20250401')
      expect(report).toBeNull()
    })

    it('日频数据集（indexDaily）→ 无交易日时返回 pass', async () => {
      const helper = buildHelperMock()
      helper.getOpenTradeDatesBetween.mockResolvedValue([])
      const service = createService(undefined, helper)
      const report = await service.checkCompleteness('indexDaily', '20250101', '20250101')
      expect(report).not.toBeNull()
      expect(report!.status).toBe('pass')
      expect(report!.message).toContain('无交易日')
    })

    it('日频数据集（indexDaily）→ 数据完整时返回 pass', async () => {
      const helper = buildHelperMock()
      helper.getOpenTradeDatesBetween.mockResolvedValue(['20250324', '20250325', '20250326'])
      helper.formatDate.mockImplementation((d: Date) => {
        // 返回 YYYYMMDD 格式
        return d.toISOString().slice(0, 10).replace(/-/g, '')
      })

      const prisma = buildPrismaMock()
      // indexDaily model 返回 3 条记录，覆盖所有日期
      const dates = ['20250324', '20250325', '20250326'].map((d) => new Date(d.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3')))
      ;(prisma as any).indexDaily = {
        count: jest.fn(async () => 3),
        findMany: jest.fn(async () => dates.map((d) => ({ tradeDate: d }))),
      }

      // formatDate 需要能把 Date 转成 YYYYMMDD
      helper.formatDate.mockImplementation((d: Date) => d.toISOString().slice(0, 10).replace(/-/g, ''))

      const service = createService(prisma, helper)
      const report = await service.checkCompleteness('indexDaily', '20250324', '20250326')
      expect(report).not.toBeNull()
      expect(report!.status).toBe('pass')
    })

    it('日频数据集（indexDaily）→ 缺失 >10% 时返回 fail', async () => {
      const helper = buildHelperMock()
      // 10 个交易日，返回 0 条已有记录 → 100% 缺失
      helper.getOpenTradeDatesBetween.mockResolvedValue([
        '20250310', '20250311', '20250312', '20250313', '20250314',
        '20250317', '20250318', '20250319', '20250320', '20250321',
      ])

      const prisma = buildPrismaMock()
      ;(prisma as any).indexDaily = {
        findMany: jest.fn(async () => []),
      }

      const service = createService(prisma, helper)
      const report = await service.checkCompleteness('indexDaily', '20250310', '20250321')
      expect(report).not.toBeNull()
      expect(report!.status).toBe('fail')
      expect(report!.details).toMatchObject({ totalMissing: 10 })
    })

    it('日频数据集（indexDaily）→ 缺失 ≤10% 时返回 warn', async () => {
      const helper = buildHelperMock()
      // 10 个交易日，返回 9 条记录 → 10% 缺失 (1/10) → ≤10% → warn
      const tradeDates = ['20250310', '20250311', '20250312', '20250313', '20250314',
        '20250317', '20250318', '20250319', '20250320', '20250321']
      helper.getOpenTradeDatesBetween.mockResolvedValue(tradeDates)

      const prisma = buildPrismaMock()
      // 返回 9 条，缺 1 条 → 1/10 = 10% → ≤10% → warn
      const existing = tradeDates.slice(0, 9).map((d) => ({
        tradeDate: new Date(d.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3')),
      }))
      ;(prisma as any).indexDaily = {
        findMany: jest.fn(async () => existing),
      }
      helper.formatDate.mockImplementation((d: Date) => d.toISOString().slice(0, 10).replace(/-/g, ''))

      const service = createService(prisma, helper)
      const report = await service.checkCompleteness('indexDaily', '20250310', '20250321')
      expect(report).not.toBeNull()
      expect(report!.status).toBe('warn')
    })

    it('financial-report 策略（income）→ 委托给报告期覆盖检查，不需要传 startDate/endDate', async () => {
      const helper = buildHelperMock()
      helper.buildRecentQuarterPeriods.mockReturnValue([]) // 空 → 直接 pass
      const service = createService(undefined, helper)
      const report = await service.checkCompleteness('income', '', '')
      expect(report).not.toBeNull()
      // 报告期为空时返回 pass
      expect(report!.status).toBe('pass')
    })
  })

  // ── runAllChecksAndCollect ─────────────────────────────────────────────────

  describe('runAllChecksAndCollect()', () => {
    it('Redis 锁已占用 → 返回空数组', async () => {
      const redis = buildRedisMock()
      redis.set.mockResolvedValue(null) // NX 返回 null → 未获取到锁
      const service = createService(undefined, undefined, undefined, redis)
      const result = await service.runAllChecksAndCollect()
      expect(result).toEqual([])
    })

    it('Redis 锁获取成功 → 返回非空报告列表，并在完成后释放锁', async () => {
      const redis = buildRedisMock()
      redis.set.mockResolvedValue('OK') // NX 成功

      const helper = buildHelperMock()
      // 让所有 helper 方法返回合理值，避免真实 DB 调用
      helper.compareDateString.mockReturnValue(0)
      helper.getLatestDateString.mockResolvedValue('20250401')
      helper.resolveLatestCompletedTradeDate.mockResolvedValue('20250401')
      helper.getOpenTradeDatesBetween.mockResolvedValue([])
      helper.buildRecentQuarterPeriods.mockReturnValue([])

      const service = createService(undefined, helper, undefined, redis)
      const result = await service.runAllChecksAndCollect()

      // 完成后应释放锁
      expect(redis.del).toHaveBeenCalledWith('data-quality:running')
      // 应返回报告（至少有时效性报告）
      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeGreaterThan(0)
    })

    it('即使内部出错也会释放 Redis 锁', async () => {
      const redis = buildRedisMock()
      redis.set.mockResolvedValue('OK')

      const helper = buildHelperMock()
      // 让 crossTable.runRecentCrossChecks 抛出异常
      const crossTable = buildCrossTableMock()
      crossTable.runRecentCrossChecks.mockRejectedValue(new Error('跨表检查失败'))
      // helper 的调用同样保持正常
      helper.compareDateString.mockReturnValue(0)
      helper.getLatestDateString.mockResolvedValue('20250401')
      helper.resolveLatestCompletedTradeDate.mockResolvedValue('20250401')
      helper.getOpenTradeDatesBetween.mockResolvedValue([])
      helper.buildRecentQuarterPeriods.mockReturnValue([])

      const service = createService(undefined, helper, crossTable, redis)
      // 不应抛出异常（错误已被内部 catch 处理）
      await expect(service.runAllChecksAndCollect()).resolves.toBeDefined()
      // 锁必须释放
      expect(redis.del).toHaveBeenCalledWith('data-quality:running')
    })
  })

  // ── writeCheckResult ───────────────────────────────────────────────────────

  describe('writeCheckResult()', () => {
    it('调用 prisma.dataQualityCheck.create 写入报告', async () => {
      const prisma = buildPrismaMock()
      const service = createService(prisma)
      await service.writeCheckResult({
        dataSet: 'daily',
        checkType: 'timeliness',
        status: 'pass',
        message: '测试写入',
      })
      expect((prisma.dataQualityCheck as any).create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            dataSet: 'daily',
            checkType: 'timeliness',
            status: 'pass',
          }),
        }),
      )
    })
  })
})
