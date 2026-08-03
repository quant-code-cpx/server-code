import { assertValidTechnicalSignalBars } from './qfq-series'
import type { IndicatorPoint, TechnicalSignalBar } from './technical-signal.types'

const EMA_12_MULTIPLIER = 2 / 13
const EMA_26_MULTIPLIER = 2 / 27
const DEA_9_MULTIPLIER = 2 / 10
const SAR_INITIAL_AF = 0.02
const SAR_AF_STEP = 0.02
const SAR_MAX_AF = 0.2

interface SarState {
  bullish: boolean
  sar: number
  ep: number
  af: number
}

/**
 * Full-precision, path-dependent technical-indicator engine. Its input must
 * start at the stock's first valid QFQ bar; callers filter dates only after
 * this engine has finished the full history.
 */
export class TechnicalIndicatorEngine {
  compute(bars: readonly TechnicalSignalBar[]): IndicatorPoint[] {
    assertValidTechnicalSignalBars(bars)
    if (bars.length === 0) return []

    const points: IndicatorPoint[] = []
    let ema12 = 0
    let ema26 = 0
    let dea = 0
    let kdjK = 50
    let kdjD = 50
    let gainSum = 0
    let lossSum = 0
    let averageGain: number | null = null
    let averageLoss: number | null = null
    let sarState: SarState | null = null

    for (let index = 0; index < bars.length; index += 1) {
      const current = bars[index]

      const { dif, currentDea } = updateMacd(current.close, index, ema12, ema26, dea)
      ema12 = updateEma(current.close, ema12, EMA_12_MULTIPLIER, index)
      ema26 = updateEma(current.close, ema26, EMA_26_MULTIPLIER, index)
      dea = currentDea

      const kdj = updateKdj(bars, index, kdjK, kdjD)
      if (kdj !== null) {
        kdjK = kdj.k
        kdjD = kdj.d
      }

      const rsi = updateRsi(bars, index, gainSum, lossSum, averageGain, averageLoss)
      gainSum = rsi.gainSum
      lossSum = rsi.lossSum
      averageGain = rsi.averageGain
      averageLoss = rsi.averageLoss

      const boll = calculateBollinger(bars, index)
      const volume = calculateVolumeRatio20(bars, index)
      const sar = updateSar(bars, index, sarState)
      sarState = sar.state

      points.push({
        tradeDate: current.tradeDate,
        open: current.open,
        high: current.high,
        low: current.low,
        close: current.close,
        vol: current.vol,
        ma5: trailingMean(bars, index, 5),
        ma10: trailingMean(bars, index, 10),
        ma20: trailingMean(bars, index, 20),
        ma60: trailingMean(bars, index, 60),
        macdDif: index >= 34 ? dif : null,
        macdDea: index >= 34 ? currentDea : null,
        kdjK: kdj?.k ?? null,
        kdjD: kdj?.d ?? null,
        kdjJ: kdj?.j ?? null,
        rsi6: rsi.value,
        bollUpper: boll?.upper ?? null,
        bollMid: boll?.mid ?? null,
        bollLower: boll?.lower ?? null,
        sar: sar.value,
        sarBullish: sar.bullish,
        volumeAverage20: volume?.average ?? null,
        volumeRatio20: volume?.ratio ?? null,
      })
    }

    return points
  }

  /** Clear alias for consumers that use engine terminology instead of compute. */
  calculate(bars: readonly TechnicalSignalBar[]): IndicatorPoint[] {
    return this.compute(bars)
  }
}

function updateMacd(
  close: number,
  index: number,
  previousEma12: number,
  previousEma26: number,
  previousDea: number,
): { dif: number; currentDea: number } {
  const ema12 = updateEma(close, previousEma12, EMA_12_MULTIPLIER, index)
  const ema26 = updateEma(close, previousEma26, EMA_26_MULTIPLIER, index)
  const dif = ema12 - ema26
  const currentDea = index === 0 ? dif : previousDea + DEA_9_MULTIPLIER * (dif - previousDea)
  return { dif, currentDea }
}

function updateEma(close: number, previous: number, multiplier: number, index: number): number {
  return index === 0 ? close : previous + multiplier * (close - previous)
}

function updateKdj(
  bars: readonly TechnicalSignalBar[],
  index: number,
  previousK: number,
  previousD: number,
): { k: number; d: number; j: number } | null {
  if (index < 8) return null

  let lowestLow = Number.POSITIVE_INFINITY
  let highestHigh = Number.NEGATIVE_INFINITY
  for (let offset = index - 8; offset <= index; offset += 1) {
    lowestLow = Math.min(lowestLow, bars[offset].low)
    highestHigh = Math.max(highestHigh, bars[offset].high)
  }

  const rsv = highestHigh === lowestLow ? 50 : (100 * (bars[index].close - lowestLow)) / (highestHigh - lowestLow)
  const k = (2 * previousK + rsv) / 3
  const d = (2 * previousD + k) / 3
  return { k, d, j: 3 * k - 2 * d }
}

function updateRsi(
  bars: readonly TechnicalSignalBar[],
  index: number,
  gainSum: number,
  lossSum: number,
  averageGain: number | null,
  averageLoss: number | null,
): {
  value: number | null
  gainSum: number
  lossSum: number
  averageGain: number | null
  averageLoss: number | null
} {
  if (index === 0) {
    return { value: null, gainSum, lossSum, averageGain, averageLoss }
  }

  const change = bars[index].close - bars[index - 1].close
  const gain = Math.max(change, 0)
  const loss = Math.max(-change, 0)

  if (index <= 6) {
    const nextGainSum = gainSum + gain
    const nextLossSum = lossSum + loss
    if (index < 6) {
      return {
        value: null,
        gainSum: nextGainSum,
        lossSum: nextLossSum,
        averageGain,
        averageLoss,
      }
    }

    const nextAverageGain = nextGainSum / 6
    const nextAverageLoss = nextLossSum / 6
    return {
      value: calculateRsiValue(nextAverageGain, nextAverageLoss),
      gainSum: nextGainSum,
      lossSum: nextLossSum,
      averageGain: nextAverageGain,
      averageLoss: nextAverageLoss,
    }
  }

  // Index > 6 always has the six-change initialization from index 6.
  const nextAverageGain = ((averageGain as number) * 5 + gain) / 6
  const nextAverageLoss = ((averageLoss as number) * 5 + loss) / 6
  return {
    value: calculateRsiValue(nextAverageGain, nextAverageLoss),
    gainSum,
    lossSum,
    averageGain: nextAverageGain,
    averageLoss: nextAverageLoss,
  }
}

function calculateRsiValue(averageGain: number, averageLoss: number): number {
  if (averageLoss === 0 && averageGain > 0) return 100
  if (averageLoss === 0 && averageGain === 0) return 50
  return 100 - 100 / (1 + averageGain / averageLoss)
}

function calculateBollinger(
  bars: readonly TechnicalSignalBar[],
  index: number,
): { mid: number; upper: number; lower: number } | null {
  const mid = trailingMean(bars, index, 20)
  if (mid === null) return null

  let squaredDifferenceSum = 0
  for (let offset = index - 19; offset <= index; offset += 1) {
    const difference = bars[offset].close - mid
    squaredDifferenceSum += difference * difference
  }
  const standardDeviation = Math.sqrt(squaredDifferenceSum / 20)
  return {
    mid,
    upper: mid + 2 * standardDeviation,
    lower: mid - 2 * standardDeviation,
  }
}

function trailingMean(bars: readonly TechnicalSignalBar[], index: number, period: number): number | null {
  if (index + 1 < period) return null

  let sum = 0
  for (let offset = index - period + 1; offset <= index; offset += 1) {
    sum += bars[offset].close
  }
  return sum / period
}

function calculateVolumeRatio20(
  bars: readonly TechnicalSignalBar[],
  index: number,
): { average: number; ratio: number } | null {
  if (index < 20) return null

  let volumeSum = 0
  for (let offset = index - 20; offset < index; offset += 1) {
    volumeSum += bars[offset].vol
  }
  const average = volumeSum / 20
  if (average <= 0) return null
  return { average, ratio: bars[index].vol / average }
}

function updateSar(
  bars: readonly TechnicalSignalBar[],
  index: number,
  previousState: SarState | null,
): { value: number | null; bullish: boolean | null; state: SarState | null } {
  if (index === 0) {
    return { value: null, bullish: null, state: null }
  }

  const current = bars[index]
  const first = bars[0]
  let state = previousState
  if (state === null) {
    const bullish = current.close > first.close
    state = {
      bullish,
      sar: bullish ? first.low : first.high,
      ep: bullish ? first.high : first.low,
      af: SAR_INITIAL_AF,
    }
  }

  let candidate = state.sar + state.af * (state.ep - state.sar)
  if (state.bullish) {
    candidate = Math.min(candidate, bars[index - 1].low)
    if (index >= 2) candidate = Math.min(candidate, bars[index - 2].low)

    if (current.low < candidate) {
      state = {
        bullish: false,
        sar: state.ep,
        ep: current.low,
        af: SAR_INITIAL_AF,
      }
    } else {
      const ep = current.high > state.ep ? current.high : state.ep
      state = {
        bullish: true,
        sar: candidate,
        ep,
        af: current.high > state.ep ? Math.min(state.af + SAR_AF_STEP, SAR_MAX_AF) : state.af,
      }
    }
  } else {
    candidate = Math.max(candidate, bars[index - 1].high)
    if (index >= 2) candidate = Math.max(candidate, bars[index - 2].high)

    if (current.high > candidate) {
      state = {
        bullish: true,
        sar: state.ep,
        ep: current.high,
        af: SAR_INITIAL_AF,
      }
    } else {
      const ep = current.low < state.ep ? current.low : state.ep
      state = {
        bullish: false,
        sar: candidate,
        ep,
        af: current.low < state.ep ? Math.min(state.af + SAR_AF_STEP, SAR_MAX_AF) : state.af,
      }
    }
  }

  return { value: state.sar, bullish: state.bullish, state }
}
