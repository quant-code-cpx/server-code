import { Injectable, Logger } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import * as dayjs from 'dayjs'

import { PrismaService } from 'src/shared/prisma.service'
import { BacktestReportData, PortfolioReportData, StockReportData } from '../dto/report-data.interface'

@Injectable()
export class ReportDataCollectorService {
  private readonly logger = new Logger(ReportDataCollectorService.name)

  constructor(private readonly prisma: PrismaService) {}

  // ─── 回测报告 ──────────────────────────────────────────────────────────────

  async collectBacktestData(runId: string): Promise<BacktestReportData> {
    const run = await this.prisma.backtestRun.findUniqueOrThrow({
      where: { id: runId },
    })

    const [navRows, trades, positions] = await Promise.all([
      this.prisma.backtestDailyNav.findMany({
        where: { runId },
        orderBy: { tradeDate: 'asc' },
      }),
      this.prisma.backtestTrade.findMany({
        where: { runId },
        orderBy: { tradeDate: 'asc' },
      }),
      this.getEndPositions(runId),
    ])

    return {
      strategy: {
        name: run.name ?? run.strategyType,
        params: run.strategyConfig as Record<string, unknown>,
        startDate: dayjs(run.startDate).format('YYYY-MM-DD'),
        endDate: dayjs(run.endDate).format('YYYY-MM-DD'),
        benchmark: run.benchmarkTsCode,
        initialCapital: new Prisma.Decimal(run.initialCapital).toNumber(),
      },
      metrics: {
        totalReturn: run.totalReturn,
        annualizedReturn: run.annualizedReturn,
        benchmarkReturn: run.benchmarkReturn,
        excessReturn: run.excessReturn,
        maxDrawdown: run.maxDrawdown,
        sharpeRatio: run.sharpeRatio,
        sortinoRatio: run.sortinoRatio,
        calmarRatio: run.calmarRatio,
        winRate: run.winRate,
        tradeCount: run.tradeCount,
        volatility: run.volatility,
        alpha: run.alpha,
        beta: run.beta,
      },
      navCurve: {
        dates: navRows.map((r) => dayjs(r.tradeDate).format('YYYY-MM-DD')),
        navValues: navRows.map((r) => new Prisma.Decimal(r.nav).toNumber()),
        benchmarkValues: navRows.map((r) => (r.benchmarkNav ? new Prisma.Decimal(r.benchmarkNav).toNumber() : 1)),
      },
      drawdownCurve: {
        dates: navRows.map((r) => dayjs(r.tradeDate).format('YYYY-MM-DD')),
        values: navRows.map((r) => r.drawdown ?? 0),
      },
      monthlyReturns: this.aggregateMonthlyReturns(navRows),
      trades: trades.map((t) => ({
        date: dayjs(t.tradeDate).format('YYYY-MM-DD'),
        tsCode: t.tsCode,
        side: t.side,
        price: new Prisma.Decimal(t.price).toNumber(),
        quantity: t.quantity,
        amount: new Prisma.Decimal(t.amount).toNumber(),
      })),
      endPositions: positions,
    }
  }

  private async getEndPositions(runId: string): Promise<BacktestReportData['endPositions']> {
    // 取最后交易日的持仓快照
    const lastSnapshot = await this.prisma.backtestPositionSnapshot.findFirst({
      where: { runId },
      orderBy: { tradeDate: 'desc' },
      select: { tradeDate: true },
    })
    if (!lastSnapshot) return []

    const rows = await this.prisma.backtestPositionSnapshot.findMany({
      where: { runId, tradeDate: lastSnapshot.tradeDate },
    })
    return rows.map((r) => ({
      tsCode: r.tsCode,
      quantity: r.quantity,
      weight: r.weight,
      unrealizedPnl: r.unrealizedPnl ? new Prisma.Decimal(r.unrealizedPnl).toNumber() : null,
    }))
  }

  private aggregateMonthlyReturns(
    navRows: { tradeDate: Date; dailyReturn: number | null }[],
  ): BacktestReportData['monthlyReturns'] {
    const monthlyMap = new Map<string, number>()
    for (const row of navRows) {
      if (row.dailyReturn == null) continue
      const key = dayjs(row.tradeDate).format('YYYY-MM')
      const prev = monthlyMap.get(key) ?? 0
      // 累计月度收益：(1+prev)*(1+daily)-1
      monthlyMap.set(key, (1 + prev) * (1 + row.dailyReturn) - 1)
    }
    return Array.from(monthlyMap.entries()).map(([key, ret]) => ({
      year: parseInt(key.slice(0, 4)),
      month: parseInt(key.slice(5, 7)),
      return: Math.round(ret * 10000) / 10000,
    }))
  }

  // ─── 个股报告 ──────────────────────────────────────────────────────────────

  async collectStockData(tsCode: string): Promise<StockReportData> {
    const [overview, priceRows, financials, holders, dividends] = await Promise.all([
      this.prisma.stockBasic.findUnique({ where: { tsCode } }),
      this.prisma.daily.findMany({
        where: { tsCode },
        orderBy: { tradeDate: 'desc' },
        take: 250,
      }),
      this.prisma.finaIndicator.findMany({
        where: { tsCode },
        orderBy: { endDate: 'desc' },
        take: 8,
      }),
      this.getLatestTop10Holders(tsCode),
      this.prisma.dividend.findMany({
        where: { tsCode },
        orderBy: { endDate: 'desc' },
        take: 10,
      }),
    ])

    // 价格按时间正序
    const sortedPrices = priceRows.reverse()

    return {
      overview: {
        tsCode,
        name: overview?.name ?? null,
        industry: overview?.industry ?? null,
        listDate: overview?.listDate ? dayjs(overview.listDate).format('YYYY-MM-DD') : null,
        area: overview?.area ?? null,
      },
      priceHistory: {
        dates: sortedPrices.map((r) => dayjs(r.tradeDate).format('YYYY-MM-DD')),
        opens: sortedPrices.map((r) => r.open ?? 0),
        highs: sortedPrices.map((r) => r.high ?? 0),
        lows: sortedPrices.map((r) => r.low ?? 0),
        closes: sortedPrices.map((r) => r.close ?? 0),
        volumes: sortedPrices.map((r) => r.vol ?? 0),
      },
      technicalIndicators: null, // 前端可按需调用技术指标接口
      financialSummary:
        financials.length > 0
          ? {
              periods: financials.map((f) => dayjs(f.endDate).format('YYYY-MM-DD')),
              roe: financials.map((f) => f.roe),
              netProfitMargin: financials.map((f) => f.netprofit_margin),
              revenueYoyGrowth: financials.map((f) => f.revenueYoy),
            }
          : null,
      top10Holders: holders,
      dividends: dividends.map((d) => ({
        endDate: d.endDate ? dayjs(d.endDate).format('YYYY-MM-DD') : null,
        divProc: d.divProc,
        cashDivTax: d.cashDivTax,
        stkDiv: d.stkDiv,
      })),
    }
  }

  private async getLatestTop10Holders(tsCode: string): Promise<StockReportData['top10Holders']> {
    // 取最新一期的十大股东
    const latestRow = await this.prisma.top10Holders.findFirst({
      where: { tsCode },
      orderBy: { endDate: 'desc' },
      select: { endDate: true },
    })
    if (!latestRow) return []

    const rows = await this.prisma.top10Holders.findMany({
      where: { tsCode, endDate: latestRow.endDate },
      orderBy: { holdAmount: 'desc' },
    })
    return rows.map((r) => ({
      holderName: r.holderName,
      holdAmount: r.holdAmount,
      holdRatio: r.holdRatio,
    }))
  }

  // ─── 组合报告 ──────────────────────────────────────────────────────────────

  async collectPortfolioData(portfolioId: string, userId: number): Promise<PortfolioReportData> {
    const portfolio = await this.prisma.portfolio.findFirstOrThrow({
      where: { id: portfolioId, userId },
      include: { holdings: true },
    })

    // 批量获取最新收盘价
    const tsCodes = portfolio.holdings.map((h) => h.tsCode)
    const latestPrices = await this.getLatestPrices(tsCodes)

    // 组装持仓详情
    const holdings = portfolio.holdings.map((h) => {
      const currentPrice = latestPrices.get(h.tsCode) ?? null
      const avgCost = new Prisma.Decimal(h.avgCost).toNumber()
      const marketValue = currentPrice ? currentPrice * h.quantity : null
      const costValue = avgCost * h.quantity
      return {
        tsCode: h.tsCode,
        name: h.stockName,
        quantity: h.quantity,
        costPrice: avgCost,
        currentPrice,
        marketValue,
        weight: null as number | null, // 后面计算
        pnl: marketValue ? marketValue - costValue : null,
        pnlPct: marketValue ? (marketValue - costValue) / costValue : null,
      }
    })

    // 计算权重
    const totalMv = holdings.reduce((sum, h) => sum + (h.marketValue ?? 0), 0)
    if (totalMv > 0) {
      for (const h of holdings) {
        h.weight = h.marketValue ? h.marketValue / totalMv : 0
      }
    }

    const totalCost = holdings.reduce((sum, h) => sum + h.costPrice * h.quantity, 0)

    // 行业分布
    const industryDist = await this.getIndustryDistribution(tsCodes, holdings)

    return {
      overview: {
        id: portfolio.id,
        name: portfolio.name,
        description: portfolio.description,
        totalMarketValue: totalMv,
        totalCost,
        totalPnl: totalMv - totalCost,
        createdAt: dayjs(portfolio.createdAt).format('YYYY-MM-DD'),
      },
      holdings,
      industryDistribution: industryDist,
    }
  }

  private async getLatestPrices(tsCodes: string[]): Promise<Map<string, number>> {
    if (tsCodes.length === 0) return new Map()

    // 查每个 tsCode 最近一条日线收盘价
    const rows = await this.prisma.$queryRaw<{ ts_code: string; close: number }[]>`
      SELECT DISTINCT ON (ts_code) ts_code, close
      FROM stock_daily_prices
      WHERE ts_code = ANY(${tsCodes})
      ORDER BY ts_code, trade_date DESC
    `
    const map = new Map<string, number>()
    for (const r of rows) {
      if (r.close != null) map.set(r.ts_code, r.close)
    }
    return map
  }

  private async getIndustryDistribution(
    tsCodes: string[],
    holdings: { tsCode: string; marketValue: number | null }[],
  ): Promise<PortfolioReportData['industryDistribution']> {
    if (tsCodes.length === 0) return []

    const stocks = await this.prisma.stockBasic.findMany({
      where: { tsCode: { in: tsCodes } },
      select: { tsCode: true, industry: true },
    })
    const industryMap = new Map<string, string>()
    for (const s of stocks) {
      if (s.industry) industryMap.set(s.tsCode, s.industry)
    }

    const totalMv = holdings.reduce((sum, h) => sum + (h.marketValue ?? 0), 0)
    if (totalMv === 0) return []

    const distMap = new Map<string, { weight: number; count: number }>()
    for (const h of holdings) {
      const industry = industryMap.get(h.tsCode) ?? '未知'
      const prev = distMap.get(industry) ?? { weight: 0, count: 0 }
      prev.weight += (h.marketValue ?? 0) / totalMv
      prev.count += 1
      distMap.set(industry, prev)
    }

    return Array.from(distMap.entries())
      .map(([industry, val]) => ({
        industry,
        weight: Math.round(val.weight * 10000) / 10000,
        count: val.count,
      }))
      .sort((a, b) => b.weight - a.weight)
  }
}
