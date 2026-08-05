import { Injectable } from '@nestjs/common'
import { Decimal } from '@prisma/client/runtime/library'
import { Prisma } from '@prisma/client'
import { PrismaService } from 'src/shared/prisma.service'

export const PORTFOLIO_NAV_ALGORITHM_VERSION = 'portfolio-nav.v1' as const
export const DEFAULT_PORTFOLIO_BENCHMARK = '000300.SH' as const

interface PriceRow {
  tsCode: string
  tradeDate: Date
  close: number | null
}

interface ReconstructedPosition {
  holdingId: string | null
  tsCode: string
  quantity: number
  avgCost: Decimal
}

@Injectable()
export class PortfolioSnapshotService {
  constructor(private readonly prisma: PrismaService) {}

  async rebuildLatestForAll(): Promise<{ tradeDate: string | null; portfolios: number; snapshots: number }> {
    const latest = await this.prisma.daily.findFirst({ orderBy: { tradeDate: 'desc' }, select: { tradeDate: true } })
    if (!latest) return { tradeDate: null, portfolios: 0, snapshots: 0 }
    const portfolios = await this.prisma.portfolio.findMany({
      where: { isArchived: false },
      select: { id: true },
      orderBy: { id: 'asc' },
      take: 10_000,
    })
    let snapshots = 0
    for (const portfolio of portfolios) {
      const coverage = await this.resolveCoverageStart(portfolio.id)
      if (!coverage || coverage > latest.tradeDate) continue
      await this.rebuildPortfolioDate(portfolio.id, latest.tradeDate)
      snapshots += 1
    }
    return { tradeDate: toIsoDate(latest.tradeDate), portfolios: portfolios.length, snapshots }
  }

  async rebuildPortfolioFrom(portfolioId: string, startDate: Date): Promise<number> {
    const latest = await this.prisma.daily.findFirst({ orderBy: { tradeDate: 'desc' }, select: { tradeDate: true } })
    if (!latest || startDate > latest.tradeDate) return 0
    const dates = await this.prisma.tradeCal.findMany({
      where: { isOpen: '1', calDate: { gte: dateOnly(startDate), lte: latest.tradeDate } },
      distinct: ['calDate'],
      orderBy: { calDate: 'asc' },
      select: { calDate: true },
      take: 1_250,
    })
    for (const row of dates) await this.rebuildPortfolioDate(portfolioId, row.calDate)
    return dates.length
  }

  async rebuildPortfolioDate(
    portfolioId: string,
    tradeDate: Date,
    benchmarkCode = DEFAULT_PORTFOLIO_BENCHMARK,
  ): Promise<void> {
    const normalizedDate = dateOnly(tradeDate)
    const portfolio = await this.prisma.portfolio.findUnique({
      where: { id: portfolioId },
      select: { id: true, initialCash: true },
    })
    if (!portfolio) throw new PortfolioSnapshotError('PORTFOLIO_NOT_FOUND', '组合不存在')

    const events = await this.prisma.portfolioHoldingEvent.findMany({
      where: { portfolioId, effectiveDate: { lte: normalizedDate } },
      orderBy: [{ effectiveDate: 'asc' }, { occurredAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        holdingId: true,
        tsCode: true,
        afterQuantity: true,
        afterAvgCost: true,
        occurredAt: true,
      },
      take: 100_000,
    })
    if (events.length === 0) throw new PortfolioSnapshotError('EVENTS_NOT_READY', '组合尚无点时持仓事件')

    const positions = new Map<string, ReconstructedPosition>()
    for (const event of events) {
      if (event.afterQuantity <= 0 || event.afterAvgCost == null) {
        positions.delete(event.tsCode)
        continue
      }
      positions.set(event.tsCode, {
        holdingId: event.holdingId,
        tsCode: event.tsCode,
        quantity: event.afterQuantity,
        avgCost: event.afterAvgCost,
      })
    }

    const priceRows = await this.loadLatestPrices([...positions.keys()], normalizedDate)
    const priceMap = new Map(priceRows.map((row) => [row.tsCode, row]))
    const missing = [...positions.keys()].filter((tsCode) => priceMap.get(tsCode)?.close == null)
    if (missing.length > 0) {
      throw new PortfolioSnapshotError('PRICE_NOT_READY', `持仓缺少可用收盘价：${missing.slice(0, 10).join(',')}`)
    }

    const positionRows = [...positions.values()].map((position) => {
      const price = priceMap.get(position.tsCode) as PriceRow
      const close = new Decimal(price.close as number)
      const marketValue = close.mul(position.quantity)
      const flags = sameDate(price.tradeDate, normalizedDate) ? [] : ['POSITION_PRICE_STALE']
      return { position, close, priceDate: price.tradeDate, marketValue, flags }
    })
    const marketValue = positionRows.reduce((sum, row) => sum.plus(row.marketValue), new Decimal(0))
    const investedCost = positionRows.reduce(
      (sum, row) => sum.plus(row.position.avgCost.mul(row.position.quantity)),
      new Decimal(0),
    )
    const cash = portfolio.initialCash.minus(investedCost)
    const totalAssets = cash.plus(marketValue)
    const nav = portfolio.initialCash.isZero() ? new Decimal(0) : totalAssets.div(portfolio.initialCash)

    const [previous, benchmark] = await Promise.all([
      this.prisma.portfolioDailySnapshot.findFirst({
        where: { portfolioId, tradeDate: { lt: normalizedDate } },
        orderBy: { tradeDate: 'desc' },
      }),
      this.prisma.indexDaily.findFirst({
        where: { tsCode: benchmarkCode, tradeDate: { lte: normalizedDate } },
        orderBy: { tradeDate: 'desc' },
        select: { tradeDate: true, pctChg: true },
      }),
    ])
    const dailyReturn = previous && !previous.nav.isZero() ? nav.div(previous.nav).minus(1).toNumber() : null
    const benchmarkReturn = previous && benchmark?.pctChg != null ? benchmark.pctChg / 100 : null
    const benchmarkNav = !benchmark
      ? null
      : previous
        ? benchmarkReturn == null
          ? previous.benchmarkNav
          : new Decimal(previous.benchmarkNav ?? 1).mul(new Decimal(1).plus(benchmarkReturn))
        : new Decimal(1)
    const qualityFlags = [
      'REALIZED_PNL_NOT_AVAILABLE',
      ...new Set(positionRows.flatMap((row) => row.flags)),
      ...(benchmark && !sameDate(benchmark.tradeDate, normalizedDate) ? ['BENCHMARK_PRICE_STALE'] : []),
    ]
    const existing = await this.prisma.portfolioDailySnapshot.findUnique({
      where: { portfolioId_tradeDate: { portfolioId, tradeDate: normalizedDate } },
      select: { algorithmVersion: true },
    })
    if (existing && existing.algorithmVersion !== PORTFOLIO_NAV_ALGORITHM_VERSION) {
      throw new PortfolioSnapshotError('ALGORITHM_VERSION_CONFLICT', '已有其他算法版本快照，拒绝覆盖')
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.portfolioPositionSnapshot.deleteMany({ where: { portfolioId, tradeDate: normalizedDate } })
      if (positionRows.length > 0) {
        await tx.portfolioPositionSnapshot.createMany({
          data: positionRows.map((row) => ({
            portfolioId,
            tradeDate: normalizedDate,
            tsCode: row.position.tsCode,
            quantity: row.position.quantity,
            avgCost: row.position.avgCost,
            close: row.close,
            priceDate: row.priceDate,
            marketValue: row.marketValue,
            weight: marketValue.isZero() ? null : row.marketValue.div(marketValue).toNumber(),
            algorithmVersion: PORTFOLIO_NAV_ALGORITHM_VERSION,
            qualityFlags: row.flags,
          })),
        })
      }
      await tx.portfolioDailySnapshot.upsert({
        where: { portfolioId_tradeDate: { portfolioId, tradeDate: normalizedDate } },
        create: {
          portfolioId,
          tradeDate: normalizedDate,
          totalAssets,
          marketValue,
          cash,
          nav,
          dailyReturn,
          benchmarkCode,
          benchmarkNav,
          benchmarkReturn,
          sourceEventThrough: events.at(-1)?.occurredAt ?? null,
          algorithmVersion: PORTFOLIO_NAV_ALGORITHM_VERSION,
          qualityFlags,
        },
        update: {
          totalAssets,
          marketValue,
          cash,
          nav,
          dailyReturn,
          benchmarkCode,
          benchmarkNav,
          benchmarkReturn,
          sourceEventThrough: events.at(-1)?.occurredAt ?? null,
          algorithmVersion: PORTFOLIO_NAV_ALGORITHM_VERSION,
          qualityFlags,
          computedAt: new Date(),
        },
      })
    })
  }

  private async resolveCoverageStart(portfolioId: string): Promise<Date | null> {
    const event = await this.prisma.portfolioHoldingEvent.findFirst({
      where: { portfolioId },
      orderBy: { effectiveDate: 'asc' },
      select: { effectiveDate: true },
    })
    return event?.effectiveDate ?? null
  }

  private async loadLatestPrices(tsCodes: string[], tradeDate: Date): Promise<PriceRow[]> {
    if (tsCodes.length === 0) return []
    return this.prisma.$queryRaw<PriceRow[]>(Prisma.sql`
      SELECT DISTINCT ON ("ts_code")
        "ts_code" AS "tsCode", "trade_date" AS "tradeDate", "close"
      FROM "stock_daily_prices"
      WHERE "ts_code" IN (${Prisma.join(tsCodes)})
        AND "trade_date" <= ${tradeDate}::date
        AND "close" IS NOT NULL
      ORDER BY "ts_code" ASC, "trade_date" DESC
    `)
  }
}

export class PortfolioSnapshotError extends Error {
  constructor(
    readonly code: 'PORTFOLIO_NOT_FOUND' | 'EVENTS_NOT_READY' | 'PRICE_NOT_READY' | 'ALGORITHM_VERSION_CONFLICT',
    message: string,
  ) {
    super(message)
    this.name = PortfolioSnapshotError.name
  }
}

function dateOnly(value: Date): Date {
  return new Date(`${toIsoDate(value)}T00:00:00.000Z`)
}

function sameDate(left: Date, right: Date): boolean {
  return toIsoDate(left) === toIsoDate(right)
}

function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10)
}
