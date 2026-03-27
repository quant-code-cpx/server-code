import { Injectable } from '@nestjs/common'
import { TushareSyncTaskName } from 'src/constant/tushare.constant'
import { BasicSyncService } from './basic-sync.service'
import { FinancialSyncService } from './financial-sync.service'
import { MarketSyncService } from './market-sync.service'
import { MoneyflowSyncService } from './moneyflow-sync.service'
import { TushareSyncPlan } from './sync-plan.types'

@Injectable()
export class TushareSyncRegistryService {
  private readonly plans: TushareSyncPlan[]
  private readonly planMap: Map<TushareSyncTaskName, TushareSyncPlan>

  constructor(
    private readonly basicSync: BasicSyncService,
    private readonly marketSync: MarketSyncService,
    private readonly financialSync: FinancialSyncService,
    private readonly moneyflowSync: MoneyflowSyncService,
  ) {
    this.plans = this.collectPlans()
    this.planMap = new Map(this.plans.map((plan) => [plan.task, plan]))
  }

  getPlans(): TushareSyncPlan[] {
    return [...this.plans]
  }

  getPlan(task: TushareSyncTaskName): TushareSyncPlan | undefined {
    return this.planMap.get(task)
  }

  getPlansByTasks(tasks: TushareSyncTaskName[]): TushareSyncPlan[] {
    return tasks
      .map((task) => this.getPlan(task))
      .filter((plan): plan is TushareSyncPlan => Boolean(plan))
  }

  getBootstrapPlans(): TushareSyncPlan[] {
    return this.plans.filter((plan) => plan.bootstrapEnabled)
  }

  getManualPlans(): TushareSyncPlan[] {
    return this.plans.filter((plan) => plan.supportsManual)
  }

  getScheduledPlans(): TushareSyncPlan[] {
    return this.plans.filter((plan) => Boolean(plan.schedule))
  }

  private collectPlans(): TushareSyncPlan[] {
    const plans = [
      ...this.basicSync.getSyncPlans(),
      ...this.marketSync.getSyncPlans(),
      ...this.financialSync.getSyncPlans(),
      ...this.moneyflowSync.getSyncPlans(),
    ].sort((a, b) => a.order - b.order)

    const seen = new Set<TushareSyncTaskName>()
    for (const plan of plans) {
      if (seen.has(plan.task)) {
        throw new Error(`Duplicate Tushare sync plan detected: ${plan.task}`)
      }
      seen.add(plan.task)
    }

    return plans
  }
}
