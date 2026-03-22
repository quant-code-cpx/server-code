import { Injectable, Logger } from '@nestjs/common'
import { TushareSyncExecutionStatus, TushareSyncTaskName } from 'src/constant/tushare.constant'
import { TushareApiService } from '../tushare-api.service'
import { mapDividendRecord, mapExpressRecord } from '../tushare-sync.mapper'
import { TushareSyncSupportService } from './tushare-sync-support.service'
import { TushareSyncPlanItem } from './tushare-sync.types'

@Injectable()
export class TushareFinancialPerformanceSyncService {
  private readonly logger = new Logger(TushareFinancialPerformanceSyncService.name)

  constructor(
    private readonly tushareApiService: TushareApiService,
    private readonly support: TushareSyncSupportService,
  ) {}

  getSyncPlan(): TushareSyncPlanItem[] {
    return [
      {
        task: TushareSyncTaskName.EXPRESS,
        category: 'financial-performance',
        stage: 'afterTradeDate',
        run: async () => this.checkExpressFreshness(),
      },
      {
        task: TushareSyncTaskName.DIVIDEND,
        category: 'financial-performance',
        stage: 'afterTradeDate',
        run: async () => this.checkDividendFreshness(),
      },
    ]
  }

  // ─── Express ─────────────────────────────────────────────────────────────────

  async checkExpressFreshness() {
    await this.support.executeTask(TushareSyncTaskName.EXPRESS, async () => {
      const latestLocalDate = await this.support.getLatestDateString('express', 'annDate')
      const rangeEnd = this.support.getCurrentShanghaiDateString()
      const rangeStart = this.resolveExpressRangeStart(latestLocalDate, rangeEnd)

      if (this.support.compareDateString(rangeStart, rangeEnd) > 0) {
        return { status: TushareSyncExecutionStatus.SKIPPED, message: '业绩快报已是最新，无需补数。' }
      }

      const windows = this.support.buildMonthlyWindows(rangeStart, rangeEnd)
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

  private async syncExpressByDateRange(startDate: string, endDate: string) {
    const rows = await this.tushareApiService.getExpress(startDate, endDate)
    const mapped = rows.map(mapExpressRecord).filter((item): item is NonNullable<typeof item> => Boolean(item))
    return this.support.replaceDateRangeRows(
      'express',
      'annDate',
      this.support.toDate(startDate),
      this.support.toDate(endDate),
      mapped,
    )
  }

  // ─── Dividend ─────────────────────────────────────────────────────────────────

  /**
   * 分红数据以"公告日（ann_date）"为时间轴增量同步。
   * 与 express 一样按月窗口批量拉取，利用 ann_date 范围过滤。
   */
  async checkDividendFreshness() {
    await this.support.executeTask(TushareSyncTaskName.DIVIDEND, async () => {
      const stockCodes = await this.getAllStockCodes()
      if (!stockCodes.length) {
        return {
          status: TushareSyncExecutionStatus.SKIPPED,
          message: '股票基础信息为空，暂时无法同步分红数据。',
        }
      }

      const dividendSyncState = await this.inspectDividendSyncState(stockCodes)
      if (dividendSyncState.mode === 'rebuild') {
        const totalRows = await this.rebuildDividendHistoryByStock(stockCodes, dividendSyncState)
        return {
          status: TushareSyncExecutionStatus.SUCCESS,
          message: `分红数据已按股票全量重建，共处理 ${stockCodes.length} 只股票。`,
          payload: {
            stockCount: stockCodes.length,
            rowCount: totalRows,
            reason: dividendSyncState.reason,
            rebuildStrategy: dividendSyncState.clearExisting ? 'reset-and-rebuild' : 'resume-rebuild',
          },
        }
      }

      const rangeStart = dividendSyncState.rangeStart
      const rangeEnd = this.support.getCurrentShanghaiDateString()

      if (this.support.compareDateString(rangeStart, rangeEnd) > 0) {
        return { status: TushareSyncExecutionStatus.SKIPPED, message: '分红数据已是最新，无需补数。' }
      }

      const windows = this.support.buildMonthlyWindows(rangeStart, rangeEnd)
      let totalRows = 0
      for (const window of windows) {
        totalRows += await this.syncDividendByDateRange(window.startDate, window.endDate)
      }

      return {
        status: TushareSyncExecutionStatus.SUCCESS,
        message: `分红数据同步完成，共同步 ${windows.length} 个月度窗口。`,
        payload: { windowCount: windows.length, rowCount: totalRows, startDate: rangeStart, endDate: rangeEnd },
      }
    })
  }

  private async syncDividendByDateRange(startDate: string, endDate: string): Promise<number> {
    const rows = await this.tushareApiService.getDividendByDateRange(startDate, endDate)
    const mapped = this.deduplicateDividendRows(
      rows.map(mapDividendRecord).filter((r): r is NonNullable<typeof r> => Boolean(r)),
    )

    return this.support.replaceDateRangeRows(
      'dividend',
      'annDate',
      this.support.toDate(startDate),
      this.support.toDate(endDate),
      mapped,
      {},
      { skipDuplicates: true },
    )
  }

  /** 按需获取并存储指定股票的所有历史分红（供股票详情接口调用） */
  async syncDividendsForStock(tsCode: string): Promise<number> {
    const mapped = await this.fetchDividendRowsForStock(tsCode)

    if (!mapped.length) return 0

    // 删除该股票所有历史分红记录后重新写入
    await this.support.prisma.dividend.deleteMany({ where: { tsCode } })
    const result = await this.support.prisma.dividend.createMany({ data: mapped, skipDuplicates: true })
    return result.count
  }

  private async inspectDividendSyncState(
    stockCodes: string[],
  ): Promise<
    { mode: 'rebuild'; reason: string; clearExisting: boolean } | { mode: 'incremental'; rangeStart: string }
  > {
    const stockUniverseCount = stockCodes.length
    const latestLocalDate = await this.support.getLatestDateString('dividend', 'annDate')
    if (!latestLocalDate) {
      return {
        mode: 'rebuild',
        reason: `分红表为空，将按股票从 ${this.support.syncStartDate} 开始全量重建。`,
        clearExisting: false,
      }
    }

    const [dividendRowCount, dividendStockCoverage, exchangeCoverage, nullAnnDateCount] = await Promise.all([
      this.support.prisma.dividend.count(),
      this.support.prisma.dividend.groupBy({ by: ['tsCode'] }).then((rows) => rows.length),
      this.getDividendExchangeCoverage(),
      this.countDividendRowsWithNullAnnDate(),
    ])

    const minimumCoveredStocks = Math.max(200, Math.floor(stockUniverseCount * 0.2))
    const minimumDividendRows = Math.max(1000, stockUniverseCount)

    const looksSuspiciouslySparse =
      dividendRowCount > 0 && dividendStockCoverage < minimumCoveredStocks && dividendRowCount < minimumDividendRows

    if (looksSuspiciouslySparse) {
      return {
        mode: 'rebuild',
        reason: `当前仅覆盖 ${dividendStockCoverage}/${stockUniverseCount} 只股票、${dividendRowCount} 条记录，判定为不完整分红快照；将按股票重新全量构建。`,
        clearExisting: true,
      }
    }

    if (dividendRowCount > 0 && nullAnnDateCount === 0) {
      return {
        mode: 'rebuild',
        reason: '当前分红表中不存在 ann_date 为空的历史实施记录，判定为旧版本过滤导致缺口；将按股票重新全量构建。',
        clearExisting: true,
      }
    }

    const missingExchanges = exchangeCoverage.filter((item) => item.stockCount > 0 && item.dividendStockCount === 0)
    if (missingExchanges.length) {
      const labels = missingExchanges.map((item) => item.exchange).join(' / ')
      return {
        mode: 'rebuild',
        reason: `分红重建已部分完成，但交易所 ${labels} 仍无任何分红记录；将从断点继续补齐剩余股票。`,
        clearExisting: false,
      }
    }

    return { mode: 'incremental', rangeStart: this.support.addDays(latestLocalDate, 1) }
  }

  private deduplicateDividendRows<
    T extends {
      tsCode: string
      annDate?: string | Date | null
      endDate?: string | Date | null
      divProc?: string | null
      recordDate?: string | Date | null
      exDate?: string | Date | null
      payDate?: string | Date | null
      divListdate?: string | Date | null
      impAnnDate?: string | Date | null
      baseDate?: string | Date | null
      baseShare?: number | null
      cashDiv?: number | null
      cashDivTax?: number | null
      stkDiv?: number | null
      stkBoRate?: number | null
      stkCoRate?: number | null
    },
  >(rows: T[]): T[] {
    const deduplicated = new Map<string, T>()

    for (const row of rows) {
      const key = [
        row.tsCode,
        this.normalizeDateValue(row.annDate),
        this.normalizeDateValue(row.endDate),
        row.divProc ?? '',
        this.normalizeDateValue(row.recordDate),
        this.normalizeDateValue(row.exDate),
        this.normalizeDateValue(row.payDate),
        this.normalizeDateValue(row.divListdate),
        this.normalizeDateValue(row.impAnnDate),
        this.normalizeDateValue(row.baseDate),
        this.normalizeNumberValue(row.baseShare),
        this.normalizeNumberValue(row.cashDiv),
        this.normalizeNumberValue(row.cashDivTax),
        this.normalizeNumberValue(row.stkDiv),
        this.normalizeNumberValue(row.stkBoRate),
        this.normalizeNumberValue(row.stkCoRate),
      ].join('|')
      deduplicated.set(key, row)
    }

    return Array.from(deduplicated.values())
  }

  private async rebuildDividendHistoryByStock(
    stockCodes: string[],
    options: { reason: string; clearExisting: boolean },
  ): Promise<number> {
    this.logger.warn(`[DIVIDEND] ${options.reason}`)

    let candidateStockCodes = stockCodes
    let totalRows = 0

    if (options.clearExisting) {
      await this.support.prisma.dividend.deleteMany({})
    } else {
      const syncedCodes = new Set(
        await this.support.prisma.dividend.groupBy({ by: ['tsCode'] }).then((rows) => rows.map((row) => row.tsCode)),
      )
      candidateStockCodes = stockCodes.filter((tsCode) => !syncedCodes.has(tsCode))
      totalRows = await this.support.prisma.dividend.count()

      if (!candidateStockCodes.length) {
        this.logger.log('[DIVIDEND] 当前所有股票都已有分红记录，跳过续跑。')
        return totalRows
      }
    }

    for (const [index, tsCode] of candidateStockCodes.entries()) {
      if (index === 0 || (index + 1) % 200 === 0 || index === candidateStockCodes.length - 1) {
        this.logger.log(
          `[DIVIDEND] 股票进度 ${index + 1}/${candidateStockCodes.length}，当前 ${tsCode}，累计写入 ${totalRows} 条。`,
        )
      }

      const mapped = await this.fetchDividendRowsForStock(tsCode)
      if (!mapped.length) {
        continue
      }

      const result = await this.support.prisma.dividend.createMany({ data: mapped, skipDuplicates: true })
      totalRows += result.count
    }

    return totalRows
  }

  private async fetchDividendRowsForStock(tsCode: string) {
    const rows = await this.tushareApiService.getDividendByTsCode(tsCode)
    return this.deduplicateDividendRows(
      rows.map(mapDividendRecord).filter((r): r is NonNullable<typeof r> => Boolean(r)),
    )
  }

  private async getAllStockCodes(): Promise<string[]> {
    const rows = await this.support.prisma.stockBasic.findMany({
      select: { tsCode: true },
      orderBy: { tsCode: 'asc' },
    })

    return rows.map((row) => row.tsCode)
  }

  private async getDividendExchangeCoverage(): Promise<
    Array<{ exchange: string; stockCount: number; dividendStockCount: number }>
  > {
    const rows = await this.support.prisma.$queryRawUnsafe<
      Array<{
        exchange: string
        stock_count: number
        dividend_stock_count: number
      }>
    >(`
      SELECT
        sb.exchange::text AS exchange,
        COUNT(DISTINCT sb.ts_code)::int AS stock_count,
        COUNT(DISTINCT d.ts_code)::int AS dividend_stock_count
      FROM stock_basic_profiles sb
      LEFT JOIN stock_dividend_events d ON d.ts_code = sb.ts_code
      GROUP BY sb.exchange
      ORDER BY sb.exchange
    `)

    return rows.map((row) => ({
      exchange: row.exchange,
      stockCount: row.stock_count,
      dividendStockCount: row.dividend_stock_count,
    }))
  }

  private async countDividendRowsWithNullAnnDate(): Promise<number> {
    const rows = await this.support.prisma.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS count
      FROM stock_dividend_events
      WHERE ann_date IS NULL
    `

    return rows[0]?.count ?? 0
  }

  private normalizeDateValue(value: string | Date | null | undefined): string {
    if (!value) {
      return ''
    }

    return value instanceof Date ? this.support.formatDate(value) : value
  }

  private normalizeNumberValue(value: number | null | undefined): string {
    return value == null ? '' : String(value)
  }

  private resolveExpressRangeStart(latestLocalDate: string | null, rangeEnd: string): string {
    const rollingStart = this.support.getCurrentShanghaiDay(rangeEnd).subtract(45, 'day').format('YYYYMMDD')

    if (!latestLocalDate) {
      return this.support.syncStartDate
    }

    if (this.support.compareDateString(latestLocalDate, rollingStart) < 0) {
      return this.support.addDays(latestLocalDate, 1)
    }

    return this.maxDateString(this.support.syncStartDate, rollingStart)
  }

  private maxDateString(left: string, right: string): string {
    return this.support.compareDateString(left, right) >= 0 ? left : right
  }
}
