import { SchedulerRegistry } from '@nestjs/schedule'
import { CronJob } from 'cron'
import { TushareSyncTaskName } from 'src/constant/tushare.constant'
import { TushareSyncRegistryService } from './sync-registry.service'
import { TushareSyncPlan } from './sync-plan.types'
import { TushareSyncService } from './sync.service'

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
    execute: async () => undefined,
    ...partial,
  }
}

describe('TushareSyncService', () => {
  const configService = {
    get: jest.fn(() => ({
      syncEnabled: true,
      syncTimeZone: 'Asia/Shanghai',
    })),
  }

  const helper = {
    isTodayTradingDay: jest.fn(async () => true),
    resolveLatestCompletedTradeDate: jest.fn(async () => '20260327'),
  }

  const schedulerRegistry: Pick<SchedulerRegistry, 'doesExist' | 'addCronJob'> = {
    doesExist: jest.fn(() => false),
    addCronJob: jest.fn(),
  }

  beforeEach(() => {
    jest.clearAllMocks()
    jest.spyOn(CronJob, 'from').mockReturnValue({
      start: jest.fn(),
    } as unknown as CronJob)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('registers plan-based cron jobs on bootstrap', async () => {
    const registry: Pick<TushareSyncRegistryService, 'getBootstrapPlans' | 'getScheduledPlans'> = {
      getBootstrapPlans: jest.fn(() => []),
      getScheduledPlans: jest.fn(() => [
        createPlan({ task: TushareSyncTaskName.DAILY }),
        createPlan({ task: TushareSyncTaskName.DAILY_BASIC, order: 20 }),
      ]),
    }

    const service = new TushareSyncService(
      configService as never,
      schedulerRegistry as SchedulerRegistry,
      helper as never,
      registry as TushareSyncRegistryService,
    )

    await service.onApplicationBootstrap()

    expect(schedulerRegistry.addCronJob).toHaveBeenCalledTimes(2)
  })

  it('runs only requested manual tasks with resolved trade date', async () => {
    const execute = jest.fn(async () => undefined)
    const dailyPlan = createPlan({ task: TushareSyncTaskName.DAILY, execute })
    const registry: Pick<TushareSyncRegistryService, 'getPlansByTasks' | 'getManualPlans' | 'getPlans'> = {
      getPlansByTasks: jest.fn(() => [dailyPlan]),
      getManualPlans: jest.fn(() => [dailyPlan]),
      getPlans: jest.fn(() => [dailyPlan]),
    }

    const service = new TushareSyncService(
      configService as never,
      schedulerRegistry as SchedulerRegistry,
      helper as never,
      registry as TushareSyncRegistryService,
    )

    const result = await service.runManualSync({
      tasks: [TushareSyncTaskName.DAILY],
      mode: 'incremental',
    })

    expect(execute).toHaveBeenCalledWith({
      trigger: 'manual',
      mode: 'incremental',
      targetTradeDate: '20260327',
    })
    expect(result.executedTasks).toEqual([TushareSyncTaskName.DAILY])
  })
})
