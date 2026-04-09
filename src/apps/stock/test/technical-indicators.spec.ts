import {
  calcMA,
  calcEMA,
  calcMACD,
  calcKDJ,
  calcRSI,
  calcBOLL,
  calcSAR,
  calcATR,
  OhlcvBar,
} from '../utils/technical-indicators'

// ─── 测试辅助 ──────────────────────────────────────────────────────────────────

function makeBar(close: number, high?: number, low?: number, open?: number, vol = 1000): OhlcvBar {
  return {
    tradeDate: '20240101',
    open: open ?? close,
    high: high ?? close,
    low: low ?? close,
    close,
    vol,
    amount: close * vol,
    preClose: close,
  }
}

function makeBarSequence(closes: number[]): OhlcvBar[] {
  return closes.map((c, i) => ({
    tradeDate: `20240101`,
    open: c,
    high: c * 1.01,
    low: c * 0.99,
    close: c,
    vol: 1000,
    amount: c * 1000,
    preClose: i > 0 ? closes[i - 1] : c,
  }))
}

// ─── MA 测试 ──────────────────────────────────────────────────────────────────

describe('calcMA', () => {
  it('should return null for insufficient data', () => {
    const result = calcMA([1, 2, 3, 4], 5)
    expect(result.every((v) => v === null)).toBe(true)
  })

  it('should calculate MA5 correctly for exact period', () => {
    const closes = [10, 20, 30, 40, 50]
    const result = calcMA(closes, 5)
    expect(result[4]).toBe(30) // (10+20+30+40+50)/5
  })

  it('should return null for first N-1 values', () => {
    const closes = [10, 20, 30, 40, 50]
    const result = calcMA(closes, 5)
    for (let i = 0; i < 4; i++) {
      expect(result[i]).toBeNull()
    }
  })

  it('should calculate rolling MA3 correctly', () => {
    const closes = [1, 2, 3, 4, 5]
    const result = calcMA(closes, 3)
    expect(result[2]).toBeCloseTo(2, 4) // (1+2+3)/3
    expect(result[3]).toBeCloseTo(3, 4) // (2+3+4)/3
    expect(result[4]).toBeCloseTo(4, 4) // (3+4+5)/3
  })
})

// ─── EMA 测试 ─────────────────────────────────────────────────────────────────

describe('calcEMA', () => {
  it('should initialize with first value', () => {
    const closes = [10, 10, 10, 10, 10]
    const result = calcEMA(closes, 3)
    // All should be approximately 10
    result.forEach((v) => {
      if (v !== null) expect(v).toBeCloseTo(10, 2)
    })
  })

  it('should respond to price changes', () => {
    const closes = [10, 10, 10, 10, 20] // jump at end
    const result = calcEMA(closes, 3)
    // After jump, EMA should be between 10 and 20
    const last = result[result.length - 1]
    expect(last).not.toBeNull()
    expect(last as number).toBeGreaterThan(10)
    expect(last as number).toBeLessThan(20)
  })

  it('should converge towards new price', () => {
    // EMA with period=2 (k=2/3) starting at 100, new price 200
    const closes = [100, 200, 200, 200]
    const result = calcEMA(closes, 2)
    // After several periods, should be close to 200
    const last = result[result.length - 1] as number
    expect(last).toBeGreaterThan(150)
  })
})

// ─── MACD 测试 ────────────────────────────────────────────────────────────────

describe('calcMACD', () => {
  it('should return arrays of same length as input', () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 + i)
    const result = calcMACD(closes)
    expect(result.dif.length).toBe(30)
    expect(result.dea.length).toBe(30)
    expect(result.hist.length).toBe(30)
  })

  it('should have DIF = EMA12 - EMA26', () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 + i)
    const result = calcMACD(closes)
    const ema12 = calcEMA(closes, 12)
    const ema26 = calcEMA(closes, 26)

    for (let i = 0; i < closes.length; i++) {
      const dif = result.dif[i]
      if (dif !== null && ema12[i] !== null && ema26[i] !== null) {
        expect(dif).toBeCloseTo((ema12[i] as number) - (ema26[i] as number), 6)
      }
    }
  })

  it('HIST should equal (DIF - DEA) * 2', () => {
    const closes = Array.from({ length: 50 }, (_, i) => 100 + Math.sin(i) * 5)
    const result = calcMACD(closes)

    for (let i = 0; i < closes.length; i++) {
      const dif = result.dif[i]
      const dea = result.dea[i]
      const hist = result.hist[i]
      if (dif !== null && dea !== null && hist !== null) {
        expect(hist).toBeCloseTo((dif - dea) * 2, 6)
      }
    }
  })
})

// ─── KDJ 测试 ─────────────────────────────────────────────────────────────────

describe('calcKDJ', () => {
  it('should return same length arrays', () => {
    const bars = makeBarSequence([10, 11, 12, 13, 14, 15, 16, 17, 18, 19])
    const result = calcKDJ(bars)
    expect(result.k.length).toBe(10)
    expect(result.d.length).toBe(10)
    expect(result.j.length).toBe(10)
  })

  it('should initialize K and D at 50', () => {
    // Single bar with constant price → RSV=50 → K=D=50, J=50
    const bars = [makeBar(100, 110, 90)]
    const result = calcKDJ(bars)
    expect(result.k[0]).toBeCloseTo(50, 1)
    expect(result.d[0]).toBeCloseTo(50, 1)
    expect(result.j[0]).toBeCloseTo(50, 1)
  })

  it('should satisfy J = 3K - 2D', () => {
    const bars = makeBarSequence([10, 11, 9, 12, 10, 11, 13, 12, 14, 15])
    const result = calcKDJ(bars)
    for (let i = 0; i < bars.length; i++) {
      const k = result.k[i]
      const d = result.d[i]
      const j = result.j[i]
      if (k !== null && d !== null && j !== null) {
        expect(j).toBeCloseTo(3 * k - 2 * d, 4)
      }
    }
  })
})

// ─── RSI 测试 ─────────────────────────────────────────────────────────────────

describe('calcRSI', () => {
  it('should return values between 0 and 100', () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 + Math.sin(i * 0.5) * 10)
    const result = calcRSI(closes)
    ;[result.rsi6, result.rsi12, result.rsi24].forEach((rsiArr) => {
      rsiArr.forEach((v) => {
        if (v !== null) {
          expect(v).toBeGreaterThanOrEqual(0)
          expect(v).toBeLessThanOrEqual(100)
        }
      })
    })
  })

  it('should return 100 when all moves are up', () => {
    const closes = Array.from({ length: 15 }, (_, i) => 100 + i)
    const result = calcRSI(closes)
    // All days up → RSI6 should be close to 100
    const rsi6 = result.rsi6.filter((v) => v !== null)
    if (rsi6.length > 0) {
      expect(rsi6[rsi6.length - 1] as number).toBeGreaterThan(90)
    }
  })

  it('should return 0 when all moves are down', () => {
    const closes = Array.from({ length: 15 }, (_, i) => 100 - i)
    const result = calcRSI(closes)
    const rsi6 = result.rsi6.filter((v) => v !== null)
    if (rsi6.length > 0) {
      expect(rsi6[rsi6.length - 1] as number).toBeLessThan(10)
    }
  })
})

// ─── BOLL 测试 ────────────────────────────────────────────────────────────────

describe('calcBOLL', () => {
  it('upper > mid > lower for non-constant data', () => {
    const closes = Array.from({ length: 25 }, (_, i) => 100 + Math.sin(i) * 5)
    const result = calcBOLL(closes)
    for (let i = 0; i < closes.length; i++) {
      const u = result.upper[i]
      const m = result.mid[i]
      const l = result.lower[i]
      if (u !== null && m !== null && l !== null) {
        expect(u).toBeGreaterThan(m)
        expect(m).toBeGreaterThan(l)
      }
    }
  })

  it('mid should equal MA20', () => {
    const closes = Array.from({ length: 25 }, (_, i) => 100 + i)
    const result = calcBOLL(closes)
    const ma20 = calcMA(closes, 20)
    for (let i = 0; i < closes.length; i++) {
      if (result.mid[i] !== null && ma20[i] !== null) {
        expect(result.mid[i]).toBeCloseTo(ma20[i] as number, 4)
      }
    }
  })

  it('should collapse to MA for constant prices', () => {
    const closes = new Array(25).fill(100)
    const result = calcBOLL(closes)
    for (let i = 19; i < closes.length; i++) {
      expect(result.upper[i]).toBeCloseTo(100, 4)
      expect(result.mid[i]).toBeCloseTo(100, 4)
      expect(result.lower[i]).toBeCloseTo(100, 4)
    }
  })
})

// ─── SAR 测试 ─────────────────────────────────────────────────────────────────

describe('calcSAR', () => {
  it('should return same length arrays', () => {
    const bars = makeBarSequence([10, 11, 12, 13, 14, 15])
    const result = calcSAR(bars)
    expect(result.sar.length).toBe(6)
    expect(result.bullish.length).toBe(6)
  })

  it('should be bullish in rising market', () => {
    const bars = makeBarSequence([100, 101, 102, 103, 104, 105, 106, 107, 108, 109])
    const result = calcSAR(bars)
    const lastBullish = result.bullish[result.bullish.length - 1]
    expect(lastBullish).toBe(true)
  })

  it('should be bearish in falling market', () => {
    const closes = [100, 99, 98, 97, 96, 95, 94, 93, 92, 91]
    const bars: OhlcvBar[] = closes.map((c, i) => ({
      tradeDate: '20240101',
      open: c,
      high: c,
      low: c - 0.5,
      close: c,
      vol: 1000,
      amount: c * 1000,
      preClose: i > 0 ? closes[i - 1] : c,
    }))
    const result = calcSAR(bars)
    const lastBullish = result.bullish[result.bullish.length - 1]
    expect(lastBullish).toBe(false)
  })
})

// ─── ATR 测试 ─────────────────────────────────────────────────────────────────

describe('calcATR', () => {
  it('should return positive values for volatile data', () => {
    const bars: OhlcvBar[] = Array.from({ length: 20 }, (_, i) => ({
      tradeDate: '20240101',
      open: 100,
      high: 105,
      low: 95,
      close: 100 + (i % 5),
      vol: 1000,
      amount: 100000,
      preClose: 100,
    }))
    const result = calcATR(bars)
    const nonNull = result.filter((v) => v !== null) as number[]
    nonNull.forEach((v) => expect(v).toBeGreaterThan(0))
  })

  it('ATR should be 0 for perfectly flat prices', () => {
    const bars: OhlcvBar[] = Array.from({ length: 20 }, () => ({
      tradeDate: '20240101',
      open: 100,
      high: 100,
      low: 100,
      close: 100,
      vol: 1000,
      amount: 100000,
      preClose: 100,
    }))
    const result = calcATR(bars)
    const nonNull = result.filter((v) => v !== null) as number[]
    nonNull.forEach((v) => expect(v).toBeCloseTo(0, 4))
  })
})
