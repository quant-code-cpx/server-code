import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { SchedulerRegistry } from '@nestjs/schedule'
import { CronJob } from 'cron'
import { TUSHARE_SYNC_CRON } from 'src/constant/tushare.constant'
import { ITushareConfig, TUSHARE_CONFIG_TOKEN } from 'src/config/tushare.config'
import { TushareBasicSyncService } from './sync/tushare-basic-sync.service'
import { TushareFinancialSyncService } from './sync/tushare-financial-sync.service'
import { TushareMarketSyncService } from './sync/tushare-market-sync.service'
import { TushareMoneyflowSyncService } from './sync/tushare-moneyflow-sync.service'
import { TushareSyncSupportService } from './sync/tushare-sync-support.service'
import { TushareSyncPlanItem, TushareSyncStage } from './sync/tushare-sync.types'

/**
 * TushareSyncService
 *
 * 仅负责编排同步流程：
 * - 应用启动时触发新鲜度检测
 * - 定时任务注册与调度
 * - 按文档分类委派给基础/行情/财务/资金流向服务执行
 */
@Injectable()
export class TushareSyncService implements OnApplicationBootstrap {
  private readonly logger = new Logger(TushareSyncService.name)
  private readonly syncEnabled: boolean
  private readonly syncTimeZone: string
  private running = false

  constructor(
    private readonly configService: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly support: TushareSyncSupportService,
    private readonly basicSyncService: TushareBasicSyncService,
    private readonly marketSyncService: TushareMarketSyncService,
    private readonly financialSyncService: TushareFinancialSyncService,
    private readonly moneyflowSyncService: TushareMoneyflowSyncService,
  ) {
    const cfg = this.configService.get<ITushareConfig>(TUSHARE_CONFIG_TOKEN, { infer: true })
    if (!cfg) {
      throw new Error('TushareConfig is not registered. Ensure TushareConfig is loaded in ConfigModule.')
    }

    this.syncEnabled = cfg.syncEnabled
    this.syncTimeZone = cfg.syncTimeZone
  }

  async onApplicationBootstrap() {
    if (!this.syncEnabled) {
      this.logger.warn('Tushare 自动同步已关闭，跳过启动检查。')
      return
    }

    this.registerDailySyncJob()
    void this.runPipeline('bootstrap').catch((error) => {
      this.logger.error(`启动阶段 Tushare 新鲜度检测失败: ${(error as Error).message}`, (error as Error).stack)
    })
  }

  private registerDailySyncJob() {
    if (this.schedulerRegistry.doesExist('cron', 'tushare-daily-sync')) {
      return
    }

    const cfg = this.configService.get<ITushareConfig>(TUSHARE_CONFIG_TOKEN, { infer: true })
    const cronExpression = cfg?.syncCron || TUSHARE_SYNC_CRON
    const cronTimeZone = cfg?.syncTimeZone || this.syncTimeZone
    const job = CronJob.from({
      cronTime: cronExpression,
      timeZone: cronTimeZone,
      onTick: () => {
        void this.runPipeline('schedule')
      },
      start: false,
    })

    job.start()
    this.schedulerRegistry.addCronJob('tushare-daily-sync', job)
    this.logger.log(`已注册 Tushare 定时同步任务：${cronExpression} [${cronTimeZone}]`)
  }

  private async runPipeline(trigger: 'bootstrap' | 'schedule') {
    if (this.running) {
      this.logger.warn(`检测到上一轮 Tushare 同步仍在执行，跳过本次 ${trigger} 触发。`)
      return
    }

    this.running = true
    this.logger.log(`开始执行 Tushare ${trigger} 同步流程...`)

    try {
      const plan = this.buildSyncPlan()
      await this.runPlanStage(plan, 'beforeTradeDate')

      if (trigger === 'schedule') {
        const todayOpen = await this.support.isTodayTradingDay()
        if (!todayOpen) {
          this.logger.log('今天不是交易日，跳过盘后自动同步。')
          return
        }
      }

      const latestCompletedTradeDate = await this.support.resolveLatestCompletedTradeDate()
      if (!latestCompletedTradeDate) {
        this.logger.warn('未能解析最近已完成的交易日，跳过本轮同步。')
        return
      }

      await this.runPlanStage(plan, 'afterTradeDate', latestCompletedTradeDate)

      this.logger.log(`Tushare ${trigger} 同步流程执行完成。`)
    } catch (error) {
      this.logger.error(`Tushare 同步流程执行失败: ${(error as Error).message}`, (error as Error).stack)
      throw error
    } finally {
      this.running = false
    }
  }

  private buildSyncPlan(): TushareSyncPlanItem[] {
    return [
      ...this.basicSyncService.getSyncPlan(),
      ...this.marketSyncService.getSyncPlan(),
      ...this.financialSyncService.getSyncPlan(),
      ...this.moneyflowSyncService.getSyncPlan(),
    ]
  }

  private async runPlanStage(plan: TushareSyncPlanItem[], stage: TushareSyncStage, targetTradeDate?: string) {
    const stagePlan = plan.filter((item) => item.stage === stage)

    for (const item of stagePlan) {
      this.logger.log(`执行同步任务 [${item.category}/${item.task}]...`)
      await item.run(targetTradeDate)
    }
  }
}
