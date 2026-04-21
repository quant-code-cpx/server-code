import { Injectable } from '@nestjs/common'
import { PrismaService } from 'src/shared/prisma.service'
import { CacheService } from 'src/shared/cache.service'
import { CACHE_KEY_PREFIX, CACHE_NAMESPACE } from 'src/constant/cache.constant'
import { PortfolioService } from './portfolio.service'

const TTL_RISK = 10 * 60
const TTL_BETA = 60 * 60

// 基准指数（沪深300）
const BENCHMARK_TS_CODE = '399300.SZ'
// Beta 计算窗口天数
const BETA_WINDOW = 250
const BETA_MIN_DAYS = 60

@Injectable()
export class PortfolioRiskService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: CacheService,
    private readonly portfolioService: PortfolioService,
  ) {}

  // ─── 行业分布 ─────────────────────────────────────────────────────────────

  async getIndustryDistribution(portfolioId: string, userId: number) {
    await this.portfolioService.assertOwner(portfolioId, userId)
    const key = `${CACHE_KEY_PREFIX.PORTFOLIO_RISK}:ind:${portfolioId}`
    return this.rememberCache(key, TTL_RISK, () => this.calcIndustryDistribution(portfolioId))
  }

  // ─── 仓位集中度 ───────────────────────────────────────────────────────────

  async getPositionConcentration(portfolioId: string, userId: number) {
    await this.portfolioService.assertOwner(portfolioId, userId)
    const key = `${CACHE_KEY_PREFIX.PORTFOLIO_RISK}:pos:${portfolioId}`
    return this.rememberCache(key, TTL_RISK, () => this.calcPositionConcentration(portfolioId))
  }

  // ─── 市值分布 ─────────────────────────────────────────────────────────────

  async getMarketCapDistribution(portfolioId: string, userId: number) {
    await this.portfolioService.assertOwner(portfolioId, userId)
    const key = `${CACHE_KEY_PREFIX.PORTFOLIO_RISK}:cap:${portfolioId}`
    return this.rememberCache(key, TTL_RISK, () => this.calcMarketCapDistribution(portfolioId))
  }

  // ─── Beta 分析 ────────────────────────────────────────────────────────────

  async getBetaAnalysis(portfolioId: string, userId: number) {
    await this.portfolioService.assertOwner(portfolioId, userId)
    const key = `${CACHE_KEY_PREFIX.PORTFOLIO_RISK}:beta:${portfolioId}`
    return this.rememberCache(key, TTL_BETA, () => this.calcBetaAnalysis(portfolioId))
  }

  // ─── 计算方法 ─────────────────────────────────────────────────────────────

  private async calcIndustryDistribution(portfolioId: string) {
    const latestDate = await this.portfolioService.getLatestTradeDate()
    const tradeDateStr = latestDate ? this.formatDate(latestDate) : null

    type IndustryRow = {
      industry: string | null
      stock_count: bigint
      total_market_value: unknown
      weight: unknown
    }

    const rows = await this.prisma.$queryRawUnsafe<IndustryRow[]>(
      `
      WITH latest AS (
        SELECT DISTINCT ON (ts_code) ts_code, close
        FROM stock_daily_valuation_metrics
        WHERE trade_date = $2::date
        ORDER BY ts_code, trade_date DESC
      ),
      holdings AS (
        SELECT
          h."tsCode" AS ts_code,
          h.quantity,
          b.name,
          b.industry,
          COALESCE(l.close * h.quantity, h."avgCost" * h.quantity) AS mkt_val
        FROM portfolio_holdings h
        JOIN stock_basic_profiles b ON b.ts_code = h."tsCode"
        LEFT JOIN latest l ON l.ts_code = h."tsCode"
        WHERE h."portfolioId" = $1
      ),
      total AS (
        SELECT SUM(mkt_val) AS total_mv FROM holdings
      )
      SELECT
        COALESCE(industry, '未知') AS industry,
        COUNT(*)::bigint AS stock_count,
        SUM(mkt_val) AS total_market_value,
        SUM(mkt_val) / NULLIF((SELECT total_mv FROM total), 0) AS weight
      FROM holdings
      GROUP BY industry
      ORDER BY weight DESC NULLS LAST
      `,
      portfolioId,
      tradeDateStr ?? '1970-01-01',
    )

    return {
      tradeDate: tradeDateStr,
      industries: rows.map((r) => ({
        industry: r.industry ?? '未知',
        stockCount: Number(r.stock_count),
        totalMarketValue: r.total_market_value != null ? Number(r.total_market_value) : null,
        weight: r.weight != null ? Math.round(Number(r.weight) * 10000) / 10000 : null,
      })),
    }
  }

  private async calcPositionConcentration(portfolioId: string) {
    const latestDate = await this.portfolioService.getLatestTradeDate()
    const tradeDateStr = latestDate ? this.formatDate(latestDate) : null

    type PositionRow = {
      ts_code: string
      stock_name: string
      mkt_val: unknown
      weight: unknown
    }

    const rows = await this.prisma.$queryRawUnsafe<PositionRow[]>(
      `
      WITH latest AS (
        SELECT DISTINCT ON (ts_code) ts_code, close
        FROM stock_daily_valuation_metrics
        WHERE trade_date = $2::date
        ORDER BY ts_code, trade_date DESC
      ),
      holdings AS (
        SELECT
          h."tsCode" AS ts_code,
          h."stockName" AS stock_name,
          COALESCE(l.close * h.quantity, h."avgCost" * h.quantity) AS mkt_val
        FROM portfolio_holdings h
        LEFT JOIN latest l ON l.ts_code = h."tsCode"
        WHERE h."portfolioId" = $1
      ),
      total AS (
        SELECT SUM(mkt_val) AS total_mv FROM holdings
      )
      SELECT
        ts_code,
        stock_name,
        mkt_val,
        mkt_val / NULLIF((SELECT total_mv FROM total), 0) AS weight
      FROM holdings
      ORDER BY weight DESC NULLS LAST
      `,
      portfolioId,
      tradeDateStr ?? '1970-01-01',
    )

    const positions = rows.map((r) => ({
      tsCode: r.ts_code,
      stockName: r.stock_name,
      marketValue: r.mkt_val != null ? Number(r.mkt_val) : null,
      weight: r.weight != null ? Math.round(Number(r.weight) * 10000) / 10000 : null,
    }))

    // HHI 集中度指数
    const weights = positions.map((p) => p.weight ?? 0)
    const hhi = weights.reduce((sum, w) => sum + w * w, 0)
    const top1Weight = positions[0]?.weight ?? 0
    const top3Weight = positions.slice(0, 3).reduce((s, p) => s + (p.weight ?? 0), 0)
    const top5Weight = positions.slice(0, 5).reduce((s, p) => s + (p.weight ?? 0), 0)

    return {
      tradeDate: tradeDateStr,
      positions,
      concentration: {
        hhi: Math.round(hhi * 10000) / 10000,
        top1Weight: Math.round(top1Weight * 10000) / 10000,
        top3Weight: Math.round(top3Weight * 10000) / 10000,
        top5Weight: Math.round(top5Weight * 10000) / 10000,
      },
    }
  }

  private async calcMarketCapDistribution(portfolioId: string) {
    const latestDate = await this.portfolioService.getLatestTradeDate()
    const tradeDateStr = latestDate ? this.formatDate(latestDate) : null

    type CapRow = {
      ts_code: string
      stock_name: string
      total_mv: unknown
      weight: unknown
      cap_tier: string
    }

    const rows = await this.prisma.$queryRawUnsafe<CapRow[]>(
      `
      WITH latest_val AS (
        SELECT DISTINCT ON (ts_code) ts_code, close, total_mv AS total_mv_raw
        FROM stock_daily_valuation_metrics
        WHERE trade_date = $2::date
        ORDER BY ts_code, trade_date DESC
      ),
      holdings AS (
        SELECT
          h."tsCode" AS ts_code,
          h."stockName" AS stock_name,
          COALESCE(lv.close * h.quantity, h."avgCost" * h.quantity) AS mkt_val,
          lv.total_mv_raw
        FROM portfolio_holdings h
        LEFT JOIN latest_val lv ON lv.ts_code = h."tsCode"
        WHERE h."portfolioId" = $1
      ),
      total AS (
        SELECT SUM(mkt_val) AS total_mv FROM holdings
      )
      SELECT
        ts_code,
        stock_name,
        total_mv_raw AS total_mv,
        mkt_val / NULLIF((SELECT total_mv FROM total), 0) AS weight,
        CASE
          WHEN total_mv_raw IS NULL THEN '未知'
          WHEN total_mv_raw >= 100000 THEN '超大盘(>1000亿)'
          WHEN total_mv_raw >= 20000 THEN '大盘(200-1000亿)'
          WHEN total_mv_raw >= 5000 THEN '中盘(50-200亿)'
          ELSE '小盘(<50亿)'
        END AS cap_tier
      FROM holdings
      ORDER BY weight DESC NULLS LAST
      `,
      portfolioId,
      tradeDateStr ?? '1970-01-01',
    )

    const tierMap = new Map<string, { weight: number; count: number }>()
    for (const r of rows) {
      const tier = r.cap_tier
      const w = r.weight != null ? Number(r.weight) : 0
      const existing = tierMap.get(tier)
      if (existing) {
        existing.weight += w
        existing.count++
      } else {
        tierMap.set(tier, { weight: w, count: 1 })
      }
    }

    const tierOrder = ['超大盘(>1000亿)', '大盘(200-1000亿)', '中盘(50-200亿)', '小盘(<50亿)', '未知']
    const tiers = tierOrder
      .filter((t) => tierMap.has(t))
      .map((t) => {
        const d = tierMap.get(t)!
        return {
          tier: t,
          weight: Math.round(d.weight * 10000) / 10000,
          stockCount: d.count,
        }
      })

    return {
      tradeDate: tradeDateStr,
      byStock: rows.map((r) => ({
        tsCode: r.ts_code,
        stockName: r.stock_name,
        totalMv: r.total_mv != null ? Number(r.total_mv) : null,
        weight: r.weight != null ? Math.round(Number(r.weight) * 10000) / 10000 : null,
        capTier: r.cap_tier,
      })),
      tiers,
    }
  }

  private async calcBetaAnalysis(portfolioId: string) {
    const latestDate = await this.portfolioService.getLatestTradeDate()
    if (!latestDate) return { tradeDate: null, portfolioBeta: null, holdings: [] }

    const tradeDateStr = this.formatDate(latestDate)

    // 查持仓
    const holdings = await this.prisma.portfolioHolding.findMany({
      where: { portfolioId },
      select: { tsCode: true, stockName: true, quantity: true, avgCost: true },
    })
    if (!holdings.length) return { tradeDate: tradeDateStr, portfolioBeta: null, holdings: [] }

    const tsCodes = holdings.map((h) => h.tsCode)

    // 查 BETA_WINDOW 天的基准收益率
    type PriceRow = { ts_code: string; pct_chg: unknown }
    const [stockRows, benchRows] = await Promise.all([
      this.prisma.$queryRawUnsafe<PriceRow[]>(
        `
        SELECT ts_code, pct_chg
        FROM stock_daily_prices
        WHERE ts_code = ANY($1::text[])
          AND trade_date <= $2::date
          AND pct_chg IS NOT NULL
        ORDER BY ts_code, trade_date DESC
        `,
        tsCodes,
        tradeDateStr,
      ),
      this.prisma.$queryRawUnsafe<PriceRow[]>(
        `
        SELECT ts_code, pct_chg
        FROM index_daily_prices
        WHERE ts_code = $1
          AND trade_date <= $2::date
          AND pct_chg IS NOT NULL
        ORDER BY trade_date DESC
        LIMIT $3
        `,
        BENCHMARK_TS_CODE,
        tradeDateStr,
        BETA_WINDOW,
      ),
    ])

    const benchReturns = benchRows.map((r) => Number(r.pct_chg))
    const benchVar = variance(benchReturns)

    // 按股票分组，截取最近 BETA_WINDOW 条
    const stockMap = new Map<string, number[]>()
    for (const r of stockRows) {
      const arr = stockMap.get(r.ts_code) ?? []
      if (arr.length < BETA_WINDOW) arr.push(Number(r.pct_chg))
      stockMap.set(r.ts_code, arr)
    }

    // 计算每只股票的 Beta
    const holdingBetas: { tsCode: string; stockName: string; beta: number | null; dataPoints: number }[] = []
    let totalMv = 0
    const mvMap = new Map<string, number>()

    for (const h of holdings) {
      const mv = Number(h.avgCost) * h.quantity
      totalMv += mv
      mvMap.set(h.tsCode, mv)
    }

    for (const h of holdings) {
      const returns = stockMap.get(h.tsCode) ?? []
      const dataPoints = Math.min(returns.length, benchReturns.length)

      let beta: number | null = null
      if (dataPoints >= BETA_MIN_DAYS && benchVar > 0) {
        const stockR = returns.slice(0, dataPoints)
        const benchR = benchReturns.slice(0, dataPoints)
        const cov = covariance(stockR, benchR)
        beta = Math.round((cov / benchVar) * 10000) / 10000
      }

      holdingBetas.push({ tsCode: h.tsCode, stockName: h.stockName, beta, dataPoints })
    }

    // 加权组合 Beta
    let portfolioBeta: number | null = null
    const validBetas = holdingBetas.filter((h) => h.beta != null)
    if (validBetas.length > 0 && totalMv > 0) {
      portfolioBeta =
        validBetas.reduce((sum, h) => {
          const w = (mvMap.get(h.tsCode) ?? 0) / totalMv
          return sum + h.beta! * w
        }, 0) /
        (validBetas.reduce((sum, h) => sum + (mvMap.get(h.tsCode) ?? 0), 0) / totalMv)
      portfolioBeta = Math.round(portfolioBeta * 10000) / 10000
    }

    return {
      tradeDate: tradeDateStr,
      benchmarkCode: BENCHMARK_TS_CODE,
      portfolioBeta,
      holdings: holdingBetas,
    }
  }

  // ─── 工具方法 ─────────────────────────────────────────────────────────────

  private formatDate(date: Date): string {
    const y = date.getFullYear()
    const m = String(date.getMonth() + 1).padStart(2, '0')
    const d = String(date.getDate()).padStart(2, '0')
    return `${y}${m}${d}`
  }

  private rememberCache<T>(key: string, ttlSeconds: number, loader: () => Promise<T>) {
    return this.cacheService.rememberJson({
      namespace: CACHE_NAMESPACE.PORTFOLIO,
      key,
      ttlSeconds,
      loader,
    })
  }
}

// ─── 统计工具 ─────────────────────────────────────────────────────────────────

function mean(arr: number[]): number {
  return arr.length === 0 ? 0 : arr.reduce((s, v) => s + v, 0) / arr.length
}

function variance(arr: number[]): number {
  if (arr.length < 2) return 0
  const m = mean(arr)
  return arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length
}

function covariance(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length)
  if (n < 2) return 0
  const ma = mean(a.slice(0, n))
  const mb = mean(b.slice(0, n))
  return a.slice(0, n).reduce((s, v, i) => s + (v - ma) * (b[i] - mb), 0) / n
}
