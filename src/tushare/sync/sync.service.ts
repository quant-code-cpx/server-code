import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  forwardRef,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { SchedulerRegistry } from '@nestjs/schedule'
import { InjectMetric } from '@willsoto/nestjs-prometheus'
import { CronJob } from 'cron'
import { Counter, Gauge, Histogram } from 'prom-client'
import { BusinessException } from 'src/common/exceptions/business.exception'
import { ITushareConfig, TUSHARE_CONFIG_TOKEN } from 'src/config/tushare.config'
import { MONITORED_CACHE_NAMESPACES, SYNC_INVALIDATION_PREFIXES } from 'src/constant/cache.constant'
import { ErrorEnum } from 'src/constant/response-code.constant'
import { TushareSyncTaskName } from 'src/constant/tushare.constant'
import { CacheService } from 'src/shared/cache.service'
import {
  TUSHARE_SYNC_DURATION,
  TUSHARE_SYNC_TOTAL,
  TUSHARE_SYNC_ROUND_DURATION,
  TUSHARE_SYNC_ROUND_TASKS,
} from 'src/shared/metrics/metrics.constants'
import { EventsGateway } from 'src/websocket/events.gateway'
import { HeatmapSnapshotService } from 'src/apps/heatmap/heatmap-snapshot.service'
import { SignalGenerationService } from 'src/apps/signal/signal-generation.service'
import { DataQualityService, DataQualityReport, QualityCheckSummary } from './quality/data-quality.service'
import { AutoRepairService } from './quality/auto-repair.service'
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

/** 进度节流：最少间隔毫秒数，防止 WebSocket 洪泛 */
const PROGRESS_THROTTLE_MS = 2000

@Injectable()
export class TushareSyncService implements OnApplicationBootstrap {
  private readonly logger = new Logger(TushareSyncService.name)
  private readonly syncEnabled: boolean
  private readonly syncTimeZone: string
  private readonly syncConcurrency: number
  private running = false

  constructor(
    private readonly configService: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly helper: SyncHelperService,
    private readonly registry: TushareSyncRegistryService,
    private readonly cacheService: CacheService,
    private readonly eventsGateway: EventsGateway,
    private readonly heatmapSnapshotService: HeatmapSnapshotService,
    private readonly dataQualityService: DataQualityService,
    private readonly autoRepair: AutoRepairService,
    @Inject(forwardRef(() => SignalGenerationService))
    private readonly signalGenerationService: SignalGenerationService,
    @InjectMetric(TUSHARE_SYNC_DURATION) private readonly syncDurationHistogram: Histogram,
    @InjectMetric(TUSHARE_SYNC_TOTAL) private readonly syncTotalCounter: Counter,
    @InjectMetric(TUSHARE_SYNC_ROUND_DURATION) private readonly syncRoundDurationGauge: Gauge,
    @InjectMetric(TUSHARE_SYNC_ROUND_TASKS) private readonly syncRoundTasksGauge: Gauge,
  ) {
    const cfg = this.configService.get<ITushareConfig>(TUSHARE_CONFIG_TOKEN, { infer: true })
    if (!cfg) {
      throw new BusinessException(ErrorEnum.TUSHARE_CONFIG_MISSING)
    }
    this.syncEnabled = cfg.syncEnabled
    this.syncTimeZone = cfg.syncTimeZone
    this.syncConcurrency = cfg.syncConcurrency ?? 3
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

    // 总体进度追踪
    let completedTaskCount = 0
    const totalTaskCount = sortedPlans.length
    const overallStartedAt = startedAt

    const updateOverallProgress = () => {
      const elapsedMs = Date.now() - overallStartedAt
      const percentage = totalTaskCount > 0 ? Math.round((completedTaskCount / totalTaskCount) * 100) : 0
      const estimatedRemainingMs =
        completedTaskCount > 0
          ? Math.round((elapsedMs / completedTaskCount) * (totalTaskCount - completedTaskCount))
          : undefined
      this.eventsGateway.broadcastSyncOverallProgress({
        completedTasks: completedTaskCount,
        totalTasks: totalTaskCount,
        percentage,
        elapsedMs,
        estimatedRemainingMs,
      })
    }

    try {
      // 按 concurrencyGroup（默认 category）分组，组间并行执行
      const CATEGORY_ORDER: TushareSyncCategory[] = [
        'basic',
        'market',
        'financial',
        'moneyflow',
        'factor',
        'alternative',
      ]

      // 将 sortedPlans 按 concurrencyGroup（默认 category）分组，各组内串行
      const groups = new Map<string, TushareSyncPlan[]>()
      for (const category of CATEGORY_ORDER) {
        const categoryPlans = sortedPlans.filter((plan) => (plan.concurrencyGroup ?? plan.category) === category)
        if (categoryPlans.length) groups.set(category, categoryPlans)
      }

      // 将 group 列表切分为多批次，每批最多 syncConcurrency 个组并行
      // 注意：'basic' 组（含 trade_cal / stock_basic）必须先单独完成，
      // 其他分类（market / financial 等）依赖交易日历，必须等 basic 完成后再并行启动。
      const groupEntries = Array.from(groups.entries())
      const batchSize = Math.max(1, this.syncConcurrency)

      const basicEntries = groupEntries.filter(([key]) => key === 'basic')
      const nonBasicEntries = groupEntries.filter(([key]) => key !== 'basic')
      const allBatches: Array<typeof groupEntries> = []
      if (basicEntries.length > 0) allBatches.push(basicEntries)
      for (let i = 0; i < nonBasicEntries.length; i += batchSize) {
        allBatches.push(nonBasicEntries.slice(i, i + batchSize))
      }

      for (const batch of allBatches) {
        await Promise.all(
          batch.map(async ([groupKey, groupPlans]) => {
            this.logger.log(`─── ${this.getCategoryLabel(groupKey as TushareSyncCategory)} ───`)

            for (const plan of groupPlans) {
              if (trigger === 'schedule' && plan.schedule?.tradingDayOnly) {
                if (isTradingDay === null) {
                  isTradingDay = await this.helper.isTodayTradingDay()
                }

                if (!isTradingDay) {
                  this.logger.log(`[${plan.label}] 今天不是交易日，跳过`)
                  skippedTasks.push(plan.task)
                  completedTaskCount++
                  updateOverallProgress()
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
                  completedTaskCount++
                  updateOverallProgress()
                  continue
                }

                planTargetTradeDate = targetTradeDate
              }

              // 构建节流的 onProgress 回调
              const planStartedAt = Date.now()
              let lastProgressAt = 0
              let lastPercentage = 0
              const onProgress = (completed: number, total: number, currentKey?: string) => {
                const now = Date.now()
                const percentage = total > 0 ? Math.round((completed / total) * 100) : 0
                // 节流：至少间隔 PROGRESS_THROTTLE_MS 毫秒，或百分比变化 > 5%
                if (now - lastProgressAt < PROGRESS_THROTTLE_MS && Math.abs(percentage - lastPercentage) <= 5) {
                  return
                }
                lastProgressAt = now
                lastPercentage = percentage
                const elapsedMs = now - planStartedAt
                const estimatedRemainingMs =
                  completed > 0 && total > completed
                    ? Math.round((elapsedMs / completed) * (total - completed))
                    : undefined
                this.eventsGateway.broadcastSyncProgress({
                  task: plan.task,
                  label: plan.label,
                  category: plan.category,
                  completedItems: completed,
                  totalItems: total,
                  percentage,
                  currentKey,
                  elapsedMs,
                  estimatedRemainingMs,
                })
              }

              await this.safeRun(
                plan,
                () =>
                  plan.execute({
                    trigger,
                    mode,
                    targetTradeDate: planTargetTradeDate,
                    onProgress,
                  }),
                failedTasks,
                executedTasks,
                trigger,
              )

              completedTaskCount++
              updateOverallProgress()
            }
          }),
        )
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
        this.triggerHeatmapSnapshotAsync(result1)
        this.triggerDataQualityCheckAsync(result1)
        this.triggerSignalGenerationAsync(result1)
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
      this.triggerHeatmapSnapshotAsync(result2)
      this.triggerDataQualityCheckAsync(result2)
      this.triggerSignalGenerationAsync(result2)
      this.eventsGateway.broadcastSyncCompleted(result2)
      return result2
    } catch (error) {
      this.logger.error(`同步流程异常: ${(error as Error).message}`, (error as Error).stack)
      this.eventsGateway.broadcastSyncFailed(trigger, mode, (error as Error).message)
      throw error
    } finally {
      this.running = false
      // 记录整轮同步指标
      const finalElapsed = Number(((Date.now() - startedAt) / 1000).toFixed(1))
      this.syncRoundDurationGauge.set({ trigger, mode }, finalElapsed)
      this.syncRoundTasksGauge.set({ trigger, mode, status: 'executed' }, executedTasks.length)
      this.syncRoundTasksGauge.set({ trigger, mode, status: 'failed' }, failedTasks.length)
      this.syncRoundTasksGauge.set({ trigger, mode, status: 'skipped' }, skippedTasks.length)
    }
  }

  private async safeRun(
    plan: TushareSyncPlan,
    fn: () => Promise<void>,
    failedTasks: FailedTask[],
    executedTasks: TushareSyncTaskName[],
    trigger: TushareSyncTrigger,
  ) {
    const endTimer = this.syncDurationHistogram.startTimer({
      task: plan.task,
      category: plan.category,
      trigger,
    })

    try {
      this.logger.log(`▶ ${plan.label}`)
      await fn()
      executedTasks.push(plan.task)

      endTimer({ status: 'success' })
      this.syncTotalCounter.inc({ task: plan.task, category: plan.category, trigger, status: 'success' })
    } catch (error) {
      this.logger.error(`✗ ${plan.label} 失败: ${(error as Error).message}`)
      failedTasks.push({ task: plan.task, label: plan.label, fn, error: error as Error })

      endTimer({ status: 'failure' })
      this.syncTotalCounter.inc({ task: plan.task, category: plan.category, trigger, status: 'failure' })
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
      case 'factor':
        return '因子数据'
      case 'alternative':
        return '另类数据'
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

  /**
   * 异步触发热力图快照聚合（不阻塞同步完成流程）。
   * 仅在有行情类任务执行成功后触发。
   */
  private triggerHeatmapSnapshotAsync(result: RunPlansResult): void {
    if (result.executedTasks.length === 0) {
      return
    }
    void this.heatmapSnapshotService.aggregateSnapshot(result.targetTradeDate ?? undefined).catch((err) => {
      this.logger.warn(`热力图快照聚合失败（不影响主同步流程）：${(err as Error).message}`)
    })
  }

  /**
   * 异步触发盘后信号生成（不阻塞同步完成流程）。
   */
  private triggerSignalGenerationAsync(result: RunPlansResult): void {
    if (result.executedTasks.length === 0) return
    void this.signalGenerationService.generateAllSignals(result.targetTradeDate ?? undefined).catch((err) => {
      this.logger.warn(`信号生成失败（不影响主同步流程）：${(err as Error).message}`)
    })
  }

  private triggerDataQualityCheckAsync(result: RunPlansResult): void {
    if (result.executedTasks.length === 0) return

    void (async () => {
      try {
        // 1. 运行全量质量检查（含跨表对账）
        const reports = await this.dataQualityService.runAllChecksAndCollect()
        if (reports.length === 0) return // 被锁跳过时 reports 为空

        // 2. 构建摘要
        const summary = this.buildQualityCheckSummary(reports)

        // 3. 广播质量检查结果
        this.eventsGateway.broadcastDataQualityCompleted(summary)

        // 4. 自动补数（仅有 fail 项时触发）
        if (summary.counts.fail > 0) {
          const repairSummary = await this.autoRepair.analyzeAndRepair(reports)
          summary.autoRepairTriggered = true
          summary.repairTaskCount = repairSummary.executed

          this.eventsGateway.broadcastAutoRepairQueued(repairSummary)
          this.logger.log(`[自动补数] 生成 ${repairSummary.repairTasks} 个补数任务，${repairSummary.executed} 个已入队`)
        }
      } catch (error) {
        this.logger.error(`盘后数据质量检查失败: ${(error as Error).message}`)
      }
    })()
  }

  private buildQualityCheckSummary(
    reports: DataQualityReport[],
    repairInfo?: { executed: number },
  ): QualityCheckSummary {
    const nonCross = reports.filter((r) => r.checkType !== 'cross-table')
    const cross = reports.filter((r) => r.checkType === 'cross-table')

    const countByStatus = (arr: typeof reports) => ({
      pass: arr.filter((r) => r.status === 'pass').length,
      warn: arr.filter((r) => r.status === 'warn').length,
      fail: arr.filter((r) => r.status === 'fail').length,
    })

    return {
      checkedAt: new Date().toISOString(),
      totalDataSets: new Set(nonCross.map((r) => r.dataSet)).size,
      counts: countByStatus(nonCross),
      failures: reports
        .filter((r) => r.status === 'fail')
        .slice(0, 10)
        .map((r) => ({ dataSet: r.dataSet, checkType: r.checkType, message: r.message })),
      crossTableCounts: countByStatus(cross),
      autoRepairTriggered: !!repairInfo,
      repairTaskCount: repairInfo?.executed ?? 0,
    }
  }
}
