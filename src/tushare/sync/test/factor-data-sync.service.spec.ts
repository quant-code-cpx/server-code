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
    getStkSurvByTradeDate: jest.fn(async () => []),
  }
}

function buildMockHelper() {
  return {
    syncTimeZone: 'Asia/Shanghai',
    prisma: {
      indexWeight: {
        findFirst: jest.fn(async () => null as { tradeDate: string } | null),
        createMany: jest.fn(async () => ({ count: 0 })),
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
    writeSyncLog: jest.fn(async () => undefined),
    flushValidationLogs: jest.fn(async () => 0),
  }
}

function createService(api = buildMockApi(), helper = buildMockHelper()) {
  // @ts-ignore 局部 mock，跳过 DI
  return new FactorDataSyncService(api as FactorDataApiService, helper as SyncHelperService)
}

describe('FactorDataSyncService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
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
})
