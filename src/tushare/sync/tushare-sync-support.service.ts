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
  TUSHARE_SYNC_CUTOFF_HOUR,
  TUSHARE_SYNC_CUTOFF_MINUTE,
  TushareSyncExecutionStatus,
  TushareSyncTaskName,
} from 'src/constant/tushare.constant'
import { ITushareConfig, TUSHARE_CONFIG_TOKEN } from 'src/config/tushare.config'
import { PrismaService } from 'src/shared/prisma.service'
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

  async executeTask(taskName: TushareSyncTaskName, handler: () => Promise<TaskExecutionResult>) {
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
    return this.prisma.$transaction(async (tx) => {
      await (tx as any)[modelName].deleteMany()
      if (!data.length) {
        return 0
      }

      const result = await (tx as any)[modelName].createMany({ data })
      return result.count as number
    })
  }

  async replaceTradeDateRows(
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

  async replaceDateRangeRows(
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

  async getOpenTradeDatesBetween(startDate: string, endDate: string) {
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

  async getPeriodEndTradeDates(startDate: string, endDate: string, unit: 'week' | 'month') {
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
    return this.getCurrentShanghaiDay(value).toDate()
  }

  formatDate(value: Date) {
    return (dayjs(value) as any).tz(this.syncTimeZone).format('YYYYMMDD')
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
}
