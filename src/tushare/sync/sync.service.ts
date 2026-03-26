import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { SchedulerRegistry } from '@nestjs/schedule'
import { CronJob } from 'cron'
import { TUSHARE_SYNC_CRON } from 'src/constant/tushare.constant'
import { ITushareConfig, TUSHARE_CONFIG_TOKEN } from 'src/config/tushare.config'
import { SyncHelperService } from './sync-helper.service'
import { BasicSyncService } from './basic-sync.service'
import { MarketSyncService } from './market-sync.service'
import { FinancialSyncService } from './financial-sync.service'
import { MoneyflowSyncService } from './moneyflow-sync.service'

interface FailedTask {
  label: string
  fn: () => Promise<void>
  error: Error
}

/**
 * TushareSyncService — 同步流程编排器
 *
 * 职责：
 * - 应用启动时执行数据新鲜度检测
 * - 注册每日 18:30 定时同步任务
 * - 按顺序调度各分类同步服务
 * - 容错处理：单个任务失败不阻塞后续任务，全部执行完后兜底重试
 *
 * 同步顺序（按 Tushare 文档分类）：
 * 1. 基础数据：股票列表 → 交易日历 → 公司信息
 * 2. 行情数据：日线 → 周线 → 月线 → 每日指标 → 复权因子
 * 3. 财务数据：利润表 → 业绩快报 → 分红 → 财务指标 → 十大股东 → 十大流通股东
 * 4. 资金流向：个股 → 行业 → 大盘
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
    private readonly helper: SyncHelperService,
    private readonly basicSync: BasicSyncService,
    private readonly marketSync: MarketSyncService,
    private readonly financialSync: FinancialSyncService,
    private readonly moneyflowSync: MoneyflowSyncService,
  ) {
    const cfg = this.configService.get<ITushareConfig>(TUSHARE_CONFIG_TOKEN, { infer: true })
    if (!cfg) throw new Error('TushareConfig is not registered.')
    this.syncEnabled = cfg.syncEnabled
    this.syncTimeZone = cfg.syncTimeZone
  }

  async onApplicationBootstrap() {
    if (!this.syncEnabled) {
      this.logger.warn('Tushare 自动同步已关闭（TUSHARE_SYNC_ENABLED=false）')
      return
    }

    this.registerDailySyncJob()

    // 启动时异步执行同步，不阻塞应用启动
    void this.runPipeline('bootstrap').catch((error) => {
      this.logger.error(`启动同步失败: ${(error as Error).message}`, (error as Error).stack)
    })
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 定时任务注册
  // ═══════════════════════════════════════════════════════════════════════════

  private registerDailySyncJob() {
    if (this.schedulerRegistry.doesExist('cron', 'tushare-daily-sync')) return

    const cfg = this.configService.get<ITushareConfig>(TUSHARE_CONFIG_TOKEN, { infer: true })
    const cronExpr = cfg?.syncCron || TUSHARE_SYNC_CRON
    const tz = cfg?.syncTimeZone || this.syncTimeZone

    const job = CronJob.from({
      cronTime: cronExpr,
      timeZone: tz,
      onTick: () => void this.runPipeline('schedule'),
      start: false,
    })

    job.start()
    this.schedulerRegistry.addCronJob('tushare-daily-sync', job)
    this.logger.log(`已注册定时同步: ${cronExpr} [${tz}]`)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 主同步流程
  // ═══════════════════════════════════════════════════════════════════════════

  private async runPipeline(trigger: 'bootstrap' | 'schedule') {
    if (this.running) {
      this.logger.warn(`上一轮同步仍在执行，跳过本次 ${trigger} 触发`)
      return
    }

    this.running = true
    const pipelineStart = Date.now()
    this.logger.log(`═══════════════════════════════════════════════════`)
    this.logger.log(`  Tushare ${trigger} 同步开始`)
    this.logger.log(`═══════════════════════════════════════════════════`)

    try {
      const failedTasks: FailedTask[] = []

      // ── Phase 1: 基础数据 ──
      this.logger.log('─── Phase 1: 基础数据 ───')
      await this.safeRun('股票列表', () => this.basicSync.syncStockBasic(), failedTasks)
      await this.safeRun('交易日历', () => this.basicSync.syncTradeCal(), failedTasks)
      await this.safeRun('公司信息', () => this.basicSync.syncStockCompany(), failedTasks)

      // ── Phase 2: 行情数据（需要 targetTradeDate） ──
      if (trigger === 'schedule') {
        const isTradingDay = await this.helper.isTodayTradingDay()
        if (!isTradingDay) {
          this.logger.log('今天不是交易日，跳过盘后同步')
          return
        }
      }

      const targetTradeDate = await this.helper.resolveLatestCompletedTradeDate()
      if (!targetTradeDate) {
        this.logger.warn('未能解析最近已完成的交易日，跳过行情/财务/资金流向同步')
        return
      }
      this.logger.log(`目标交易日: ${targetTradeDate}`)

      this.logger.log('─── Phase 2: 行情数据 ───')
      await this.safeRun('日线行情', () => this.marketSync.syncDaily(targetTradeDate), failedTasks)
      await this.safeRun('周线行情', () => this.marketSync.syncWeekly(targetTradeDate), failedTasks)
      await this.safeRun('月线行情', () => this.marketSync.syncMonthly(targetTradeDate), failedTasks)
      await this.safeRun('每日指标', () => this.marketSync.syncDailyBasic(targetTradeDate), failedTasks)
      await this.safeRun('复权因子', () => this.marketSync.syncAdjFactor(targetTradeDate), failedTasks)
      await this.safeRun('核心指数日线', () => this.marketSync.syncIndexDaily(targetTradeDate), failedTasks)

      // ── Phase 3: 财务数据 ──
      this.logger.log('─── Phase 3: 财务数据 ───')
      await this.safeRun('利润表', () => this.financialSync.syncIncome(), failedTasks)
      await this.safeRun('业绩快报', () => this.financialSync.syncExpress(), failedTasks)
      await this.safeRun('分红数据', () => this.financialSync.syncDividend(), failedTasks)
      await this.safeRun('财务指标', () => this.financialSync.syncFinaIndicator(), failedTasks)
      await this.safeRun('十大股东', () => this.financialSync.syncTop10Holders(), failedTasks)
      await this.safeRun('十大流通股东', () => this.financialSync.syncTop10FloatHolders(), failedTasks)

      // ── Phase 4: 资金流向 ──
      this.logger.log('─── Phase 4: 资金流向 ───')
      await this.safeRun('个股资金流', () => this.moneyflowSync.syncMoneyflowDc(targetTradeDate), failedTasks)
      await this.safeRun('行业资金流', () => this.moneyflowSync.syncMoneyflowIndDc(targetTradeDate), failedTasks)
      await this.safeRun('大盘资金流', () => this.moneyflowSync.syncMoneyflowMktDc(targetTradeDate), failedTasks)
      await this.safeRun('沪深港通资金流', () => this.moneyflowSync.syncMoneyflowHsgt(targetTradeDate), failedTasks)

      // ── Phase 5: 兜底重试 ──
      if (failedTasks.length > 0) {
        this.logger.warn(`═══ ${failedTasks.length} 个任务失败，开始兜底重试 ═══`)
        const stillFailed: string[] = []

        for (const task of failedTasks) {
          try {
            this.logger.log(`重试: ${task.label}`)
            await task.fn()
            this.logger.log(`重试成功: ${task.label}`)
          } catch (error) {
            this.logger.error(`重试仍失败: ${task.label} - ${(error as Error).message}`)
            stillFailed.push(task.label)
          }
        }

        if (stillFailed.length > 0) {
          this.logger.error(`兜底重试后仍有 ${stillFailed.length} 个任务失败: ${stillFailed.join(', ')}`)
        } else {
          this.logger.log('兜底重试全部成功')
        }
      }

      const elapsed = ((Date.now() - pipelineStart) / 1000).toFixed(1)
      this.logger.log(`═══════════════════════════════════════════════════`)
      this.logger.log(`  Tushare ${trigger} 同步完成 (耗时 ${elapsed}s)`)
      this.logger.log(`═══════════════════════════════════════════════════`)
    } catch (error) {
      this.logger.error(`同步流程异常: ${(error as Error).message}`, (error as Error).stack)
    } finally {
      this.running = false
    }
  }

  /**
   * 安全执行一个同步任务：捕获异常并记录，不阻断后续任务
   */
  private async safeRun(label: string, fn: () => Promise<void>, failedTasks: FailedTask[]) {
    try {
      this.logger.log(`▶ ${label}`)
      await fn()
    } catch (error) {
      this.logger.error(`✗ ${label} 失败: ${(error as Error).message}`)
      failedTasks.push({ label, fn, error: error as Error })
    }
  }
}
