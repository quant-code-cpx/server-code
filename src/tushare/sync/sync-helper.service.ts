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
  TushareSyncProgressStatus,
  TushareSyncRetryStatus,
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
import { CACHE_KEY_PREFIX, CACHE_NAMESPACE, CACHE_TTL_SECONDS } from 'src/constant/cache.constant'
import { BusinessException } from 'src/common/exceptions/business.exception'
import { ErrorEnum } from 'src/constant/response-code.constant'
import { CacheService } from 'src/shared/cache.service'
import { ITushareConfig, TUSHARE_CONFIG_TOKEN } from 'src/config/tushare.config'
import { PrismaService } from 'src/shared/prisma.service'

dayjs.extend(utc)
dayjs.extend(timezone)
dayjs.extend(isoWeek)

interface SyncLogPayload {
  status: TushareSyncExecutionStatus
  message: string
  tradeDate?: Date
  payload?: Record<string, unknown>
}

/**
 * SyncHelperService — 同步通用工具
 *
 * 提供日期运算、交易日历查询、批量数据库操作、同步日志读写等基础能力，
 * 供各分类同步服务调用。
 */
@Injectable()
export class SyncHelperService {
  private readonly logger = new Logger(SyncHelperService.name)
  readonly syncStartDate: string
  readonly syncTimeZone: string
  readonly prisma: PrismaService

  constructor(
    prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly cacheService: CacheService,
  ) {
    this.prisma = prisma
    const cfg = this.configService.get<ITushareConfig>(TUSHARE_CONFIG_TOKEN, { infer: true })
    if (!cfg) {
      throw new BusinessException(ErrorEnum.TUSHARE_CONFIG_MISSING)
    }
    this.syncStartDate = cfg.syncStartDate
    this.syncTimeZone = cfg.syncTimeZone
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 同步日志
  // ═══════════════════════════════════════════════════════════════════════════

  /** 检查某个任务今天（上海时区）是否已成功同步过 */
  async isTaskSyncedToday(task: TushareSyncTaskName): Promise<boolean> {
    const todayStr = this.getCurrentShanghaiDateString()
    const log = await this.prisma.tushareSyncLog.findFirst({
      where: {
        task: TushareSyncTask[task],
        status: TushareSyncStatus.SUCCESS,
      },
      orderBy: { startedAt: 'desc' },
    })
    if (!log) return false
    const logDate = (dayjs as any)(log.startedAt).tz(this.syncTimeZone).format('YYYYMMDD')
    return logDate === todayStr
  }

  /** 检查某个任务是否已成功同步到指定交易日（按 sync log.tradeDate 判断） */
  async isTaskSyncedForTradeDate(task: TushareSyncTaskName, tradeDate: string): Promise<boolean> {
    const log = await this.prisma.tushareSyncLog.findFirst({
      where: {
        task: TushareSyncTask[task],
        status: TushareSyncStatus.SUCCESS,
        tradeDate: this.toDate(tradeDate),
      },
      orderBy: { startedAt: 'desc' },
    })

    return Boolean(log)
  }

  /** 写入同步日志 */
  async writeSyncLog(task: TushareSyncTaskName, result: SyncLogPayload, startedAt: Date) {
    await this.prisma.tushareSyncLog.create({
      data: {
        task: TushareSyncTask[task],
        status: TushareSyncStatus[result.status],
        tradeDate: result.tradeDate,
        message: result.message,
        payload: (result.payload ?? undefined) as Prisma.InputJsonValue | undefined,
        startedAt,
        finishedAt: new Date(),
      },
    })
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 数据库通用操作
  // ═══════════════════════════════════════════════════════════════════════════

  /** 获取某个模型的某个日期字段的最大值（返回 YYYYMMDD 字符串） */
  async getLatestDateString(modelName: string, fieldName = 'tradeDate'): Promise<string | null> {
    const result = await (this.prisma as any)[modelName].aggregate({
      _max: { [fieldName]: true },
    })
    const maxDate = result?._max?.[fieldName] as Date | null | undefined
    return maxDate ? this.formatDate(maxDate) : null
  }

  /** 全量替换：先删后插 */
  async replaceAllRows(modelName: string, data: unknown[]): Promise<number> {
    const model = (this.prisma as any)[modelName]
    if (!data.length) {
      await model.deleteMany()
      return 0
    }
    const [, result] = await this.prisma.$transaction([model.deleteMany(), model.createMany({ data })])
    return result.count as number
  }

  /** 按交易日幂等覆盖 */
  async replaceTradeDateRows(
    modelName: string,
    tradeDate: Date,
    data: unknown[],
    extraWhere: Record<string, unknown> = {},
  ): Promise<number> {
    const model = (this.prisma as any)[modelName]
    const deleteArgs = { where: { tradeDate, ...extraWhere } }
    if (!data.length) {
      await model.deleteMany(deleteArgs)
      return 0
    }
    const [, result] = await this.prisma.$transaction([model.deleteMany(deleteArgs), model.createMany({ data })])
    return result.count as number
  }

  /** 按日期区间幂等覆盖 */
  async replaceDateRangeRows(
    modelName: string,
    fieldName: string,
    startDate: Date,
    endDate: Date,
    data: unknown[],
    extraWhere: Record<string, unknown> = {},
    options: { skipDuplicates?: boolean } = {},
  ): Promise<number> {
    const model = (this.prisma as any)[modelName]
    const deleteArgs = {
      where: { ...extraWhere, [fieldName]: { gte: startDate, lte: endDate } },
    }
    if (!data.length) {
      await model.deleteMany(deleteArgs)
      return 0
    }
    const [, result] = await this.prisma.$transaction([
      model.deleteMany(deleteArgs),
      model.createMany({ data, skipDuplicates: options.skipDuplicates }),
    ])
    return result.count as number
  }

  /** 删除早于截止日期的数据 */
  async deleteRowsBeforeDate(
    modelName: string,
    fieldName: string,
    cutoffDate: Date,
    extraWhere: Record<string, unknown> = {},
  ): Promise<number> {
    const model = (this.prisma as any)[modelName]
    const result = await model.deleteMany({
      where: { ...extraWhere, [fieldName]: { lt: cutoffDate } },
    })
    return result.count as number
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 交易日历查询
  // ═══════════════════════════════════════════════════════════════════════════

  /** 获取区间内所有开市交易日（SSE，升序） */
  async getOpenTradeDatesBetween(startDate: string, endDate: string): Promise<string[]> {
    if (this.compareDateString(startDate, endDate) > 0) return []

    return this.cacheService.rememberJson({
      namespace: CACHE_NAMESPACE.TRADE_CALENDAR,
      key: this.cacheService.buildKey(CACHE_KEY_PREFIX.TRADE_CALENDAR_OPEN_RANGE, { startDate, endDate }),
      ttlSeconds: CACHE_TTL_SECONDS.TRADE_CALENDAR,
      loader: async () => {
        const rows = await this.prisma.tradeCal.findMany({
          where: {
            exchange: PrismaStockExchange.SSE,
            isOpen: '1',
            calDate: { gte: this.toDate(startDate), lte: this.toDate(endDate) },
          },
          orderBy: { calDate: 'asc' },
          select: { calDate: true },
        })
        return rows.map((r) => this.formatDate(r.calDate))
      },
    })
  }

  /** 获取最近 N 个开市交易日（SSE，升序） */
  async getRecentOpenTradeDates(endDate: string, limit: number): Promise<string[]> {
    if (limit <= 0) return []

    return this.cacheService.rememberJson({
      namespace: CACHE_NAMESPACE.TRADE_CALENDAR,
      key: this.cacheService.buildKey(CACHE_KEY_PREFIX.TRADE_CALENDAR_RECENT_OPEN, { endDate, limit }),
      ttlSeconds: CACHE_TTL_SECONDS.TRADE_CALENDAR,
      loader: async () => {
        const rows = await this.prisma.tradeCal.findMany({
          where: {
            exchange: PrismaStockExchange.SSE,
            isOpen: '1',
            calDate: { lte: this.toDate(endDate) },
          },
          orderBy: { calDate: 'desc' },
          take: limit,
          select: { calDate: true },
        })
        return rows.map((r) => this.formatDate(r.calDate)).reverse()
      },
    })
  }

  /** 获取区间内每周/每月最后一个交易日 */
  async getPeriodEndTradeDates(startDate: string, endDate: string, unit: 'week' | 'month'): Promise<string[]> {
    const openDates = await this.getOpenTradeDatesBetween(startDate, endDate)
    const grouped = new Map<string, string>()
    openDates.forEach((date) => {
      const d = this.getCurrentShanghaiDay(date)
      const key = unit === 'week' ? `${d.isoWeekYear()}-${d.isoWeek()}` : d.format('YYYY-MM')
      grouped.set(key, date)
    })
    return Array.from(grouped.values())
  }

  /** 解析最近一个已完成收盘的交易日（适用于盘后同步） */
  async resolveLatestCompletedTradeDate(): Promise<string | null> {
    const todayDate = this.getCurrentShanghaiDateString()
    const passedCutoff = this.hasPassedSyncCutoff()

    return this.cacheService.rememberJson({
      namespace: CACHE_NAMESPACE.TRADE_CALENDAR,
      key: this.cacheService.buildKey(CACHE_KEY_PREFIX.TRADE_CALENDAR_LATEST_COMPLETED, {
        todayDate,
        passedCutoff,
      }),
      ttlSeconds: CACHE_TTL_SECONDS.TRADE_CALENDAR,
      loader: async () => {
        const todaCal = await this.prisma.tradeCal.findUnique({
          where: {
            exchange_calDate: {
              exchange: PrismaStockExchange.SSE,
              calDate: this.toDate(todayDate),
            },
          },
        })

        if (todaCal?.isOpen === '1') {
          if (passedCutoff) return todayDate
          return todaCal.pretradeDate ? this.formatDate(todaCal.pretradeDate) : null
        }

        if (todaCal?.pretradeDate) return this.formatDate(todaCal.pretradeDate)

        const latest = await this.prisma.tradeCal.findFirst({
          where: {
            exchange: PrismaStockExchange.SSE,
            isOpen: '1',
            calDate: { lte: this.toDate(todayDate) },
          },
          orderBy: { calDate: 'desc' },
          select: { calDate: true },
        })
        return latest ? this.formatDate(latest.calDate) : null
      },
    })
  }

  /** 今天是否为交易日 */
  async isTodayTradingDay(): Promise<boolean> {
    const todayDate = this.getCurrentShanghaiDateString()

    return this.cacheService.rememberJson({
      namespace: CACHE_NAMESPACE.TRADE_CALENDAR,
      key: this.cacheService.buildKey(CACHE_KEY_PREFIX.TRADE_CALENDAR_IS_TODAY_TRADING, { todayDate }),
      ttlSeconds: CACHE_TTL_SECONDS.TRADE_CALENDAR,
      loader: async () => {
        const cal = await this.prisma.tradeCal.findUnique({
          where: {
            exchange_calDate: {
              exchange: PrismaStockExchange.SSE,
              calDate: this.toDate(todayDate),
            },
          },
        })
        return cal?.isOpen === '1'
      },
    })
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 日期工具
  // ═══════════════════════════════════════════════════════════════════════════

  getCurrentShanghaiNow() {
    return (dayjs as any)().tz(this.syncTimeZone)
  }

  getCurrentShanghaiDateString(): string {
    return this.getCurrentShanghaiNow().format('YYYYMMDD')
  }

  private hasPassedSyncCutoff(now = this.getCurrentShanghaiNow()): boolean {
    return (
      now.hour() > TUSHARE_SYNC_CUTOFF_HOUR ||
      (now.hour() === TUSHARE_SYNC_CUTOFF_HOUR && now.minute() >= TUSHARE_SYNC_CUTOFF_MINUTE)
    )
  }

  getCurrentShanghaiDay(value: string) {
    return (dayjs as any).tz(value, 'YYYYMMDD', this.syncTimeZone)
  }

  /** YYYYMMDD → Date (UTC 表示) */
  toDate(value: string): Date {
    const y = Number(value.slice(0, 4))
    const m = Number(value.slice(4, 6))
    const d = Number(value.slice(6, 8))
    return new Date(Date.UTC(y, m - 1, d))
  }

  /** Date → YYYYMMDD (UTC 表示) */
  formatDate(value: Date): string {
    const y = value.getUTCFullYear()
    const m = String(value.getUTCMonth() + 1).padStart(2, '0')
    const d = String(value.getUTCDate()).padStart(2, '0')
    return `${y}${m}${d}`
  }

  addDays(value: string, days: number): string {
    return this.getCurrentShanghaiDay(value).add(days, 'day').format('YYYYMMDD')
  }

  compareDateString(left: string, right: string): number {
    const l = this.getCurrentShanghaiDay(left)
    const r = this.getCurrentShanghaiDay(right)
    if (l.isBefore(r, 'day')) return -1
    if (l.isAfter(r, 'day')) return 1
    return 0
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 时间窗口构建
  // ═══════════════════════════════════════════════════════════════════════════

  /** 按年拆分时间窗口（用于交易日历批量查询） */
  buildYearlyWindows(startDate: string, endDate: string): Array<{ startDate: string; endDate: string }> {
    const windows: Array<{ startDate: string; endDate: string }> = []
    let cursor = this.getCurrentShanghaiDay(startDate)
    const end = this.getCurrentShanghaiDay(endDate)
    while (cursor.isBefore(end) || cursor.isSame(end, 'day')) {
      const windowEnd = cursor.endOf('year').isAfter(end) ? end : cursor.endOf('year')
      windows.push({ startDate: cursor.format('YYYYMMDD'), endDate: windowEnd.format('YYYYMMDD') })
      cursor = windowEnd.add(1, 'day')
    }
    return windows
  }

  /** 按月拆分时间窗口 */
  buildMonthlyWindows(startDate: string, endDate: string): Array<{ startDate: string; endDate: string }> {
    const windows: Array<{ startDate: string; endDate: string }> = []
    let cursor = this.getCurrentShanghaiDay(startDate).startOf('month')
    const end = this.getCurrentShanghaiDay(endDate)
    while (cursor.isBefore(end) || cursor.isSame(end, 'day')) {
      const windowStart = cursor.isBefore(this.getCurrentShanghaiDay(startDate))
        ? this.getCurrentShanghaiDay(startDate)
        : cursor
      const rawEnd = cursor.endOf('month')
      const windowEnd = rawEnd.isAfter(end) ? end : rawEnd
      windows.push({ startDate: windowStart.format('YYYYMMDD'), endDate: windowEnd.format('YYYYMMDD') })
      cursor = cursor.add(1, 'month')
    }
    return windows
  }

  /**
   * 构建从 latestEndDate 之后到当前季度的所有季度期末日期
   * 格式: YYYYMMDD (如 20231231, 20240331 ...)
   */
  buildPendingQuarterPeriods(latestEndDate: string | null): string[] {
    const QUARTER_ENDS: Record<number, string> = { 1: '0331', 2: '0630', 3: '0930', 4: '1231' }
    const now = this.getCurrentShanghaiNow()
    const currentYear = now.year()
    const currentQuarter = Math.ceil((now.month() + 1) / 3)

    let startYear: number
    let startQuarter: number

    if (!latestEndDate) {
      startYear = parseInt(this.syncStartDate.slice(0, 4))
      startQuarter = 1
    } else {
      const y = parseInt(latestEndDate.slice(0, 4))
      const m = parseInt(latestEndDate.slice(4, 6))
      const q = Math.ceil(m / 3)
      if (q < 4) {
        startYear = y
        startQuarter = q + 1
      } else {
        startYear = y + 1
        startQuarter = 1
      }
    }

    const periods: string[] = []
    for (let y = startYear; y <= currentYear; y++) {
      const sQ = y === startYear ? startQuarter : 1
      const eQ = y === currentYear ? currentQuarter : 4
      for (let q = sQ; q <= eQ; q++) {
        periods.push(`${y}${QUARTER_ENDS[q]}`)
      }
    }
    return periods
  }

  /** 构建最近 N 年的季度期末日期集合（按自然季度） */
  buildRecentQuarterPeriods(years: number): string[] {
    const QUARTER_ENDS: Record<number, string> = { 1: '0331', 2: '0630', 3: '0930', 4: '1231' }
    const now = this.getCurrentShanghaiNow()
    const currentYear = now.year()
    const currentQuarter = Math.ceil((now.month() + 1) / 3)
    const startYear = currentYear - years + 1
    const periods: string[] = []

    for (let year = startYear; year <= currentYear; year++) {
      const endQuarter = year === currentYear ? currentQuarter : 4
      for (let quarter = 1; quarter <= endQuarter; quarter++) {
        periods.push(`${year}${QUARTER_ENDS[quarter]}`)
      }
    }

    return periods
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 枚举映射
  // ═══════════════════════════════════════════════════════════════════════════

  toPrismaExchange(exchange: StockExchange): PrismaStockExchange {
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

  toPrismaMoneyflowContentType(ct: MoneyflowContentType): PrismaMoneyflowContentType {
    switch (ct) {
      case MoneyflowContentType.INDUSTRY:
        return PrismaMoneyflowContentType.INDUSTRY
      case MoneyflowContentType.CONCEPT:
        return PrismaMoneyflowContentType.CONCEPT
      case MoneyflowContentType.REGION:
        return PrismaMoneyflowContentType.REGION
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 断点续传进度管理
  // ═══════════════════════════════════════════════════════════════════════════

  /** 获取任务断点键（上次成功完成的分片键），不存在则返回 null */
  async getResumeKey(task: TushareSyncTaskName): Promise<string | null> {
    const record = await this.prisma.tushareSyncProgress.findUnique({
      where: { task: TushareSyncTask[task] },
      select: { lastSuccessKey: true, status: true },
    })
    // 仅当状态为 RUNNING（上次未完成）时才返回断点键，否则视为全新
    if (record?.status === TushareSyncProgressStatus.RUNNING && record.lastSuccessKey) {
      return record.lastSuccessKey
    }
    return null
  }

  /** 更新同步进度：记录最后成功分片键和已完成分片数 */
  async updateProgress(task: TushareSyncTaskName, lastSuccessKey: string, completedKeys: number, totalKeys?: number) {
    await this.prisma.tushareSyncProgress.upsert({
      where: { task: TushareSyncTask[task] },
      create: {
        task: TushareSyncTask[task],
        lastSuccessKey,
        completedKeys,
        totalKeys: totalKeys ?? null,
        status: TushareSyncProgressStatus.RUNNING,
      },
      update: {
        lastSuccessKey,
        completedKeys,
        ...(totalKeys !== undefined ? { totalKeys } : {}),
        status: TushareSyncProgressStatus.RUNNING,
      },
    })
  }

  /** 标记任务为已完成，清除断点 */
  async markCompleted(task: TushareSyncTaskName) {
    await this.prisma.tushareSyncProgress.upsert({
      where: { task: TushareSyncTask[task] },
      create: {
        task: TushareSyncTask[task],
        lastSuccessKey: null,
        completedKeys: 0,
        status: TushareSyncProgressStatus.COMPLETED,
      },
      update: {
        lastSuccessKey: null,
        status: TushareSyncProgressStatus.COMPLETED,
      },
    })
  }

  /** 重置断点（供全量同步时使用，清除历史进度） */
  async resetProgress(task: TushareSyncTaskName) {
    await this.prisma.tushareSyncProgress.upsert({
      where: { task: TushareSyncTask[task] },
      create: {
        task: TushareSyncTask[task],
        lastSuccessKey: null,
        completedKeys: 0,
        status: TushareSyncProgressStatus.IDLE,
      },
      update: {
        lastSuccessKey: null,
        completedKeys: 0,
        totalKeys: null,
        status: TushareSyncProgressStatus.IDLE,
      },
    })
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 失败重试队列
  // ═══════════════════════════════════════════════════════════════════════════

  /** 将失败分片入队重试（指数退避：5min / 30min / 2h） */
  async enqueueRetry(task: TushareSyncTaskName, failedKey: string | null, errorMessage: string) {
    const RETRY_DELAYS_MS = [5 * 60 * 1000, 30 * 60 * 1000, 2 * 60 * 60 * 1000]
    // 查询该任务+分片当前的重试记录
    const existing = await this.prisma.tushareSyncRetryQueue.findFirst({
      where: {
        task: TushareSyncTask[task],
        failedKey: failedKey ?? null,
        status: { in: [TushareSyncRetryStatus.PENDING, TushareSyncRetryStatus.RETRYING] },
      },
      orderBy: { createdAt: 'desc' },
    })

    if (existing) {
      // 已有待重试记录，更新错误信息和下次重试时间
      const delayMs = RETRY_DELAYS_MS[Math.min(existing.retryCount, RETRY_DELAYS_MS.length - 1)]
      await this.prisma.tushareSyncRetryQueue.update({
        where: { id: existing.id },
        data: {
          errorMessage,
          status: TushareSyncRetryStatus.PENDING,
          nextRetryAt: new Date(Date.now() + delayMs),
        },
      })
      return
    }

    // 新建重试记录
    const delayMs = RETRY_DELAYS_MS[0]
    await this.prisma.tushareSyncRetryQueue.create({
      data: {
        task: TushareSyncTask[task],
        failedKey: failedKey ?? null,
        errorMessage,
        retryCount: 0,
        maxRetries: 3,
        nextRetryAt: new Date(Date.now() + delayMs),
        status: TushareSyncRetryStatus.PENDING,
      },
    })
  }
}
