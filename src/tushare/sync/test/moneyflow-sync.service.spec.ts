/**
 * MoneyflowSyncService — 单元测试
 *
 * 覆盖要点：
 * - getSyncPlans() 返回 moneyflow 类别的所有任务
 * - getSyncPlans() 包含 MONEYFLOW_DC / MONEYFLOW_IND_DC / MONEYFLOW_MKT_DC / MONEYFLOW_HSGT 任务
 * - syncMoneyflow: 调用 api.getMoneyflowByTradeDate 并写入结果
 * - syncMoneyflow: 每日配额耗尽（TushareApiError 40203）时记录警告并跳过，不抛出
 * - syncMoneyflowIndDc: 对每个 content_type 调用一次 api
 * - syncMoneyflowMktDc: 调用 api.getMoneyflowMktDcByTradeDate
 * - syncMoneyflowHsgt: 调用 api.getMoneyflowHsgtByDateRange
 * - requireTradeDate: undefined 时抛出 BusinessException
 */

import { ConfigService } from '@nestjs/config'
import { TushareSyncTaskName, TUSHARE_MONEYFLOW_CONTENT_TYPES } from 'src/constant/tushare.constant'
import { BusinessException } from 'src/common/exceptions/business.exception'
import { TushareApiError } from 'src/tushare/api/tushare-client.service'
import { MoneyflowApiService } from '../../api/moneyflow-api.service'
import { MoneyflowSyncService } from '../moneyflow-sync.service'
import { SyncHelperService } from '../sync-helper.service'
import { TUSHARE_CONFIG_TOKEN } from 'src/config/tushare.config'

// ── mock 工厂 ─────────────────────────────────────────────────────────────────

const MOCK_CONFIG = {
  token: 'test-token',
  baseUrl: 'https://api.tushare.pro',
  requestIntervalMs: 0,
  rateLimitRetryDelayMs: 0,
  maxRetries: 1,
}

function buildMockConfigService(): ConfigService {
  // @ts-ignore
  return {
    get: jest.fn((token: string) => {
      if (token === TUSHARE_CONFIG_TOKEN) return MOCK_CONFIG
      return undefined
    }),
  } as unknown as ConfigService
}

function buildMockHelper() {
  return {
    syncTimeZone: 'Asia/Shanghai',
    syncStartDate: '20100101',
    isTaskSyncedForTradeDate: jest.fn(async () => false),
    isTaskSyncedToday: jest.fn(async () => false),
    getLatestDateString: jest.fn(async () => null as string | null),
    addDays: jest.fn((_date: string, _n: number) => '20240102'),
    compareDateString: jest.fn((a: string, b: string) => (a > b ? 1 : a < b ? -1 : 0)),
    getOpenTradeDatesBetween: jest.fn(async () => [] as string[]),
    getRecentOpenTradeDates: jest.fn(async () => ['20240101'] as string[]),
    toDate: jest.fn((s: string) => new Date(s.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'))),
    replaceTradeDateRows: jest.fn(async () => 10),
    replaceDateRangeRows: jest.fn(async () => 10),
    deleteRowsBeforeDate: jest.fn(async () => 0),
    writeSyncLog: jest.fn(async () => undefined),
    flushValidationLogs: jest.fn(async () => undefined),
  }
}

function buildMockApi() {
  return {
    getMoneyflowByTradeDate: jest.fn(async () => []),
    getMoneyflowIndDcByTradeDate: jest.fn(async () => []),
    getMoneyflowMktDcByTradeDate: jest.fn(async () => []),
    getMoneyflowHsgtByDateRange: jest.fn(async () => []),
  }
}

function createService(
  api = buildMockApi(),
  helper = buildMockHelper(),
  configService = buildMockConfigService(),
): MoneyflowSyncService {
  // @ts-ignore 局部 mock，跳过 DI
  return new MoneyflowSyncService(
    api as unknown as MoneyflowApiService,
    helper as unknown as SyncHelperService,
    configService,
  )
}

/** 构造一个每日配额耗尽的 TushareApiError */
function dailyQuotaError() {
  return new TushareApiError('moneyflow_dc', 40203, 'Tushare error: 每天最多访问该接口10次')
}

// ── 测试套件 ──────────────────────────────────────────────────────────────────

describe('MoneyflowSyncService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    // 确保 TUSHARE_MONEYFLOW_FULL_HISTORY 为默认值
    delete process.env.TUSHARE_MONEYFLOW_FULL_HISTORY
  })

  // ── getSyncPlans() ─────────────────────────────────────────────────────────

  describe('getSyncPlans()', () => {
    it('所有 plan 的 category 都为 moneyflow', () => {
      const plans = createService().getSyncPlans()
      expect(plans.length).toBeGreaterThan(0)
      for (const plan of plans) {
        expect(plan.category).toBe('moneyflow')
      }
    })

    it('包含核心任务：MONEYFLOW_DC / MONEYFLOW_IND_DC / MONEYFLOW_MKT_DC / MONEYFLOW_HSGT', () => {
      const tasks = createService()
        .getSyncPlans()
        .map((p) => p.task)
      expect(tasks).toContain(TushareSyncTaskName.MONEYFLOW_DC)
      expect(tasks).toContain(TushareSyncTaskName.MONEYFLOW_IND_DC)
      expect(tasks).toContain(TushareSyncTaskName.MONEYFLOW_MKT_DC)
      expect(tasks).toContain(TushareSyncTaskName.MONEYFLOW_HSGT)
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

  // ── syncMoneyflow() ────────────────────────────────────────────────────────

  describe('syncMoneyflow()', () => {
    it('应调用 api.getMoneyflowByTradeDate', async () => {
      const helper = buildMockHelper()
      helper.getRecentOpenTradeDates.mockResolvedValue(['20240101'])
      helper.getLatestDateString.mockResolvedValue(null)
      const api = buildMockApi()
      const service = createService(api, helper)

      await service.syncMoneyflow('20240101', 'incremental')

      expect(api.getMoneyflowByTradeDate).toHaveBeenCalledWith('20240101')
    })

    it('目标交易日已同步时应跳过（incremental 模式）', async () => {
      const helper = buildMockHelper()
      helper.isTaskSyncedForTradeDate.mockResolvedValue(true)
      const api = buildMockApi()
      const service = createService(api, helper)

      await service.syncMoneyflow('20240101', 'incremental')

      expect(api.getMoneyflowByTradeDate).not.toHaveBeenCalled()
    })

    it('触发每日配额限制（40203）时应记录 warn 并跳过，不抛出', async () => {
      const helper = buildMockHelper()
      helper.getRecentOpenTradeDates.mockResolvedValue(['20240101'])
      helper.getLatestDateString.mockResolvedValue(null)
      const api = buildMockApi()
      api.getMoneyflowByTradeDate.mockRejectedValueOnce(dailyQuotaError())
      const service = createService(api, helper)

      // 不应抛出异常
      await expect(service.syncMoneyflow('20240101', 'incremental')).resolves.toBeUndefined()
    })

    it('非配额错误应继续记录失败日期', async () => {
      const helper = buildMockHelper()
      helper.getRecentOpenTradeDates.mockResolvedValue(['20240101', '20240102'])
      helper.getLatestDateString.mockResolvedValue(null)
      const api = buildMockApi()
      api.getMoneyflowByTradeDate
        .mockRejectedValueOnce(new TushareApiError('moneyflow_dc', -2001, 'invalid token'))
        .mockResolvedValueOnce([])
      const service = createService(api, helper)

      // 单日失败不应影响后续日期
      await expect(service.syncMoneyflow('20240102', 'incremental')).resolves.toBeUndefined()
      expect(api.getMoneyflowByTradeDate).toHaveBeenCalledTimes(2)
    })

    it('同步完成后应调用 helper.flushValidationLogs', async () => {
      const helper = buildMockHelper()
      helper.getRecentOpenTradeDates.mockResolvedValue(['20240101'])
      helper.getLatestDateString.mockResolvedValue(null)
      const service = createService(buildMockApi(), helper)

      await service.syncMoneyflow('20240101', 'incremental')

      expect(helper.flushValidationLogs).toHaveBeenCalled()
    })
  })

  // ── syncMoneyflowIndDc() ───────────────────────────────────────────────────

  describe('syncMoneyflowIndDc()', () => {
    it('应对每个 content_type 各调用一次 api.getMoneyflowIndDcByTradeDate', async () => {
      const helper = buildMockHelper()
      helper.getRecentOpenTradeDates.mockResolvedValue(['20240101'])
      helper.getLatestDateString.mockResolvedValue(null)
      const api = buildMockApi()
      const service = createService(api, helper)

      await service.syncMoneyflowIndDc('20240101', 'incremental')

      expect(api.getMoneyflowIndDcByTradeDate).toHaveBeenCalledTimes(TUSHARE_MONEYFLOW_CONTENT_TYPES.length)
      for (const ct of TUSHARE_MONEYFLOW_CONTENT_TYPES) {
        expect(api.getMoneyflowIndDcByTradeDate).toHaveBeenCalledWith('20240101', ct)
      }
    })

    it('触发每日配额限制时应跳过，不抛出', async () => {
      const helper = buildMockHelper()
      helper.getRecentOpenTradeDates.mockResolvedValue(['20240101'])
      helper.getLatestDateString.mockResolvedValue(null)
      const api = buildMockApi()
      api.getMoneyflowIndDcByTradeDate.mockRejectedValue(dailyQuotaError())
      const service = createService(api, helper)

      await expect(service.syncMoneyflowIndDc('20240101', 'incremental')).resolves.toBeUndefined()
    })
  })

  // ── syncMoneyflowMktDc() ───────────────────────────────────────────────────

  describe('syncMoneyflowMktDc()', () => {
    it('应调用 api.getMoneyflowMktDcByTradeDate', async () => {
      const helper = buildMockHelper()
      helper.getRecentOpenTradeDates.mockResolvedValue(['20240101'])
      helper.getLatestDateString.mockResolvedValue(null)
      const api = buildMockApi()
      const service = createService(api, helper)

      await service.syncMoneyflowMktDc('20240101', 'incremental')

      expect(api.getMoneyflowMktDcByTradeDate).toHaveBeenCalledWith('20240101')
    })

    it('触发每日配额限制时应跳过，不抛出', async () => {
      const helper = buildMockHelper()
      helper.getRecentOpenTradeDates.mockResolvedValue(['20240101'])
      helper.getLatestDateString.mockResolvedValue(null)
      const api = buildMockApi()
      api.getMoneyflowMktDcByTradeDate.mockRejectedValue(dailyQuotaError())
      const service = createService(api, helper)

      await expect(service.syncMoneyflowMktDc('20240101', 'incremental')).resolves.toBeUndefined()
    })
  })

  // ── syncMoneyflowHsgt() ────────────────────────────────────────────────────

  describe('syncMoneyflowHsgt()', () => {
    it('应调用 api.getMoneyflowHsgtByDateRange', async () => {
      const helper = buildMockHelper()
      helper.isTaskSyncedForTradeDate.mockResolvedValue(false)
      helper.getLatestDateString.mockResolvedValue(null)
      helper.compareDateString.mockReturnValue(-1) // startDate < targetTradeDate
      const api = buildMockApi()
      const service = createService(api, helper)

      await service.syncMoneyflowHsgt('20240101', 'incremental')

      expect(api.getMoneyflowHsgtByDateRange).toHaveBeenCalled()
    })

    it('目标交易日已同步时应跳过（incremental 模式）', async () => {
      const helper = buildMockHelper()
      helper.isTaskSyncedForTradeDate.mockResolvedValue(true)
      const api = buildMockApi()
      const service = createService(api, helper)

      await service.syncMoneyflowHsgt('20240101', 'incremental')

      expect(api.getMoneyflowHsgtByDateRange).not.toHaveBeenCalled()
    })

    it('触发每日配额限制时应跳过，不抛出', async () => {
      const helper = buildMockHelper()
      helper.isTaskSyncedForTradeDate.mockResolvedValue(false)
      helper.getLatestDateString.mockResolvedValue(null)
      helper.compareDateString.mockReturnValue(-1)
      const api = buildMockApi()
      api.getMoneyflowHsgtByDateRange.mockRejectedValueOnce(dailyQuotaError())
      const service = createService(api, helper)

      await expect(service.syncMoneyflowHsgt('20240101', 'incremental')).resolves.toBeUndefined()
    })

    it('full 模式应忽略 isTaskSyncedForTradeDate 并执行同步', async () => {
      const helper = buildMockHelper()
      helper.isTaskSyncedForTradeDate.mockResolvedValue(true)
      helper.getLatestDateString.mockResolvedValue(null)
      helper.compareDateString.mockReturnValue(-1)
      const api = buildMockApi()
      const service = createService(api, helper)

      await service.syncMoneyflowHsgt('20240101', 'full')

      expect(api.getMoneyflowHsgtByDateRange).toHaveBeenCalled()
    })
  })

  // ── requireTradeDate ───────────────────────────────────────────────────────

  describe('requireTradeDate（通过 plan.execute 间接验证）', () => {
    it('targetTradeDate 为 undefined 时应抛出 BusinessException', async () => {
      const service = createService()
      const plans = service.getSyncPlans()
      const plan = plans.find((p) => p.task === TushareSyncTaskName.MONEYFLOW_DC)!

      await expect(async () =>
        plan.execute({ mode: 'incremental', targetTradeDate: undefined, trigger: 'manual' }),
      ).rejects.toBeInstanceOf(BusinessException)
    })
  })

  // ── 4 个同步方法的独立性 ──────────────────────────────────────────────────

  describe('各 sync 方法相互独立', () => {
    it('syncMoneyflow 失败不影响 syncMoneyflowMktDc 执行', async () => {
      const helper = buildMockHelper()
      helper.getRecentOpenTradeDates.mockResolvedValue(['20240101'])
      helper.getLatestDateString.mockResolvedValue(null)
      helper.isTaskSyncedForTradeDate.mockResolvedValue(false)
      helper.compareDateString.mockReturnValue(-1)

      const api = buildMockApi()
      api.getMoneyflowByTradeDate.mockRejectedValue(new Error('network error'))

      const service = createService(api, helper)

      // syncMoneyflow 抛出（非配额错误会被吞掉但不影响其他调用）
      await service.syncMoneyflow('20240101', 'incremental')

      // syncMoneyflowMktDc 应独立正常执行
      await service.syncMoneyflowMktDc('20240101', 'incremental')

      expect(api.getMoneyflowMktDcByTradeDate).toHaveBeenCalled()
    })
  })
})
