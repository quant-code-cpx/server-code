import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import * as dayjs from 'dayjs'
const isoWeek = require('dayjs/plugin/isoWeek')
const timezone = require('dayjs/plugin/timezone')
const utc = require('dayjs/plugin/utc')
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
  TUSHARE_MONEYFLOW_RECENT_TRADE_DAYS,
  TUSHARE_SYNC_CUTOFF_HOUR,
  TUSHARE_SYNC_CUTOFF_MINUTE,
  TushareSyncExecutionStatus,
  TushareSyncTaskName,
} from 'src/constant/tushare.constant'
import { ITushareConfig, TUSHARE_CONFIG_TOKEN } from 'src/config/tushare.config'
import { PrismaService } from 'src/shared/prisma.service'
import { TushareApiError } from '../tushare.service'
import { DailyLikeSyncOptions, TaskExecutionResult } from './tushare-sync.types'

dayjs.extend(utc)
dayjs.extend(timezone)
dayjs.extend(isoWeek)

@Injectable()
export class TushareSyncSupportService {
  private readonly logger = new Logger(TushareSyncSupportService.name)
  readonly syncStartDate: string
  readonly syncTimeZone: string

  constructor(
    readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    const cfg = this.configService.get<ITushareConfig>(TUSHARE_CONFIG_TOKEN, { infer: true })
    if (!cfg) {
      throw new Error('TushareConfig is not registered. Ensure TushareConfig is loaded in ConfigModule.')
    }

    this.syncStartDate = cfg.syncStartDate
    this.syncTimeZone = cfg.syncTimeZone
  }

  /**
   * 通用的“按日期型数据集”补数模板。
   *
   * 适用于：
   * - daily / weekly / monthly / adj_factor / daily_basic 这类可以按日期增量推进的数据；
   * - 通过读取本地最大日期实现断点续跑；
   * - 通过 `resolveDates()` 决定本轮实际要补哪些日期；
   * - 通过 `syncOneDate()` 执行单个日期的抓取与落库。
   *
   * 这类任务通常执行时间较长，因此这里会额外输出阶段性进度日志，
   * 避免长时间只有“开始执行 DAILY...”而没有后续反馈，造成误判为卡死。
   */
  async syncDailyLikeDataset(options: DailyLikeSyncOptions) {
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
      const totalDates = tradeDates.length
      for (const [index, tradeDate] of tradeDates.entries()) {
        if (index === 0 || (index + 1) % 250 === 0 || index === totalDates - 1) {
          this.logger.log(
            `[${options.task}] 补数进度 ${index + 1}/${totalDates}，当前日期 ${tradeDate}，累计写入 ${totalRows} 条。`,
          )
        }

        try {
          totalRows += await options.syncOneDate(tradeDate)
        } catch (error) {
          if (this.isDailyQuotaExceededError(error)) {
            throw error
          }

          throw new Error(`[${options.task}] 同步日期 ${tradeDate} 失败：${(error as Error).message}`)
        }
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

  async executeTask(taskName: TushareSyncTaskName, handler: () => Promise<TaskExecutionResult>) {
    const startedAt = new Date()

    try {
      const result = await handler()
      await this.writeSyncLog(taskName, result, startedAt)

      const level = result.status === TushareSyncExecutionStatus.FAILED ? 'error' : 'log'
      this.logger[level](`[${taskName}] ${result.message}`)
      return result
    } catch (error) {
      if (this.isDailyQuotaExceededError(error)) {
        const result: TaskExecutionResult = {
          status: TushareSyncExecutionStatus.SKIPPED,
          message: `[${error.apiName}] 触发当日访问配额限制，已跳过本次任务：${error.message}`,
          payload: {
            apiName: error.apiName,
            code: error.code,
          },
        }
        await this.writeSyncLog(taskName, result, startedAt)
        this.logger.warn(`[${taskName}] ${result.message}`)
        return result
      }

      const result: TaskExecutionResult = {
        status: TushareSyncExecutionStatus.FAILED,
        message: (error as Error).message,
        payload: { stack: (error as Error).stack ?? null },
      }
      await this.writeSyncLog(taskName, result, startedAt)
      throw error
    }
  }

  async getLatestSuccessfulTaskLog(task: TushareSyncTask) {
    return this.prisma.tushareSyncLog.findFirst({
      where: { task, status: TushareSyncStatus.SUCCESS },
      orderBy: { startedAt: 'desc' },
    })
  }

  async getLatestDateString(modelName: string, fieldName: string = 'tradeDate'): Promise<string | null> {
    const aggregateResult = await (this.prisma as any)[modelName].aggregate({
      _max: { [fieldName]: true },
    })

    const maxDate = aggregateResult?._max?.[fieldName] as Date | null | undefined
    return maxDate ? this.formatDate(maxDate) : null
  }

  async replaceAllRows(modelName: string, data: unknown[]) {
    const model = (this.prisma as any)[modelName]

    if (!data.length) {
      await model.deleteMany()
      return 0
    }

    const [, result] = await this.prisma.$transaction([model.deleteMany(), model.createMany({ data })])
    return result.count as number
  }

  async replaceTradeDateRows(
    modelName: string,
    tradeDate: Date,
    data: unknown[],
    extraWhere: Record<string, unknown> = {},
  ) {
    // 针对单个交易日的幂等覆盖写入：先删该日期旧数据，再整批写入新数据。
    const model = (this.prisma as any)[modelName]
    const deleteArgs = {
      where: {
        tradeDate,
        ...extraWhere,
      },
    }

    if (!data.length) {
      await model.deleteMany(deleteArgs)
      return 0
    }

    const [, result] = await this.prisma.$transaction([model.deleteMany(deleteArgs), model.createMany({ data })])
    return result.count as number
  }

  async replaceDateRangeRows(
    modelName: string,
    fieldName: string,
    startDate: Date,
    endDate: Date,
    data: unknown[],
    extraWhere: Record<string, unknown> = {},
    options: { skipDuplicates?: boolean } = {},
  ) {
    // 针对日期区间的幂等覆盖写入：常用于公告型、窗口型同步任务。
    const model = (this.prisma as any)[modelName]
    const deleteArgs = {
      where: {
        ...extraWhere,
        [fieldName]: {
          gte: startDate,
          lte: endDate,
        },
      },
    }

    if (!data.length) {
      await model.deleteMany(deleteArgs)
      return 0
    }

    const [, result] = await this.prisma.$transaction([
      model.deleteMany(deleteArgs),
      model.createMany({
        data,
        skipDuplicates: options.skipDuplicates,
      }),
    ])
    return result.count as number
  }

  async deleteRowsBeforeDate(
    modelName: string,
    fieldName: string,
    cutoffDate: Date,
    extraWhere: Record<string, unknown> = {},
  ) {
    const model = (this.prisma as any)[modelName]
    const result = await model.deleteMany({
      where: {
        ...extraWhere,
        [fieldName]: {
          lt: cutoffDate,
        },
      },
    })

    return result.count as number
  }

  async getOpenTradeDatesBetween(startDate: string, endDate: string) {
    if (this.compareDateString(startDate, endDate) > 0) {
      return []
    }

    // 统一以 SSE 交易日历驱动 A 股按日数据同步，保证日线/周线/月线推进口径一致。
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

  async getRecentOpenTradeDates(endDate: string, limit: number = TUSHARE_MONEYFLOW_RECENT_TRADE_DAYS) {
    if (limit <= 0) {
      return []
    }

    const rows = await this.prisma.tradeCal.findMany({
      where: {
        exchange: PrismaStockExchange.SSE,
        isOpen: '1',
        calDate: {
          lte: this.toDate(endDate),
        },
      },
      orderBy: { calDate: 'desc' },
      take: limit,
      select: { calDate: true },
    })

    return rows.map((row) => this.formatDate(row.calDate)).reverse()
  }

  async getPeriodEndTradeDates(startDate: string, endDate: string, unit: 'week' | 'month') {
    // 先展开区间内所有开市日，再折叠为“每周最后一个交易日 / 每月最后一个交易日”。
    const openDates = await this.getOpenTradeDatesBetween(startDate, endDate)
    const grouped = new Map<string, string>()

    openDates.forEach((date) => {
      const current = this.getCurrentShanghaiDay(date)
      const key = unit === 'week' ? `${current.isoWeekYear()}-${current.isoWeek()}` : current.format('YYYY-MM')
      grouped.set(key, date)
    })

    return Array.from(grouped.values())
  }

  async resolveLatestCompletedTradeDate() {
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

  async isTodayTradingDay() {
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

  async writeSyncLog(taskName: TushareSyncTaskName, result: TaskExecutionResult, startedAt: Date) {
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

  buildYearlyWindows(startDate: string, endDate: string) {
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

  buildMonthlyWindows(startDate: string, endDate: string) {
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

  getCurrentShanghaiNow() {
    return (dayjs as any)().tz(this.syncTimeZone)
  }

  getCurrentShanghaiDateString() {
    return this.getCurrentShanghaiNow().format('YYYYMMDD')
  }

  getCurrentShanghaiDay(value: string) {
    return (dayjs as any).tz(value, 'YYYYMMDD', this.syncTimeZone)
  }

  toDate(value: string) {
    const year = Number(value.slice(0, 4))
    const month = Number(value.slice(4, 6))
    const day = Number(value.slice(6, 8))

    return new Date(Date.UTC(year, month - 1, day))
  }

  formatDate(value: Date) {
    const year = value.getUTCFullYear()
    const month = String(value.getUTCMonth() + 1).padStart(2, '0')
    const day = String(value.getUTCDate()).padStart(2, '0')

    return `${year}${month}${day}`
  }

  addDays(value: string, days: number) {
    return this.getCurrentShanghaiDay(value).add(days, 'day').format('YYYYMMDD')
  }

  compareDateString(left: string, right: string) {
    const leftDay = this.getCurrentShanghaiDay(left)
    const rightDay = this.getCurrentShanghaiDay(right)

    if (leftDay.isBefore(rightDay, 'day')) return -1
    if (leftDay.isAfter(rightDay, 'day')) return 1
    return 0
  }

  toPrismaExchange(exchange: StockExchange) {
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

  toPrismaMoneyflowContentType(contentType: MoneyflowContentType) {
    switch (contentType) {
      case MoneyflowContentType.INDUSTRY:
        return PrismaMoneyflowContentType.INDUSTRY
      case MoneyflowContentType.CONCEPT:
        return PrismaMoneyflowContentType.CONCEPT
      case MoneyflowContentType.REGION:
        return PrismaMoneyflowContentType.REGION
    }
  }

  private isDailyQuotaExceededError(error: unknown): error is TushareApiError {
    return error instanceof TushareApiError && error.code === 40203 && /(每天|每小时)最多访问该接口/.test(error.message)
  }
}
