import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { SchedulerRegistry } from '@nestjs/schedule'
import dayjs from 'dayjs'
import isoWeek from 'dayjs/plugin/isoWeek'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'
import { CronJob } from 'cron'
import {
  MoneyflowContentType as PrismaMoneyflowContentType,
  Prisma,
  StockExchange as PrismaStockExchange,
  TushareSyncStatus,
  TushareSyncTask,
} from '@prisma/client'
import {
  MoneyflowContentType,
  StockExchange,
  TUSHARE_MONEYFLOW_CONTENT_TYPES,
  TUSHARE_SYNC_CRON,
  TUSHARE_SYNC_CUTOFF_HOUR,
  TUSHARE_SYNC_CUTOFF_MINUTE,
  TUSHARE_SYNC_TIME_ZONE,
  TUSHARE_TRADE_CALENDAR_EXCHANGES,
  TUSHARE_STOCK_LIST_STATUSES,
  TushareSyncExecutionStatus,
  TushareSyncTaskName,
} from 'src/constant/tushare.constant'
import { ITushareConfig, TUSHARE_CONFIG_TOKEN } from 'src/config/tushare.config'
import { PrismaService } from 'src/shared/prisma.service'
import { TushareApiService } from './tushare-api.service'
import {
  mapAdjFactorRecord,
  mapDailyBasicRecord,
  mapDailyRecord,
  mapExpressRecord,
  mapMoneyflowDcRecord,
  mapMoneyflowIndDcRecord,
  mapMoneyflowMktDcRecord,
  mapMonthlyRecord,
  mapStockBasicRecord,
  mapStockCompanyRecord,
  mapTradeCalRecord,
  mapWeeklyRecord,
} from './tushare-sync.mapper'

dayjs.extend(utc)
dayjs.extend(timezone)
dayjs.extend(isoWeek)

interface TaskExecutionResult {
  status: TushareSyncExecutionStatus
  message: string
  tradeDate?: Date
  payload?: Record<string, unknown>
}

/**
 * TushareSyncService
 *
 * 负责两类核心工作：
 * 1. 应用启动后检查各类本地数据是否落后，必要时执行补数；
 * 2. 每个交易日 18:30 自动执行盘后增量同步。
 *
 * 说明：
 * - 交易日判断统一依赖本地 trade_cal 表，若本地缺失则会先同步交易日历；
 * - 为了降低接口限制风险，日线类数据按“单个交易日”抓取并整日替换入库；
 * - 业绩快报按月份窗口补数，避免一次请求跨度过大。
 */
@Injectable()
export class TushareSyncService implements OnApplicationBootstrap {
  private readonly logger = new Logger(TushareSyncService.name)
  private readonly syncEnabled: boolean
  private readonly syncStartDate: string
  private readonly syncTimeZone: string
  private running = false

  constructor(
    private readonly tushareApiService: TushareApiService,
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {
    const cfg = this.configService.get<ITushareConfig>(TUSHARE_CONFIG_TOKEN, { infer: true })
    if (!cfg) {
      throw new Error('TushareConfig is not registered. Ensure TushareConfig is loaded in ConfigModule.')
    }

    this.syncEnabled = cfg.syncEnabled
    this.syncStartDate = cfg.syncStartDate
    this.syncTimeZone = cfg.syncTimeZone
  }

  /** 应用启动后自动触发全量新鲜度检查 */
  async onApplicationBootstrap() {
    if (!this.syncEnabled) {
      this.logger.warn('Tushare 自动同步已关闭，跳过启动检查。')
      return
    }

    this.registerDailySyncJob()
    await this.runPipeline('bootstrap')
  }

  /** 按配置动态注册 Cron，避免绕过 ConfigService。 */
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
      await this.syncTradeCalendarCoverage()

      if (trigger === 'schedule') {
        const todayOpen = await this.isTodayTradingDay()
        if (!todayOpen) {
          this.logger.log('今天不是交易日，跳过盘后自动同步。')
          return
        }
      }

      const latestCompletedTradeDate = await this.resolveLatestCompletedTradeDate()
      if (!latestCompletedTradeDate) {
        this.logger.warn('未能解析最近已完成的交易日，跳过本轮同步。')
        return
      }

      await this.checkStockBasicFreshness()
      await this.checkStockCompanyFreshness()
      await this.checkDailyFreshness(latestCompletedTradeDate)
      await this.checkWeeklyFreshness(latestCompletedTradeDate)
      await this.checkMonthlyFreshness(latestCompletedTradeDate)
      await this.checkAdjFactorFreshness(latestCompletedTradeDate)
      await this.checkDailyBasicFreshness(latestCompletedTradeDate)
      await this.checkMoneyflowFreshness(latestCompletedTradeDate)
      await this.checkExpressFreshness()

      this.logger.log(`Tushare ${trigger} 同步流程执行完成。`)
    } catch (error) {
      this.logger.error(`Tushare 同步流程执行失败: ${(error as Error).message}`, (error as Error).stack)
      throw error
    } finally {
      this.running = false
    }
  }

  // ─────────────────────────────────────────────
  // 新鲜度检测入口
  // ─────────────────────────────────────────────

  async checkStockBasicFreshness() {
    await this.executeTask(TushareSyncTaskName.STOCK_BASIC, async () => {
      const rowCount = await this.prisma.stockBasic.count()
      const latestSuccess = await this.getLatestSuccessfulTaskLog(TushareSyncTask.STOCK_BASIC)
      const todayKey = this.getCurrentShanghaiDateString()

      if (rowCount > 0 && latestSuccess?.startedAt && this.formatDate(latestSuccess.startedAt) === todayKey) {
        return { status: TushareSyncExecutionStatus.SKIPPED, message: '股票列表今天已同步过，无需重复刷新。' }
      }

      const result = await Promise.all(TUSHARE_STOCK_LIST_STATUSES.map((status) => this.tushareApiService.getStockBasic(status)))
      const deduped = new Map<string, ReturnType<typeof mapStockBasicRecord>>()
      result
        .flat()
        .map(mapStockBasicRecord)
        .filter((item): item is NonNullable<typeof item> => Boolean(item))
        .forEach((item) => deduped.set(item.tsCode, item))

      const count = await this.replaceAllRows('stockBasic', Array.from(deduped.values()))
      return {
        status: TushareSyncExecutionStatus.SUCCESS,
        message: `股票列表同步完成，共写入 ${count} 条记录。`,
        payload: { rowCount: count },
      }
    })
  }

  async checkStockCompanyFreshness() {
    await this.executeTask(TushareSyncTaskName.STOCK_COMPANY, async () => {
      const rowCount = await this.prisma.stockCompany.count()
      const latestSuccess = await this.getLatestSuccessfulTaskLog(TushareSyncTask.STOCK_COMPANY)
      const todayKey = this.getCurrentShanghaiDateString()

      if (rowCount > 0 && latestSuccess?.startedAt && this.formatDate(latestSuccess.startedAt) === todayKey) {
        return { status: TushareSyncExecutionStatus.SKIPPED, message: '上市公司基础信息今天已同步过。' }
      }

      const exchanges = [StockExchange.SSE, StockExchange.SZSE, StockExchange.BSE] as const
      const result = await Promise.all(exchanges.map((exchange) => this.tushareApiService.getStockCompany(exchange)))
      const deduped = new Map<string, ReturnType<typeof mapStockCompanyRecord>>()
      result
        .flat()
        .map(mapStockCompanyRecord)
        .filter((item): item is NonNullable<typeof item> => Boolean(item))
        .forEach((item) => deduped.set(item.tsCode, item))

      const count = await this.replaceAllRows('stockCompany', Array.from(deduped.values()))
      return {
        status: TushareSyncExecutionStatus.SUCCESS,
        message: `上市公司基础信息同步完成，共写入 ${count} 条记录。`,
        payload: { rowCount: count },
      }
    })
  }

  async checkDailyFreshness(targetTradeDate: string) {
    await this.syncDailyLikeDataset({
      task: TushareSyncTaskName.DAILY,
      prismaTask: TushareSyncTask.DAILY,
      modelName: 'daily',
      latestLocalDate: () => this.getLatestDateString('daily'),
      resolveDates: (startDate) => this.getOpenTradeDatesBetween(startDate, targetTradeDate),
      syncOneDate: (tradeDate) => this.syncDailyByTradeDate(tradeDate),
      targetTradeDate,
    })
  }

  async checkWeeklyFreshness(targetTradeDate: string) {
    await this.syncDailyLikeDataset({
      task: TushareSyncTaskName.WEEKLY,
      prismaTask: TushareSyncTask.WEEKLY,
      modelName: 'weekly',
      latestLocalDate: () => this.getLatestDateString('weekly'),
      resolveDates: (startDate) => this.getPeriodEndTradeDates(startDate, targetTradeDate, 'week'),
      syncOneDate: (tradeDate) => this.syncWeeklyByTradeDate(tradeDate),
      targetTradeDate,
    })
  }

  async checkMonthlyFreshness(targetTradeDate: string) {
    await this.syncDailyLikeDataset({
      task: TushareSyncTaskName.MONTHLY,
      prismaTask: TushareSyncTask.MONTHLY,
      modelName: 'monthly',
      latestLocalDate: () => this.getLatestDateString('monthly'),
      resolveDates: (startDate) => this.getPeriodEndTradeDates(startDate, targetTradeDate, 'month'),
      syncOneDate: (tradeDate) => this.syncMonthlyByTradeDate(tradeDate),
      targetTradeDate,
    })
  }

  async checkAdjFactorFreshness(targetTradeDate: string) {
    await this.syncDailyLikeDataset({
      task: TushareSyncTaskName.ADJ_FACTOR,
      prismaTask: TushareSyncTask.ADJ_FACTOR,
      modelName: 'adjFactor',
      latestLocalDate: () => this.getLatestDateString('adjFactor'),
      resolveDates: (startDate) => this.getOpenTradeDatesBetween(startDate, targetTradeDate),
      syncOneDate: (tradeDate) => this.syncAdjFactorByTradeDate(tradeDate),
      targetTradeDate,
    })
  }

  async checkDailyBasicFreshness(targetTradeDate: string) {
    await this.syncDailyLikeDataset({
      task: TushareSyncTaskName.DAILY_BASIC,
      prismaTask: TushareSyncTask.DAILY_BASIC,
      modelName: 'dailyBasic',
      latestLocalDate: () => this.getLatestDateString('dailyBasic'),
      resolveDates: (startDate) => this.getOpenTradeDatesBetween(startDate, targetTradeDate),
      syncOneDate: (tradeDate) => this.syncDailyBasicByTradeDate(tradeDate),
      targetTradeDate,
    })
  }

  async checkMoneyflowFreshness(targetTradeDate: string) {
    await this.syncDailyLikeDataset({
      task: TushareSyncTaskName.MONEYFLOW_DC,
      prismaTask: TushareSyncTask.MONEYFLOW_DC,
      modelName: 'moneyflowDc',
      latestLocalDate: () => this.getLatestDateString('moneyflowDc'),
      resolveDates: (startDate) => this.getOpenTradeDatesBetween(startDate, targetTradeDate),
      syncOneDate: (tradeDate) => this.syncMoneyflowDcByTradeDate(tradeDate),
      targetTradeDate,
    })

    await this.syncDailyLikeDataset({
      task: TushareSyncTaskName.MONEYFLOW_IND_DC,
      prismaTask: TushareSyncTask.MONEYFLOW_IND_DC,
      modelName: 'moneyflowIndDc',
      latestLocalDate: () => this.getLatestDateString('moneyflowIndDc'),
      resolveDates: (startDate) => this.getOpenTradeDatesBetween(startDate, targetTradeDate),
      syncOneDate: (tradeDate) => this.syncMoneyflowIndDcByTradeDate(tradeDate),
      targetTradeDate,
    })

    await this.syncDailyLikeDataset({
      task: TushareSyncTaskName.MONEYFLOW_MKT_DC,
      prismaTask: TushareSyncTask.MONEYFLOW_MKT_DC,
      modelName: 'moneyflowMktDc',
      latestLocalDate: () => this.getLatestDateString('moneyflowMktDc'),
      resolveDates: (startDate) => this.getOpenTradeDatesBetween(startDate, targetTradeDate),
      syncOneDate: (tradeDate) => this.syncMoneyflowMktDcByTradeDate(tradeDate),
      targetTradeDate,
    })
  }

  async checkExpressFreshness() {
    await this.executeTask(TushareSyncTaskName.EXPRESS, async () => {
      const latestLocalDate = await this.getLatestDateString('express', 'annDate')
      const rangeStart = latestLocalDate ? this.addDays(latestLocalDate, 1) : this.syncStartDate
      const rangeEnd = this.getCurrentShanghaiDateString()

      if (this.compareDateString(rangeStart, rangeEnd) > 0) {
        return { status: TushareSyncExecutionStatus.SKIPPED, message: '业绩快报已是最新，无需补数。' }
      }

      const windows = this.buildMonthlyWindows(rangeStart, rangeEnd)
      let totalRows = 0
      for (const window of windows) {
        totalRows += await this.syncExpressByDateRange(window.startDate, window.endDate)
      }

      return {
        status: TushareSyncExecutionStatus.SUCCESS,
        message: `业绩快报同步完成，共同步 ${windows.length} 个时间窗口。`,
        payload: { windowCount: windows.length, rowCount: totalRows, startDate: rangeStart, endDate: rangeEnd },
      }
    })
  }

  // ─────────────────────────────────────────────
  // 具体同步动作
  // ─────────────────────────────────────────────

  private async syncTradeCalendarCoverage() {
    await this.executeTask(TushareSyncTaskName.TRADE_CAL, async () => {
      const startDate = this.syncStartDate
      const endDate = this.getCurrentShanghaiNow().add(365, 'day').format('YYYYMMDD')
      const windows = this.buildYearlyWindows(startDate, endDate)
      let totalRows = 0

      for (const exchange of TUSHARE_TRADE_CALENDAR_EXCHANGES) {
        const prismaExchange = this.toPrismaExchange(exchange)
        for (const window of windows) {
          const rows = await this.tushareApiService.getTradeCalendar(exchange, window.startDate, window.endDate)
          const mapped = rows
            .map(mapTradeCalRecord)
            .filter((item): item is NonNullable<typeof item> => Boolean(item))

          totalRows += await this.replaceDateRangeRows(
            'tradeCal',
            'calDate',
            this.toDate(window.startDate),
            this.toDate(window.endDate),
            mapped.filter((item) => item.exchange === prismaExchange),
            { exchange: prismaExchange },
          )
        }
      }

      return {
        status: TushareSyncExecutionStatus.SUCCESS,
        message: `交易日历覆盖区间已刷新：${startDate} ~ ${endDate}`,
        payload: { rowCount: totalRows, startDate, endDate },
      }
    })
  }

  private async syncDailyByTradeDate(tradeDate: string) {
    const rows = await this.tushareApiService.getDailyByTradeDate(tradeDate)
    const mapped = rows.map(mapDailyRecord).filter((item): item is NonNullable<typeof item> => Boolean(item))
    return this.replaceTradeDateRows('daily', this.toDate(tradeDate), mapped)
  }

  private async syncWeeklyByTradeDate(tradeDate: string) {
    const rows = await this.tushareApiService.getWeeklyByTradeDate(tradeDate)
    const mapped = rows.map(mapWeeklyRecord).filter((item): item is NonNullable<typeof item> => Boolean(item))
    return this.replaceTradeDateRows('weekly', this.toDate(tradeDate), mapped)
  }

  private async syncMonthlyByTradeDate(tradeDate: string) {
    const rows = await this.tushareApiService.getMonthlyByTradeDate(tradeDate)
    const mapped = rows.map(mapMonthlyRecord).filter((item): item is NonNullable<typeof item> => Boolean(item))
    return this.replaceTradeDateRows('monthly', this.toDate(tradeDate), mapped)
  }

  private async syncAdjFactorByTradeDate(tradeDate: string) {
    const rows = await this.tushareApiService.getAdjFactorByTradeDate(tradeDate)
    const mapped = rows.map(mapAdjFactorRecord).filter((item): item is NonNullable<typeof item> => Boolean(item))
    return this.replaceTradeDateRows('adjFactor', this.toDate(tradeDate), mapped)
  }

  private async syncDailyBasicByTradeDate(tradeDate: string) {
    const rows = await this.tushareApiService.getDailyBasicByTradeDate(tradeDate)
    const mapped = rows.map(mapDailyBasicRecord).filter((item): item is NonNullable<typeof item> => Boolean(item))
    return this.replaceTradeDateRows('dailyBasic', this.toDate(tradeDate), mapped)
  }

  private async syncMoneyflowDcByTradeDate(tradeDate: string) {
    const rows = await this.tushareApiService.getMoneyflowDcByTradeDate(tradeDate)
    const mapped = rows.map(mapMoneyflowDcRecord).filter((item): item is NonNullable<typeof item> => Boolean(item))
    return this.replaceTradeDateRows('moneyflowDc', this.toDate(tradeDate), mapped)
  }

  private async syncMoneyflowIndDcByTradeDate(tradeDate: string) {
    let totalRows = 0

    for (const contentType of TUSHARE_MONEYFLOW_CONTENT_TYPES) {
      const rows = await this.tushareApiService.getMoneyflowIndDcByTradeDate(tradeDate, contentType)
      const mapped = rows.map(mapMoneyflowIndDcRecord).filter((item): item is NonNullable<typeof item> => Boolean(item))
      totalRows += await this.replaceTradeDateRows(
        'moneyflowIndDc',
        this.toDate(tradeDate),
        mapped,
        { contentType: this.toPrismaMoneyflowContentType(contentType) },
      )
    }

    return totalRows
  }

  private async syncMoneyflowMktDcByTradeDate(tradeDate: string) {
    const rows = await this.tushareApiService.getMoneyflowMktDcByTradeDate(tradeDate)
    const mapped = rows.map(mapMoneyflowMktDcRecord).filter((item): item is NonNullable<typeof item> => Boolean(item))
    return this.replaceTradeDateRows('moneyflowMktDc', this.toDate(tradeDate), mapped)
  }

  private async syncExpressByDateRange(startDate: string, endDate: string) {
    const rows = await this.tushareApiService.getExpress(startDate, endDate)
    const mapped = rows.map(mapExpressRecord).filter((item): item is NonNullable<typeof item> => Boolean(item))
    return this.replaceDateRangeRows('express', 'annDate', this.toDate(startDate), this.toDate(endDate), mapped)
  }

  // ─────────────────────────────────────────────
  // 通用执行 / 入库 / 时间工具
  // ─────────────────────────────────────────────

  private async syncDailyLikeDataset(options: {
    task: TushareSyncTaskName
    prismaTask: TushareSyncTask
    modelName: string
    latestLocalDate: () => Promise<string | null>
    resolveDates: (startDate: string) => Promise<string[]>
    syncOneDate: (tradeDate: string) => Promise<number>
    targetTradeDate: string
  }) {
    await this.executeTask(options.task, async () => {
      const latestLocalDate = await options.latestLocalDate()
      const startDate = latestLocalDate ? this.addDays(latestLocalDate, 1) : this.syncStartDate

      if (this.compareDateString(startDate, options.targetTradeDate) > 0) {
        return {
          status: TushareSyncExecutionStatus.SKIPPED,
          message: `${options.task} 已同步到 ${latestLocalDate ?? options.targetTradeDate}，无需更新。`,
        }
      }

      const tradeDates = await options.resolveDates(startDate)
      if (!tradeDates.length) {
        return {
          status: TushareSyncExecutionStatus.SKIPPED,
          message: `${options.task} 在 ${startDate} ~ ${options.targetTradeDate} 间没有需要同步的交易日。`,
        }
      }

      let totalRows = 0
      for (const tradeDate of tradeDates) {
        totalRows += await options.syncOneDate(tradeDate)
      }

      return {
        status: TushareSyncExecutionStatus.SUCCESS,
        message: `${options.task} 已同步至 ${tradeDates[tradeDates.length - 1]}。`,
        tradeDate: this.toDate(tradeDates[tradeDates.length - 1]),
        payload: {
          rowCount: totalRows,
          dateCount: tradeDates.length,
          startDate: tradeDates[0],
          endDate: tradeDates[tradeDates.length - 1],
        },
      }
    })
  }

  private async executeTask(taskName: TushareSyncTaskName, handler: () => Promise<TaskExecutionResult>) {
    const startedAt = new Date()

    try {
      const result = await handler()
      await this.writeSyncLog(taskName, result, startedAt)

      const level = result.status === TushareSyncExecutionStatus.FAILED ? 'error' : 'log'
      this.logger[level](`[${taskName}] ${result.message}`)
      return result
    } catch (error) {
      const result: TaskExecutionResult = {
        status: TushareSyncExecutionStatus.FAILED,
        message: (error as Error).message,
        payload: { stack: (error as Error).stack ?? null },
      }
      await this.writeSyncLog(taskName, result, startedAt)
      throw error
    }
  }

  private async writeSyncLog(taskName: TushareSyncTaskName, result: TaskExecutionResult, startedAt: Date) {
    await this.prisma.tushareSyncLog.create({
      data: {
        task: TushareSyncTask[taskName],
        status: TushareSyncStatus[result.status],
        tradeDate: result.tradeDate,
        message: result.message,
        payload: (result.payload ?? undefined) as Prisma.InputJsonValue | undefined,
        startedAt,
        finishedAt: new Date(),
      },
    })
  }

  private async getLatestSuccessfulTaskLog(task: TushareSyncTask) {
    return this.prisma.tushareSyncLog.findFirst({
      where: { task, status: TushareSyncStatus.SUCCESS },
      orderBy: { startedAt: 'desc' },
    })
  }

  private async getLatestDateString(modelName: string, fieldName: string = 'tradeDate'): Promise<string | null> {
    const aggregateResult = await (this.prisma as any)[modelName].aggregate({
      _max: { [fieldName]: true },
    })

    const maxDate = aggregateResult?._max?.[fieldName] as Date | null | undefined
    return maxDate ? this.formatDate(maxDate) : null
  }

  private async replaceAllRows(modelName: string, data: unknown[]) {
    return this.prisma.$transaction(async (tx) => {
      await (tx as any)[modelName].deleteMany()
      if (!data.length) {
        return 0
      }

      const result = await (tx as any)[modelName].createMany({ data })
      return result.count as number
    })
  }

  private async replaceTradeDateRows(
    modelName: string,
    tradeDate: Date,
    data: unknown[],
    extraWhere: Record<string, unknown> = {},
  ) {
    return this.prisma.$transaction(async (tx) => {
      await (tx as any)[modelName].deleteMany({
        where: {
          tradeDate,
          ...extraWhere,
        },
      })

      if (!data.length) {
        return 0
      }

      const result = await (tx as any)[modelName].createMany({ data })
      return result.count as number
    })
  }

  private async replaceDateRangeRows(
    modelName: string,
    fieldName: string,
    startDate: Date,
    endDate: Date,
    data: unknown[],
    extraWhere: Record<string, unknown> = {},
  ) {
    return this.prisma.$transaction(async (tx) => {
      await (tx as any)[modelName].deleteMany({
        where: {
          ...extraWhere,
          [fieldName]: {
            gte: startDate,
            lte: endDate,
          },
        },
      })

      if (!data.length) {
        return 0
      }

      const result = await (tx as any)[modelName].createMany({ data })
      return result.count as number
    })
  }

  private async getOpenTradeDatesBetween(startDate: string, endDate: string) {
    if (this.compareDateString(startDate, endDate) > 0) {
      return []
    }

    const rows = await this.prisma.tradeCal.findMany({
      where: {
        exchange: PrismaStockExchange.SSE,
        isOpen: '1',
        calDate: {
          gte: this.toDate(startDate),
          lte: this.toDate(endDate),
        },
      },
      orderBy: { calDate: 'asc' },
      select: { calDate: true },
    })

    return rows.map((row) => this.formatDate(row.calDate))
  }

  private async getPeriodEndTradeDates(startDate: string, endDate: string, unit: 'week' | 'month') {
    const openDates = await this.getOpenTradeDatesBetween(startDate, endDate)
    const grouped = new Map<string, string>()

    openDates.forEach((date) => {
      const current = this.getCurrentShanghaiDay(date)
      const key = unit === 'week' ? `${current.isoWeekYear()}-${current.isoWeek()}` : current.format('YYYY-MM')
      grouped.set(key, date)
    })

    return Array.from(grouped.values())
  }

  private async resolveLatestCompletedTradeDate() {
    const now = this.getCurrentShanghaiNow()
    const todayDate = now.format('YYYYMMDD')
    const todayCalendar = await this.prisma.tradeCal.findUnique({
      where: {
        exchange_calDate: {
          exchange: PrismaStockExchange.SSE,
          calDate: this.toDate(todayDate),
        },
      },
    })

    if (todayCalendar?.isOpen === '1') {
      const passedCutoff =
        now.hour() > TUSHARE_SYNC_CUTOFF_HOUR ||
        (now.hour() === TUSHARE_SYNC_CUTOFF_HOUR && now.minute() >= TUSHARE_SYNC_CUTOFF_MINUTE)

      if (passedCutoff) {
        return todayDate
      }

      return todayCalendar.pretradeDate ? this.formatDate(todayCalendar.pretradeDate) : null
    }

    if (todayCalendar?.pretradeDate) {
      return this.formatDate(todayCalendar.pretradeDate)
    }

    const latestOpenDate = await this.prisma.tradeCal.findFirst({
      where: {
        exchange: PrismaStockExchange.SSE,
        isOpen: '1',
        calDate: { lte: this.toDate(todayDate) },
      },
      orderBy: { calDate: 'desc' },
      select: { calDate: true },
    })

    return latestOpenDate ? this.formatDate(latestOpenDate.calDate) : null
  }

  private async isTodayTradingDay() {
    const todayDate = this.getCurrentShanghaiDateString()
    const calendar = await this.prisma.tradeCal.findUnique({
      where: {
        exchange_calDate: {
          exchange: PrismaStockExchange.SSE,
          calDate: this.toDate(todayDate),
        },
      },
    })

    return calendar?.isOpen === '1'
  }

  private buildYearlyWindows(startDate: string, endDate: string) {
    const windows: Array<{ startDate: string; endDate: string }> = []
    let cursor = this.getCurrentShanghaiDay(startDate)
    const end = this.getCurrentShanghaiDay(endDate)

    while (cursor.isBefore(end) || cursor.isSame(end, 'day')) {
      const windowStart = cursor
      const windowEnd = cursor.endOf('year').isAfter(end) ? end : cursor.endOf('year')

      windows.push({
        startDate: windowStart.format('YYYYMMDD'),
        endDate: windowEnd.format('YYYYMMDD'),
      })

      cursor = windowEnd.add(1, 'day')
    }

    return windows
  }

  private buildMonthlyWindows(startDate: string, endDate: string) {
    const windows: Array<{ startDate: string; endDate: string }> = []
    let cursor = this.getCurrentShanghaiDay(startDate).startOf('month')
    const end = this.getCurrentShanghaiDay(endDate)

    while (cursor.isBefore(end) || cursor.isSame(end, 'day')) {
      const windowStart = cursor.isBefore(this.getCurrentShanghaiDay(startDate))
        ? this.getCurrentShanghaiDay(startDate)
        : cursor
      const rawEnd = cursor.endOf('month')
      const windowEnd = rawEnd.isAfter(end) ? end : rawEnd

      windows.push({
        startDate: windowStart.format('YYYYMMDD'),
        endDate: windowEnd.format('YYYYMMDD'),
      })

      cursor = cursor.add(1, 'month')
    }

    return windows
  }

  private getCurrentShanghaiNow() {
    return dayjs().tz(this.syncTimeZone)
  }

  private getCurrentShanghaiDateString() {
    return this.getCurrentShanghaiNow().format('YYYYMMDD')
  }

  private getCurrentShanghaiDay(value: string) {
    return dayjs.tz(value, 'YYYYMMDD', this.syncTimeZone)
  }

  private toDate(value: string) {
    return this.getCurrentShanghaiDay(value).toDate()
  }

  private formatDate(value: Date) {
    return dayjs(value).tz(this.syncTimeZone).format('YYYYMMDD')
  }

  private addDays(value: string, days: number) {
    return this.getCurrentShanghaiDay(value).add(days, 'day').format('YYYYMMDD')
  }

  private compareDateString(left: string, right: string) {
    const leftDay = this.getCurrentShanghaiDay(left)
    const rightDay = this.getCurrentShanghaiDay(right)

    if (leftDay.isBefore(rightDay, 'day')) return -1
    if (leftDay.isAfter(rightDay, 'day')) return 1
    return 0
  }

  private toPrismaExchange(exchange: StockExchange) {
    switch (exchange) {
      case StockExchange.SSE:
        return PrismaStockExchange.SSE
      case StockExchange.SZSE:
        return PrismaStockExchange.SZSE
      case StockExchange.BSE:
        return PrismaStockExchange.BSE
      case StockExchange.HKEX:
        return PrismaStockExchange.HKEX
    }
  }

  private toPrismaMoneyflowContentType(contentType: MoneyflowContentType) {
    switch (contentType) {
      case MoneyflowContentType.INDUSTRY:
        return PrismaMoneyflowContentType.INDUSTRY
      case MoneyflowContentType.CONCEPT:
        return PrismaMoneyflowContentType.CONCEPT
      case MoneyflowContentType.REGION:
        return PrismaMoneyflowContentType.REGION
    }
  }
}
