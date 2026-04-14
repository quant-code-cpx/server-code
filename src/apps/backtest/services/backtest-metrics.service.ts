import { Injectable } from '@nestjs/common'
import { BacktestConfig, BacktestMetrics, DailyNavRecord, TradeRecord } from '../types/backtest-engine.types'

const RISK_FREE_RATE = 0.02 // 2% annualized
const TRADING_DAYS_PER_YEAR = 252

@Injectable()
export class BacktestMetricsService {
  computeMetrics(navRecords: DailyNavRecord[], trades: TradeRecord[], config: BacktestConfig): BacktestMetrics {
    if (navRecords.length < 2) {
      return this.emptyMetrics(trades.length)
    }

    const returns = navRecords.map((r) => r.dailyReturn)
    const benchmarkReturns = navRecords.map((r) => r.benchmarkReturn)

    const firstNav = navRecords[0].nav
    const lastNav = navRecords[navRecords.length - 1].nav
    const firstBenchmark = navRecords[0].benchmarkNav
    const lastBenchmark = navRecords[navRecords.length - 1].benchmarkNav

    const totalReturn = lastNav / firstNav - 1
    const benchmarkReturn = lastBenchmark > 0 ? lastBenchmark / firstBenchmark - 1 : 0
    const excessReturn = totalReturn - benchmarkReturn

    const nDays = navRecords.length
    const years = nDays / TRADING_DAYS_PER_YEAR
    // 极端亏损保护：totalReturn ≤ -1 时底数为负，Math.pow 返回 NaN；钳制为 -100%
    const annualizedReturn = years > 0 ? (totalReturn <= -1 ? -1 : Math.pow(1 + totalReturn, 1 / years) - 1) : 0

    const dailyRfRate = RISK_FREE_RATE / TRADING_DAYS_PER_YEAR
    const excessDailyReturns = returns.map((r) => r - dailyRfRate)

    // 使用样本方差（÷(n-1)）以符合标准金融计量惯例，避免对短回测系统性高估 Sharpe
    const n = excessDailyReturns.length
    const mean = excessDailyReturns.reduce((a, b) => a + b, 0) / n
    const variance = n > 1 ? excessDailyReturns.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1) : 0
    const stdDev = Math.sqrt(variance)
    const annualizedStd = stdDev * Math.sqrt(TRADING_DAYS_PER_YEAR)
    const volatility = annualizedStd

    // 极小 std（浮点精度噪声）视为零波动，Sharpe = 0
    const sharpeRatio = annualizedStd > 1e-8 ? (annualizedReturn - RISK_FREE_RATE) / annualizedStd : 0

    // Sortino - only downside deviation (using all observations in denominator)
    const downsideSquaredSum = excessDailyReturns.reduce((a, r) => a + (r < 0 ? r ** 2 : 0), 0)
    const downsideVariance = excessDailyReturns.length > 0 ? downsideSquaredSum / excessDailyReturns.length : 0
    const downsideStd = Math.sqrt(downsideVariance) * Math.sqrt(TRADING_DAYS_PER_YEAR)
    const sortinoRatio = downsideStd > 0 ? (annualizedReturn - RISK_FREE_RATE) / downsideStd : 0

    // Max drawdown
    const maxDrawdown = Math.min(...navRecords.map((r) => r.drawdown), 0)

    // Calmar
    const calmarRatio = Math.abs(maxDrawdown) > 0 ? annualizedReturn / Math.abs(maxDrawdown) : 0

    // Alpha & Beta (vs benchmark) — 使用样本协方差/样本方差（÷(n-1)）
    const benchmarkMean = benchmarkReturns.reduce((a, b) => a + b, 0) / benchmarkReturns.length
    const nb = benchmarkReturns.length
    const bmVariance = nb > 1 ? benchmarkReturns.reduce((a, b) => a + (b - benchmarkMean) ** 2, 0) / (nb - 1) : 0

    let beta = 0
    if (bmVariance > 0) {
      const returnsMean = returns.reduce((a, b) => a + b, 0) / returns.length
      const covariance =
        returns.reduce((a, r, i) => a + (r - returnsMean) * (benchmarkReturns[i] - benchmarkMean), 0) /
        (returns.length - 1)
      beta = covariance / bmVariance
    }
    // 极端亏损保护（同上）
    const annualizedBmReturn =
      years > 0 ? (benchmarkReturn <= -1 ? -1 : Math.pow(1 + benchmarkReturn, 1 / years) - 1) : 0
    const alpha = annualizedReturn - (RISK_FREE_RATE + beta * (annualizedBmReturn - RISK_FREE_RATE))

    // Information ratio — 使用样本标准差（÷(n-1)）
    const excessSeriesDaily = returns.map((r, i) => r - benchmarkReturns[i])
    const excessMean = excessSeriesDaily.reduce((a, b) => a + b, 0) / excessSeriesDaily.length
    const ne = excessSeriesDaily.length
    const excessStd = Math.sqrt(
      ne > 1 ? excessSeriesDaily.reduce((a, b) => a + (b - excessMean) ** 2, 0) / (ne - 1) : 0,
    )
    const annualizedExcessStd = excessStd * Math.sqrt(TRADING_DAYS_PER_YEAR)
    const informationRatio = annualizedExcessStd > 0 ? (excessMean * TRADING_DAYS_PER_YEAR) / annualizedExcessStd : 0

    // Win rate (days with positive return vs benchmark)
    const winDays = excessSeriesDaily.filter((r) => r > 0).length
    const winRate = nDays > 0 ? winDays / nDays : 0

    // Turnover rate (average daily turnover annualized)
    const buyTrades = trades.filter((t) => t.side === 'BUY')
    const totalBuyAmount = buyTrades.reduce((a, t) => a + t.amount, 0)
    const avgNav = navRecords.reduce((a, r) => a + r.nav, 0) / navRecords.length
    const turnoverRate = avgNav > 0 && years > 0 ? totalBuyAmount / avgNav / years : 0

    return {
      totalReturn,
      annualizedReturn,
      benchmarkReturn,
      excessReturn,
      maxDrawdown,
      sharpeRatio,
      sortinoRatio,
      calmarRatio,
      volatility,
      alpha,
      beta,
      informationRatio,
      winRate,
      turnoverRate,
      tradeCount: trades.length,
    }
  }

  private emptyMetrics(tradeCount: number): BacktestMetrics {
    return {
      totalReturn: 0,
      annualizedReturn: 0,
      benchmarkReturn: 0,
      excessReturn: 0,
      maxDrawdown: 0,
      sharpeRatio: 0,
      sortinoRatio: 0,
      calmarRatio: 0,
      volatility: 0,
      alpha: 0,
      beta: 0,
      informationRatio: 0,
      winRate: 0,
      turnoverRate: 0,
      tradeCount,
    }
  }
}
