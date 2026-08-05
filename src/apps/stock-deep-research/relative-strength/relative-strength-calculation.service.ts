import { Injectable } from '@nestjs/common'

export interface RelativeStrengthPoint {
  tradeDate: string
  stockClose: number
  benchmarkClose: number
}

@Injectable()
export class RelativeStrengthCalculationService {
  calculate(points: readonly RelativeStrengthPoint[]) {
    if (!points.length) return emptyCalculation()
    const baseStock = points[0].stockClose
    const baseBenchmark = points[0].benchmarkClose
    const series = points.map((point) => {
      const stockNormalizedNav = point.stockClose / baseStock
      const benchmarkNormalizedNav = point.benchmarkClose / baseBenchmark
      return {
        tradeDate: point.tradeDate,
        stockNormalizedNav,
        benchmarkNormalizedNav,
        stockCumulativeReturn: stockNormalizedNav - 1,
        benchmarkCumulativeReturn: benchmarkNormalizedNav - 1,
        cumulativeExcessReturn: stockNormalizedNav - benchmarkNormalizedNav,
      }
    })
    const stockReturns = dailyReturns(points.map((point) => point.stockClose))
    const benchmarkReturns = dailyReturns(points.map((point) => point.benchmarkClose))
    const activeReturns = stockReturns.map((value, index) => value - benchmarkReturns[index])
    const stockTotalReturn = series.at(-1)!.stockCumulativeReturn
    const benchmarkTotalReturn = series.at(-1)!.benchmarkCumulativeReturn
    const excessStartIndex = Math.max(0, series.length - 20)
    const excess20d =
      series.at(-1)!.stockNormalizedNav / series[excessStartIndex].stockNormalizedNav -
      series.at(-1)!.benchmarkNormalizedNav / series[excessStartIndex].benchmarkNormalizedNav
    const sufficient = points.length >= 20
    const benchmarkVariance = sampleVariance(benchmarkReturns)
    const activeStd = sampleStd(activeReturns)
    return {
      summary: {
        stockTotalReturn,
        benchmarkTotalReturn,
        excessReturn: stockTotalReturn - benchmarkTotalReturn,
        excess20d,
        annualizedVolatility: sampleStd(stockReturns) * Math.sqrt(252),
        maxDrawdown: maxDrawdown(series.map((item) => item.stockNormalizedNav)),
        beta:
          sufficient && benchmarkVariance > 0
            ? sampleCovariance(stockReturns, benchmarkReturns) / benchmarkVariance
            : null,
        informationRatio: sufficient && activeStd > 0 ? (mean(activeReturns) / activeStd) * Math.sqrt(252) : null,
      },
      series,
    }
  }
}

function emptyCalculation() {
  return {
    summary: {
      stockTotalReturn: null,
      benchmarkTotalReturn: null,
      excessReturn: null,
      excess20d: null,
      annualizedVolatility: null,
      maxDrawdown: null,
      beta: null,
      informationRatio: null,
    },
    series: [],
  }
}

function dailyReturns(values: readonly number[]): number[] {
  return values.slice(1).map((value, index) => value / values[index] - 1)
}

function mean(values: readonly number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

function sampleVariance(values: readonly number[]): number {
  if (values.length < 2) return 0
  const average = mean(values)
  return values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1)
}

function sampleStd(values: readonly number[]): number {
  return Math.sqrt(sampleVariance(values))
}

function sampleCovariance(left: readonly number[], right: readonly number[]): number {
  if (left.length !== right.length || left.length < 2) return 0
  const leftMean = mean(left)
  const rightMean = mean(right)
  return (
    left.reduce((sum, value, index) => sum + (value - leftMean) * (right[index] - rightMean), 0) / (left.length - 1)
  )
}

function maxDrawdown(nav: readonly number[]): number | null {
  if (!nav.length) return null
  let peak = nav[0]
  let drawdown = 0
  for (const value of nav) {
    peak = Math.max(peak, value)
    drawdown = Math.min(drawdown, value / peak - 1)
  }
  return drawdown
}
