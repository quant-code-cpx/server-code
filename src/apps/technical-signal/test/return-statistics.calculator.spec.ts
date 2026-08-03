import {
  calculateAdjustedReturn,
  calculateBasicReturnStatistics,
  calculateDirectionalReturn,
  calculateDirectionalReturnStatistics,
} from '../domain'

describe('technical signal pure return/statistics calculators', () => {
  it('uses adjustment-factor ratios and entry-mode prices', () => {
    const exRightNeutral = calculateAdjustedReturn({ open: 10, close: 10 }, 1, { close: 5 }, 2, 'SIGNAL_CLOSE')
    // 5*2 / (10*1) - 1 = 0: a split must not become a -50% signal outcome.
    expect(exRightNeutral.rawReturn).toBe(0)

    const nextOpen = calculateAdjustedReturn({ open: 100, close: 98 }, 1, { close: 108 }, 1, 'NEXT_OPEN')
    expect(nextOpen.rawReturn).toBeCloseTo(0.08, 12)
    expect(calculateDirectionalReturn(0.08, 'BEARISH')).toBeCloseTo(-0.08, 12)
    expect(calculateDirectionalReturn(0.08, 'CONTEXTUAL')).toBeNull()
  })

  it('calculates hand-derived distribution, interpolated quartiles, and n-1 stddev', () => {
    const result = calculateBasicReturnStatistics([-0.2, 0, 0.1, 0.3])

    expect(result).toMatchObject({
      sampleCount: 4,
      upCount: 2,
      downCount: 1,
      flatCount: 1,
      upRatio: 0.5,
      downRatio: 0.25,
      flatRatio: 0.25,
      median: 0.05,
      minimum: -0.2,
      maximum: 0.3,
      p75: 0.15,
    })
    expect(result.average).toBeCloseTo(0.05, 12)
    expect(result.p25).toBeCloseTo(-0.05, 12)
    // Sum squared deviations = 0.13, sample variance = 0.13 / 3.
    expect(result.stdDev).toBeCloseTo(Math.sqrt(0.13 / 3), 12)
  })

  it('keeps n=0/n=1 null semantics and does not invent contextual direction', () => {
    expect(calculateBasicReturnStatistics([])).toMatchObject({
      sampleCount: 0,
      average: null,
      stdDev: null,
      upRatio: null,
    })
    expect(calculateBasicReturnStatistics([0.1]).stdDev).toBeNull()
    expect(calculateDirectionalReturnStatistics([0.1, -0.1], 'CONTEXTUAL')).toEqual({
      sampleCount: 0,
      successCount: 0,
      failureCount: 0,
      flatCount: 0,
      successRatio: null,
      average: null,
      median: null,
      minimum: null,
      maximum: null,
      stdDev: null,
      p25: null,
      p75: null,
    })
  })

  it('reorients bearish returns before directional success statistics', () => {
    const result = calculateDirectionalReturnStatistics([-0.2, 0.05], 'BEARISH')

    // Bearish directional returns are [20%, -5%].
    expect(result.successCount).toBe(1)
    expect(result.failureCount).toBe(1)
    expect(result.flatCount).toBe(0)
    expect(result.successRatio).toBe(0.5)
    expect(result.average).toBeCloseTo(0.075, 12)
  })
})
