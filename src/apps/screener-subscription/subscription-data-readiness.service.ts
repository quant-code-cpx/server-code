import { Injectable } from '@nestjs/common'
import { Prisma, StockExchange, TushareSyncStatus, TushareSyncTask } from '@prisma/client'
import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'
import { ScreenerFiltersDto } from 'src/apps/stock/dto/stock-screener-query.dto'
import { PrismaService } from 'src/shared/prisma.service'
import { FactorScreeningRuleSpec, SignalEventRuleSpec, StockScreeningRuleSpec, SubscriptionRuleType } from './rule'
import { isSpecialTreatmentStockName } from './rule/subscription-universe.util'

dayjs.extend(utc)
dayjs.extend(timezone)

const MIN_TARGET_COVERAGE = 0.995
const STOCK_BASIC_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
const HK_HOLD_LAST_DAILY_DATE = '20240820'
const FINANCIAL_ELIGIBILITY_MIN_AGE_DAYS = 400

const COVERAGE_TABLES = {
  DAILY: Prisma.raw('stock_daily_prices'),
  DAILY_BASIC: Prisma.raw('stock_daily_valuation_metrics'),
  STK_FACTOR: Prisma.raw('stock_technical_factors'),
  MONEYFLOW: Prisma.raw('stock_capital_flows'),
} as const

type CoverageDataset = keyof typeof COVERAGE_TABLES

const DAILY_BASIC_FILTERS = [
  'minPeTtm',
  'maxPeTtm',
  'minPb',
  'maxPb',
  'minDvTtm',
  'minTotalMv',
  'maxTotalMv',
  'minCircMv',
  'maxCircMv',
  'minPsTtm',
  'maxPsTtm',
  'minTurnoverRate',
  'maxTurnoverRate',
]

const DAILY_FILTERS = ['minPctChg', 'maxPctChg', 'minAmount', 'maxAmount']
const FINANCIAL_FILTERS = [
  'minRevenueYoy',
  'maxRevenueYoy',
  'minNetprofitYoy',
  'maxNetprofitYoy',
  'minRoe',
  'maxRoe',
  'minGrossMargin',
  'maxGrossMargin',
  'minNetMargin',
  'maxNetMargin',
  'maxDebtToAssets',
  'minCurrentRatio',
  'minQuickRatio',
  'minOcfToNetprofit',
]
const TECHNICAL_FILTERS = [
  'minBuySignalCount',
  'minRsi6',
  'maxRsi6',
  'macdSignal',
  'kdjSignal',
  'rsiSignal',
  'bollSignal',
  'maTrend',
]

export interface CheckStockScreeningReadinessOptions {
  filters: ScreenerFiltersDto
  tradeDate: string
}

export interface SubscriptionDataReadinessResult {
  ready: boolean
  tradeDate: string
  dataVersions: Record<string, string>
  missing: string[]
}

interface SyncLogVersion {
  id: number
  startedAt: Date
}

interface CountRow {
  count: bigint | number | string
}

@Injectable()
export class SubscriptionDataReadinessService {
  constructor(private readonly prisma: PrismaService) {}

  async checkRule(
    ruleSpec: StockScreeningRuleSpec | FactorScreeningRuleSpec | SignalEventRuleSpec,
    tradeDate: string,
  ): Promise<SubscriptionDataReadinessResult> {
    if (ruleSpec.type === SubscriptionRuleType.STOCK_SCREENING) {
      return this.checkStockScreening({ filters: ruleSpec.filters as ScreenerFiltersDto, tradeDate })
    }
    if (ruleSpec.type === SubscriptionRuleType.SIGNAL_EVENT) return this.checkSignalEvent(ruleSpec, tradeDate)
    return this.checkFactorScreening(ruleSpec, tradeDate)
  }

  /** B3 快照门禁：必须存在同一 catalogVersion 的完整日级快照，事件表才可被消费。 */
  async checkSignalEvent(ruleSpec: SignalEventRuleSpec, tradeDate: string): Promise<SubscriptionDataReadinessResult> {
    const targetDate = this.parseTradeDate(tradeDate)
    if (!targetDate) return this.notReady(tradeDate, ['TRADE_DATE_INVALID'])
    try {
      const [isOpen, universeCodes] = await Promise.all([
        this.prisma.tradeCal.findFirst({
          where: { exchange: StockExchange.SSE, isOpen: '1', calDate: targetDate },
          select: { calDate: true },
        }),
        this.resolveFactorUniverse(targetDate, ruleSpec),
      ])
      const snapshots = await this.prisma.technicalSignalDailySnapshot.findMany({
        where: { tradeDate, tsCode: { in: universeCodes } },
        select: { tsCode: true, catalogVersion: true },
      })
      const coverageByCatalog = new Map<string, Set<string>>()
      for (const snapshot of snapshots) {
        const codes = coverageByCatalog.get(snapshot.catalogVersion) ?? new Set<string>()
        codes.add(snapshot.tsCode)
        coverageByCatalog.set(snapshot.catalogVersion, codes)
      }
      const [catalogVersion, coveredCodes] = [...coverageByCatalog.entries()].sort(
        (left, right) => right[1].size - left[1].size,
      )[0] ?? [null, new Set<string>()]
      const coverage = universeCodes.length > 0 ? coveredCodes.size / universeCodes.length : 0
      const missing = new Set<string>()
      if (!isOpen) missing.add('TRADE_CAL_NOT_OPEN')
      if (universeCodes.length === 0) missing.add('TECHNICAL_SIGNAL_UNIVERSE_EMPTY')
      if (!catalogVersion || coverage < MIN_TARGET_COVERAGE) missing.add('TECHNICAL_SIGNAL_NOT_READY')
      const dataVersions =
        catalogVersion && coverage >= MIN_TARGET_COVERAGE
          ? {
              TECHNICAL_SIGNAL: `target:${tradeDate}:coverage:${coveredCodes.size}/${universeCodes.length}:catalog:${catalogVersion}`,
            }
          : {}
      return { ready: missing.size === 0, tradeDate, dataVersions, missing: [...missing].sort() }
    } catch {
      return this.notReady(tradeDate, ['TECHNICAL_SIGNAL_READINESS_CHECK_FAILED'])
    }
  }

  /** B2 快照门禁：不回退到实时计算，任一因子覆盖不足均禁止评估。 */
  async checkFactorScreening(
    ruleSpec: FactorScreeningRuleSpec,
    tradeDate: string,
  ): Promise<SubscriptionDataReadinessResult> {
    const targetDate = this.parseTradeDate(tradeDate)
    if (!targetDate) return this.notReady(tradeDate, ['TRADE_DATE_INVALID'])
    try {
      const [isOpen, universeCodes] = await Promise.all([
        this.prisma.tradeCal.findFirst({
          where: { exchange: StockExchange.SSE, isOpen: '1', calDate: targetDate },
          select: { calDate: true },
        }),
        this.resolveFactorUniverse(targetDate, ruleSpec),
      ])
      const snapshots = await this.prisma.factorSnapshot.findMany({
        where: {
          tradeDate,
          factorName: { in: ruleSpec.conditions.map((condition) => condition.factorId) },
          tsCode: { in: universeCodes },
          value: { not: null },
        },
        select: { factorName: true, syncedAt: true },
      })
      const missing = new Set<string>()
      const dataVersions: Record<string, string> = {}
      if (!isOpen) missing.add('TRADE_CAL_NOT_OPEN')
      if (universeCodes.length === 0) missing.add('FACTOR_UNIVERSE_EMPTY')
      const snapshotStats = new Map<string, { count: number; syncedAt: Date }>()
      for (const snapshot of snapshots) {
        const current = snapshotStats.get(snapshot.factorName)
        snapshotStats.set(snapshot.factorName, {
          count: (current?.count ?? 0) + 1,
          syncedAt: !current || snapshot.syncedAt > current.syncedAt ? snapshot.syncedAt : current.syncedAt,
        })
      }
      for (const condition of ruleSpec.conditions) {
        const summary = snapshotStats.get(condition.factorId)
        const coverage = summary && universeCodes.length > 0 ? summary.count / universeCodes.length : 0
        if (!summary || coverage < 0.99) {
          missing.add(`FACTOR_SNAPSHOT_NOT_READY:${condition.factorId}`)
          continue
        }
        dataVersions[`FACTOR_SNAPSHOT:${condition.factorId}`] = [
          `target:${tradeDate}`,
          `coverage:${summary.count}/${universeCodes.length}`,
          `synced:${summary.syncedAt.toISOString()}`,
        ].join(':')
      }
      return { ready: missing.size === 0, tradeDate, dataVersions, missing: [...missing].sort() }
    } catch {
      return this.notReady(tradeDate, ['FACTOR_SNAPSHOT_READINESS_CHECK_FAILED'])
    }
  }

  /**
   * B0 只判定现有基础选股所依赖的数据。同步日志证明任务完成，目标日
   * 水位/覆盖率证明数据实际落表；任一条件不足均返回未就绪而非抛异常。
   */
  async checkStockScreening({
    filters,
    tradeDate,
  }: CheckStockScreeningReadinessOptions): Promise<SubscriptionDataReadinessResult> {
    const targetDate = this.parseTradeDate(tradeDate)
    if (!targetDate) return this.notReady(tradeDate, ['TRADE_DATE_INVALID'])

    try {
      const missing = new Set<string>()
      const dataVersions: Record<string, string> = {}
      const rawFilters = filters as unknown as Record<string, unknown>
      const [isOpen, universeSize] = await Promise.all([
        this.prisma.tradeCal.findFirst({
          where: { exchange: StockExchange.SSE, isOpen: '1', calDate: targetDate },
          select: { calDate: true },
        }),
        this.countTradableUniverse(targetDate),
      ])
      if (!isOpen) missing.add('TRADE_CAL_NOT_OPEN')

      await this.checkStockBasic(universeSize, missing, dataVersions)

      const needsDailyBasic = this.hasAny(rawFilters, DAILY_BASIC_FILTERS)
      const needsTechnical = this.hasAny(rawFilters, TECHNICAL_FILTERS)
      const needsDaily =
        this.hasAny(rawFilters, DAILY_FILTERS) ||
        rawFilters.minBuySignalCount !== undefined ||
        rawFilters.maTrend !== undefined ||
        rawFilters.bollSignal === 'above_upper' ||
        rawFilters.bollSignal === 'below_lower'
      const needsMoneyflow = rawFilters.minMainNetInflow5d !== undefined || rawFilters.minMainNetInflow20d !== undefined
      const moneyflowWindowDays = rawFilters.minMainNetInflow20d !== undefined ? 20 : needsMoneyflow ? 5 : 0
      const technicalWindowDays = this.requiresPreviousTechnicalRow(rawFilters) ? 2 : 0
      const needsFinancial = this.hasAny(rawFilters, FINANCIAL_FILTERS)
      const conceptCodes = this.readStringArray(rawFilters.conceptCodes)
      const hasConceptFilter = rawFilters.conceptCodes !== undefined && conceptCodes !== null && conceptCodes.length > 0

      if (rawFilters.conceptCodes !== undefined && conceptCodes === null) {
        missing.add('THS_MEMBER_FILTER_INVALID')
      }

      await Promise.all([
        needsDaily
          ? this.checkTargetDataset({
              key: 'DAILY',
              task: TushareSyncTask.DAILY,
              tradeDate,
              targetDate,
              universeSize,
              count: () => this.countActiveCoverage('DAILY', targetDate),
              watermark: () => this.findDailyWatermark(targetDate),
              missing,
              dataVersions,
            })
          : Promise.resolve(),
        needsDailyBasic
          ? this.checkTargetDataset({
              key: 'DAILY_BASIC',
              task: TushareSyncTask.DAILY_BASIC,
              tradeDate,
              targetDate,
              universeSize,
              count: () => this.countActiveCoverage('DAILY_BASIC', targetDate),
              watermark: () => this.findDailyBasicWatermark(targetDate),
              missing,
              dataVersions,
            })
          : Promise.resolve(),
        needsTechnical
          ? this.checkTargetDataset({
              key: 'STK_FACTOR',
              task: TushareSyncTask.STK_FACTOR,
              tradeDate,
              targetDate,
              universeSize,
              count: () => this.countActiveCoverage('STK_FACTOR', targetDate),
              watermark: () => this.findStkFactorWatermark(targetDate),
              missing,
              dataVersions,
            })
          : Promise.resolve(),
        needsMoneyflow
          ? this.checkTargetDataset({
              key: 'MONEYFLOW',
              task: TushareSyncTask.MONEYFLOW,
              tradeDate,
              targetDate,
              universeSize,
              count: () => this.countActiveCoverage('MONEYFLOW', targetDate),
              watermark: () => this.findMoneyflowWatermark(targetDate),
              missing,
              dataVersions,
            })
          : Promise.resolve(),
        technicalWindowDays > 0
          ? this.checkRecentWindow({
              key: 'STK_FACTOR',
              dataset: 'STK_FACTOR',
              targetDate,
              requiredDays: technicalWindowDays,
              missing,
              dataVersions,
            })
          : Promise.resolve(),
        moneyflowWindowDays > 0
          ? this.checkRecentWindow({
              key: 'MONEYFLOW',
              dataset: 'MONEYFLOW',
              targetDate,
              requiredDays: moneyflowWindowDays,
              missing,
              dataVersions,
            })
          : Promise.resolve(),
        needsFinancial ? this.checkFinancial(tradeDate, targetDate, missing, dataVersions) : Promise.resolve(),
        rawFilters.northboundOnly === true
          ? this.checkHkHold(tradeDate, targetDate, missing, dataVersions)
          : Promise.resolve(),
        hasConceptFilter ? this.checkThsConcept(tradeDate, conceptCodes, missing, dataVersions) : Promise.resolve(),
      ])

      return { ready: missing.size === 0, tradeDate, dataVersions, missing: [...missing].sort() }
    } catch {
      return this.notReady(tradeDate, ['READINESS_CHECK_FAILED'])
    }
  }

  private async checkStockBasic(
    universeSize: number,
    missing: Set<string>,
    dataVersions: Record<string, string>,
  ): Promise<void> {
    const [log, snapshot] = await Promise.all([
      this.findLatestSuccessLog(TushareSyncTask.STOCK_BASIC),
      this.prisma.stockBasic.findFirst({ orderBy: { syncedAt: 'desc' }, select: { syncedAt: true } }),
    ])
    if (!log || !snapshot || universeSize === 0 || !this.isFresh(log.startedAt) || !this.isFresh(snapshot.syncedAt)) {
      missing.add('STOCK_BASIC_NOT_READY')
      return
    }
    dataVersions.STOCK_BASIC = `log:${log.id}:snapshot:${this.formatTradeDate(snapshot.syncedAt)}:universe:${universeSize}`
  }

  private async checkTargetDataset(input: {
    key: string
    task: TushareSyncTask
    tradeDate: string
    targetDate: Date
    universeSize: number
    count: () => Promise<number>
    watermark: () => Promise<Date | null>
    missing: Set<string>
    dataVersions: Record<string, string>
  }): Promise<void> {
    const [log, count, watermark] = await Promise.all([
      this.findTradeDateSuccessLog(input.task, input.targetDate),
      input.count(),
      input.watermark(),
    ])
    const coverage = input.universeSize > 0 ? count / input.universeSize : 0
    if (!log || coverage < MIN_TARGET_COVERAGE) {
      input.missing.add(`${input.key}_NOT_READY`)
      return
    }
    input.dataVersions[input.key] = [
      `target:${input.tradeDate}`,
      `log:${log.id}`,
      `coverage:${count}/${input.universeSize}`,
      `watermark:${watermark ? this.formatTradeDate(watermark) : 'none'}`,
    ].join(':')
  }

  private async checkFinancial(
    tradeDate: string,
    targetDate: Date,
    missing: Set<string>,
    dataVersions: Record<string, string>,
  ): Promise<void> {
    const eligibleBefore = new Date(targetDate.getTime() - FINANCIAL_ELIGIBILITY_MIN_AGE_DAYS * 86_400_000)
    const [log, latest, universeSize, coveredCount] = await Promise.all([
      this.findLatestSuccessLog(TushareSyncTask.FINA_INDICATOR),
      this.prisma.finaIndicator.findFirst({
        where: { annDate: { not: null, lte: targetDate } },
        orderBy: [{ annDate: 'desc' }, { endDate: 'desc' }],
        select: { annDate: true },
      }),
      this.countMatureTradableUniverse(targetDate, eligibleBefore),
      this.countFinancialCoverage(targetDate, eligibleBefore),
    ])
    const coverage = universeSize > 0 ? coveredCount / universeSize : 0
    if (!log || !latest?.annDate || coverage < MIN_TARGET_COVERAGE) {
      missing.add('FINA_INDICATOR_NOT_READY')
      return
    }
    dataVersions.FINA_INDICATOR = [
      `asOf:${tradeDate}`,
      `log:${log.id}`,
      `maxAnnDate:${this.formatTradeDate(latest.annDate)}`,
      `coverage:${coveredCount}/${universeSize}`,
    ].join(':')
  }

  private async checkHkHold(
    tradeDate: string,
    targetDate: Date,
    missing: Set<string>,
    dataVersions: Record<string, string>,
  ): Promise<void> {
    if (tradeDate > HK_HOLD_LAST_DAILY_DATE) {
      missing.add('HK_HOLD_UNAVAILABLE_AFTER_20240820')
      return
    }
    const [log, count, watermark] = await Promise.all([
      this.findTradeDateSuccessLog(TushareSyncTask.HK_HOLD, targetDate),
      this.prisma.hkHold.count({ where: { tradeDate: targetDate } }),
      this.findHkHoldWatermark(targetDate),
    ])
    if (!log || count === 0) {
      missing.add('HK_HOLD_NOT_READY')
      return
    }
    dataVersions.HK_HOLD = `target:${tradeDate}:log:${log.id}:rows:${count}:watermark:${watermark ? this.formatTradeDate(watermark) : 'none'}`
  }

  private async checkThsConcept(
    tradeDate: string,
    conceptCodes: string[],
    missing: Set<string>,
    dataVersions: Record<string, string>,
  ): Promise<void> {
    if (tradeDate !== dayjs().tz('Asia/Shanghai').format('YYYYMMDD')) {
      missing.add('THS_MEMBER_PIT_UNSUPPORTED')
      return
    }
    const [log, count] = await Promise.all([
      this.findLatestSuccessLog(TushareSyncTask.THS_MEMBER),
      this.prisma.thsMember.count({ where: { isNew: 'Y', tsCode: { in: conceptCodes } } }),
    ])
    if (!log || !this.isFresh(log.startedAt) || count === 0) {
      missing.add('THS_MEMBER_NOT_READY')
      return
    }
    dataVersions.THS_MEMBER = `log:${log.id}:rows:${count}`
  }

  private async findTradeDateSuccessLog(task: TushareSyncTask, tradeDate: Date): Promise<SyncLogVersion | null> {
    return this.prisma.tushareSyncLog.findFirst({
      where: { task, status: TushareSyncStatus.SUCCESS, tradeDate },
      orderBy: { startedAt: 'desc' },
      select: { id: true, startedAt: true },
    })
  }

  private async findLatestSuccessLog(task: TushareSyncTask): Promise<SyncLogVersion | null> {
    return this.prisma.tushareSyncLog.findFirst({
      where: { task, status: TushareSyncStatus.SUCCESS },
      orderBy: { startedAt: 'desc' },
      select: { id: true, startedAt: true },
    })
  }

  private async findDailyWatermark(targetDate: Date): Promise<Date | null> {
    return (
      (
        await this.prisma.daily.findFirst({
          where: { tradeDate: { lte: targetDate } },
          orderBy: { tradeDate: 'desc' },
          select: { tradeDate: true },
        })
      )?.tradeDate ?? null
    )
  }

  /**
   * 覆盖率分母是规则在该日会扫描的可交易 universe；按 list/delist 日期而不是
   * 当前 list_status 计算，避免之后退市的历史股票被静默排除。
   */
  private async countActiveCoverage(dataset: CoverageDataset, tradeDate: Date): Promise<number> {
    const rows = await this.prisma.$queryRaw<CountRow[]>(Prisma.sql`
      SELECT COUNT(DISTINCT source.ts_code)::bigint AS count
      FROM ${COVERAGE_TABLES[dataset]} AS source
      INNER JOIN stock_basic_profiles AS stock ON stock.ts_code = source.ts_code
      WHERE source.trade_date = ${tradeDate}
        AND (stock.list_date IS NULL OR stock.list_date <= ${tradeDate})
        AND (stock.delist_date IS NULL OR stock.delist_date > ${tradeDate})
    `)
    return Number(rows[0]?.count ?? 0)
  }

  /**
   * 资金流累积、MACD/KDJ 交叉都读取窗口中的前序交易日。按交易日历逐日核验，
   * 避免源表少一天时 SQL 静默向更早日期补行而改变计算语义。
   */
  private async checkRecentWindow(input: {
    key: string
    dataset: CoverageDataset
    targetDate: Date
    requiredDays: number
    missing: Set<string>
    dataVersions: Record<string, string>
  }): Promise<void> {
    const tradeDates = await this.findRecentOpenTradeDates(input.targetDate, input.requiredDays)
    if (tradeDates.length !== input.requiredDays) {
      input.missing.add(`${input.key}_WINDOW_NOT_READY`)
      return
    }

    const earliestTradeDate = tradeDates[tradeDates.length - 1]
    const [universeSize, coveredCount] = await Promise.all([
      this.countTradableUniverse(earliestTradeDate),
      this.countActiveWindowCoverage(input.dataset, tradeDates, earliestTradeDate),
    ])
    const coverage = universeSize > 0 ? coveredCount / universeSize : 0
    if (coverage < MIN_TARGET_COVERAGE) {
      input.missing.add(`${input.key}_WINDOW_NOT_READY`)
      return
    }
    input.dataVersions[`${input.key}_WINDOW`] = [
      `days:${input.requiredDays}`,
      `from:${this.formatTradeDate(earliestTradeDate)}`,
      `to:${this.formatTradeDate(tradeDates[0])}`,
      `coverage:${coveredCount}/${universeSize}`,
    ].join(':')
  }

  private async findRecentOpenTradeDates(targetDate: Date, take: number): Promise<Date[]> {
    const rows = await this.prisma.tradeCal.findMany({
      where: { exchange: StockExchange.SSE, isOpen: '1', calDate: { lte: targetDate } },
      orderBy: { calDate: 'desc' },
      take,
      select: { calDate: true },
    })
    return rows.map((row) => row.calDate)
  }

  private async countActiveWindowCoverage(
    dataset: CoverageDataset,
    tradeDates: Date[],
    earliestTradeDate: Date,
  ): Promise<number> {
    const rows = await this.prisma.$queryRaw<CountRow[]>(Prisma.sql`
      SELECT COUNT(*)::bigint AS count
      FROM (
        SELECT stock.ts_code
        FROM stock_basic_profiles AS stock
        INNER JOIN ${COVERAGE_TABLES[dataset]} AS source ON source.ts_code = stock.ts_code
        WHERE (stock.list_date IS NULL OR stock.list_date <= ${earliestTradeDate})
          AND (stock.delist_date IS NULL OR stock.delist_date > ${earliestTradeDate})
          AND source.trade_date = ANY(${tradeDates})
        GROUP BY stock.ts_code
        HAVING COUNT(DISTINCT source.trade_date) = ${tradeDates.length}
      ) AS covered
    `)
    return Number(rows[0]?.count ?? 0)
  }

  private async countTradableUniverse(tradeDate: Date): Promise<number> {
    return this.prisma.stockBasic.count({
      where: {
        AND: [
          { OR: [{ listDate: null }, { listDate: { lte: tradeDate } }] },
          { OR: [{ delistDate: null }, { delistDate: { gt: tradeDate } }] },
        ],
      },
    })
  }

  private async resolveFactorUniverse(
    tradeDate: Date,
    ruleSpec: FactorScreeningRuleSpec | SignalEventRuleSpec,
  ): Promise<string[]> {
    const [stocks, dailyCodes] = await Promise.all([
      this.prisma.stockBasic.findMany({
        where: {
          listStatus: 'L',
          AND: [
            { OR: [{ listDate: null }, { listDate: { lte: tradeDate } }] },
            { OR: [{ delistDate: null }, { delistDate: { gt: tradeDate } }] },
          ],
        },
        select: { tsCode: true, name: true },
      }),
      ruleSpec.universe.excludeSuspended
        ? this.prisma.daily.findMany({ where: { tradeDate }, select: { tsCode: true } })
        : Promise.resolve([]),
    ])
    const activeDaily = new Set(dailyCodes.map((row) => row.tsCode))
    return stocks
      .filter((stock) => {
        if (ruleSpec.universe.excludeSt && isSpecialTreatmentStockName(stock.name)) return false
        if (ruleSpec.universe.excludeBse && stock.tsCode.endsWith('.BJ')) return false
        return !ruleSpec.universe.excludeSuspended || activeDaily.has(stock.tsCode)
      })
      .map((stock) => stock.tsCode)
  }

  private async countMatureTradableUniverse(targetDate: Date, eligibleBefore: Date): Promise<number> {
    return this.prisma.stockBasic.count({
      where: {
        listDate: { lte: eligibleBefore },
        OR: [{ delistDate: null }, { delistDate: { gt: targetDate } }],
      },
    })
  }

  private async countFinancialCoverage(targetDate: Date, eligibleBefore: Date): Promise<number> {
    const rows = await this.prisma.$queryRaw<CountRow[]>(Prisma.sql`
      SELECT COUNT(DISTINCT fi.ts_code)::bigint AS count
      FROM financial_indicator_snapshots AS fi
      INNER JOIN stock_basic_profiles AS stock ON stock.ts_code = fi.ts_code
      WHERE fi.ann_date IS NOT NULL
        AND fi.ann_date <= ${targetDate}
        AND stock.list_date <= ${eligibleBefore}
        AND (stock.delist_date IS NULL OR stock.delist_date > ${targetDate})
    `)
    return Number(rows[0]?.count ?? 0)
  }

  private requiresPreviousTechnicalRow(filters: Record<string, unknown>): boolean {
    return (
      filters.minBuySignalCount !== undefined ||
      filters.macdSignal === 'golden_cross' ||
      filters.macdSignal === 'death_cross' ||
      filters.kdjSignal === 'golden_cross' ||
      filters.kdjSignal === 'death_cross'
    )
  }

  private async findDailyBasicWatermark(targetDate: Date): Promise<Date | null> {
    return (
      (
        await this.prisma.dailyBasic.findFirst({
          where: { tradeDate: { lte: targetDate } },
          orderBy: { tradeDate: 'desc' },
          select: { tradeDate: true },
        })
      )?.tradeDate ?? null
    )
  }

  private async findStkFactorWatermark(targetDate: Date): Promise<Date | null> {
    return (
      (
        await this.prisma.stkFactor.findFirst({
          where: { tradeDate: { lte: targetDate } },
          orderBy: { tradeDate: 'desc' },
          select: { tradeDate: true },
        })
      )?.tradeDate ?? null
    )
  }

  private async findMoneyflowWatermark(targetDate: Date): Promise<Date | null> {
    return (
      (
        await this.prisma.moneyflow.findFirst({
          where: { tradeDate: { lte: targetDate } },
          orderBy: { tradeDate: 'desc' },
          select: { tradeDate: true },
        })
      )?.tradeDate ?? null
    )
  }

  private async findHkHoldWatermark(targetDate: Date): Promise<Date | null> {
    return (
      (
        await this.prisma.hkHold.findFirst({
          where: { tradeDate: { lte: targetDate } },
          orderBy: { tradeDate: 'desc' },
          select: { tradeDate: true },
        })
      )?.tradeDate ?? null
    )
  }

  private hasAny(filters: Record<string, unknown>, fields: string[]): boolean {
    return fields.some((field) => filters[field] !== undefined)
  }

  private readStringArray(value: unknown): string[] | null {
    if (value === undefined) return []
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) return null
    return value
  }

  private parseTradeDate(value: string): Date | null {
    if (!/^\d{8}$/.test(value)) return null
    const year = Number(value.slice(0, 4))
    const month = Number(value.slice(4, 6))
    const day = Number(value.slice(6, 8))
    const date = new Date(Date.UTC(year, month - 1, day))
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : null
  }

  private formatTradeDate(date: Date): string {
    return dayjs(date).tz('Asia/Shanghai').format('YYYYMMDD')
  }

  private isFresh(date: Date): boolean {
    return Date.now() - date.getTime() <= STOCK_BASIC_MAX_AGE_MS
  }

  private notReady(tradeDate: string, missing: string[]): SubscriptionDataReadinessResult {
    return { ready: false, tradeDate, dataVersions: {}, missing }
  }
}
