import { BadRequestException, ConflictException } from '@nestjs/common'
import { SchedulerRegistry } from '@nestjs/schedule'
import { CronJob } from 'cron'
import dayjs from 'dayjs'
import { TushareSyncTaskName } from 'src/constant/tushare.constant'
import { EventsGateway } from 'src/websocket/events.gateway'
import { TushareSyncRegistryService } from '../sync-registry.service'
import { TushareSyncPlan } from '../sync-plan.types'
import { TushareSyncService } from '../sync.service'

// ── 测试数据工厂 ──────────────────────────────────────────────────────────────

function createPlan(partial: Partial<TushareSyncPlan>): TushareSyncPlan {
  return {
    task: TushareSyncTaskName.DAILY,
    label: '日线行情',
    category: 'market',
    order: 10,
    bootstrapEnabled: true,
    supportsManual: true,
    supportsFullSync: true,
    requiresTradeDate: true,
    schedule: {
      cron: '0 30 18 * * 1-5',
      timeZone: 'Asia/Shanghai',
      description: '交易日盘后同步日线行情',
      tradingDayOnly: true,
    },
    execute: jest.fn(async () => undefined),
    ...partial,
  }
}

// ── 共享 mock 工厂 ────────────────────────────────────────────────────────────

function buildSharedMocks() {
  return {
    configService: {
      get: jest.fn(() => ({
        syncEnabled: true,
        syncTimeZone: 'Asia/Shanghai',
      })),
    },
    helper: {
      isTodayTradingDay: jest.fn(async () => true),
      resolveLatestCompletedTradeDate: jest.fn(async () => '20260327'),
      getCurrentShanghaiNow: jest.fn(() => dayjs('2026-03-27T20:00:00+08:00')),
    },
    schedulerRegistry: {
      doesExist: jest.fn(() => false),
      addCronJob: jest.fn(),
    } as Pick<SchedulerRegistry, 'doesExist' | 'addCronJob'>,
    eventsGateway: {
      broadcastSyncStarted: jest.fn(),
      broadcastSyncCompleted: jest.fn(),
      broadcastSyncFailed: jest.fn(),
      broadcastSyncProgress: jest.fn(),
      broadcastSyncOverallProgress: jest.fn(),
      broadcastDataQualityCompleted: jest.fn(),
      broadcastAutoRepairQueued: jest.fn(),
    } as Partial<EventsGateway>,
    cacheService: {
      invalidateNamespaces: jest.fn(async () => 0),
      invalidateByPrefixes: jest.fn(async () => 0),
      getNamespaceMetrics: jest.fn(async () => []),
    },
    heatmapSnapshotService: {
      aggregateSnapshot: jest.fn(async () => ({ tradeDate: '20260327', totalRecords: 0 })),
    },
    /** 修复：sync.service 实际调用 runAllChecksAndCollect（而非 runAllChecks） */
    dataQualityService: {
      runAllChecksAndCollect: jest.fn(async () => []),
    },
    autoRepairService: {
      analyzeAndRepair: jest.fn(async () => ({ totalChecked: 0, repairTasks: 0, executed: 0, tasks: [] })),
    },
  }
}

function createService(registry: Partial<TushareSyncRegistryService>, mocks = buildSharedMocks()): TushareSyncService {
  const noopHistogram = { observe: jest.fn(), startTimer: jest.fn(() => jest.fn()) } as never
  const noopCounter = { inc: jest.fn() } as never
  const noopGauge = { set: jest.fn() } as never
  return new TushareSyncService(
    mocks.configService as never,
    mocks.schedulerRegistry as SchedulerRegistry,
    mocks.helper as never,
    registry as TushareSyncRegistryService,
    mocks.cacheService as never,
    mocks.eventsGateway as EventsGateway,
    mocks.heatmapSnapshotService as never,
    mocks.dataQualityService as never,
    mocks.autoRepairService as never,
    { generateAllSignals: jest.fn().mockResolvedValue(undefined) } as never,
    noopHistogram,
    noopCounter,
    noopGauge,
    noopGauge,
  )
}

// ── 测试套件 ──────────────────────────────────────────────────────────────────

describe('TushareSyncService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.spyOn(CronJob, 'from').mockReturnValue({ start: jest.fn() } as unknown as CronJob)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  // ── onApplicationBootstrap ────────────────────────────────────────────────

  describe('onApplicationBootstrap()', () => {
    it('应为每个 scheduled plan 注册 cron job', async () => {
      const mocks = buildSharedMocks()
      const registry: Pick<TushareSyncRegistryService, 'getBootstrapPlans' | 'getScheduledPlans'> = {
        getBootstrapPlans: jest.fn(() => []),
        getScheduledPlans: jest.fn(() => [
          createPlan({ task: TushareSyncTaskName.DAILY }),
          createPlan({ task: TushareSyncTaskName.DAILY_BASIC, order: 20 }),
        ]),
      }

      const service = createService(registry, mocks)
      await service.onApplicationBootstrap()

      expect(mocks.schedulerRegistry.addCronJob).toHaveBeenCalledTimes(2)
    })

    it('syncEnabled=false 时应直接返回，不注册任何 cron job', async () => {
      const mocks = buildSharedMocks()
      mocks.configService.get.mockReturnValue({ syncEnabled: false, syncTimeZone: 'Asia/Shanghai' } as never)

      const registry: Pick<TushareSyncRegistryService, 'getBootstrapPlans' | 'getScheduledPlans'> = {
        getBootstrapPlans: jest.fn(),
        getScheduledPlans: jest.fn(),
      }

      const service = createService(registry, mocks)
      await service.onApplicationBootstrap()

      expect(mocks.schedulerRegistry.addCronJob).not.toHaveBeenCalled()
      expect(registry.getScheduledPlans).not.toHaveBeenCalled()
    })
  })

  // ── getAvailableSyncPlans() ──────────────────────────────────────────────

  describe('getAvailableSyncPlans()', () => {
    it('应将 registry plan 映射为 DTO（包含 schedule 信息）', () => {
      const plan = createPlan({ task: TushareSyncTaskName.DAILY })
      const registry = { getPlans: jest.fn(() => [plan]) }

      const service = createService(registry)
      const result = service.getAvailableSyncPlans()

      expect(result).toHaveLength(1)
      const dto = result[0]
      expect(dto.task).toBe(TushareSyncTaskName.DAILY)
      expect(dto.label).toBe('日线行情')
      expect(dto.category).toBe('market')
      expect(dto.schedule).toMatchObject({
        cron: '0 30 18 * * 1-5',
        timeZone: 'Asia/Shanghai',
      })
    })

    it('无 schedule 的 plan 应映射为 schedule=null', () => {
      const plan = createPlan({ schedule: undefined })
      const registry = { getPlans: jest.fn(() => [plan]) }

      const service = createService(registry)
      const result = service.getAvailableSyncPlans()

      expect(result[0].schedule).toBeNull()
    })
  })

  // ── runManualSync() ───────────────────────────────────────────────────────

  describe('runManualSync()', () => {
    it('应调用 execute 并携带正确的 targetTradeDate', async () => {
      const execute = jest.fn(async () => undefined)
      const dailyPlan = createPlan({ task: TushareSyncTaskName.DAILY, execute })
      const registry: Pick<TushareSyncRegistryService, 'getPlansByTasks' | 'getManualPlans' | 'getPlans'> = {
        getPlansByTasks: jest.fn(() => [dailyPlan]),
        getManualPlans: jest.fn(() => [dailyPlan]),
        getPlans: jest.fn(() => [dailyPlan]),
      }

      const service = createService(registry)
      const result = await service.runManualSync({
        tasks: [TushareSyncTaskName.DAILY],
        mode: 'incremental',
      })

      expect(execute).toHaveBeenCalledWith({
        trigger: 'manual',
        mode: 'incremental',
        targetTradeDate: '20260327',
        onProgress: expect.any(Function),
      })
      expect(result.executedTasks).toEqual([TushareSyncTaskName.DAILY])
    })

    it('请求未知任务名时应抛出 BadRequestException', async () => {
      const registry: Pick<TushareSyncRegistryService, 'getPlansByTasks' | 'getManualPlans'> = {
        getPlansByTasks: jest.fn(() => []), // 返回空，模拟未找到
        getManualPlans: jest.fn(() => []),
      }

      const service = createService(registry)

      await expect(service.runManualSync({ tasks: [TushareSyncTaskName.DAILY], mode: 'incremental' })).rejects.toThrow(
        BadRequestException,
      )
    })

    it('任务不支持手动同步时应抛出 BadRequestException', async () => {
      const plan = createPlan({ task: TushareSyncTaskName.DAILY, supportsManual: false })
      const registry: Pick<TushareSyncRegistryService, 'getPlansByTasks' | 'getManualPlans'> = {
        getPlansByTasks: jest.fn(() => [plan]),
        getManualPlans: jest.fn(() => [plan]),
      }

      const service = createService(registry)

      await expect(service.runManualSync({ tasks: [TushareSyncTaskName.DAILY], mode: 'incremental' })).rejects.toThrow(
        BadRequestException,
      )
    })

    it('mode=full 且任务不支持全量同步时应抛出 BadRequestException', async () => {
      const plan = createPlan({ task: TushareSyncTaskName.DAILY, supportsFullSync: false })
      const registry: Pick<TushareSyncRegistryService, 'getPlansByTasks' | 'getManualPlans'> = {
        getPlansByTasks: jest.fn(() => [plan]),
        getManualPlans: jest.fn(() => [plan]),
      }

      const service = createService(registry)

      await expect(service.runManualSync({ tasks: [TushareSyncTaskName.DAILY], mode: 'full' })).rejects.toThrow(
        BadRequestException,
      )
    })

    it('上一轮同步未结束时应抛出 ConflictException', async () => {
      const execute = jest.fn(async () => undefined)
      const plan = createPlan({ task: TushareSyncTaskName.DAILY, execute })
      const registry: Pick<TushareSyncRegistryService, 'getPlansByTasks' | 'getManualPlans' | 'getPlans'> = {
        getPlansByTasks: jest.fn(() => [plan]),
        getManualPlans: jest.fn(() => [plan]),
        getPlans: jest.fn(() => [plan]),
      }

      const service = createService(registry)
      // 模拟服务当前正处于运行中
      ;(service as unknown as { running: boolean }).running = true

      await expect(service.runManualSync({ tasks: [TushareSyncTaskName.DAILY], mode: 'incremental' })).rejects.toThrow(
        ConflictException,
      )
    })
  })

  // ── triggerManualSyncAsync() ──────────────────────────────────────────────

  describe('triggerManualSyncAsync()', () => {
    it('上一轮同步未结束时应同步抛出 ConflictException', () => {
      const execute = jest.fn(async () => undefined)
      const plan = createPlan({ task: TushareSyncTaskName.DAILY, execute })
      const registry: Pick<TushareSyncRegistryService, 'getPlansByTasks' | 'getManualPlans'> = {
        getPlansByTasks: jest.fn(() => [plan]),
        getManualPlans: jest.fn(() => [plan]),
      }

      const service = createService(registry)
      ;(service as unknown as { running: boolean }).running = true

      expect(() => service.triggerManualSyncAsync({ tasks: [TushareSyncTaskName.DAILY], mode: 'incremental' })).toThrow(
        ConflictException,
      )
    })
  })
})
