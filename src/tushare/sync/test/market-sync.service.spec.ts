/**
 * MarketSyncService — 单元测试
 *
 * 覆盖要点：
 * - getSyncPlans() 返回 market 类别的所有任务
 * - getSyncPlans() 包含 DAILY / WEEKLY / MONTHLY / DAILY_BASIC / ADJ_FACTOR / INDEX_DAILY 等任务
 * - syncDaily: 目标交易日已同步时跳过（incremental）
 * - syncDaily: 调用 api.getDailyByTradeDate 并写入结果
 * - syncDaily: full 模式强制重置断点并执行
 * - requireTradeDate: undefined 时抛出 BusinessException
 */

import { TushareSyncTaskName } from 'src/constant/tushare.constant'
import { BusinessException } from 'src/common/exceptions/business.exception'
import { MarketApiService } from '../../api/market-api.service'
import { MarketSyncService } from '../market-sync.service'
import { SyncHelperService } from '../sync-helper.service'

// ── mock 工厂 ─────────────────────────────────────────────────────────────────

function buildMockHelper() {
  return {
    syncTimeZone: 'Asia/Shanghai',
    syncStartDate: '20100101',
    isTaskSyncedForTradeDate: jest.fn(async () => false),
    getResumeKey: jest.fn(async () => null as string | null),
    getLatestDateString: jest.fn(async () => null as string | null),
    getOpenTradeDatesBetween: jest.fn(async () => [] as string[]),
    getPeriodEndTradeDates: jest.fn(async () => [] as string[]),
    compareDateString: jest.fn((a: string, b: string) => (a > b ? 1 : a < b ? -1 : 0)),
    addDays: jest.fn((date: string, days: number) => {
      void date
      void days
      return '20240102'
    }),
    toDate: jest.fn((s: string) => new Date(s.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'))),
    formatDate: jest.fn(() => '20220101'),
    replaceTradeDateRows: jest.fn(async () => 100),
    replaceDateRangeRows: jest.fn(async () => 100),
    updateProgress: jest.fn(async () => undefined),
    markRunning: jest.fn(async () => undefined),
    resetProgress: jest.fn(async () => undefined),
    markCompleted: jest.fn(async () => undefined),
    enqueueRetry: jest.fn(async () => undefined),
    writeSyncLog: jest.fn(async () => undefined),
    flushValidationLogs: jest.fn(async () => undefined),
    deleteRowsBeforeDate: jest.fn(async () => 0),
    getRecentOpenTradeDates: jest.fn(async () => [] as string[]),
    isTaskSyncedToday: jest.fn(async () => false),
    prisma: {
      tradeCal: { findMany: jest.fn(async () => []) },
      indexDaily: { findMany: jest.fn(async () => []) },
    },
  }
}

function buildMockApi() {
  return {
    getDailyByTradeDate: jest.fn(async () => []),
    getWeeklyByTradeDate: jest.fn(async () => []),
    getMonthlyByTradeDate: jest.fn(async () => []),
    getDailyBasicByTradeDate: jest.fn(async () => []),
    getAdjFactorByTradeDate: jest.fn(async () => []),
    getCoreIndexDailyByTradeDate: jest.fn(async () => []),
    getCoreIndexDailyByDateRange: jest.fn(async () => []),
    getMarginDetailByTradeDate: jest.fn(async () => []),
    getIndexDailyBasicByTradeDate: jest.fn(async () => []),
    getCbDailyByTradeDate: jest.fn(async () => []),
  }
}

function dailyApiRow() {
  return {
    ts_code: '000001.SZ',
    trade_date: '20240101',
    open: 10,
    high: 11,
    low: 9.8,
    close: 10.5,
    pre_close: 10,
    change: 0.5,
    pct_chg: 5,
    vol: 1000,
    amount: 10000,
  }
}

function indexDailyApiRow(tradeDate: string) {
  return {
    ts_code: '000300.SH',
    trade_date: tradeDate,
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    pre_close: 100,
    change: 0,
    pct_chg: 0,
    vol: 1000,
    amount: 10000,
  }
}

function createService(api = buildMockApi(), helper = buildMockHelper()): MarketSyncService {
  return new MarketSyncService(api as unknown as MarketApiService, helper as unknown as SyncHelperService)
}

// ── 测试套件 ──────────────────────────────────────────────────────────────────

describe('MarketSyncService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  // ── getSyncPlans() ─────────────────────────────────────────────────────────

  describe('getSyncPlans()', () => {
    it('所有 plan 的 category 都为 market', () => {
      const plans = createService().getSyncPlans()
      expect(plans.length).toBeGreaterThan(0)
      for (const plan of plans) {
        expect(plan.category).toBe('market')
      }
    })

    it('包含核心任务：DAILY / WEEKLY / MONTHLY / DAILY_BASIC / ADJ_FACTOR / INDEX_DAILY', () => {
      const tasks = createService()
        .getSyncPlans()
        .map((p) => p.task)
      expect(tasks).toContain(TushareSyncTaskName.DAILY)
      expect(tasks).toContain(TushareSyncTaskName.WEEKLY)
      expect(tasks).toContain(TushareSyncTaskName.MONTHLY)
      expect(tasks).toContain(TushareSyncTaskName.DAILY_BASIC)
      expect(tasks).toContain(TushareSyncTaskName.ADJ_FACTOR)
      expect(tasks).toContain(TushareSyncTaskName.INDEX_DAILY)
    })

    it('按 order 字段正向排列', () => {
      const plans = createService().getSyncPlans()
      const orders = plans.map((p) => p.order)
      expect(orders).toEqual([...orders].sort((a, b) => a - b))
    })

    it('每个 plan 都含 execute 函数', () => {
      const plans = createService().getSyncPlans()
      for (const plan of plans) {
        expect(typeof plan.execute).toBe('function')
      }
    })

    it('高成本逐股筹码分布应为周五盘后任务', () => {
      const plan = createService()
        .getSyncPlans()
        .find((p) => p.task === TushareSyncTaskName.CYQ_CHIPS)!

      expect(plan.schedule?.cron).toBe('0 30 20 * * 5')
      expect(plan.schedule?.tradingDayOnly).toBe(true)
    })
  })

  // ── syncDaily() ────────────────────────────────────────────────────────────

  describe('syncDaily()', () => {
    it('incremental 模式目标交易日已同步时应跳过，不调用 API', async () => {
      const helper = buildMockHelper()
      helper.isTaskSyncedForTradeDate.mockResolvedValue(true)
      const api = buildMockApi()
      const service = createService(api, helper)

      await service.syncDaily('20240101', 'incremental')

      expect(api.getDailyByTradeDate).not.toHaveBeenCalled()
    })

    it('incremental 模式未同步时应调用 api.getDailyByTradeDate', async () => {
      const helper = buildMockHelper()
      helper.isTaskSyncedForTradeDate.mockResolvedValue(false)
      helper.getOpenTradeDatesBetween.mockResolvedValue(['20240101'])
      const api = buildMockApi()
      const service = createService(api, helper)

      await service.syncDaily('20240101', 'incremental')

      expect(api.getDailyByTradeDate).toHaveBeenCalledWith('20240101')
    })

    it('full 模式应调用 helper.resetProgress 并强制执行同步', async () => {
      const helper = buildMockHelper()
      // 即使 isTaskSyncedForTradeDate 返回 true，full 模式也必须执行
      helper.isTaskSyncedForTradeDate.mockResolvedValue(true)
      helper.getOpenTradeDatesBetween.mockResolvedValue(['20240101'])
      const api = buildMockApi()
      const service = createService(api, helper)

      await service.syncDaily('20240101', 'full')

      expect(helper.resetProgress).toHaveBeenCalled()
      expect(api.getDailyByTradeDate).toHaveBeenCalled()
    })

    it('无可同步交易日时不应调用 API', async () => {
      const helper = buildMockHelper()
      helper.isTaskSyncedForTradeDate.mockResolvedValue(false)
      helper.getOpenTradeDatesBetween.mockResolvedValue([])
      const api = buildMockApi()
      const service = createService(api, helper)

      await service.syncDaily('20240101', 'incremental')

      expect(api.getDailyByTradeDate).not.toHaveBeenCalled()
    })

    it('同步完成后应写入同步日志', async () => {
      const helper = buildMockHelper()
      helper.isTaskSyncedForTradeDate.mockResolvedValue(false)
      helper.getOpenTradeDatesBetween.mockResolvedValue(['20240101'])
      const service = createService(buildMockApi(), helper)

      await service.syncDaily('20240101', 'incremental')

      expect(helper.writeSyncLog).toHaveBeenCalledWith(
        TushareSyncTaskName.DAILY,
        expect.objectContaining({ payload: expect.objectContaining({ rowCount: expect.any(Number) }) }),
        expect.any(Date),
      )
    })

    it('API 抛出异常时应记录失败日期并继续执行后续日期', async () => {
      const helper = buildMockHelper()
      helper.isTaskSyncedForTradeDate.mockResolvedValue(false)
      helper.getOpenTradeDatesBetween.mockResolvedValue(['20240101', '20240102'])
      const api = buildMockApi()
      api.getDailyByTradeDate.mockRejectedValueOnce(new Error('网络超时')).mockResolvedValueOnce([])
      const service = createService(api, helper)

      // 不应抛出异常
      await expect(service.syncDaily('20240102', 'incremental')).resolves.toBeUndefined()
    })

    it('精确重试应绕过历史成功日志和最新进度，只处理失败目标日期', async () => {
      const helper = buildMockHelper()
      helper.isTaskSyncedForTradeDate.mockResolvedValue(true)
      helper.getResumeKey.mockResolvedValue('20240201')
      helper.getLatestDateString.mockResolvedValue('20240201')
      helper.getOpenTradeDatesBetween.mockResolvedValue(['20240101'])
      const api = buildMockApi()
      api.getDailyByTradeDate.mockResolvedValue([dailyApiRow()])
      const service = createService(api, helper)

      await service.syncDaily('20240101', 'incremental', {
        trigger: 'manual',
        mode: 'incremental',
        targetTradeDate: '20240101',
        retryExactTarget: true,
      })

      expect(helper.isTaskSyncedForTradeDate).not.toHaveBeenCalled()
      expect(helper.getResumeKey).not.toHaveBeenCalled()
      expect(helper.getOpenTradeDatesBetween).toHaveBeenCalledWith('20240101', '20240101')
      expect(api.getDailyByTradeDate).toHaveBeenCalledWith('20240101')
      expect(helper.markCompleted).not.toHaveBeenCalled()
    })

    it('精确重试返回 0 行时必须失败，不能记录假成功', async () => {
      const helper = buildMockHelper()
      helper.getOpenTradeDatesBetween.mockResolvedValue(['20240101'])
      const service = createService(buildMockApi(), helper)

      await expect(
        service.syncDaily('20240101', 'incremental', {
          trigger: 'manual',
          mode: 'incremental',
          targetTradeDate: '20240101',
          retryExactTarget: true,
        }),
      ).rejects.toThrow('返回 0 行')

      expect(helper.replaceTradeDateRows).not.toHaveBeenCalled()
      expect(helper.writeSyncLog).not.toHaveBeenCalled()
    })
  })

  // ── syncWeekly() ───────────────────────────────────────────────────────────

  describe('syncWeekly()', () => {
    it('应使用 getPeriodEndTradeDates 获取周线交易日', async () => {
      const helper = buildMockHelper()
      helper.isTaskSyncedForTradeDate.mockResolvedValue(false)
      helper.getPeriodEndTradeDates.mockResolvedValue(['20240105'])
      const api = buildMockApi()
      const service = createService(api, helper)

      await service.syncWeekly('20240105', 'incremental')

      expect(helper.getPeriodEndTradeDates).toHaveBeenCalledWith(expect.any(String), '20240105', 'week')
      expect(api.getWeeklyByTradeDate).toHaveBeenCalledWith('20240105')
    })
  })

  // ── syncMonthly() ──────────────────────────────────────────────────────────

  describe('syncMonthly()', () => {
    it('应使用 getPeriodEndTradeDates 获取月线交易日', async () => {
      const helper = buildMockHelper()
      helper.isTaskSyncedForTradeDate.mockResolvedValue(false)
      helper.getPeriodEndTradeDates.mockResolvedValue(['20240131'])
      const api = buildMockApi()
      const service = createService(api, helper)

      await service.syncMonthly('20240131', 'incremental')

      expect(helper.getPeriodEndTradeDates).toHaveBeenCalledWith(expect.any(String), '20240131', 'month')
      expect(api.getMonthlyByTradeDate).toHaveBeenCalledWith('20240131')
    })
  })

  // ── syncDailyBasic() ───────────────────────────────────────────────────────

  describe('syncDailyBasic()', () => {
    it('应调用 api.getDailyBasicByTradeDate', async () => {
      const helper = buildMockHelper()
      helper.isTaskSyncedForTradeDate.mockResolvedValue(false)
      helper.getOpenTradeDatesBetween.mockResolvedValue(['20240101'])
      const api = buildMockApi()
      const service = createService(api, helper)

      await service.syncDailyBasic('20240101', 'incremental')

      expect(api.getDailyBasicByTradeDate).toHaveBeenCalledWith('20240101')
    })
  })

  // ── syncAdjFactor() ────────────────────────────────────────────────────────

  describe('syncAdjFactor()', () => {
    it('应调用 api.getAdjFactorByTradeDate', async () => {
      const helper = buildMockHelper()
      helper.isTaskSyncedForTradeDate.mockResolvedValue(false)
      helper.getOpenTradeDatesBetween.mockResolvedValue(['20240101'])
      const api = buildMockApi()
      const service = createService(api, helper)

      await service.syncAdjFactor('20240101', 'incremental')

      expect(api.getAdjFactorByTradeDate).toHaveBeenCalledWith('20240101')
    })
  })

  // ── syncIndexDaily() ──────────────────────────────────────────────────────

  describe('syncIndexDaily()', () => {
    it('[BIZ] full 模式从最近五年起点开始，并写入可续传断点', async () => {
      const helper = buildMockHelper()
      helper.getOpenTradeDatesBetween.mockResolvedValue(['20190228', '20190301'])
      const api = buildMockApi()
      api.getCoreIndexDailyByDateRange.mockResolvedValue([indexDailyApiRow('20190228')])

      await createService(api, helper).syncIndexDaily('20240229', 'full')

      expect(helper.getOpenTradeDatesBetween).toHaveBeenCalledWith('20190228', '20240229')
      expect(api.getCoreIndexDailyByDateRange).toHaveBeenCalledWith('20190228', '20240229')
      expect(helper.updateProgress).toHaveBeenCalledWith(TushareSyncTaskName.INDEX_DAILY, '20190301', 2, 2)
      expect(helper.markCompleted).toHaveBeenCalledWith(TushareSyncTaskName.INDEX_DAILY)
      expect(helper.writeSyncLog).toHaveBeenCalledWith(
        TushareSyncTaskName.INDEX_DAILY,
        expect.objectContaining({
          status: 'SUCCESS',
          payload: expect.objectContaining({ mode: 'full', rangeStart: '20190228', failedDates: [] }),
        }),
        expect.any(Date),
      )
    })

    it('[BIZ] full 模式 RUNNING 断点续传，不能重置回起点', async () => {
      const helper = buildMockHelper()
      helper.getResumeKey.mockResolvedValue('20050104')
      helper.addDays.mockImplementation((date: string) => (date === '20050104' ? '20050105' : '20240102'))
      helper.getOpenTradeDatesBetween.mockResolvedValue(['20050105'])
      const api = buildMockApi()
      api.getCoreIndexDailyByTradeDate.mockResolvedValue([indexDailyApiRow('20050105')])

      await createService(api, helper).syncIndexDaily('20050105', 'full')

      expect(helper.getOpenTradeDatesBetween).toHaveBeenCalledWith('20050105', '20050105')
      expect(helper.resetProgress).not.toHaveBeenCalled()
    })

    it('[BIZ] incremental 模式遇到 RUNNING 全量任务时优先续传断点', async () => {
      const helper = buildMockHelper()
      helper.getResumeKey.mockResolvedValue('20050104')
      helper.addDays.mockImplementation((date: string) => (date === '20050104' ? '20050105' : '20240102'))
      helper.getOpenTradeDatesBetween.mockResolvedValue(['20050105'])
      const api = buildMockApi()
      api.getCoreIndexDailyByTradeDate.mockResolvedValue([indexDailyApiRow('20050105')])

      await createService(api, helper).syncIndexDaily('20050105', 'incremental')

      expect(helper.getLatestDateString).not.toHaveBeenCalled()
      expect(helper.getOpenTradeDatesBetween).toHaveBeenCalledWith('20050105', '20050105')
    })

    it('[BIZ] 增量同步首次和原地重试都失败时，断点不越过缺口且任务保持未完成', async () => {
      const helper = buildMockHelper()
      helper.getOpenTradeDatesBetween.mockResolvedValue(['19901219', '19901220'])
      const api = buildMockApi()
      api.getCoreIndexDailyByTradeDate.mockRejectedValue(new Error('网络超时'))

      await createService(api, helper).syncIndexDaily('19901220', 'incremental')

      expect(api.getCoreIndexDailyByTradeDate).toHaveBeenCalledTimes(4)
      expect(helper.enqueueRetry).toHaveBeenCalledTimes(2)
      expect(helper.markCompleted).not.toHaveBeenCalled()
      expect(helper.writeSyncLog).toHaveBeenCalledWith(
        TushareSyncTaskName.INDEX_DAILY,
        expect.objectContaining({ status: 'FAILED' }),
        expect.any(Date),
      )
    })

    it('[BIZ] 精确重试绕过成功日志且不标记全任务完成', async () => {
      const helper = buildMockHelper()
      helper.isTaskSyncedForTradeDate.mockResolvedValue(true)
      helper.getOpenTradeDatesBetween.mockResolvedValue(['20240102'])
      const api = buildMockApi()
      api.getCoreIndexDailyByTradeDate.mockResolvedValue([indexDailyApiRow('20240102')])

      await createService(api, helper).syncIndexDaily('20240102', 'incremental', {
        trigger: 'manual',
        mode: 'incremental',
        targetTradeDate: '20240102',
        retryExactTarget: true,
      })

      expect(helper.isTaskSyncedForTradeDate).not.toHaveBeenCalled()
      expect(helper.markCompleted).not.toHaveBeenCalled()
      expect(api.getCoreIndexDailyByTradeDate).toHaveBeenCalledWith('20240102')
    })
  })

  // ── requireTradeDate ────────────────────────────────────────────────────────

  describe('requireTradeDate（私有方法，通过 plan.execute 间接验证）', () => {
    it('targetTradeDate 为 undefined 时应抛出 BusinessException', async () => {
      const service = createService()
      const plans = service.getSyncPlans()
      const dailyPlan = plans.find((p) => p.task === TushareSyncTaskName.DAILY)!

      await expect(async () =>
        dailyPlan.execute({ mode: 'incremental', targetTradeDate: undefined, trigger: 'manual' }),
      ).rejects.toBeInstanceOf(BusinessException)
    })

    it('targetTradeDate 有值时不应抛出 BusinessException', async () => {
      const helper = buildMockHelper()
      helper.isTaskSyncedForTradeDate.mockResolvedValue(true) // 跳过实际同步
      const service = createService(buildMockApi(), helper)
      const plans = service.getSyncPlans()
      const dailyPlan = plans.find((p) => p.task === TushareSyncTaskName.DAILY)!

      await expect(
        dailyPlan.execute({ mode: 'incremental', targetTradeDate: '20240101', trigger: 'manual' }),
      ).resolves.toBeUndefined()
    })
  })
})
