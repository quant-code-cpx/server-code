import { TushareSyncTaskName } from 'src/constant/tushare.constant'
import { FundApiService } from '../../api/fund-api.service'
import { FundSyncService } from '../fund-sync.service'
import { SyncHelperService } from '../sync-helper.service'

function toDate(value: string): Date {
  return new Date(Date.UTC(Number(value.slice(0, 4)), Number(value.slice(4, 6)) - 1, Number(value.slice(6, 8))))
}

function buildMockHelper() {
  return {
    syncTimeZone: 'Asia/Shanghai',
    syncStartDate: '20260401',
    prisma: {
      fundBasic: { findMany: jest.fn(async () => []) },
      fundShare: { createMany: jest.fn(async () => ({ count: 0 })) },
      fundAdj: { createMany: jest.fn(async () => ({ count: 0 })) },
    },
    isTaskSyncedForTradeDate: jest.fn(async () => false),
    getLatestDateString: jest.fn(async () => '20260401' as string | null),
    addDays: jest.fn(() => '20260402'),
    compareDateString: jest.fn((left: string, right: string) => left.localeCompare(right)),
    getOpenTradeDatesBetween: jest.fn(async () => ['20260402', '20260403']),
    toDate: jest.fn(toDate),
    replaceTradeDateRows: jest.fn(async (_modelName: string, _tradeDate: Date, data: unknown[]) => data.length),
    flushValidationLogs: jest.fn(async () => undefined),
    writeSyncLog: jest.fn(async () => undefined),
    updateProgress: jest.fn(async () => undefined),
    markCompleted: jest.fn(async () => undefined),
    getResumeKey: jest.fn(async () => null as string | null),
  }
}

function buildMockApi() {
  return {
    getFundBasic: jest.fn(async () => []),
    getFundNavByTsCode: jest.fn(async () => []),
    getFundDailyByTradeDate: jest.fn(async () => []),
    getFundPortfolioByTsCode: jest.fn(async () => []),
    getFundShareByTsCode: jest.fn(async (_tsCode?: string, _startDate?: string, _endDate?: string) => []),
    getFundShareByMarketAndDateRange: jest.fn(async (market: 'SH' | 'SZ', startDate: string) => [
      { ts_code: market === 'SH' ? '510300.SH' : '159915.SZ', trade_date: startDate, fd_share: 1000 },
    ]),
    getFundAdjByTsCode: jest.fn(async (_tsCode?: string, _startDate?: string, _endDate?: string) => []),
    getFundAdjByTradeDate: jest.fn(async (tradeDate: string) => [
      { ts_code: '510300.SH', trade_date: tradeDate, adj_factor: 1.2345 },
      { ts_code: '159915.SZ', trade_date: tradeDate, adj_factor: 0.9876 },
    ]),
  }
}

function createService(api = buildMockApi(), helper = buildMockHelper()): FundSyncService {
  return new FundSyncService(api as unknown as FundApiService, helper as unknown as SyncHelperService)
}

describe('FundSyncService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('getSyncPlans()', () => {
    it('基金净值降为周频，份额和复权因子按交易日判鲜', () => {
      const plans = createService().getSyncPlans()
      const nav = plans.find((p) => p.task === TushareSyncTaskName.FUND_NAV)!
      const share = plans.find((p) => p.task === TushareSyncTaskName.FUND_SHARE)!
      const adj = plans.find((p) => p.task === TushareSyncTaskName.FUND_ADJ)!

      expect(nav.schedule?.cron).toBe('0 0 21 * * 1')
      expect(share.requiresTradeDate).toBe(true)
      expect(adj.requiresTradeDate).toBe(true)
    })
  })

  describe('syncFundShare()', () => {
    it('incremental 按市场和交易日拉取，不再逐基金扫描', async () => {
      const helper = buildMockHelper()
      const api = buildMockApi()
      const service = createService(api, helper)

      await service.syncFundShare({ trigger: 'schedule', mode: 'incremental', targetTradeDate: '20260403' })

      expect(api.getFundShareByMarketAndDateRange).toHaveBeenCalledTimes(4)
      expect(api.getFundShareByMarketAndDateRange).toHaveBeenCalledWith('SH', '20260402', '20260402')
      expect(api.getFundShareByMarketAndDateRange).toHaveBeenCalledWith('SZ', '20260403', '20260403')
      expect(api.getFundShareByTsCode).not.toHaveBeenCalled()
      expect(helper.replaceTradeDateRows).toHaveBeenCalledTimes(2)
      expect(helper.writeSyncLog).toHaveBeenCalledWith(
        TushareSyncTaskName.FUND_SHARE,
        expect.objectContaining({
          status: 'SUCCESS',
          tradeDate: toDate('20260403'),
          payload: expect.objectContaining({ rowCount: 4, dateCount: 2 }),
        }),
        expect.any(Date),
      )
    })
  })

  describe('syncFundAdj()', () => {
    it('incremental 按交易日拉取复权因子，不再逐基金扫描', async () => {
      const helper = buildMockHelper()
      const api = buildMockApi()
      const service = createService(api, helper)

      await service.syncFundAdj({ trigger: 'schedule', mode: 'incremental', targetTradeDate: '20260403' })

      expect(api.getFundAdjByTradeDate).toHaveBeenCalledTimes(2)
      expect(api.getFundAdjByTradeDate).toHaveBeenCalledWith('20260402')
      expect(api.getFundAdjByTradeDate).toHaveBeenCalledWith('20260403')
      expect(api.getFundAdjByTsCode).not.toHaveBeenCalled()
      expect(helper.replaceTradeDateRows).toHaveBeenCalledTimes(2)
      expect(helper.writeSyncLog).toHaveBeenCalledWith(
        TushareSyncTaskName.FUND_ADJ,
        expect.objectContaining({
          status: 'SUCCESS',
          tradeDate: toDate('20260403'),
          payload: expect.objectContaining({ rowCount: 4, dateCount: 2 }),
        }),
        expect.any(Date),
      )
    })

    it('交易日接口疑似触顶时回退逐基金补全，避免截断', async () => {
      const helper = buildMockHelper()
      helper.getOpenTradeDatesBetween.mockResolvedValue(['20260402'])
      helper.prisma.fundBasic.findMany.mockResolvedValue([{ tsCode: '510300.SH' }, { tsCode: '159915.SZ' }])

      const api = buildMockApi()
      api.getFundAdjByTradeDate.mockResolvedValue(
        Array.from({ length: 2000 }, (_, i) => ({
          ts_code: `${String(i).padStart(6, '0')}.OF`,
          trade_date: '20260402',
          adj_factor: 1,
        })),
      )
      api.getFundAdjByTsCode.mockImplementation(async (tsCode: string, startDate?: string) => [
        { ts_code: tsCode, trade_date: startDate, adj_factor: 1.2345 },
      ])

      const service = createService(api, helper)
      await service.syncFundAdj({ trigger: 'schedule', mode: 'incremental', targetTradeDate: '20260402' })

      expect(api.getFundAdjByTradeDate).toHaveBeenCalledWith('20260402')
      expect(api.getFundAdjByTsCode).toHaveBeenCalledTimes(2)
      expect(api.getFundAdjByTsCode).toHaveBeenCalledWith('510300.SH', '20260402', '20260402')
      expect(api.getFundAdjByTsCode).toHaveBeenCalledWith('159915.SZ', '20260402', '20260402')
      expect(helper.replaceTradeDateRows).toHaveBeenCalledWith(
        'fundAdj',
        toDate('20260402'),
        expect.arrayContaining([
          expect.objectContaining({ tsCode: '510300.SH' }),
          expect.objectContaining({ tsCode: '159915.SZ' }),
        ]),
      )
      expect(helper.writeSyncLog).toHaveBeenCalledWith(
        TushareSyncTaskName.FUND_ADJ,
        expect.objectContaining({
          status: 'SUCCESS',
          payload: expect.objectContaining({ rowCount: 2, dateCount: 1 }),
        }),
        expect.any(Date),
      )
    })
  })
})
