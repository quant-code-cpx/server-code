import { BadRequestException, ConflictException, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { SchedulerRegistry } from '@nestjs/schedule'
import { CronJob } from 'cron'
import { BusinessException } from 'src/common/exceptions/business.exception'
import { ITushareConfig, TUSHARE_CONFIG_TOKEN } from 'src/config/tushare.config'
import { MONITORED_CACHE_NAMESPACES, SYNC_INVALIDATION_PREFIXES } from 'src/constant/cache.constant'
import { ErrorEnum } from 'src/constant/response-code.constant'
import { TushareSyncTaskName } from 'src/constant/tushare.constant'
import { CacheService } from 'src/shared/cache.service'
import { EventsGateway } from 'src/websocket/events.gateway'
import { SyncHelperService } from './sync-helper.service'
import { TushareSyncRegistryService } from './sync-registry.service'
import { TushareSyncCategory, TushareSyncMode, TushareSyncPlan, TushareSyncTrigger } from './sync-plan.types'

interface FailedTask {
  task: TushareSyncTaskName
  label: string
  fn: () => Promise<void>
  error: Error
}

interface RunPlansOptions {
  trigger: TushareSyncTrigger
  mode: TushareSyncMode
  plans: TushareSyncPlan[]
}

export interface RunPlansResult {
  trigger: TushareSyncTrigger
  mode: TushareSyncMode
  executedTasks: TushareSyncTaskName[]
  skippedTasks: TushareSyncTaskName[]
  failedTasks: TushareSyncTaskName[]
  targetTradeDate: string | null
  elapsedSeconds: number
}

@Injectable()
export class TushareSyncService implements OnApplicationBootstrap {
  private readonly logger = new Logger(TushareSyncService.name)
  private readonly syncEnabled: boolean
  private readonly syncTimeZone: string
  private running = false

  constructor(
    private readonly configService: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly helper: SyncHelperService,
    private readonly registry: TushareSyncRegistryService,
    private readonly cacheService: CacheService,
    private readonly eventsGateway: EventsGateway,
  ) {
    const cfg = this.configService.get<ITushareConfig>(TUSHARE_CONFIG_TOKEN, { infer: true })
    if (!cfg) {
      throw new BusinessException(ErrorEnum.TUSHARE_CONFIG_MISSING)
    }
    this.syncEnabled = cfg.syncEnabled
    this.syncTimeZone = cfg.syncTimeZone
  }

  async onApplicationBootstrap() {
    if (!this.syncEnabled) {
      this.logger.warn('Tushare 自动同步已关闭（TUSHARE_SYNC_ENABLED=false）')
      return
    }

    this.registerSyncJobs()

    void this.runPlans({
      trigger: 'bootstrap',
      mode: 'incremental',
      plans: this.registry.getBootstrapPlans(),
    }).catch((error) => {
      this.logger.error(`启动同步失败: ${(error as Error).message}`, (error as Error).stack)
    })
  }

  getAvailableSyncPlans() {
    return this.registry.getPlans().map((plan) => ({
      task: plan.task,
      label: plan.label,
      category: plan.category,
      bootstrapEnabled: plan.bootstrapEnabled,
      supportsManual: plan.supportsManual,
      supportsFullSync: plan.supportsFullSync,
      requiresTradeDate: plan.requiresTradeDate,
      schedule: plan.schedule
        ? {
            cron: plan.schedule.cron,
            timeZone: plan.schedule.timeZone,
            description: plan.schedule.description,
            tradingDayOnly: plan.schedule.tradingDayOnly ?? false,
          }
        : null,
    }))
  }

  async getCacheStats() {
    return {
      generatedAt: new Date().toISOString(),
      namespaces: await this.cacheService.getNamespaceMetrics(MONITORED_CACHE_NAMESPACES),
    }
  }

  async runManualSync(input: { tasks?: TushareSyncTaskName[]; mode: TushareSyncMode }): Promise<RunPlansResult> {
    const requestedPlans = this.buildManualPlans(input)

    return this.runPlans({
      trigger: 'manual',
      mode: input.mode,
      plans: requestedPlans,
    })
  }

  /**
   * 异步触发手动同步：同步验证参数后立即返回，实际同步在后台执行。
   * 同步开始、完成、异常均通过 WebSocket 广播通知前端。
   */
  triggerManualSyncAsync(input: { tasks?: TushareSyncTaskName[]; mode: TushareSyncMode }): void {
    const requestedPlans = this.buildManualPlans(input)

    if (this.running) {
      throw new ConflictException('上一轮同步仍在执行，请稍后再试')
    }

    void this.runPlans({
      trigger: 'manual',
      mode: input.mode,
      plans: requestedPlans,
    }).catch((error) => {
      // runPlans emits broadcastSyncFailed in its own catch before re-throwing.
      // This catch handles any edge case where runPlans throws before its try block
      // (e.g. an unexpected error after the running flag is set).
      this.logger.error(`手动同步后台执行异常: ${(error as Error).message}`, (error as Error).stack)
      this.eventsGateway.broadcastSyncFailed('manual', input.mode, (error as Error).message)
    })
  }

  private buildManualPlans(input: { tasks?: TushareSyncTaskName[]; mode: TushareSyncMode }): TushareSyncPlan[] {
    const requestedPlans = input.tasks?.length
      ? this.registry.getPlansByTasks(input.tasks)
      : this.registry.getManualPlans()

    if (input.tasks?.length && requestedPlans.length !== input.tasks.length) {
      const found = new Set(requestedPlans.map((plan) => plan.task))
      const unknown = input.tasks.filter((task) => !found.has(task))
      throw new BadRequestException(`未知的同步任务: ${unknown.join(', ')}`)
    }

    if (!requestedPlans.length) {
      throw new BadRequestException('未找到可执行的同步任务')
    }

    const unsupportedManual = requestedPlans.filter((plan) => !plan.supportsManual)
    if (unsupportedManual.length > 0) {
      throw new BadRequestException(`以下任务不支持手动同步: ${unsupportedManual.map((plan) => plan.task).join(', ')}`)
    }

    if (input.mode === 'full') {
      const unsupportedFull = requestedPlans.filter((plan) => !plan.supportsFullSync)
      if (unsupportedFull.length > 0) {
        throw new BadRequestException(`以下任务不支持全量同步: ${unsupportedFull.map((plan) => plan.task).join(', ')}`)
      }
    }

    return requestedPlans
  }

  private registerSyncJobs() {
    for (const plan of this.registry.getScheduledPlans()) {
      if (!plan.schedule) continue

      const jobName = this.getJobName(plan.task)
      if (this.schedulerRegistry.doesExist('cron', jobName)) {
        continue
      }

      const job = CronJob.from({
        cronTime: plan.schedule.cron,
        timeZone: plan.schedule.timeZone || this.syncTimeZone,
        onTick: () => void this.runScheduledTask(plan.task),
        start: false,
      })

      job.start()
      this.schedulerRegistry.addCronJob(jobName, job)
      this.logger.log(
        `已注册同步任务 ${plan.task}: ${plan.schedule.cron} [${plan.schedule.timeZone || this.syncTimeZone}]`,
      )
    }
  }

  private async runScheduledTask(task: TushareSyncTaskName) {
    const plan = this.registry.getPlan(task)
    if (!plan) {
      this.logger.warn(`未找到定时同步任务定义: ${task}`)
      return
    }

    await this.runPlans({
      trigger: 'schedule',
      mode: 'incremental',
      plans: [plan],
    })
  }

  private async runPlans({ trigger, mode, plans }: RunPlansOptions): Promise<RunPlansResult> {
    if (plans.length === 0) {
      return {
        trigger,
        mode,
        executedTasks: [],
        skippedTasks: [],
        failedTasks: [],
        targetTradeDate: null,
        elapsedSeconds: 0,
      }
    }

    if (this.running) {
      const message = `上一轮同步仍在执行，跳过本次 ${trigger} 触发`
      if (trigger === 'manual') {
        throw new ConflictException(message)
      }
      this.logger.warn(message)
      return {
        trigger,
        mode,
        executedTasks: [],
        skippedTasks: plans.map((plan) => plan.task),
        failedTasks: [],
        targetTradeDate: null,
        elapsedSeconds: 0,
      }
    }

    this.running = true
    const startedAt = Date.now()
    const executedTasks: TushareSyncTaskName[] = []
    const skippedTasks: TushareSyncTaskName[] = []
    const failedTasks: FailedTask[] = []
    const sortedPlans = [...plans].sort((a, b) => a.order - b.order)
    let isTradingDay: boolean | null = null
    let targetTradeDate: string | null = null
    let targetTradeDateResolved = false

    this.logger.log('═══════════════════════════════════════════════════')
    this.logger.log(`  Tushare ${trigger} 同步开始 (${mode})`)
    this.logger.log('═══════════════════════════════════════════════════')

    this.eventsGateway.broadcastSyncStarted(trigger, mode)

    try {
      for (const category of ['basic', 'market', 'financial', 'moneyflow'] as TushareSyncCategory[]) {
        const categoryPlans = sortedPlans.filter((plan) => plan.category === category)
        if (!categoryPlans.length) continue

        this.logger.log(`─── ${this.getCategoryLabel(category)} ───`)

        for (const plan of categoryPlans) {
          if (trigger === 'schedule' && plan.schedule?.tradingDayOnly) {
            if (isTradingDay === null) {
              isTradingDay = await this.helper.isTodayTradingDay()
            }

            if (!isTradingDay) {
              this.logger.log(`[${plan.label}] 今天不是交易日，跳过`)
              skippedTasks.push(plan.task)
              continue
            }
          }

          let planTargetTradeDate: string | undefined
          if (plan.requiresTradeDate) {
            if (!targetTradeDateResolved) {
              targetTradeDateResolved = true
              targetTradeDate = await this.helper.resolveLatestCompletedTradeDate()
            }

            if (!targetTradeDate) {
              this.logger.warn(`[${plan.label}] 未能解析最近已完成的交易日，跳过`)
              skippedTasks.push(plan.task)
              continue
            }

            planTargetTradeDate = targetTradeDate
          }

          await this.safeRun(
            plan,
            () =>
              plan.execute({
                trigger,
                mode,
                targetTradeDate: planTargetTradeDate,
              }),
            failedTasks,
            executedTasks,
          )
        }
      }

      if (failedTasks.length > 0) {
        this.logger.warn(`═══ ${failedTasks.length} 个任务失败，开始兜底重试 ═══`)
        const stillFailed: TushareSyncTaskName[] = []

        for (const task of failedTasks) {
          try {
            this.logger.log(`重试: ${task.label}`)
            await task.fn()
            this.logger.log(`重试成功: ${task.label}`)
          } catch (error) {
            this.logger.error(`重试仍失败: ${task.label} - ${(error as Error).message}`)
            stillFailed.push(task.task)
          }
        }

        const elapsedSeconds = Number(((Date.now() - startedAt) / 1000).toFixed(1))
        if (stillFailed.length > 0) {
          this.logger.error(`兜底重试后仍有 ${stillFailed.length} 个任务失败: ${stillFailed.join(', ')}`)
        } else {
          this.logger.log('兜底重试全部成功')
        }

        this.logger.log('═══════════════════════════════════════════════════')
        this.logger.log(`  Tushare ${trigger} 同步完成 (耗时 ${elapsedSeconds}s)`)
        this.logger.log('═══════════════════════════════════════════════════')

        const result1: RunPlansResult = {
          trigger,
          mode,
          executedTasks,
          skippedTasks,
          failedTasks: stillFailed,
          targetTradeDate,
          elapsedSeconds,
        }
        await this.invalidateCachesAfterSync(result1)
        this.eventsGateway.broadcastSyncCompleted(result1)
        return result1
      }

      const elapsedSeconds = Number(((Date.now() - startedAt) / 1000).toFixed(1))
      this.logger.log('═══════════════════════════════════════════════════')
      this.logger.log(`  Tushare ${trigger} 同步完成 (耗时 ${elapsedSeconds}s)`)
      this.logger.log('═══════════════════════════════════════════════════')

      const result2: RunPlansResult = {
        trigger,
        mode,
        executedTasks,
        skippedTasks,
        failedTasks: [],
        targetTradeDate,
        elapsedSeconds,
      }
      await this.invalidateCachesAfterSync(result2)
      this.eventsGateway.broadcastSyncCompleted(result2)
      return result2
    } catch (error) {
      this.logger.error(`同步流程异常: ${(error as Error).message}`, (error as Error).stack)
      this.eventsGateway.broadcastSyncFailed(trigger, mode, (error as Error).message)
      throw error
    } finally {
      this.running = false
    }
  }

  private async safeRun(
    plan: TushareSyncPlan,
    fn: () => Promise<void>,
    failedTasks: FailedTask[],
    executedTasks: TushareSyncTaskName[],
  ) {
    try {
      this.logger.log(`▶ ${plan.label}`)
      await fn()
      executedTasks.push(plan.task)
    } catch (error) {
      this.logger.error(`✗ ${plan.label} 失败: ${(error as Error).message}`)
      failedTasks.push({ task: plan.task, label: plan.label, fn, error: error as Error })
    }
  }

  private getCategoryLabel(category: TushareSyncCategory): string {
    switch (category) {
      case 'basic':
        return '基础数据'
      case 'market':
        return '行情数据'
      case 'financial':
        return '财务数据'
      case 'moneyflow':
        return '资金流向'
    }
  }

  private getJobName(task: TushareSyncTaskName): string {
    return `tushare-sync:${task}`
  }

  private async invalidateCachesAfterSync(result: RunPlansResult) {
    if (result.executedTasks.length === 0) {
      return
    }

    try {
      const trackedDeleted = await this.cacheService.invalidateNamespaces(MONITORED_CACHE_NAMESPACES)
      const legacyDeleted = await this.cacheService.invalidateByPrefixes([...SYNC_INVALIDATION_PREFIXES])
      this.logger.log(
        `已清理同步相关缓存：tracked=${trackedDeleted}，legacy=${legacyDeleted}，tasks=${result.executedTasks.join(', ')}`,
      )
    } catch (error) {
      this.logger.warn(`同步后缓存清理失败: ${(error as Error).message}`)
    }
  }
}
