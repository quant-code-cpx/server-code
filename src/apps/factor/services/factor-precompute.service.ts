import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common'
import { SchedulerRegistry } from '@nestjs/schedule'
import { CronJob } from 'cron'
import { Prisma } from '@prisma/client'
import { PrismaService } from 'src/shared/prisma.service'
import { FactorComputeService } from './factor-compute.service'

// ── Stat helpers ─────────────────────────────────────────────────────────────

function computePercentileRank(sortedValues: number[], value: number): number {
  const n = sortedValues.length
  if (n === 0) return 0
  let below = 0
  for (const v of sortedValues) {
    if (v < value) below++
  }
  return below / n
}

function computeStats(values: number[]): {
  mean: number | null
  median: number | null
  stdDev: number | null
  min: number | null
  max: number | null
  q25: number | null
  q75: number | null
  skewness: number | null
  kurtosis: number | null
} {
  if (!values.length) {
    return {
      mean: null,
      median: null,
      stdDev: null,
      min: null,
      max: null,
      q25: null,
      q75: null,
      skewness: null,
      kurtosis: null,
    }
  }

  const sorted = [...values].sort((a, b) => a - b)
  const n = sorted.length

  const mean = values.reduce((s, v) => s + v, 0) / n
  const min = sorted[0]
  const max = sorted[n - 1]

  // Median
  const median =
    n % 2 === 0 ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2 : sorted[Math.floor(n / 2)]

  // Std dev (sample)
  const variance = n > 1 ? values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1) : 0
  const stdDev = Math.sqrt(variance)

  // Percentiles via linear interpolation
  function percentileAt(p: number): number {
    const idx = p * (n - 1)
    const lo = Math.floor(idx)
    const hi = Math.ceil(idx)
    if (lo === hi) return sorted[lo]
    return sorted[lo] + (idx - lo) * (sorted[hi] - sorted[lo])
  }

  const q25 = percentileAt(0.25)
  const q75 = percentileAt(0.75)

  // Skewness (sample: Pearson's moment)
  let skewness: number | null = null
  if (n >= 3 && stdDev > 0) {
    const m3 = values.reduce((s, v) => s + (v - mean) ** 3, 0) / n
    skewness = m3 / stdDev ** 3
  }

  // Excess kurtosis (sample)
  let kurtosis: number | null = null
  if (n >= 4 && stdDev > 0) {
    const m4 = values.reduce((s, v) => s + (v - mean) ** 4, 0) / n
    kurtosis = m4 / stdDev ** 4 - 3
  }

  return { mean, median, stdDev, min, max, q25, q75, skewness, kurtosis }
}

// ── Result types ──────────────────────────────────────────────────────────────

export interface PrecomputeResult {
  tradeDate: string
  factorsProcessed: number
  factorsFailed: number
  totalRows: number
  elapsedMs: number
}

export interface BackfillResult {
  startDate: string
  endDate: string
  datesProcessed: number
  datesSkipped: number
  totalRows: number
  elapsedMs: number
}

// ─────────────────────────────────────────────────────────────────────────────

interface TradeCalRow {
  cal_date: Date
}

const BATCH_UPSERT_SIZE = 2000

@Injectable()
export class FactorPrecomputeService implements OnApplicationBootstrap {
  private readonly logger = new Logger(FactorPrecomputeService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly compute: FactorComputeService,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {}

  onApplicationBootstrap() {
    const job = new CronJob(
      '0 0 20 * * 1-5', // 20:00 weekdays
      () => {
        void this.runDailyPrecompute()
      },
      null,
      true,
      'Asia/Shanghai',
    )
    this.schedulerRegistry.addCronJob('factor-precompute-daily', job)
    this.logger.log('因子预计算定时任务已注册（每个工作日 20:00 Asia/Shanghai）')
  }

  // ── Trade calendar helper ─────────────────────────────────────────────────

  private async getTradeDates(startDate: string, endDate: string): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<TradeCalRow[]>(Prisma.sql`
      SELECT cal_date
      FROM exchange_trade_calendars
      WHERE exchange = 'SSE' AND is_open = '1'
        AND cal_date >= ${startDate}::date
        AND cal_date <= ${endDate}::date
      ORDER BY cal_date ASC
    `)
    return rows.map((r) => {
      const d = r.cal_date instanceof Date ? r.cal_date : new Date(r.cal_date)
      return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`
    })
  }

  private async getLatestTradeDate(): Promise<string | null> {
    const today = new Date()
    const todayStr = `${today.getUTCFullYear()}${String(today.getUTCMonth() + 1).padStart(2, '0')}${String(today.getUTCDate()).padStart(2, '0')}`

    const rows = await this.prisma.$queryRaw<TradeCalRow[]>(Prisma.sql`
      SELECT cal_date
      FROM exchange_trade_calendars
      WHERE exchange = 'SSE' AND is_open = '1'
        AND cal_date <= ${todayStr}::date
      ORDER BY cal_date DESC
      LIMIT 1
    `)
    if (!rows.length) return null
    const r = rows[0].cal_date instanceof Date ? rows[0].cal_date : new Date(rows[0].cal_date)
    return `${r.getUTCFullYear()}${String(r.getUTCMonth() + 1).padStart(2, '0')}${String(r.getUTCDate()).padStart(2, '0')}`
  }

  // ── Core compute & store ──────────────────────────────────────────────────

  /**
   * 预计算单个因子在指定日期的全市场截面值并落库。
   * Returns the number of rows stored (valid values only).
   */
  async computeAndStore(factorName: string, tradeDate: string): Promise<number> {
    const rawValues = await this.compute.computeRealtimeForDate(factorName, tradeDate)

    const valid = rawValues.filter((v) => v.factorValue != null) as Array<{
      tsCode: string
      factorValue: number
    }>

    const missing = rawValues.length - valid.length

    // Sort for percentile calculation
    const sortedValues = [...valid].sort((a, b) => a.factorValue - b.factorValue)
    const sortedNums = sortedValues.map((v) => v.factorValue)

    // Compute percentile for each entry
    const snapshotRows = valid.map((v) => ({
      factorName,
      tradeDate,
      tsCode: v.tsCode,
      value: new Prisma.Decimal(v.factorValue),
      percentile: new Prisma.Decimal(
        Math.round(computePercentileRank(sortedNums, v.factorValue) * 1e4) / 1e4,
      ),
    }))

    const stats = computeStats(sortedNums)

    // Write in a transaction: delete existing + batch insert + upsert summary
    await this.prisma.$transaction(async (tx) => {
      await tx.factorSnapshot.deleteMany({
        where: { factorName, tradeDate },
      })

      for (let i = 0; i < snapshotRows.length; i += BATCH_UPSERT_SIZE) {
        const batch = snapshotRows.slice(i, i + BATCH_UPSERT_SIZE)
        await tx.factorSnapshot.createMany({ data: batch })
      }

      await tx.factorSnapshotSummary.upsert({
        where: { factorName_tradeDate: { factorName, tradeDate } },
        create: {
          factorName,
          tradeDate,
          count: valid.length,
          missing,
          mean: stats.mean != null ? new Prisma.Decimal(stats.mean) : null,
          median: stats.median != null ? new Prisma.Decimal(stats.median) : null,
          stdDev: stats.stdDev != null ? new Prisma.Decimal(stats.stdDev) : null,
          min: stats.min != null ? new Prisma.Decimal(stats.min) : null,
          max: stats.max != null ? new Prisma.Decimal(stats.max) : null,
          q25: stats.q25 != null ? new Prisma.Decimal(stats.q25) : null,
          q75: stats.q75 != null ? new Prisma.Decimal(stats.q75) : null,
          skewness: stats.skewness != null ? new Prisma.Decimal(stats.skewness) : null,
          kurtosis: stats.kurtosis != null ? new Prisma.Decimal(stats.kurtosis) : null,
        },
        update: {
          count: valid.length,
          missing,
          mean: stats.mean != null ? new Prisma.Decimal(stats.mean) : null,
          median: stats.median != null ? new Prisma.Decimal(stats.median) : null,
          stdDev: stats.stdDev != null ? new Prisma.Decimal(stats.stdDev) : null,
          min: stats.min != null ? new Prisma.Decimal(stats.min) : null,
          max: stats.max != null ? new Prisma.Decimal(stats.max) : null,
          q25: stats.q25 != null ? new Prisma.Decimal(stats.q25) : null,
          q75: stats.q75 != null ? new Prisma.Decimal(stats.q75) : null,
          skewness: stats.skewness != null ? new Prisma.Decimal(stats.skewness) : null,
          kurtosis: stats.kurtosis != null ? new Prisma.Decimal(stats.kurtosis) : null,
          syncedAt: new Date(),
        },
      })
    })

    return snapshotRows.length
  }

  // ── Precompute all factors for a date ─────────────────────────────────────

  /**
   * 批量预计算指定日期所有已启用因子的截面值。
   * factorNames 不传时计算所有已启用因子。
   */
  async precomputeAllFactors(
    tradeDate: string,
    factorNames?: string[],
  ): Promise<PrecomputeResult> {
    const startMs = Date.now()

    const factors = await this.prisma.factorDefinition.findMany({
      where: { isEnabled: true, ...(factorNames?.length ? { name: { in: factorNames } } : {}) },
      select: { name: true },
    })

    let factorsProcessed = 0
    let factorsFailed = 0
    let totalRows = 0

    for (const factor of factors) {
      try {
        const rows = await this.computeAndStore(factor.name, tradeDate)
        totalRows += rows
        factorsProcessed++
        this.logger.debug(`[${factor.name}] ${tradeDate} 预计算完成，${rows} 条`)
      } catch (error) {
        factorsFailed++
        this.logger.error(
          `[${factor.name}] ${tradeDate} 预计算失败: ${(error as Error).message}`,
        )
      }
    }

    const elapsed = Date.now() - startMs
    this.logger.log(
      `预计算完成 ${tradeDate}：${factorsProcessed} 因子成功，${factorsFailed} 失败，` +
        `共 ${totalRows} 行，耗时 ${elapsed}ms`,
    )

    return {
      tradeDate,
      factorsProcessed,
      factorsFailed,
      totalRows,
      elapsedMs: elapsed,
    }
  }

  // ── Historical backfill ───────────────────────────────────────────────────

  /**
   * 历史回补：补算指定日期范围内所有交易日的因子值。
   * 支持断点续传（skipExisting 默认 true，跳过已有快照的日期）。
   */
  async backfill(
    startDate: string,
    endDate: string,
    options?: {
      factorNames?: string[]
      skipExisting?: boolean
    },
  ): Promise<BackfillResult> {
    const skip = options?.skipExisting !== false
    const startMs = Date.now()

    const allDates = await this.getTradeDates(startDate, endDate)
    let tradeDates = allDates

    if (skip && tradeDates.length > 0) {
      // Find dates that already have a complete snapshot (at least one factor present)
      interface ExistingRow {
        trade_date: string
      }
      const existing = await this.prisma.$queryRaw<ExistingRow[]>(Prisma.sql`
        SELECT DISTINCT trade_date
        FROM factor_snapshots
        WHERE trade_date = ANY(${tradeDates}::text[])
      `)
      const existingSet = new Set(existing.map((r) => r.trade_date))
      tradeDates = tradeDates.filter((d) => !existingSet.has(d))
    }

    const datesSkipped = allDates.length - tradeDates.length
    let datesProcessed = 0
    let totalRows = 0

    for (const tradeDate of tradeDates) {
      const result = await this.precomputeAllFactors(tradeDate, options?.factorNames)
      totalRows += result.totalRows
      datesProcessed++
    }

    return {
      startDate,
      endDate,
      datesProcessed,
      datesSkipped,
      totalRows,
      elapsedMs: Date.now() - startMs,
    }
  }

  // ── Status query ──────────────────────────────────────────────────────────

  async getPrecomputeStatus() {
    interface SummaryRow {
      factor_name: string
      latest_date: string
      total_dates: bigint
    }

    const rows = await this.prisma.$queryRaw<SummaryRow[]>(Prisma.sql`
      SELECT
        factor_name,
        MAX(trade_date) AS latest_date,
        COUNT(DISTINCT trade_date) AS total_dates
      FROM factor_snapshot_summaries
      GROUP BY factor_name
      ORDER BY factor_name
    `)

    interface OverallRow {
      overall_latest: string
      overall_total_dates: bigint
    }

    const overall = await this.prisma.$queryRaw<OverallRow[]>(Prisma.sql`
      SELECT
        MAX(trade_date) AS overall_latest,
        COUNT(DISTINCT trade_date) AS overall_total_dates
      FROM factor_snapshot_summaries
    `)

    return {
      generatedAt: new Date().toISOString(),
      latestDate: overall[0]?.overall_latest ?? null,
      totalDatesWithData: Number(overall[0]?.overall_total_dates ?? 0),
      byFactor: rows.map((r) => ({
        factorName: r.factor_name,
        latestDate: r.latest_date,
        totalDates: Number(r.total_dates),
      })),
    }
  }

  // ── Daily cron (20:00 Asia/Shanghai, Mon–Fri) ─────────────────────────────

  async runDailyPrecompute(): Promise<void> {
    this.logger.log('因子预计算定时任务开始')
    const targetDate = await this.getLatestTradeDate()
    if (!targetDate) {
      this.logger.warn('无法获取最近交易日，跳过预计算')
      return
    }

    // Check if already computed for this date
    const existing = await this.prisma.factorSnapshotSummary.count({
      where: { tradeDate: targetDate },
    })
    if (existing > 0) {
      this.logger.log(`${targetDate} 已有预计算快照（${existing} 因子），跳过`)
      return
    }

    try {
      await this.precomputeAllFactors(targetDate)
    } catch (error) {
      this.logger.error(`因子预计算定时任务失败: ${(error as Error).message}`, (error as Error).stack)
    }
  }
}
