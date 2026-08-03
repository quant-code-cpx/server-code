import { createQfqBars, TechnicalIndicatorEngine, type TechnicalSignalBar } from '../domain'

function bar(sequence: number, close: number, overrides: Partial<TechnicalSignalBar> = {}): TechnicalSignalBar {
  return {
    tradeDate: String(20240100 + sequence),
    open: close,
    high: close + 1,
    low: Math.max(close - 1, 0.01),
    close,
    vol: 100,
    ...overrides,
  }
}

describe('TechnicalIndicatorEngine', () => {
  it('uses a common QFQ anchor so an ex-right day does not create a false price jump', () => {
    const qfqBars = createQfqBars(
      [
        { ...bar(1, 10), adjFactor: 1 },
        { ...bar(2, 5), adjFactor: 2 },
      ],
      2,
    )

    expect(qfqBars.map(({ close }) => close)).toEqual([5, 5])
    expect(qfqBars.map(({ vol }) => vol)).toEqual([100, 100])
  })

  it('uses full-precision MACD recursion and exposes it only from valid bar 35', () => {
    const bars = Array.from({ length: 36 }, (_, index) => bar(index + 1, index === 35 ? 2 : 1))
    const points = new TechnicalIndicatorEngine().compute(bars)

    expect(points[33].macdDif).toBeNull()
    expect(points[34].macdDif).toBe(0)
    expect(points[35].macdDif).toBeCloseTo(2 / 13 - 2 / 27, 12)
    expect(points[35].macdDea).toBeCloseTo((2 / 13 - 2 / 27) * 0.2, 12)
  })

  it('uses specified KDJ and RSI6 initializations and Wilder recurrence', () => {
    const kdjBars = Array.from({ length: 9 }, (_, index) => bar(index + 1, index === 8 ? 10 : 5, { high: 10, low: 1 }))
    const kdjPoint = new TechnicalIndicatorEngine().compute(kdjBars)[8]
    // RSV=100; K=(2*50+100)/3; D=(2*50+K)/3; J=3K-2D.
    expect(kdjPoint.kdjK).toBeCloseTo(66.6666666667, 10)
    expect(kdjPoint.kdjD).toBeCloseTo(55.5555555556, 10)
    expect(kdjPoint.kdjJ).toBeCloseTo(88.8888888889, 10)

    const rsiBars = [1, 2, 3, 4, 5, 6, 7, 6].map((close, index) => bar(index + 1, close))
    const rsiPoints = new TechnicalIndicatorEngine().compute(rsiBars)
    // First six changes are gains: RSI6=100. Next loss yields gain=5/6, loss=1/6, RSI=83.333... .
    expect(rsiPoints[6].rsi6).toBe(100)
    expect(rsiPoints[7].rsi6).toBeCloseTo(83.3333333333, 10)
  })

  it('uses SMA/population variance and excludes current volume from 20-day volume ratio', () => {
    const bars = Array.from({ length: 60 }, (_, index) => bar(index + 1, index + 1))
    bars[20] = bar(21, 21, { vol: 160 })
    const points = new TechnicalIndicatorEngine().compute(bars)
    const last = points[59]

    // Values 56..60 => MA5=58; 51..60 => MA10=55.5; 41..60 => MA20=50.5.
    expect(last.ma5).toBe(58)
    expect(last.ma10).toBe(55.5)
    expect(last.ma20).toBe(50.5)
    expect(last.ma60).toBe(30.5)
    // Population standard deviation of 41..60 is sqrt(33.25).
    expect(last.bollMid).toBe(50.5)
    expect(last.bollUpper).toBeCloseTo(50.5 + 2 * Math.sqrt(33.25), 12)
    expect(last.bollLower).toBeCloseTo(50.5 - 2 * Math.sqrt(33.25), 12)
    expect(points[20].volumeAverage20).toBe(100)
    expect(points[20].volumeRatio20).toBe(1.6)
  })

  it('uses fixed SAR state transitions, including strict reversal and previous-low clamp', () => {
    const points = new TechnicalIndicatorEngine().compute([
      bar(1, 10, { high: 11, low: 9 }),
      bar(2, 12, { high: 13, low: 10 }),
      bar(3, 9, { high: 12, low: 8.5 }),
    ])

    // Bar 2 initializes bullish: candidate 9.04 clamps to prior low 9, then EP becomes 13.
    expect(points[1].sar).toBe(9)
    expect(points[1].sarBullish).toBe(true)
    // Bar 3 candidate clamps to 9; low 8.5 is strictly below it, so SAR flips to prior EP=13.
    expect(points[2].sar).toBe(13)
    expect(points[2].sarBullish).toBe(false)
  })
})
