import { INDEX_WEIGHT_INDEX_CODES, TushareSyncTaskName } from 'src/constant/tushare.constant'
import { FactorDataApiService } from '../../api/factor-data-api.service'
import { FactorDataSyncService } from '../factor-data-sync.service'
import { SyncHelperService } from '../sync-helper.service'

function buildMockApi() {
  return {
    getStkLimitByTradeDate: jest.fn(async () => []),
    getSuspendDByTradeDate: jest.fn(async () => []),
    getIndexWeightByMonth: jest.fn(async () => []),
    getHkHoldByTradeDate: jest.fn(async () => []),
    getStkFactorByTradeDate: jest.fn(async () => []),
    getStkSurvByDateRange: jest.fn(async () => []),
  }
}

function buildMockHelper() {
  return {
    syncTimeZone: 'Asia/Shanghai',
    syncStartDate: '20100101',
    prisma: {
      $transaction: jest.fn(async (operations: Promise<unknown>[]) => Promise.all(operations)),
      indexWeight: {
        findFirst: jest.fn(async () => null as { tradeDate: string } | null),
        createMany: jest.fn(async () => ({ count: 0 })),
      },
      suspendD: {
        deleteMany: jest.fn(async () => ({ count: 0 })),
        createMany: jest.fn(async () => ({ count: 0 })),
      },
      stkSurv: {
        createMany: jest.fn(async () => ({ count: 0 })),
      },
      stkFactor: {
        deleteMany: jest.fn(async () => ({ count: 0 })),
        createMany: jest.fn(async ({ data }: { data: unknown[] }) => ({ count: data.length })),
      },
    },
    getCurrentShanghaiDateString: jest.fn(() => '20260422'),
    compareDateString: jest.fn((a: string, b: string) => (a > b ? 1 : a < b ? -1 : 0)),
    addDays: jest.fn((date: string) => {
      const year = Number(date.slice(0, 4))
      const month = Number(date.slice(4, 6))
      const day = Number(date.slice(6, 8))
      const next = new Date(Date.UTC(year, month - 1, day + 1))
      return `${next.getUTCFullYear()}${String(next.getUTCMonth() + 1).padStart(2, '0')}${String(next.getUTCDate()).padStart(2, '0')}`
    }),
    getOpenTradeDatesBetween: jest.fn(async () => [] as string[]),
    getLatestDateString: jest.fn(async () => null as string | null),
    isTaskSyncedForTradeDate: jest.fn(async () => false),
    toDate: jest.fn(
      (date: string) => new Date(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T00:00:00.000Z`),
    ),
    writeSyncLog: jest.fn(async () => undefined),
    flushValidationLogs: jest.fn(async () => 0),
    getResumeKey: jest.fn(async () => null as string | null),
    markRunning: jest.fn(async () => undefined),
    updateProgress: jest.fn(async () => undefined),
    markCompleted: jest.fn(async () => undefined),
    enqueueRetry: jest.fn(async () => undefined),
  }
}

function createService(api = buildMockApi(), helper = buildMockHelper()) {
  // @ts-expect-error 局部 mock，跳过 DI
  return new FactorDataSyncService(api as FactorDataApiService, helper as SyncHelperService)
}

describe('FactorDataSyncService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('getSyncPlans()', () => {
    it('停更的沪深股通持股只保留手动补历史，不注册自动计划', () => {
      const plan = createService()
        .getSyncPlans()
        .find((p) => p.task === TushareSyncTaskName.HK_HOLD)!

      expect(plan.bootstrapEnabled).toBe(false)
      expect(plan.schedule).toBeUndefined()
      expect(plan.supportsManual).toBe(true)
    })
  })

  describe('syncIndexWeight()', () => {
    it('应覆盖 /index/list 中全部核心指数，而不是只同步旧的 5 个指数', async () => {
      const api = buildMockApi()
      const helper = buildMockHelper()
      const service = createService(api, helper)

      await service.syncIndexWeight('incremental')

      expect(api.getIndexWeightByMonth).toHaveBeenCalledTimes(INDEX_WEIGHT_INDEX_CODES.length)
      expect(api.getIndexWeightByMonth).toHaveBeenCalledWith('000903.SH', '20150101', '20260422')
      expect(api.getIndexWeightByMonth).toHaveBeenCalledWith('000001.SH', '20150101', '20260422')
    })

    it('incremental 模式对新增指数应按指数维度回补历史，而不是沿用全表最大日期', async () => {
      const api = buildMockApi()
      const helper = buildMockHelper()
      helper.prisma.indexWeight.findFirst.mockImplementation(async (args?: { where?: { indexCode?: string } }) => {
        const indexCode = args?.where?.indexCode
        if (indexCode === '000300.SH') {
          return { tradeDate: '20260401' }
        }
        return null
      })
      const service = createService(api, helper)

      await service.syncIndexWeight('incremental')

      expect(api.getIndexWeightByMonth).toHaveBeenCalledWith('000300.SH', '20260402', '20260422')
      expect(api.getIndexWeightByMonth).toHaveBeenCalledWith('000903.SH', '20150101', '20260422')
      expect(helper.writeSyncLog).toHaveBeenCalledWith(
        TushareSyncTaskName.INDEX_WEIGHT,
        expect.objectContaining({ payload: expect.objectContaining({ rowCount: expect.any(Number) }) }),
        expect.any(Date),
      )
    })
  })

  describe('syncSuspendD()', () => {
    it('Tushare 早期停牌历史为空时仍保留已核验的 600089.SH 股东大会停牌事实', async () => {
      const api = buildMockApi()
      const helper = buildMockHelper()
      helper.syncStartDate = '19980520'
      helper.getOpenTradeDatesBetween.mockResolvedValue(['19980520'])
      const service = createService(api, helper)

      await service.syncSuspendD('19980520', 'full')

      expect(api.getSuspendDByTradeDate).toHaveBeenCalledWith('19980520')
      expect(helper.prisma.suspendD.createMany).toHaveBeenCalledWith({
        data: [
          {
            tsCode: '600089.SH',
            tradeDate: '19980520',
            suspendTiming: null,
            suspendType: 'S',
          },
        ],
        skipDuplicates: true,
      })
    })

    it('上游后续补齐同一停牌事实时不重复写入修正记录', async () => {
      const api = buildMockApi()
      api.getSuspendDByTradeDate.mockResolvedValue([
        {
          ts_code: '600089.SH',
          trade_date: '19981120',
          suspend_timing: '09:30-15:00',
          suspend_type: 'S',
        },
      ])
      const helper = buildMockHelper()
      helper.syncStartDate = '19981120'
      helper.getOpenTradeDatesBetween.mockResolvedValue(['19981120'])
      const service = createService(api, helper)

      await service.syncSuspendD('19981120', 'full')

      expect(helper.prisma.suspendD.createMany).toHaveBeenCalledWith({
        data: [
          {
            tsCode: '600089.SH',
            tradeDate: '19981120',
            suspendTiming: '09:30-15:00',
            suspendType: 'S',
          },
        ],
        skipDuplicates: true,
      })
    })
  })

  describe('syncStkSurv()', () => {
    it('incremental 模式：已有数据时应从最新 survDate 后一天开始', async () => {
      const api = buildMockApi()
      const helper = buildMockHelper()
      // 模拟表内已有到 20260415 的数据
      helper.getLatestDateString.mockResolvedValue('20260415')
      const service = createService(api, helper)

      await service.syncStkSurv('incremental')

      // addDays('20260415') → '20260416'，从 20260416 开始到今天 20260422（同年），调一次
      expect(api.getStkSurvByDateRange).toHaveBeenCalledTimes(1)
      expect(api.getStkSurvByDateRange).toHaveBeenCalledWith('20260416', '20260422')
    })

    it('incremental 模式：表为空时应从 syncStartDate 开始按年分批调用', async () => {
      const api = buildMockApi()
      const helper = buildMockHelper()
      helper.getLatestDateString.mockResolvedValue(null)
      // syncStartDate = '20100101'，today = '20260422'，共 2026-2010+1 = 17 年
      const service = createService(api, helper)

      await service.syncStkSurv('incremental')

      expect(api.getStkSurvByDateRange).toHaveBeenCalledTimes(17)
      // 第一批：20100101 → 20101231
      expect(api.getStkSurvByDateRange).toHaveBeenCalledWith('20100101', '20101231')
      // 最后一批：20260101 → 20260422（今天）
      expect(api.getStkSurvByDateRange).toHaveBeenCalledWith('20260101', '20260422')
    })

    it('full 模式：忽略表内数据，始终从 syncStartDate 开始全量重拉', async () => {
      const api = buildMockApi()
      const helper = buildMockHelper()
      // 即使表内有数据，full 模式也要从头开始
      helper.getLatestDateString.mockResolvedValue('20260415')
      const service = createService(api, helper)

      await service.syncStkSurv('full')

      // full 模式 latestDate = null → 从 syncStartDate 开始，17 批
      expect(api.getStkSurvByDateRange).toHaveBeenCalledTimes(17)
      expect(api.getStkSurvByDateRange).toHaveBeenCalledWith('20100101', '20101231')
    })
  })

  describe('syncStkFactor()', () => {
    it('[BIZ] full 模式逐日成功推进安全断点，全部完成后标记 completed', async () => {
      const api = buildMockApi()
      api.getStkFactorByTradeDate.mockResolvedValue([stkFactorRecord()])
      const helper = buildMockHelper()
      helper.getOpenTradeDatesBetween.mockResolvedValue(['20260803', '20260804'])
      const service = createService(api, helper)

      await service.syncStkFactor('20260804', 'full')

      expect(helper.markRunning).toHaveBeenCalledWith(TushareSyncTaskName.STK_FACTOR, 2)
      expect(helper.updateProgress.mock.calls).toEqual([
        [TushareSyncTaskName.STK_FACTOR, '20260803', 1, 2],
        [TushareSyncTaskName.STK_FACTOR, '20260804', 2, 2],
      ])
      expect(helper.markCompleted).toHaveBeenCalledWith(TushareSyncTaskName.STK_FACTOR)
    })

    it('[BIZ] 发现 RUNNING 断点后从下一开放交易日继续，不重拉成功分片', async () => {
      const api = buildMockApi()
      api.getStkFactorByTradeDate.mockResolvedValue([stkFactorRecord()])
      const helper = buildMockHelper()
      helper.getResumeKey.mockResolvedValue('20260803')
      helper.getOpenTradeDatesBetween.mockResolvedValue(['20260804'])
      const service = createService(api, helper)

      await service.syncStkFactor('20260804', 'full')

      expect(helper.getOpenTradeDatesBetween).toHaveBeenCalledWith('20260804', '20260804')
      expect(api.getStkFactorByTradeDate).toHaveBeenCalledTimes(1)
      expect(api.getStkFactorByTradeDate).toHaveBeenCalledWith('20260804')
    })

    it('[ERR] 中间日期失败后立即停止，不越过失败日期推进断点，也不写假 SUCCESS', async () => {
      const api = buildMockApi()
      api.getStkFactorByTradeDate
        .mockResolvedValueOnce([stkFactorRecord()])
        .mockRejectedValueOnce(new Error('upstream failed'))
        .mockResolvedValueOnce([stkFactorRecord()])
      const helper = buildMockHelper()
      helper.getOpenTradeDatesBetween.mockResolvedValue(['20260801', '20260802', '20260803'])
      const service = createService(api, helper)

      await expect(service.syncStkFactor('20260803', 'full')).rejects.toThrow('upstream failed')

      expect(api.getStkFactorByTradeDate).toHaveBeenCalledTimes(2)
      expect(helper.updateProgress).toHaveBeenCalledTimes(1)
      expect(helper.updateProgress).toHaveBeenCalledWith(TushareSyncTaskName.STK_FACTOR, '20260801', 1, 3)
      expect(helper.enqueueRetry).toHaveBeenCalledWith(TushareSyncTaskName.STK_FACTOR, '20260802', 'upstream failed')
      expect(helper.markCompleted).not.toHaveBeenCalled()
      expect(helper.writeSyncLog).toHaveBeenCalledWith(
        TushareSyncTaskName.STK_FACTOR,
        expect.objectContaining({ status: 'FAILED' }),
        expect.any(Date),
      )
    })

    it('[ERR] 核心技术指标组覆盖率低于 50% 时失败即停，不写入伪 0', async () => {
      const api = buildMockApi()
      api.getStkFactorByTradeDate.mockResolvedValue([
        { ...stkFactorRecord(), macd_dif: null, macd_dea: null, macd: null },
      ])
      const helper = buildMockHelper()
      helper.getOpenTradeDatesBetween.mockResolvedValue(['20260804'])
      const service = createService(api, helper)

      await expect(service.syncStkFactor('20260804', 'incremental')).rejects.toThrow('STK_FACTOR_DATA_QUALITY_FAILED')
      expect(helper.prisma.stkFactor.createMany).not.toHaveBeenCalled()
      expect(helper.enqueueRetry).toHaveBeenCalled()
    })
  })
})

function stkFactorRecord() {
  return {
    ts_code: '600089.SH',
    trade_date: '20260804',
    close: 12,
    pct_change: 1,
    macd_dif: 1,
    macd_dea: 0,
    macd: 1,
    kdj_k: 60,
    kdj_d: 50,
    kdj_j: 80,
    rsi_6: 40,
    rsi_12: 45,
    rsi_24: 50,
    boll_upper: 14,
    boll_mid: 12,
    boll_lower: 10,
  }
}
