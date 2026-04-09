/**
 * FinancialSyncService — 单元测试
 *
 * 覆盖要点：
 * - getSyncPlans() 返回 financial 类别的所有任务
 * - syncForecast: incremental → 最近 2 个季度；full → 历史全量（2010 起）
 * - syncForecast: 单报告期失败不阻断后续报告期（错误容忍）
 * - syncIncome: full 模式 → 触发 rebuildIncomeRecentYears（income.deleteMany 被调用）
 * - syncIncome: incremental + 空表 → 也触发重建
 * - syncIncome: incremental + 非空表 → 不触发重建
 */

import { TushareSyncTaskName } from 'src/constant/tushare.constant'
import { FinancialApiService } from '../../api/financial-api.service'
import { FinancialSyncService } from '../financial-sync.service'
import { SyncHelperService } from '../sync-helper.service'

// ── mock 工厂 ─────────────────────────────────────────────────────────────────

function buildPrismaMock() {
  return {
    stockBasic: {
      findMany: jest.fn(async () => [] as { tsCode: string }[]),
    },
    income: {
      deleteMany: jest.fn(async () => ({})),
      createMany: jest.fn(async () => ({ count: 0 })),
      count: jest.fn(async () => 0),
    },
    balanceSheet: {
      deleteMany: jest.fn(async () => ({})),
      createMany: jest.fn(async () => ({ count: 0 })),
      count: jest.fn(async () => 0),
    },
    cashflow: {
      deleteMany: jest.fn(async () => ({})),
      createMany: jest.fn(async () => ({ count: 0 })),
      count: jest.fn(async () => 0),
    },
    forecast: {
      createMany: jest.fn(async () => ({ count: 0 })),
    },
  }
}

function buildMockHelper(prismaMock = buildPrismaMock()) {
  return Object.assign(
    {
      syncTimeZone: 'Asia/Shanghai',
      syncStartDate: '20100101',
      isTaskSyncedToday: jest.fn(async () => false),
      replaceAllRows: jest.fn(async () => 0),
      replaceDateRangeRows: jest.fn(async () => 0),
      writeSyncLog: jest.fn(async () => undefined),
      buildRecentQuarterPeriods: jest.fn((years: number) =>
        Array.from({ length: years * 4 }, (_, i) => {
          const y = 2010 + Math.floor(i / 4)
          const q = ['0331', '0630', '0930', '1231'][i % 4]
          return `${y}${q}`
        }),
      ),
      buildMonthlyWindows: jest.fn(() => [] as { startDate: string; endDate: string }[]),
      getCurrentShanghaiDateString: jest.fn(() => '20260101'),
      getCurrentShanghaiNow: jest.fn(() => ({
        add: jest.fn(() => ({ format: jest.fn(() => '20270101') })),
      })),
      toDate: jest.fn((s: string) => new Date(s.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'))),
      addDays: jest.fn((_date: string, _n: number) => '20260101'),
      flushValidationLogs: jest.fn(async () => undefined),
    },
    { prisma: prismaMock },
  )
}

function buildMockApi() {
  return {
    getForecastByPeriod: jest.fn(async () => []),
    getIncomeByTsCode: jest.fn(async () => []),
    getBalanceSheetByTsCode: jest.fn(async () => []),
    getCashflowByTsCode: jest.fn(async () => []),
    getExpressByDateRange: jest.fn(async () => []),
    getDividendByTsCode: jest.fn(async () => []),
    getFinaIndicatorByTsCode: jest.fn(async () => []),
    getTop10HoldersByTsCodeAndPeriod: jest.fn(async () => []),
    getTop10FloatHoldersByTsCodeAndPeriod: jest.fn(async () => []),
    getStkHolderNumberByDateRange: jest.fn(async () => []),
    getStkHolderTradeByDateRange: jest.fn(async () => []),
    getPledgeStatByTsCode: jest.fn(async () => []),
    getFinaAuditByTsCode: jest.fn(async () => []),
    getDisclosureDateByPeriod: jest.fn(async () => []),
    getRepurchaseByDateRange: jest.fn(async () => []),
    getFinaMainbzByTsCode: jest.fn(async () => []),
  }
}

function createService(api = buildMockApi(), helper = buildMockHelper()): FinancialSyncService {
  // @ts-ignore 局部 mock，跳过 DI
  return new FinancialSyncService(api as FinancialApiService, helper as SyncHelperService)
}

// ── 测试套件 ──────────────────────────────────────────────────────────────────

describe('FinancialSyncService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  // ── getSyncPlans() ─────────────────────────────────────────────────────────

  describe('getSyncPlans()', () => {
    it('所有 plan 的 category 都为 financial', () => {
      const plans = createService().getSyncPlans()
      expect(plans.length).toBeGreaterThan(0)
      for (const plan of plans) {
        expect(plan.category).toBe('financial')
      }
    })

    it('包含核心任务：INCOME / FORECAST / FINA_INDICATOR / DIVIDEND', () => {
      const tasks = createService()
        .getSyncPlans()
        .map((p) => p.task)
      expect(tasks).toContain(TushareSyncTaskName.INCOME)
      expect(tasks).toContain(TushareSyncTaskName.FORECAST)
      expect(tasks).toContain(TushareSyncTaskName.FINA_INDICATOR)
      expect(tasks).toContain(TushareSyncTaskName.DIVIDEND)
    })

    it('按 order 字段正向排列', () => {
      const plans = createService().getSyncPlans()
      const orders = plans.map((p) => p.order)
      expect(orders).toEqual([...orders].sort((a, b) => a - b))
    })
  })

  // ── syncForecast() ─────────────────────────────────────────────────────────

  describe('syncForecast()', () => {
    it('incremental 模式应使用最近 2 年（8 个季度）', async () => {
      const helper = buildMockHelper()
      const service = createService(buildMockApi(), helper)

      await service.syncForecast('incremental')

      expect(helper.buildRecentQuarterPeriods).toHaveBeenCalledWith(2)
    })

    it('full 模式应使用从 2010 年至今的所有季度（years > 2）', async () => {
      const helper = buildMockHelper()
      const service = createService(buildMockApi(), helper)

      await service.syncForecast('full')

      const [callArg] = helper.buildRecentQuarterPeriods.mock.calls[0]
      expect(callArg).toBeGreaterThan(2) // 2010 至今超过 2 年
    })

    it('应对每个报告期调用一次 api.getForecastByPeriod', async () => {
      const helper = buildMockHelper()
      // 固定返回 2 个季度
      helper.buildRecentQuarterPeriods.mockReturnValue(['20251231', '20260331'])
      const api = buildMockApi()
      const service = createService(api, helper)

      await service.syncForecast('incremental')

      expect(api.getForecastByPeriod).toHaveBeenCalledTimes(2)
      expect(api.getForecastByPeriod).toHaveBeenCalledWith('20251231')
      expect(api.getForecastByPeriod).toHaveBeenCalledWith('20260331')
    })

    it('单个报告期 API 抛出异常时，后续报告期应继续执行', async () => {
      const helper = buildMockHelper()
      helper.buildRecentQuarterPeriods.mockReturnValue(['20250331', '20250630', '20250930'])
      const api = buildMockApi()
      // 第 2 个报告期抛出错误
      api.getForecastByPeriod
        .mockResolvedValueOnce([])
        .mockRejectedValueOnce(new Error('API 频控'))
        .mockResolvedValueOnce([])
      const service = createService(api, helper)

      // 不应抛出异常
      await expect(service.syncForecast('incremental')).resolves.toBeUndefined()
      // 3 个报告期都被尝试
      expect(api.getForecastByPeriod).toHaveBeenCalledTimes(3)
    })

    it('完成后应写同步日志', async () => {
      const helper = buildMockHelper()
      helper.buildRecentQuarterPeriods.mockReturnValue(['20260331'])
      const service = createService(buildMockApi(), helper)

      await service.syncForecast('incremental')

      expect(helper.writeSyncLog).toHaveBeenCalledWith(
        TushareSyncTaskName.FORECAST,
        expect.objectContaining({ payload: expect.objectContaining({ mode: 'incremental' }) }),
        expect.any(Date),
      )
    })
  })

  // ── syncIncome() ──────────────────────────────────────────────────────────

  describe('syncIncome()', () => {
    it('full 模式应清空 income 表并按股票重建', async () => {
      const prismaMock = buildPrismaMock()
      // stockBasic 返回两只股票使重建流程走完
      prismaMock.stockBasic.findMany.mockResolvedValue([{ tsCode: '000001.SZ' }, { tsCode: '000002.SZ' }] as never)

      const helper = buildMockHelper(prismaMock)
      helper.buildRecentQuarterPeriods.mockReturnValue(['20260331'])

      const service = createService(buildMockApi(), helper)
      await service.syncIncome('full')

      // 重建时应先清空旧数据
      expect(prismaMock.income.deleteMany).toHaveBeenCalledWith({})
    })

    it('incremental + 空表（count=0）时也应触发重建', async () => {
      const prismaMock = buildPrismaMock()
      prismaMock.income.count.mockResolvedValue(0) // 空表
      prismaMock.stockBasic.findMany.mockResolvedValue([{ tsCode: '000001.SZ' }] as never)

      const helper = buildMockHelper(prismaMock)
      helper.buildRecentQuarterPeriods.mockReturnValue(['20260331'])

      const service = createService(buildMockApi(), helper)
      await service.syncIncome('incremental')

      expect(prismaMock.income.deleteMany).toHaveBeenCalled()
    })

    it('incremental + 非空表时不应触发重建（不调用 income.deleteMany）', async () => {
      const prismaMock = buildPrismaMock()
      prismaMock.income.count.mockResolvedValue(10_000) // 非空表

      const helper = buildMockHelper(prismaMock)
      helper.isTaskSyncedToday.mockResolvedValue(false)

      const service = createService(buildMockApi(), helper)
      await service.syncIncome('incremental')

      expect(prismaMock.income.deleteMany).not.toHaveBeenCalled()
    })

    it('incremental + 已同步今日时不触发任何操作', async () => {
      const prismaMock = buildPrismaMock()
      prismaMock.income.count.mockResolvedValue(50_000) // 非空表

      const helper = buildMockHelper(prismaMock)
      helper.isTaskSyncedToday.mockResolvedValue(true)

      const service = createService(buildMockApi(), helper)
      await service.syncIncome('incremental')

      expect(prismaMock.income.deleteMany).not.toHaveBeenCalled()
    })
  })
})
