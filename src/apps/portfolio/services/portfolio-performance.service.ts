import { Injectable } from '@nestjs/common'
import { PrismaService } from 'src/shared/prisma.service'
import { PortfolioService } from '../portfolio.service'
import {
  PerformanceDailyItemDto,
  PerformanceMetricsDto,
  PortfolioPerformanceDto,
  PortfolioPerformanceResponseDto,
} from '../dto/portfolio-performance.dto'

const TRADING_DAYS_PER_YEAR = 252
const RISK_FREE_RATE = 0.02 // 2% 年化无风险利率，与 BacktestMetrics 保持一致

@Injectable()
export class PortfolioPerformanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly portfolioService: PortfolioService,
  ) {}

  async getPerformance(dto: PortfolioPerformanceDto, userId: number): Promise<PortfolioPerformanceResponseDto> {
    const portfolio = await this.portfolioService.assertOwner(dto.portfolioId, userId)
    const benchmarkTsCode = dto.benchmarkTsCode ?? '000300.SH'

    // 确定日期范围
    const startDate = dto.startDate
      ? this.parseDateStr(dto.startDate)
      : new Date(portfolio.createdAt.toISOString().slice(0, 10))
    const latestTradeDate = await this.portfolioService.getLatestTradeDate()
    const endDate = dto.endDate ? this.parseDateStr(dto.endDate) : (latestTradeDate ?? new Date())

    // 加载持仓
    const holdings = await this.prisma.portfolioHolding.findMany({
      where: { portfolioId: dto.portfolioId },
      select: { tsCode: true, quantity: true, avgCost: true },
    })

    // 计算初始现金 = initialCash - totalCost（持仓成本）
    const initialCash = Number(portfolio.initialCash)
    const totalCost = holdings.reduce((sum, h) => sum + h.quantity * Number(h.avgCost), 0)
    const cashBalance = Math.max(initialCash - totalCost, 0)

    // 加载持仓股票日线
    const tsCodes = holdings.map((h) => h.tsCode)
    type DailyRow = { tsCode: string; tradeDate: Date; close: number | null }
    let dailyRows: DailyRow[] = []
    if (tsCodes.length > 0) {
      dailyRows = await this.prisma.daily.findMany({
        where: {
          tsCode: { in: tsCodes },
          tradeDate: { gte: startDate, lte: endDate },
        },
        select: { tsCode: true, tradeDate: true, close: true },
        orderBy: { tradeDate: 'asc' },
      })
    }

    // 加载基准指数日线
    const benchmarkRows = await this.prisma.indexDaily.findMany({
      where: {
        tsCode: benchmarkTsCode,
        tradeDate: { gte: startDate, lte: endDate },
      },
      select: { tradeDate: true, close: true },
      orderBy: { tradeDate: 'asc' },
    })

    if (benchmarkRows.length === 0) {
      return this.emptyResponse(dto.portfolioId, benchmarkTsCode, startDate, endDate)
    }

    // 按日期构建组合市值 Map
    const holdingQtyMap = new Map(holdings.map((h) => [h.tsCode, h.quantity]))

    type CloseByDate = Map<string, number>
    const closePriceByStock = new Map<string, CloseByDate>()
    for (const r of dailyRows) {
      const dateStr = r.tradeDate.toISOString().slice(0, 10)
      if (!closePriceByStock.has(r.tsCode)) closePriceByStock.set(r.tsCode, new Map())
      closePriceByStock.get(r.tsCode)!.set(dateStr, r.close ? Number(r.close) : 0)
    }

    // 逐日构建净值序列（基于基准日期）
    const benchmarkBase = benchmarkRows[0].close ? Number(benchmarkRows[0].close) : 1
    let cumulativeExcess = 0

    // 上一个已知收盘价（用于持仓无当日数据时的 fallback）
    // 注意：不以 avgCost 初始化，避免首日无行情时使用买入成本替代市场价
    const lastKnownPrice = new Map<string, number>()

    const dailySeries: PerformanceDailyItemDto[] = []
    let prevPortfolioNav = 1
    let prevBenchmarkNav = 1

    for (const benchRow of benchmarkRows) {
      const dateStr = benchRow.tradeDate.toISOString().slice(0, 10)
      const benchClose = benchRow.close ? Number(benchRow.close) : 0

      // 计算组合市值
      let portfolioMV = cashBalance
      for (const [tsCode, qty] of holdingQtyMap) {
        const close = closePriceByStock.get(tsCode)?.get(dateStr)
        if (close !== undefined) lastKnownPrice.set(tsCode, close)
        portfolioMV += qty * (lastKnownPrice.get(tsCode) ?? 0)
      }

      const portfolioNav = initialCash > 0 ? portfolioMV / initialCash : 1
      const benchmarkNav = benchmarkBase > 0 ? benchClose / benchmarkBase : 1

      const dailyReturn = prevPortfolioNav > 0 ? portfolioNav / prevPortfolioNav - 1 : 0
      const benchmarkReturn = prevBenchmarkNav > 0 ? benchmarkNav / prevBenchmarkNav - 1 : 0
      const excessReturn = dailyReturn - benchmarkReturn
      cumulativeExcess = (1 + cumulativeExcess) * (1 + excessReturn) - 1

      dailySeries.push({
        date: dateStr,
        portfolioNav: round4(portfolioNav),
        benchmarkNav: round4(benchmarkNav),
        dailyReturn: round4(dailyReturn),
        benchmarkReturn: round4(benchmarkReturn),
        excessReturn: round4(excessReturn),
        cumulativeExcess: round4(cumulativeExcess),
      })

      prevPortfolioNav = portfolioNav
      prevBenchmarkNav = benchmarkNav
    }

    const metrics = this.computeMetrics(dailySeries)

    return {
      portfolioId: dto.portfolioId,
      benchmarkTsCode,
      startDate: startDate.toISOString().slice(0, 10),
      endDate: endDate.toISOString().slice(0, 10),
      metrics,
      dailySeries,
    }
  }

  // ── 指标计算 ──────────────────────────────────────────────────────────────

  private computeMetrics(series: PerformanceDailyItemDto[]): PerformanceMetricsDto {
    if (series.length < 2) {
      return {
        totalReturn: 0,
        benchmarkTotalReturn: 0,
        cumulativeExcessReturn: 0,
        annualizedReturn: 0,
        annualizedVolatility: 0,
        trackingError: 0,
        informationRatio: 0,
        maxDrawdown: 0,
        sharpeRatio: 0,
      }
    }

    const first = series[0]
    const last = series[series.length - 1]
    const totalReturn = last.portfolioNav - 1
    const benchmarkTotalReturn = last.benchmarkNav - 1
    const cumulativeExcessReturn = last.cumulativeExcess

    const years = series.length / TRADING_DAYS_PER_YEAR
    const annualizedReturn = years > 0 ? Math.pow(1 + totalReturn, 1 / years) - 1 : 0

    const dailyReturns = series.slice(1).map((s) => s.dailyReturn)
    const excessReturns = series.slice(1).map((s) => s.excessReturn)

    const annualizedVolatility = stdDev(dailyReturns) * Math.sqrt(TRADING_DAYS_PER_YEAR)
    const trackingError = stdDev(excessReturns) * Math.sqrt(TRADING_DAYS_PER_YEAR)

    const avgExcess = mean(excessReturns)
    const informationRatio = trackingError > 0 ? (avgExcess * TRADING_DAYS_PER_YEAR) / trackingError : 0
    const sharpeRatio = annualizedVolatility > 0 ? (annualizedReturn - RISK_FREE_RATE) / annualizedVolatility : 0

    // 最大回撤
    let maxDrawdown = 0
    let peak = first.portfolioNav
    for (const s of series) {
      if (s.portfolioNav > peak) peak = s.portfolioNav
      const drawdown = peak > 0 ? (peak - s.portfolioNav) / peak : 0
      if (drawdown > maxDrawdown) maxDrawdown = drawdown
    }

    return {
      totalReturn: round4(totalReturn),
      benchmarkTotalReturn: round4(benchmarkTotalReturn),
      cumulativeExcessReturn: round4(cumulativeExcessReturn),
      annualizedReturn: round4(annualizedReturn),
      annualizedVolatility: round4(annualizedVolatility),
      trackingError: round4(trackingError),
      informationRatio: round4(informationRatio),
      maxDrawdown: round4(maxDrawdown),
      sharpeRatio: round4(sharpeRatio),
    }
  }

  // ── 工具方法 ──────────────────────────────────────────────────────────────

  private parseDateStr(s: string): Date {
    if (s.length === 8) {
      return new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`)
    }
    return new Date(s)
  }

  private emptyResponse(
    portfolioId: string,
    benchmarkTsCode: string,
    startDate: Date,
    endDate: Date,
  ): PortfolioPerformanceResponseDto {
    return {
      portfolioId,
      benchmarkTsCode,
      startDate: startDate.toISOString().slice(0, 10),
      endDate: endDate.toISOString().slice(0, 10),
      metrics: {
        totalReturn: 0,
        benchmarkTotalReturn: 0,
        cumulativeExcessReturn: 0,
        annualizedReturn: 0,
        annualizedVolatility: 0,
        trackingError: 0,
        informationRatio: 0,
        maxDrawdown: 0,
        sharpeRatio: 0,
      },
      dailySeries: [],
    }
  }
}

// ── Math helpers ──────────────────────────────────────────────────────────────

function mean(arr: number[]): number {
  if (arr.length === 0) return 0
  return arr.reduce((a, b) => a + b, 0) / arr.length
}

function stdDev(arr: number[]): number {
  if (arr.length < 2) return 0
  const m = mean(arr)
  const variance = arr.reduce((sum, v) => sum + (v - m) ** 2, 0) / (arr.length - 1)
  return Math.sqrt(variance)
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000
}
