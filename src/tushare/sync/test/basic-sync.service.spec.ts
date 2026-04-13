/**
 * BasicSyncService — 单元测试
 *
 * 覆盖要点：
 * - getSyncPlans() 返回所有基础数据任务
 * - syncStockBasic: 今日已同步时跳过（incremental）；full 模式强制执行
 * - syncThsIndex: 先删 thsMember 再删 thsIndex（外键顺序）
 * - syncThsMember: boards 为空时提前返回
 */
import { TushareSyncTaskName } from 'src/constant/tushare.constant'
import { BasicApiService } from '../../api/basic-api.service'
import { BasicSyncService } from '../basic-sync.service'
import { SyncHelperService } from '../sync-helper.service'

// ── mock 工厂 ─────────────────────────────────────────────────────────────────

function buildPrismaMock() {
  return {
    thsMember: {
      deleteMany: jest.fn(async () => ({})),
      createMany: jest.fn(async () => ({ count: 0 })),
    },
    thsIndex: {
      deleteMany: jest.fn(async () => ({})),
      createMany: jest.fn(async () => ({ count: 0 })),
      findMany: jest.fn(async () => [] as { tsCode: string; type: string }[]),
    },
    indexClassify: {
      findMany: jest.fn(async () => []),
    },
    indexMemberAll: {
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
      buildYearlyWindows: jest.fn(() => [{ startDate: '20100101', endDate: '20101231' }]),
      getCurrentShanghaiNow: jest.fn(() => ({
        add: jest.fn(() => ({ format: jest.fn(() => '20271231') })),
      })),
      toPrismaExchange: jest.fn((ex: string) => ex),
      toDate: jest.fn((d: string) => new Date(d)),
      flushValidationLogs: jest.fn(async () => undefined),
    },
    { prisma: prismaMock },
  )
}

function buildMockApi() {
  return {
    getStockBasic: jest.fn(async () => []),
    getTradeCalendar: jest.fn(async () => []),
    getStockCompany: jest.fn(async () => []),
    getIndexClassify: jest.fn(async () => []),
    getIndexMemberAllByL1Code: jest.fn(async () => []),
    getCbBasicAll: jest.fn(async () => []),
    getThsIndex: jest.fn(async () => []),
    getThsMemberByCode: jest.fn(async () => []),
  }
}

function createService(api = buildMockApi(), helper = buildMockHelper()): BasicSyncService {
  // @ts-ignore 局部 mock，跳过 DI
  return new BasicSyncService(api as BasicApiService, helper as SyncHelperService)
}

// ── 测试套件 ──────────────────────────────────────────────────────────────────

describe('BasicSyncService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  // ── getSyncPlans() ─────────────────────────────────────────────────────────

  describe('getSyncPlans()', () => {
    it('应返回 8 个基础数据同步任务', () => {
      const service = createService()
      const plans = service.getSyncPlans()
      expect(plans).toHaveLength(8)
    })

    it('所有 plan 的 category 都为 basic', () => {
      const plans = createService().getSyncPlans()
      for (const plan of plans) {
        expect(plan.category).toBe('basic')
      }
    })

    it('包含 STOCK_BASIC / TRADE_CAL / THS_INDEX / THS_MEMBER 等核心任务', () => {
      const tasks = createService()
        .getSyncPlans()
        .map((p) => p.task)
      expect(tasks).toContain(TushareSyncTaskName.STOCK_BASIC)
      expect(tasks).toContain(TushareSyncTaskName.TRADE_CAL)
      expect(tasks).toContain(TushareSyncTaskName.THS_INDEX)
      expect(tasks).toContain(TushareSyncTaskName.THS_MEMBER)
      expect(tasks).toContain(TushareSyncTaskName.STOCK_COMPANY)
    })

    it('按 order 字段正向排列', () => {
      const plans = createService().getSyncPlans()
      const orders = plans.map((p) => p.order)
      expect(orders).toEqual([...orders].sort((a, b) => a - b))
    })
  })

  // ── syncStockBasic() ───────────────────────────────────────────────────────

  describe('syncStockBasic()', () => {
    it('incremental 模式今日已同步时应跳过，不调用 API', async () => {
      const helper = buildMockHelper()
      helper.isTaskSyncedToday.mockResolvedValue(true)
      const api = buildMockApi()
      const service = createService(api, helper)

      await service.syncStockBasic('incremental')

      expect(api.getStockBasic).not.toHaveBeenCalled()
      expect(helper.replaceAllRows).not.toHaveBeenCalled()
    })

    it('incremental 模式今日未同步时应调用 API 并写入数据', async () => {
      const api = buildMockApi()
      const helper = buildMockHelper()
      helper.isTaskSyncedToday.mockResolvedValue(false)
      const service = createService(api, helper)

      await service.syncStockBasic('incremental')

      expect(api.getStockBasic).toHaveBeenCalled()
      expect(helper.replaceAllRows).toHaveBeenCalledWith('stockBasic', expect.any(Array))
    })

    it('full 模式应忽略 isTaskSyncedToday，直接调用 API', async () => {
      const api = buildMockApi()
      const helper = buildMockHelper()
      // 即便返回 true，full 模式也必须执行
      helper.isTaskSyncedToday.mockResolvedValue(true)
      const service = createService(api, helper)

      await service.syncStockBasic('full')

      expect(api.getStockBasic).toHaveBeenCalled()
    })

    it('完成后应写同步日志', async () => {
      const helper = buildMockHelper()
      const service = createService(buildMockApi(), helper)

      await service.syncStockBasic('full')

      expect(helper.writeSyncLog).toHaveBeenCalledWith(
        TushareSyncTaskName.STOCK_BASIC,
        expect.objectContaining({ payload: expect.objectContaining({ rowCount: expect.any(Number) }) }),
        expect.any(Date),
      )
    })
  })

  // ── syncThsIndex() ─────────────────────────────────────────────────────────

  describe('syncThsIndex()', () => {
    it('应先删 thsMember，再删 thsIndex（外键顺序保证）', async () => {
      const prismaMock = buildPrismaMock()
      const callOrder: string[] = []
      prismaMock.thsMember.deleteMany.mockImplementation(async () => {
        callOrder.push('thsMember.deleteMany')
        return {}
      })
      prismaMock.thsIndex.deleteMany.mockImplementation(async () => {
        callOrder.push('thsIndex.deleteMany')
        return {}
      })
      prismaMock.thsIndex.createMany.mockImplementation(async () => {
        callOrder.push('thsIndex.createMany')
        return { count: 0 }
      })

      const service = createService(buildMockApi(), buildMockHelper(prismaMock))
      await service.syncThsIndex()

      expect(callOrder[0]).toBe('thsMember.deleteMany')
      expect(callOrder[1]).toBe('thsIndex.deleteMany')
      expect(callOrder[2]).toBe('thsIndex.createMany')
    })

    it('完成后应调用 flushValidationLogs 和 writeSyncLog', async () => {
      const helper = buildMockHelper()
      const service = createService(buildMockApi(), helper)

      await service.syncThsIndex()

      expect(helper.flushValidationLogs).toHaveBeenCalled()
      expect(helper.writeSyncLog).toHaveBeenCalledWith(
        TushareSyncTaskName.THS_INDEX,
        expect.any(Object),
        expect.any(Date),
      )
    })
  })

  // ── syncThsMember() ────────────────────────────────────────────────────────

  describe('syncThsMember()', () => {
    it('thsIndex 为空时应提前返回，不调用 API', async () => {
      const prismaMock = buildPrismaMock()
      prismaMock.thsIndex.findMany.mockResolvedValue([]) // 空板块列表
      const api = buildMockApi()
      const service = createService(api, buildMockHelper(prismaMock))

      await service.syncThsMember()

      expect(api.getThsMemberByCode).not.toHaveBeenCalled()
    })

    it('thsIndex 非空时应逐板块调用 API 拉取成分', async () => {
      const prismaMock = buildPrismaMock()
      prismaMock.thsIndex.findMany.mockResolvedValue([
        { tsCode: '884001.TI', type: 'N' },
        { tsCode: '884002.TI', type: 'N' },
      ] as never)

      const api = buildMockApi()
      const service = createService(api, buildMockHelper(prismaMock))

      await service.syncThsMember()

      expect(api.getThsMemberByCode).toHaveBeenCalledTimes(2)
      expect(api.getThsMemberByCode).toHaveBeenCalledWith('884001.TI')
      expect(api.getThsMemberByCode).toHaveBeenCalledWith('884002.TI')
    })

    it('同步前应先清空 thsMember 旧数据', async () => {
      const prismaMock = buildPrismaMock()
      prismaMock.thsIndex.findMany.mockResolvedValue([{ tsCode: '884001.TI', type: 'N' }] as never)
      const service = createService(buildMockApi(), buildMockHelper(prismaMock))

      await service.syncThsMember()

      expect(prismaMock.thsMember.deleteMany).toHaveBeenCalled()
    })
  })

  // ── syncTradeCalendar() — 额外校验 ─────────────────────────────────────────

  describe('syncTradeCalendar()', () => {
    it('API 返回空数据时不抛错，写同步日志', async () => {
      const api = buildMockApi()
      api.getTradeCalendar.mockResolvedValue([])
      const helper = buildMockHelper()
      const service = createService(api, helper)

      await expect(service.syncTradeCal('full')).resolves.toBeUndefined()

      expect(helper.writeSyncLog).toHaveBeenCalled()
    })
  })

  // ── syncStockCompany() — 额外校验 ──────────────────────────────────────────

  describe('syncStockCompany()', () => {
    it('full 模式调用 API 写入公司信息', async () => {
      const api = buildMockApi()
      api.getStockCompany.mockResolvedValue([])
      const helper = buildMockHelper()
      const service = createService(api, helper)

      await service.syncStockCompany('full')

      expect(api.getStockCompany).toHaveBeenCalled()
    })
  })
})
