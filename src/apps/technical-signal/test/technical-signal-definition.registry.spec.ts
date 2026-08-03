import { detectTechnicalSignalOccurrences, TECHNICAL_SIGNAL_DEFINITIONS, type IndicatorPoint } from '../domain'

function point(tradeDate: string, overrides: Partial<IndicatorPoint> = {}): IndicatorPoint {
  return {
    tradeDate,
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    vol: 100,
    ma5: null,
    ma10: null,
    ma20: null,
    ma60: null,
    macdDif: null,
    macdDea: null,
    kdjK: null,
    kdjD: null,
    kdjJ: null,
    rsi6: null,
    bollUpper: null,
    bollMid: null,
    bollLower: null,
    sar: null,
    sarBullish: null,
    volumeAverage20: null,
    volumeRatio20: null,
    ...overrides,
  }
}

function definition(signalKey: string) {
  const found = TECHNICAL_SIGNAL_DEFINITIONS.find((candidate) => candidate.signalKey === signalKey)
  if (!found) throw new Error(`missing definition ${signalKey}`)
  return found
}

describe('TECHNICAL_SIGNAL_DEFINITIONS', () => {
  it('contains frozen 14-event v1 catalog with stable hashes', () => {
    expect(TECHNICAL_SIGNAL_DEFINITIONS).toHaveLength(14)
    expect(new Set(TECHNICAL_SIGNAL_DEFINITIONS.map(({ signalKey }) => signalKey)).size).toBe(14)
    for (const signal of TECHNICAL_SIGNAL_DEFINITIONS) {
      expect(signal.source).toBe('LOCAL_QFQ_OHLCV')
      expect(signal.indicatorAlgorithmVersion).toBe('technical-indicator.v2')
      expect(signal.definitionHash).toMatch(/^[a-f0-9]{64}$/)
    }
  })

  it.each([
    ['macd.golden-cross', { macdDif: -1, macdDea: 0 }, { macdDif: 1, macdDea: 0 }],
    ['macd.death-cross', { macdDif: 1, macdDea: 0 }, { macdDif: -1, macdDea: 0 }],
    ['kdj.golden-cross', { kdjK: 10, kdjD: 20, kdjJ: -10 }, { kdjK: 21, kdjD: 20, kdjJ: 23 }],
    ['kdj.death-cross', { kdjK: 90, kdjD: 80, kdjJ: 110 }, { kdjK: 79, kdjD: 80, kdjJ: 77 }],
    ['rsi6.oversold-enter', { rsi6: 35 }, { rsi6: 29 }],
    ['rsi6.overbought-enter', { rsi6: 65 }, { rsi6: 71 }],
    ['boll.upper-breakout', { close: 99, bollUpper: 100 }, { close: 101, bollUpper: 100 }],
    ['boll.lower-breakdown', { close: 91, bollLower: 90 }, { close: 89, bollLower: 90 }],
    ['ma.bullish-alignment-enter', { ma5: 4, ma10: 4, ma20: 3, ma60: 2 }, { ma5: 5, ma10: 4, ma20: 3, ma60: 2 }],
    ['ma.bearish-alignment-enter', { ma5: 3, ma10: 3, ma20: 4, ma60: 5 }, { ma5: 2, ma10: 3, ma20: 4, ma60: 5 }],
    ['sar.bullish-state-enter', { sar: 101, sarBullish: false }, { sar: 99, sarBullish: true }],
    ['sar.bearish-state-enter', { sar: 99, sarBullish: true }, { sar: 101, sarBullish: false }],
    [
      'volume-ratio20.expand-enter',
      { volumeAverage20: 100, volumeRatio20: 1.4 },
      { volumeAverage20: 100, volumeRatio20: 1.6 },
    ],
    [
      'volume-ratio20.shrink-enter',
      { volumeAverage20: 100, volumeRatio20: 0.6 },
      { volumeAverage20: 100, volumeRatio20: 0.4 },
    ],
  ])('detects hand-derived %s transition', (signalKey, previous, current) => {
    const evidence = definition(signalKey).evaluate(
      point('20240101', previous as Partial<IndicatorPoint>),
      point('20240102', current as Partial<IndicatorPoint>),
    )

    expect(evidence).not.toBeNull()
  })

  it('does not treat equality or a continuing state as a new MACD event', () => {
    const golden = definition('macd.golden-cross')

    expect(
      golden.evaluate(point('20240101', { macdDif: 0, macdDea: 0 }), point('20240102', { macdDif: 0, macdDea: 0 })),
    ).toBeNull()
    expect(
      golden.evaluate(point('20240102', { macdDif: 1, macdDea: 0 }), point('20240103', { macdDif: 2, macdDea: 0 })),
    ).toBeNull()
  })

  it('uses pre-window previous point to detect a transition on window first day', () => {
    const occurrences = detectTechnicalSignalOccurrences(
      [point('20240101', { macdDif: -1, macdDea: 0 }), point('20240102', { macdDif: 1, macdDea: 0 })],
      {
        definitions: [definition('macd.golden-cross')],
        windowStartDate: '20240102',
        windowEndDate: '20240102',
      },
    )

    expect(occurrences).toHaveLength(1)
    expect(occurrences[0]).toMatchObject({
      signalKey: 'macd.golden-cross',
      signalDate: '20240102',
      direction: 'BULLISH',
    })
  })
})
