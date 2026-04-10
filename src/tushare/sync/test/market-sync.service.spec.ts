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
    addDays: jest.fn((_date: string, n: number) => '20240102'),
    toDate: jest.fn((s: string) => new Date(s.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'))),
    formatDate: jest.fn(() => '20220101'),
    replaceTradeDateRows: jest.fn(async () => 100),
    replaceDateRangeRows: jest.fn(async () => 100),
    updateProgress: jest.fn(async () => undefined),
    resetProgress: jest.fn(async () => undefined),
    markCompleted: jest.fn(async () => undefined),
    enqueueRetry: jest.fn(async () => undefined),
    writeSyncLog: jest.fn(async () => undefined),
    flushValidationLogs: jest.fn(async () => undefined),
    deleteRowsBeforeDate: jest.fn(async () => 0),
    getRecentOpenTradeDates: jest.fn(async () => [] as string[]),
    isTaskSyncedToday: jest.fn(async () => false),
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
    getMarginDetailByTradeDate: jest.fn(async () => []),
    getIndexDailyBasicByTradeDate: jest.fn(async () => []),
    getCbDailyByTradeDate: jest.fn(async () => []),
  }
}

function createService(api = buildMockApi(), helper = buildMockHelper()): MarketSyncService {
  // @ts-ignore 局部 mock，跳过 DI
  return new MarketSyncService(api as MarketApiService, helper as SyncHelperService)
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
      api.getDailyByTradeDate
        .mockRejectedValueOnce(new Error('网络超时'))
        .mockResolvedValueOnce([])
      const service = createService(api, helper)

      // 不应抛出异常
      await expect(service.syncDaily('20240102', 'incremental')).resolves.toBeUndefined()
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
