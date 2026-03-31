/**
 * chip-estimation.ts
 *
 * 筹码分布估算算法（无 Tushare cyq 接口时使用）
 * 基于历史每日成交量在当日价格区间内按正态分布分配，并加时间衰减权重
 */

import { OhlcvBar } from './technical-indicators'

export interface ChipBin {
  priceLow: number
  priceHigh: number
  percent: number // 0-100
  isProfit: boolean
}

export interface ChipConcentration {
  range90Low: number | null
  range90High: number | null
  range70Low: number | null
  range70High: number | null
  score: number | null // 0-100，越高越集中
  profitRatio: number | null // 获利比例 (%)
  avgCost: number | null
}

export interface ChipKeyLevels {
  peakPrice: number | null // 最密集成交价位（主力成本）
  resistanceHigh: number | null
  resistanceLow: number | null
  supportHigh: number | null
  supportLow: number | null
}

export interface ChipEstimationResult {
  distribution: ChipBin[]
  concentration: ChipConcentration
  keyLevels: ChipKeyLevels
}

const BINS = 100
const DECAY_FACTOR = 0.97 // 时间衰减因子

/**
 * 按正态分布将成交量分配到价格区间各 bin
 */
function distributeVolumeNormal(vol: number, centerPrice: number, std: number, bins: number[], priceLow: number, binWidth: number): void {
  if (std <= 0 || binWidth <= 0) {
    // 退化：全部放在最近的 bin
    const idx = Math.floor((centerPrice - priceLow) / binWidth)
    const clampedIdx = Math.max(0, Math.min(BINS - 1, idx))
    bins[clampedIdx] += vol
    return
  }

  // 对每个 bin 计算正态概率密度，归一化后分配
  const weights: number[] = new Array(BINS).fill(0)
  let totalWeight = 0

  for (let b = 0; b < BINS; b++) {
    const binCenter = priceLow + (b + 0.5) * binWidth
    const z = (binCenter - centerPrice) / std
    const w = Math.exp(-0.5 * z * z)
    weights[b] = w
    totalWeight += w
  }

  if (totalWeight === 0) return

  for (let b = 0; b < BINS; b++) {
    bins[b] += vol * (weights[b] / totalWeight)
  }
}

/**
 * 从 OHLCV 历史数据估算筹码分布
 * @param bars 历史日线数据（近 120 个交易日，升序排列）
 * @param currentPrice 当前价格（用于计算获利比例）
 */
export function estimateChipDistribution(bars: OhlcvBar[], currentPrice: number): ChipEstimationResult {
  if (bars.length === 0) {
    return emptyResult()
  }

  // 计算价格范围
  let priceMin = Infinity
  let priceMax = -Infinity
  for (const bar of bars) {
    if (bar.low < priceMin) priceMin = bar.low
    if (bar.high > priceMax) priceMax = bar.high
  }

  // 扩展范围 1% 避免边界问题
  const range = priceMax - priceMin
  if (range <= 0) return emptyResult()

  priceMin = priceMin - range * 0.01
  priceMax = priceMax + range * 0.01
  const binWidth = (priceMax - priceMin) / BINS

  const bins: number[] = new Array(BINS).fill(0)
  const totalDays = bars.length

  let totalWeightedVol = 0
  let weightedPriceSum = 0

  // 时间衰减：最近的数据权重更高
  for (let i = 0; i < totalDays; i++) {
    const daysAgo = totalDays - 1 - i
    const decay = Math.pow(DECAY_FACTOR, daysAgo)
    const bar = bars[i]

    const centerPrice = (bar.open + bar.close) / 2
    const std = (bar.high - bar.low) / 4

    const weightedVol = bar.vol * decay
    distributeVolumeNormal(weightedVol, centerPrice, std, bins, priceMin, binWidth)

    totalWeightedVol += weightedVol
    weightedPriceSum += centerPrice * weightedVol
  }

  // 归一化
  const totalBinSum = bins.reduce((a, b) => a + b, 0)
  const distribution: ChipBin[] = []

  for (let b = 0; b < BINS; b++) {
    const priceLow = priceMin + b * binWidth
    const priceHigh = priceLow + binWidth
    const percent = totalBinSum > 0 ? (bins[b] / totalBinSum) * 100 : 0
    const isProfit = priceHigh <= currentPrice

    distribution.push({
      priceLow: Math.round(priceLow * 100) / 100,
      priceHigh: Math.round(priceHigh * 100) / 100,
      percent: Math.round(percent * 10000) / 10000,
      isProfit,
    })
  }

  // 获利比例
  const profitRatio =
    totalBinSum > 0
      ? distribution.filter((b) => b.isProfit).reduce((a, b) => a + b.percent, 0)
      : null

  // 平均成本
  const avgCost = totalWeightedVol > 0 ? Math.round((weightedPriceSum / totalWeightedVol) * 100) / 100 : null

  // 累计分布用于计算集中度
  const cumulative: number[] = []
  let cumSum = 0
  for (const bin of distribution) {
    cumSum += bin.percent
    cumulative.push(cumSum)
  }

  // 找 70% 和 90% 集中度价格区间（最密集的 N% 筹码对应的价格范围）
  const { low: range70Low, high: range70High } = findConcentrationRange(distribution, 70)
  const { low: range90Low, high: range90High } = findConcentrationRange(distribution, 90)

  // 集中度评分：90% 筹码价格范围 / 总价格范围越小，越集中
  const totalRange = priceMax - priceMin
  let score: number | null = null
  if (range90Low !== null && range90High !== null && totalRange > 0) {
    const concRange = range90High - range90Low
    score = Math.round((1 - concRange / totalRange) * 100)
    score = Math.max(0, Math.min(100, score))
  }

  // 关键价位
  const keyLevels = calcKeyLevels(distribution, currentPrice, bins, priceMin, binWidth)

  return {
    distribution,
    concentration: {
      range90Low,
      range90High,
      range70Low,
      range70High,
      score,
      profitRatio,
      avgCost,
    },
    keyLevels,
  }
}

/**
 * 找出包含 targetPercent% 筹码的最窄价格区间（用滑动窗口）
 */
function findConcentrationRange(
  distribution: ChipBin[],
  targetPercent: number,
): { low: number | null; high: number | null } {
  const n = distribution.length
  let best: { low: number | null; high: number | null; width: number } = { low: null, high: null, width: Infinity }

  let windowSum = 0
  let left = 0

  for (let right = 0; right < n; right++) {
    windowSum += distribution[right].percent

    while (windowSum >= targetPercent && left <= right) {
      const width = distribution[right].priceHigh - distribution[left].priceLow
      if (width < best.width) {
        best = {
          low: distribution[left].priceLow,
          high: distribution[right].priceHigh,
          width,
        }
      }
      windowSum -= distribution[left].percent
      left++
    }
  }

  return { low: best.low, high: best.high }
}

/**
 * 计算关键价位（峰值、支撑、阻力）
 */
function calcKeyLevels(
  distribution: ChipBin[],
  currentPrice: number,
  bins: number[],
  priceMin: number,
  binWidth: number,
): ChipKeyLevels {
  // 找最密集 bin（主力成本）
  let peakIdx = 0
  for (let i = 1; i < BINS; i++) {
    if (bins[i] > bins[peakIdx]) peakIdx = i
  }
  const peakPrice = priceMin + (peakIdx + 0.5) * binWidth

  // 上方密集区（价格 > currentPrice 中筹码最密集的区间）
  let abovePeakIdx = -1
  for (let i = 0; i < BINS; i++) {
    const price = priceMin + (i + 0.5) * binWidth
    if (price > currentPrice) {
      if (abovePeakIdx === -1 || bins[i] > bins[abovePeakIdx]) {
        abovePeakIdx = i
      }
    }
  }

  // 下方密集区（价格 < currentPrice 中筹码最密集的区间）
  let belowPeakIdx = -1
  for (let i = 0; i < BINS; i++) {
    const price = priceMin + (i + 0.5) * binWidth
    if (price < currentPrice) {
      if (belowPeakIdx === -1 || bins[i] > bins[belowPeakIdx]) {
        belowPeakIdx = i
      }
    }
  }

  // 以峰值 bin 为中心，找包含 15% 筹码的范围作为密集区边界
  function getPeakRange(peakBinIdx: number): { low: number; high: number } | null {
    if (peakBinIdx < 0) return null
    let lo = peakBinIdx
    let hi = peakBinIdx
    let sum = distribution[peakBinIdx].percent
    while (sum < 15 && (lo > 0 || hi < BINS - 1)) {
      const expandLeft = lo > 0 ? bins[lo - 1] : -1
      const expandRight = hi < BINS - 1 ? bins[hi + 1] : -1
      if (expandLeft >= expandRight && lo > 0) {
        lo--
        sum += distribution[lo].percent
      } else if (hi < BINS - 1) {
        hi++
        sum += distribution[hi].percent
      } else if (lo > 0) {
        lo--
        sum += distribution[lo].percent
      } else {
        break
      }
    }
    return {
      low: Math.round((priceMin + lo * binWidth) * 100) / 100,
      high: Math.round((priceMin + (hi + 1) * binWidth) * 100) / 100,
    }
  }

  const aboveRange = getPeakRange(abovePeakIdx)
  const belowRange = getPeakRange(belowPeakIdx)

  return {
    peakPrice: Math.round(peakPrice * 100) / 100,
    resistanceHigh: aboveRange?.high ?? null,
    resistanceLow: aboveRange?.low ?? null,
    supportHigh: belowRange?.high ?? null,
    supportLow: belowRange?.low ?? null,
  }
}

function emptyResult(): ChipEstimationResult {
  return {
    distribution: [],
    concentration: {
      range90Low: null,
      range90High: null,
      range70Low: null,
      range70High: null,
      score: null,
      profitRatio: null,
      avgCost: null,
    },
    keyLevels: {
      peakPrice: null,
      resistanceHigh: null,
      resistanceLow: null,
      supportHigh: null,
      supportLow: null,
    },
  }
}
