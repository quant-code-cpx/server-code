/**
 * technical-indicators.ts
 *
 * 纯函数技术指标计算库 — 无任何框架依赖，仅依赖输入 OhlcvBar[]
 * 所有函数返回与输入等长的数组，数据不足时对应位置为 null
 */

export interface OhlcvBar {
  tradeDate: string // 'YYYYMMDD'
  open: number
  high: number
  low: number
  close: number
  vol: number // 成交量（手）
  amount: number // 成交额（千元）
  preClose: number // 昨收
}

// ─── 辅助函数 ──────────────────────────────────────────────────────────────────

function isValidNumber(v: number | null | undefined): v is number {
  return v !== null && v !== undefined && Number.isFinite(v)
}

function safeDiv(a: number, b: number): number | null {
  if (!isValidNumber(b) || b === 0) return null
  return a / b
}

// ─── 移动平均线 ────────────────────────────────────────────────────────────────

/** Simple Moving Average */
export function calcMA(closes: (number | null)[], period: number): (number | null)[] {
  const result: (number | null)[] = new Array(closes.length).fill(null)
  for (let i = period - 1; i < closes.length; i++) {
    let sum = 0
    let valid = true
    for (let j = i - period + 1; j <= i; j++) {
      if (!isValidNumber(closes[j])) {
        valid = false
        break
      }
      sum += closes[j] as number
    }
    result[i] = valid ? sum / period : null
  }
  return result
}

/** Exponential Moving Average */
export function calcEMA(closes: (number | null)[], period: number): (number | null)[] {
  const k = 2 / (period + 1)
  const result: (number | null)[] = new Array(closes.length).fill(null)
  let ema: number | null = null
  for (let i = 0; i < closes.length; i++) {
    const c = closes[i]
    if (!isValidNumber(c)) {
      ema = null
      continue
    }
    if (ema === null) {
      // 预热：用第一个有效收盘价初始化
      ema = c
    } else {
      ema = c * k + ema * (1 - k)
    }
    result[i] = ema
  }
  return result
}

// ─── MACD（12, 26, 9）──────────────────────────────────────────────────────────

export interface MacdResult {
  dif: (number | null)[]
  dea: (number | null)[]
  hist: (number | null)[] // (DIF - DEA) * 2
}

export function calcMACD(closes: (number | null)[]): MacdResult {
  const ema12 = calcEMA(closes, 12)
  const ema26 = calcEMA(closes, 26)
  const dif: (number | null)[] = closes.map((_, i) => {
    const e12 = ema12[i]
    const e26 = ema26[i]
    return isValidNumber(e12) && isValidNumber(e26) ? e12 - e26 : null
  })
  const dea = calcEMA(dif, 9)
  const hist: (number | null)[] = dif.map((d, i) => {
    const de = dea[i]
    return isValidNumber(d) && isValidNumber(de) ? (d - de) * 2 : null
  })
  return { dif, dea, hist }
}

// ─── KDJ（9, 3, 3）────────────────────────────────────────────────────────────

export interface KdjResult {
  k: (number | null)[]
  d: (number | null)[]
  j: (number | null)[]
}

export function calcKDJ(bars: OhlcvBar[]): KdjResult {
  const n = bars.length
  const kArr: (number | null)[] = new Array(n).fill(null)
  const dArr: (number | null)[] = new Array(n).fill(null)
  const jArr: (number | null)[] = new Array(n).fill(null)

  let prevK = 50
  let prevD = 50

  for (let i = 0; i < n; i++) {
    const start = Math.max(0, i - 8) // 9日窗口
    let high9 = -Infinity
    let low9 = Infinity
    for (let j = start; j <= i; j++) {
      if (bars[j].high > high9) high9 = bars[j].high
      if (bars[j].low < low9) low9 = bars[j].low
    }

    let rsv: number
    if (high9 === low9) {
      rsv = 50
    } else {
      rsv = ((bars[i].close - low9) / (high9 - low9)) * 100
    }

    const k = (2 / 3) * prevK + (1 / 3) * rsv
    const d = (2 / 3) * prevD + (1 / 3) * k
    const j = 3 * k - 2 * d

    kArr[i] = k
    dArr[i] = d
    jArr[i] = j

    prevK = k
    prevD = d
  }

  return { k: kArr, d: dArr, j: jArr }
}

// ─── RSI（6, 12, 24）────────────────────────────────────────────────────────────

function calcRSISingle(closes: (number | null)[], period: number): (number | null)[] {
  const result: (number | null)[] = new Array(closes.length).fill(null)
  let avgU = 0
  let avgD = 0
  let initialized = false
  let initCount = 0

  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1]
    const curr = closes[i]
    if (!isValidNumber(prev) || !isValidNumber(curr)) {
      initialized = false
      initCount = 0
      avgU = 0
      avgD = 0
      continue
    }

    const diff = (curr as number) - (prev as number)
    const u = diff > 0 ? diff : 0
    const d = diff < 0 ? -diff : 0

    if (!initialized) {
      avgU = (avgU * initCount + u) / (initCount + 1)
      avgD = (avgD * initCount + d) / (initCount + 1)
      initCount++
      if (initCount >= period) {
        initialized = true
        const rs = avgD === 0 ? Infinity : avgU / avgD
        result[i] = avgD === 0 ? 100 : 100 - 100 / (1 + rs)
      }
    } else {
      avgU = (avgU * (period - 1) + u) / period
      avgD = (avgD * (period - 1) + d) / period
      const rs = avgD === 0 ? Infinity : avgU / avgD
      result[i] = avgD === 0 ? 100 : 100 - 100 / (1 + rs)
    }
  }
  return result
}

export interface RsiResult {
  rsi6: (number | null)[]
  rsi12: (number | null)[]
  rsi24: (number | null)[]
}

export function calcRSI(closes: (number | null)[]): RsiResult {
  return {
    rsi6: calcRSISingle(closes, 6),
    rsi12: calcRSISingle(closes, 12),
    rsi24: calcRSISingle(closes, 24),
  }
}

// ─── BOLL 布林带（20, 2）──────────────────────────────────────────────────────

export interface BollResult {
  upper: (number | null)[]
  mid: (number | null)[]
  lower: (number | null)[]
}

export function calcBOLL(closes: (number | null)[], period = 20, multiplier = 2): BollResult {
  const n = closes.length
  const upper: (number | null)[] = new Array(n).fill(null)
  const mid: (number | null)[] = new Array(n).fill(null)
  const lower: (number | null)[] = new Array(n).fill(null)

  for (let i = period - 1; i < n; i++) {
    const slice: number[] = []
    let valid = true
    for (let j = i - period + 1; j <= i; j++) {
      if (!isValidNumber(closes[j])) {
        valid = false
        break
      }
      slice.push(closes[j] as number)
    }
    if (!valid) continue

    const mean = slice.reduce((a, b) => a + b, 0) / period
    const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period
    const std = Math.sqrt(variance)

    mid[i] = mean
    upper[i] = mean + multiplier * std
    lower[i] = mean - multiplier * std
  }

  return { upper, mid, lower }
}

// ─── WR 威廉指标（6, 10）──────────────────────────────────────────────────────

function calcWRSingle(bars: OhlcvBar[], period: number): (number | null)[] {
  const result: (number | null)[] = new Array(bars.length).fill(null)
  for (let i = period - 1; i < bars.length; i++) {
    let highN = -Infinity
    let lowN = Infinity
    for (let j = i - period + 1; j <= i; j++) {
      if (bars[j].high > highN) highN = bars[j].high
      if (bars[j].low < lowN) lowN = bars[j].low
    }
    if (highN === lowN) {
      result[i] = -50
    } else {
      result[i] = ((highN - bars[i].close) / (highN - lowN)) * -100
    }
  }
  return result
}

export interface WrResult {
  wr6: (number | null)[]
  wr10: (number | null)[]
}

export function calcWR(bars: OhlcvBar[]): WrResult {
  return {
    wr6: calcWRSingle(bars, 6),
    wr10: calcWRSingle(bars, 10),
  }
}

// ─── CCI 商品通道指数（14）────────────────────────────────────────────────────

export function calcCCI(bars: OhlcvBar[], period = 14): (number | null)[] {
  const result: (number | null)[] = new Array(bars.length).fill(null)
  const tps = bars.map((b) => (b.high + b.low + b.close) / 3)

  for (let i = period - 1; i < bars.length; i++) {
    const slice = tps.slice(i - period + 1, i + 1)
    const ma = slice.reduce((a, b) => a + b, 0) / period
    const md = slice.reduce((a, b) => a + Math.abs(b - ma), 0) / period
    if (md === 0) {
      result[i] = 0
    } else {
      result[i] = (tps[i] - ma) / (0.015 * md)
    }
  }
  return result
}

// ─── DMI 趋势指标（14）────────────────────────────────────────────────────────

export interface DmiResult {
  pdi: (number | null)[] // +DI
  mdi: (number | null)[] // -DI
  adx: (number | null)[]
  adxr: (number | null)[]
}

export function calcDMI(bars: OhlcvBar[], period = 14): DmiResult {
  const n = bars.length
  const pdi: (number | null)[] = new Array(n).fill(null)
  const mdi: (number | null)[] = new Array(n).fill(null)
  const adx: (number | null)[] = new Array(n).fill(null)
  const adxr: (number | null)[] = new Array(n).fill(null)

  if (n < 2) return { pdi, mdi, adx, adxr }

  const k = 1 / period // Wilder smooth factor = 1/N

  let smoothPDM = 0
  let smoothMDM = 0
  let smoothTR = 0
  let dxEma: number | null = null

  for (let i = 1; i < n; i++) {
    const bar = bars[i]
    const prev = bars[i - 1]

    const upMove = bar.high - prev.high
    const downMove = prev.low - bar.low

    const rawPDM = upMove > 0 && upMove > downMove ? upMove : 0
    const rawMDM = downMove > 0 && downMove > upMove ? downMove : 0

    const tr = Math.max(bar.high - bar.low, Math.abs(bar.high - prev.close), Math.abs(bar.low - prev.close))

    // Wilder smoothing
    smoothPDM = smoothPDM * (1 - k) + rawPDM * k
    smoothMDM = smoothMDM * (1 - k) + rawMDM * k
    smoothTR = smoothTR * (1 - k) + tr * k

    if (smoothTR === 0) continue

    const pDI = (smoothPDM / smoothTR) * 100
    const mDI = (smoothMDM / smoothTR) * 100
    pdi[i] = pDI
    mdi[i] = mDI

    const sum = pDI + mDI
    const dx = sum === 0 ? 0 : (Math.abs(pDI - mDI) / sum) * 100

    if (dxEma === null) {
      dxEma = dx
    } else {
      dxEma = dxEma * (1 - k) + dx * k
    }
    adx[i] = dxEma

    // ADXR = (ADX + ADX N periods ago) / 2
    const prevAdx = i >= period ? adx[i - period] : null
    adxr[i] = isValidNumber(prevAdx) ? (dxEma + (prevAdx as number)) / 2 : null
  }

  return { pdi, mdi, adx, adxr }
}

// ─── TRIX 三重指数平均（12）───────────────────────────────────────────────────

export interface TrixResult {
  trix: (number | null)[]
  matrix: (number | null)[] // TRIX 的 MA(20) 信号线
}

export function calcTRIX(closes: (number | null)[], period = 12, signalPeriod = 20): TrixResult {
  const n = closes.length
  const ema1 = calcEMA(closes, period)
  const ema2 = calcEMA(ema1, period)
  const ema3 = calcEMA(ema2, period)

  const trix: (number | null)[] = new Array(n).fill(null)
  for (let i = 1; i < n; i++) {
    const e3 = ema3[i]
    const e3prev = ema3[i - 1]
    if (isValidNumber(e3) && isValidNumber(e3prev) && (e3prev as number) !== 0) {
      trix[i] = (((e3 as number) - (e3prev as number)) / (e3prev as number)) * 100
    }
  }

  const matrix = calcMA(trix, signalPeriod)
  return { trix, matrix }
}

// ─── DMA 平行线差（10, 50, 10）────────────────────────────────────────────────

export interface DmaResult {
  dma: (number | null)[]
  ama: (number | null)[] // DMA 的 MA(10) 信号线
}

export function calcDMA(closes: (number | null)[], shortPeriod = 10, longPeriod = 50, signalPeriod = 10): DmaResult {
  const ma10 = calcMA(closes, shortPeriod)
  const ma50 = calcMA(closes, longPeriod)
  const n = closes.length

  const dma: (number | null)[] = new Array(n).fill(null)
  for (let i = 0; i < n; i++) {
    const s = ma10[i]
    const l = ma50[i]
    dma[i] = isValidNumber(s) && isValidNumber(l) ? (s as number) - (l as number) : null
  }

  const ama = calcMA(dma, signalPeriod)
  return { dma, ama }
}

// ─── BIAS 乖离率（6, 12, 24）─────────────────────────────────────────────────

function calcBIASSingle(closes: (number | null)[], period: number): (number | null)[] {
  const ma = calcMA(closes, period)
  return closes.map((c, i) => {
    const m = ma[i]
    return isValidNumber(c) && isValidNumber(m) && (m as number) !== 0
      ? (((c as number) - (m as number)) / (m as number)) * 100
      : null
  })
}

export interface BiasResult {
  bias6: (number | null)[]
  bias12: (number | null)[]
  bias24: (number | null)[]
}

export function calcBIAS(closes: (number | null)[]): BiasResult {
  return {
    bias6: calcBIASSingle(closes, 6),
    bias12: calcBIASSingle(closes, 12),
    bias24: calcBIASSingle(closes, 24),
  }
}

// ─── OBV 能量潮 ────────────────────────────────────────────────────────────────

export interface ObvResult {
  obv: (number | null)[]
  obvMa: (number | null)[] // OBV 的 30 日均线
}

export function calcOBV(bars: OhlcvBar[]): ObvResult {
  const n = bars.length
  const obv: (number | null)[] = new Array(n).fill(null)
  let current = 0

  for (let i = 0; i < n; i++) {
    if (i === 0) {
      current = bars[i].vol
    } else {
      const diff = bars[i].close - bars[i - 1].close
      if (diff > 0) current += bars[i].vol
      else if (diff < 0) current -= bars[i].vol
    }
    obv[i] = current
  }

  const obvMa = calcMA(obv, 30)
  return { obv, obvMa }
}

// ─── VR 成交量变异率（26）─────────────────────────────────────────────────────

export function calcVR(bars: OhlcvBar[], period = 26): (number | null)[] {
  const n = bars.length
  const result: (number | null)[] = new Array(n).fill(null)

  for (let i = period - 1; i < n; i++) {
    let avs = 0 // 上涨日成交量
    let bvs = 0 // 下跌日成交量
    let cvs = 0 // 平盘日成交量

    for (let j = i - period + 1; j <= i; j++) {
      const diff = bars[j].close - (j > 0 ? bars[j - 1].close : bars[j].preClose)
      if (diff > 0) avs += bars[j].vol
      else if (diff < 0) bvs += bars[j].vol
      else cvs += bars[j].vol
    }

    const denom = bvs + cvs / 2
    result[i] = denom === 0 ? null : ((avs + cvs / 2) / denom) * 100
  }

  return result
}

// ─── EMV 简易波动指标（14）────────────────────────────────────────────────────

export interface EmvResult {
  emv: (number | null)[]
  emvMa: (number | null)[] // EMV 的 MA(9) 信号线
}

export function calcEMV(bars: OhlcvBar[], period = 14, signalPeriod = 9): EmvResult {
  const n = bars.length
  const rawEmv: (number | null)[] = new Array(n).fill(null)

  for (let i = 1; i < n; i++) {
    const bar = bars[i]
    const prev = bars[i - 1]
    const midMove = (bar.high + bar.low) / 2 - (prev.high + prev.low) / 2
    const range = bar.high - bar.low
    if (range === 0 || bar.vol === 0) continue
    rawEmv[i] = (midMove * range) / bar.vol
  }

  const emv = calcMA(rawEmv, period)
  const emvMa = calcMA(emv, signalPeriod)
  return { emv, emvMa }
}

// ─── ROC 变动速率（12）────────────────────────────────────────────────────────

export interface RocResult {
  roc: (number | null)[]
  rocMa: (number | null)[] // ROC 的 MA(6) 信号线
}

export function calcROC(closes: (number | null)[], period = 12, signalPeriod = 6): RocResult {
  const n = closes.length
  const roc: (number | null)[] = new Array(n).fill(null)

  for (let i = period; i < n; i++) {
    const prev = closes[i - period]
    const curr = closes[i]
    if (isValidNumber(prev) && isValidNumber(curr) && (prev as number) !== 0) {
      roc[i] = (((curr as number) - (prev as number)) / (prev as number)) * 100
    }
  }

  const rocMa = calcMA(roc, signalPeriod)
  return { roc, rocMa }
}

// ─── PSY 心理线（12）──────────────────────────────────────────────────────────

export interface PsyResult {
  psy: (number | null)[]
  psyMa: (number | null)[] // PSY 的 MA(6)
}

export function calcPSY(closes: (number | null)[], period = 12, signalPeriod = 6): PsyResult {
  const n = closes.length
  const psy: (number | null)[] = new Array(n).fill(null)

  for (let i = period; i < n; i++) {
    let upCount = 0
    for (let j = i - period + 1; j <= i; j++) {
      const prev = closes[j - 1]
      const curr = closes[j]
      if (isValidNumber(prev) && isValidNumber(curr) && (curr as number) > (prev as number)) {
        upCount++
      }
    }
    psy[i] = (upCount / period) * 100
  }

  const psyMa = calcMA(psy, signalPeriod)
  return { psy, psyMa }
}

// ─── BR/AR 人气意愿指标（26）─────────────────────────────────────────────────

export interface BrarResult {
  br: (number | null)[]
  ar: (number | null)[]
}

export function calcBRAR(bars: OhlcvBar[], period = 26): BrarResult {
  const n = bars.length
  const br: (number | null)[] = new Array(n).fill(null)
  const ar: (number | null)[] = new Array(n).fill(null)

  for (let i = period - 1; i < n; i++) {
    let sumHighMinusOpen = 0
    let sumOpenMinusLow = 0
    let sumMaxHighMinusPrevClose = 0
    let sumMaxPrevCloseMinusLow = 0

    for (let j = i - period + 1; j <= i; j++) {
      const bar = bars[j]
      const prevClose = j > 0 ? bars[j - 1].close : bar.preClose

      sumHighMinusOpen += bar.high - bar.open
      sumOpenMinusLow += bar.open - bar.low
      sumMaxHighMinusPrevClose += Math.max(bar.high - prevClose, 0)
      sumMaxPrevCloseMinusLow += Math.max(prevClose - bar.low, 0)
    }

    ar[i] = sumOpenMinusLow === 0 ? null : (sumHighMinusOpen / sumOpenMinusLow) * 100
    br[i] = sumMaxPrevCloseMinusLow === 0 ? null : (sumMaxHighMinusPrevClose / sumMaxPrevCloseMinusLow) * 100
  }

  return { br, ar }
}

// ─── CR 带状能量线（26）───────────────────────────────────────────────────────

export function calcCR(bars: OhlcvBar[], period = 26): (number | null)[] {
  const n = bars.length
  const result: (number | null)[] = new Array(n).fill(null)

  for (let i = period; i < n; i++) {
    let sumHighMinusMid = 0
    let sumMidMinusLow = 0

    for (let j = i - period + 1; j <= i; j++) {
      const prev = bars[j - 1]
      const mid = (prev.high + prev.low + prev.close) / 3
      sumHighMinusMid += Math.max(bars[j].high - mid, 0)
      sumMidMinusLow += Math.max(mid - bars[j].low, 0)
    }

    result[i] = sumMidMinusLow === 0 ? null : (sumHighMinusMid / sumMidMinusLow) * 100
  }

  return result
}

// ─── SAR 抛物线指标 ────────────────────────────────────────────────────────────

export interface SarResult {
  sar: (number | null)[]
  bullish: (boolean | null)[] // true=多头, false=空头
}

export function calcSAR(bars: OhlcvBar[], initAF = 0.02, stepAF = 0.02, maxAF = 0.2): SarResult {
  const n = bars.length
  const sar: (number | null)[] = new Array(n).fill(null)
  const bullish: (boolean | null)[] = new Array(n).fill(null)

  if (n < 2) return { sar, bullish }

  let isBullish = bars[1].close > bars[0].close
  let af = initAF
  let ep = isBullish ? bars[0].high : bars[0].low
  let sarVal = isBullish ? bars[0].low : bars[0].high

  for (let i = 1; i < n; i++) {
    const bar = bars[i]
    const prevBar = bars[i - 1]

    // 更新 SAR
    let newSar = sarVal + af * (ep - sarVal)

    // 多头时 SAR 不应高于前两根的低点
    if (isBullish) {
      const low1 = prevBar.low
      const low2 = i >= 2 ? bars[i - 2].low : low1
      newSar = Math.min(newSar, low1, low2)
    } else {
      // 空头时 SAR 不应低于前两根的高点
      const high1 = prevBar.high
      const high2 = i >= 2 ? bars[i - 2].high : high1
      newSar = Math.max(newSar, high1, high2)
    }

    // 检查翻转
    if (isBullish && bar.low < newSar) {
      // 翻转为空头
      isBullish = false
      newSar = ep // SAR 设为之前的极值点
      ep = bar.low
      af = initAF
    } else if (!isBullish && bar.high > newSar) {
      // 翻转为多头
      isBullish = true
      newSar = ep
      ep = bar.high
      af = initAF
    } else {
      // 继续当前趋势，更新极值点
      if (isBullish && bar.high > ep) {
        ep = bar.high
        af = Math.min(af + stepAF, maxAF)
      } else if (!isBullish && bar.low < ep) {
        ep = bar.low
        af = Math.min(af + stepAF, maxAF)
      }
    }

    sarVal = newSar
    sar[i] = sarVal
    bullish[i] = isBullish
  }

  return { sar, bullish }
}

// ─── ATR 平均真实波幅（14）────────────────────────────────────────────────────

export function calcATR(bars: OhlcvBar[], period = 14): (number | null)[] {
  const n = bars.length
  const trs: (number | null)[] = new Array(n).fill(null)

  for (let i = 1; i < n; i++) {
    const bar = bars[i]
    const prevClose = bars[i - 1].close
    const tr = Math.max(bar.high - bar.low, Math.abs(bar.high - prevClose), Math.abs(bar.low - prevClose))
    trs[i] = tr
  }

  return calcEMA(trs, period)
}

// ─── HV 历史波动率（20 日年化）────────────────────────────────────────────────

export function calcHV(closes: (number | null)[], period = 20): (number | null)[] {
  const n = closes.length
  const result: (number | null)[] = new Array(n).fill(null)

  const logReturns: (number | null)[] = new Array(n).fill(null)
  for (let i = 1; i < n; i++) {
    const prev = closes[i - 1]
    const curr = closes[i]
    if (isValidNumber(prev) && isValidNumber(curr) && (prev as number) > 0 && (curr as number) > 0) {
      logReturns[i] = Math.log((curr as number) / (prev as number))
    }
  }

  for (let i = period; i < n; i++) {
    const slice: number[] = []
    for (let j = i - period + 1; j <= i; j++) {
      if (isValidNumber(logReturns[j])) slice.push(logReturns[j] as number)
    }
    if (slice.length < period) continue
    const mean = slice.reduce((a, b) => a + b, 0) / slice.length
    const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / slice.length
    result[i] = Math.sqrt(variance) * Math.sqrt(252) * 100
  }

  return result
}

// ─── 量比 ────────────────────────────────────────────────────────────────────

export function calcVolumeRatio(vols: number[], period = 5): (number | null)[] {
  const n = vols.length
  const result: (number | null)[] = new Array(n).fill(null)
  const maVol = calcMA(
    vols.map((v) => v),
    period,
  )

  for (let i = period - 1; i < n; i++) {
    const ma = maVol[i]
    if (isValidNumber(ma) && (ma as number) !== 0) {
      result[i] = vols[i] / (ma as number)
    }
  }

  return result
}

// ─── 综合计算入口 ─────────────────────────────────────────────────────────────

export interface TechnicalDataPoint {
  tradeDate: string
  open: number | null
  high: number | null
  low: number | null
  close: number | null
  vol: number | null
  amount: number | null
  pctChg: number | null

  // 均线
  ma5: number | null
  ma10: number | null
  ma20: number | null
  ma60: number | null
  ma120: number | null
  ma250: number | null
  ema12: number | null
  ema26: number | null

  // MACD
  macdDif: number | null
  macdDea: number | null
  macdHist: number | null

  // KDJ
  kdjK: number | null
  kdjD: number | null
  kdjJ: number | null

  // RSI
  rsi6: number | null
  rsi12: number | null
  rsi24: number | null

  // BOLL
  bollUpper: number | null
  bollMid: number | null
  bollLower: number | null

  // WR
  wr6: number | null
  wr10: number | null

  // CCI
  cci: number | null

  // DMI
  dmiPdi: number | null
  dmiMdi: number | null
  dmiAdx: number | null
  dmiAdxr: number | null

  // TRIX
  trix: number | null
  trixMa: number | null

  // DMA
  dma: number | null
  dmaMa: number | null

  // BIAS
  bias6: number | null
  bias12: number | null
  bias24: number | null

  // OBV
  obv: number | null
  obvMa: number | null

  // VR
  vr: number | null

  // EMV
  emv: number | null
  emvMa: number | null

  // ROC
  roc: number | null
  rocMa: number | null

  // PSY
  psy: number | null
  psyMa: number | null

  // BRAR
  br: number | null
  ar: number | null

  // CR
  cr: number | null

  // SAR
  sar: number | null
  sarBullish: boolean | null

  // 量价
  volMa5: number | null
  volMa10: number | null
  volMa20: number | null
  volumeRatio: number | null

  // 波动率
  atr14: number | null
  hv20: number | null
}

/**
 * 主计算入口：输入完整 OhlcvBar[]（含 preClose），返回等长的 TechnicalDataPoint[]
 * 调用者应先传入足够的 buffer 数据（建议 days + 300），再截取需要的最后 N 条
 */
export function computeAllIndicators(bars: OhlcvBar[]): TechnicalDataPoint[] {
  if (bars.length === 0) return []

  const closes = bars.map((b) => b.close as number | null)
  const vols = bars.map((b) => b.vol)

  // 均线
  const ma5 = calcMA(closes, 5)
  const ma10 = calcMA(closes, 10)
  const ma20 = calcMA(closes, 20)
  const ma60 = calcMA(closes, 60)
  const ma120 = calcMA(closes, 120)
  const ma250 = calcMA(closes, 250)
  const ema12 = calcEMA(closes, 12)
  const ema26 = calcEMA(closes, 26)

  // MACD
  const macd = calcMACD(closes)

  // KDJ
  const kdj = calcKDJ(bars)

  // RSI
  const rsi = calcRSI(closes)

  // BOLL
  const boll = calcBOLL(closes)

  // WR
  const wr = calcWR(bars)

  // CCI
  const cci = calcCCI(bars)

  // DMI
  const dmi = calcDMI(bars)

  // TRIX
  const trix = calcTRIX(closes)

  // DMA
  const dma = calcDMA(closes)

  // BIAS
  const bias = calcBIAS(closes)

  // OBV
  const obv = calcOBV(bars)

  // VR
  const vr = calcVR(bars)

  // EMV
  const emv = calcEMV(bars)

  // ROC
  const roc = calcROC(closes)

  // PSY
  const psy = calcPSY(closes)

  // BRAR
  const brar = calcBRAR(bars)

  // CR
  const cr = calcCR(bars)

  // SAR
  const sar = calcSAR(bars)

  // ATR
  const atr14 = calcATR(bars)

  // HV
  const hv20 = calcHV(closes)

  // 量价
  const volMa5 = calcMA(vols as (number | null)[], 5)
  const volMa10 = calcMA(vols as (number | null)[], 10)
  const volMa20 = calcMA(vols as (number | null)[], 20)
  const volumeRatio = calcVolumeRatio(vols)

  const round = (v: number | null, decimals = 4): number | null => {
    if (v === null || !isValidNumber(v)) return null
    const factor = 10 ** decimals
    return Math.round(v * factor) / factor
  }

  return bars.map((bar, i) => ({
    tradeDate: bar.tradeDate,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    vol: bar.vol,
    amount: bar.amount,
    pctChg: i > 0 && bar.preClose > 0 ? round(((bar.close - bar.preClose) / bar.preClose) * 100, 2) : null,

    ma5: round(ma5[i], 2),
    ma10: round(ma10[i], 2),
    ma20: round(ma20[i], 2),
    ma60: round(ma60[i], 2),
    ma120: round(ma120[i], 2),
    ma250: round(ma250[i], 2),
    ema12: round(ema12[i], 2),
    ema26: round(ema26[i], 2),

    macdDif: round(macd.dif[i]),
    macdDea: round(macd.dea[i]),
    macdHist: round(macd.hist[i]),

    kdjK: round(kdj.k[i], 2),
    kdjD: round(kdj.d[i], 2),
    kdjJ: round(kdj.j[i], 2),

    rsi6: round(rsi.rsi6[i], 2),
    rsi12: round(rsi.rsi12[i], 2),
    rsi24: round(rsi.rsi24[i], 2),

    bollUpper: round(boll.upper[i], 2),
    bollMid: round(boll.mid[i], 2),
    bollLower: round(boll.lower[i], 2),

    wr6: round(wr.wr6[i], 2),
    wr10: round(wr.wr10[i], 2),

    cci: round(cci[i], 2),

    dmiPdi: round(dmi.pdi[i], 2),
    dmiMdi: round(dmi.mdi[i], 2),
    dmiAdx: round(dmi.adx[i], 2),
    dmiAdxr: round(dmi.adxr[i], 2),

    trix: round(trix.trix[i]),
    trixMa: round(trix.matrix[i]),

    dma: round(dma.dma[i], 2),
    dmaMa: round(dma.ama[i], 2),

    bias6: round(bias.bias6[i], 2),
    bias12: round(bias.bias12[i], 2),
    bias24: round(bias.bias24[i], 2),

    obv: round(obv.obv[i], 0),
    obvMa: round(obv.obvMa[i], 0),

    vr: round(vr[i], 2),

    emv: round(emv.emv[i]),
    emvMa: round(emv.emvMa[i]),

    roc: round(roc.roc[i], 2),
    rocMa: round(roc.rocMa[i], 2),

    psy: round(psy.psy[i], 2),
    psyMa: round(psy.psyMa[i], 2),

    br: round(brar.br[i], 2),
    ar: round(brar.ar[i], 2),

    cr: round(cr[i], 2),

    sar: round(sar.sar[i], 2),
    sarBullish: sar.bullish[i],

    volMa5: round(volMa5[i], 0),
    volMa10: round(volMa10[i], 0),
    volMa20: round(volMa20[i], 0),
    volumeRatio: round(volumeRatio[i], 4),

    atr14: round(atr14[i], 4),
    hv20: round(hv20[i], 2),
  }))
}

// ─── 信号判断辅助函数 ──────────────────────────────────────────────────────────

/** 判断最近一次穿越事件（上穿/下穿），在最近 lookback 根 bar 中搜索 */
export function detectCross(
  fastArr: (number | null)[],
  slowArr: (number | null)[],
  lookback = 3,
): 'golden_cross' | 'death_cross' | null {
  const n = fastArr.length
  for (let i = n - 1; i >= Math.max(1, n - lookback); i--) {
    const fastNow = fastArr[i]
    const slowNow = slowArr[i]
    const fastPrev = fastArr[i - 1]
    const slowPrev = slowArr[i - 1]
    if (!isValidNumber(fastNow) || !isValidNumber(slowNow) || !isValidNumber(fastPrev) || !isValidNumber(slowPrev))
      continue
    if ((fastPrev as number) <= (slowPrev as number) && (fastNow as number) > (slowNow as number))
      return 'golden_cross'
    if ((fastPrev as number) >= (slowPrev as number) && (fastNow as number) < (slowNow as number))
      return 'death_cross'
  }
  return null
}

/** 判断 MA 金叉/死叉，返回最近事件名称 */
export function detectMALatestCross(points: TechnicalDataPoint[]): string | null {
  const n = points.length
  if (n < 2) return null

  const pairs: Array<{ fast: 'ma5' | 'ma10'; slow: 'ma10' | 'ma20'; name: string }> = [
    { fast: 'ma5', slow: 'ma10', name: 'ma5_cross_ma10' },
    { fast: 'ma10', slow: 'ma20', name: 'ma10_cross_ma20' },
  ]

  for (const { fast, slow, name } of pairs) {
    for (let i = n - 1; i >= Math.max(1, n - 5); i--) {
      const fn = points[i][fast]
      const sn = points[i][slow]
      const fp = points[i - 1][fast]
      const sp = points[i - 1][slow]
      if (!isValidNumber(fn) || !isValidNumber(sn) || !isValidNumber(fp) || !isValidNumber(sp)) continue
      if ((fp as number) <= (sp as number) && (fn as number) > (sn as number)) return `${name}_up`
      if ((fp as number) >= (sp as number) && (fn as number) < (sn as number)) return `${name}_down`
    }
  }
  return null
}
