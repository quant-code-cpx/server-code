import { TushareSyncTaskName } from 'src/constant/tushare.constant'
import { TushareSyncRegistryService } from './sync-registry.service'
import { TushareSyncPlan } from './sync-plan.types'

function createPlan(task: TushareSyncTaskName, order: number): TushareSyncPlan {
  return {
    task,
    label: task,
    category: 'basic',
    order,
    bootstrapEnabled: true,
    supportsManual: true,
    supportsFullSync: true,
    requiresTradeDate: false,
    execute: async () => undefined,
  }
}

describe('TushareSyncRegistryService', () => {
  it('collects and sorts plans from all providers', () => {
    const registry = new TushareSyncRegistryService(
      { getSyncPlans: () => [createPlan(TushareSyncTaskName.STOCK_BASIC, 20)] } as never,
      { getSyncPlans: () => [createPlan(TushareSyncTaskName.DAILY, 10)] } as never,
      { getSyncPlans: () => [] } as never,
      { getSyncPlans: () => [] } as never,
    )

    expect(registry.getPlans().map((plan) => plan.task)).toEqual([
      TushareSyncTaskName.DAILY,
      TushareSyncTaskName.STOCK_BASIC,
    ])
  })

  it('throws when duplicate tasks are registered', () => {
    expect(
      () =>
        new TushareSyncRegistryService(
          { getSyncPlans: () => [createPlan(TushareSyncTaskName.DAILY, 10)] } as never,
          { getSyncPlans: () => [createPlan(TushareSyncTaskName.DAILY, 20)] } as never,
          { getSyncPlans: () => [] } as never,
          { getSyncPlans: () => [] } as never,
        ),
    ).toThrow('Duplicate Tushare sync plan detected: DAILY')
  })
})
