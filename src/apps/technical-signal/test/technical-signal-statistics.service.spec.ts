import { StockExchange } from '@prisma/client'
import type { IndicatorPoint } from '../domain'
import {
  TechnicalSignalEntryMode,
  TechnicalSignalPeriod,
  type TechnicalSignalOccurrenceListRequestDto,
  type TechnicalSignalStatisticsRequestDto,
} from '../dto/technical-signal-request.dto'
import type { TechnicalSignalTimelineSnapshot } from '../repositories/prisma-technical-signal.repository'
import { TechnicalSignalDefinitionService } from '../services/technical-signal-definition.service'
import { TechnicalSignalEvaluationService } from '../services/technical-signal-evaluation.service'
import { TechnicalSignalStatisticsService } from '../services/technical-signal-statistics.service'

const TS_CODE = '000001.SZ'
const SAR_BEARISH = 'sar.bearish-state-enter'

describe('TechnicalSignalStatisticsService', () => {
  let definitions: TechnicalSignalDefinitionService
  let repository: { loadTimeline: jest.Mock }
  let cacheService: ReturnType<typeof buildCacheServiceMock>
  let service: TechnicalSignalStatisticsService

  beforeEach(() => {
    definitions = new TechnicalSignalDefinitionService()
    repository = { loadTimeline: jest.fn() }
    cacheService = buildCacheServiceMock()
    // Reflect.construct keeps this fixture compatible while the production
    // constructor gains CacheService; JavaScript safely ignores extra args in
    // the pre-cache implementation.
    const evaluation = Reflect.construct(TechnicalSignalEvaluationService, [repository, definitions])
    service = Reflect.construct(TechnicalSignalStatisticsService, [repository, definitions, cacheService, evaluation])
  })

  it('[BIZ] computes bearish raw/directional return plus raw and directional MFE/MAE', async () => {
    const timeline = buildTimeline({
      dates: ['20260101', '20260102', '20260105', '20260106'],
      bars: [
        quote('20260101', 100),
        quote('20260102', 100),
        quote('20260105', 96, { high: 104, low: 90 }),
        quote('20260106', 92, { high: 98, low: 88 }),
      ],
    })
    repository.loadTimeline.mockResolvedValueOnce(timeline)
    setIndicatorPoints(service, [
      point('20260101', true),
      point('20260102', false),
      point('20260105', false),
      point('20260106', false),
    ])

    const response = await service.query({
      tsCode: TS_CODE,
      signals: [{ signalKey: SAR_BEARISH }],
      periods: [TechnicalSignalPeriod.CUSTOM],
      customStartDate: '20260101',
      customEndDate: '20260106',
      horizons: [2],
      entryMode: TechnicalSignalEntryMode.SIGNAL_CLOSE,
    } as TechnicalSignalStatisticsRequestDto)

    const horizon = response.groups[0].horizons[0]
    expect(response.groups[0]).toMatchObject({
      signalKey: SAR_BEARISH,
      direction: 'BEARISH',
      occurrenceCount: 1,
    })
    // 100 -> 92 is -8% raw, which is a +8% outcome for a bearish signal.
    expect(horizon.raw.averageReturnPct).toBe(-8)
    expect(horizon.directional.averageDirectionalReturnPct).toBe(8)
    expect(horizon.directional.successRatio).toBe(1)
    expect(horizon.excursion).toMatchObject({
      completePathCount: 1,
      partialPathCount: 0,
      averageMfePct: 4,
      averageMaePct: -12,
      averageDirectionalMfePct: 12,
      averageDirectionalMaePct: -4,
    })
    expect(repository.loadTimeline).toHaveBeenCalledTimes(1)
  })

  it('[BIZ] echoes tsCode and does not evaluate a later occurrence outside the requested window', async () => {
    const timeline = buildTimeline({
      dates: ['20260101', '20260102', '20260105', '20260106', '20260107', '20260108'],
      bars: [
        quote('20260101', 100),
        quote('20260102', 100),
        quote('20260105', 96, { high: 104, low: 90 }),
        quote('20260106', 92, { high: 98, low: 88 }),
        quote('20260107', 93),
        quote('20260108', 91),
      ],
    })
    repository.loadTimeline.mockResolvedValueOnce(timeline)
    setIndicatorPoints(service, [
      point('20260101', true),
      point('20260102', false),
      point('20260105', false),
      point('20260106', true),
      point('20260107', true),
      // A second bearish transition exists after endDate. There are deliberately
      // no future calendar dates for its H=2 outcome, so evaluating it would
      // fail instead of being harmlessly filtered after the fact.
      point('20260108', false),
    ])

    const response = await service.listOccurrences({
      tsCode: TS_CODE,
      signalKey: SAR_BEARISH,
      startDate: '20260101',
      endDate: '20260106',
      horizons: [2],
      entryMode: TechnicalSignalEntryMode.SIGNAL_CLOSE,
    } as TechnicalSignalOccurrenceListRequestDto)

    expect(repository.loadTimeline).toHaveBeenCalledTimes(1)
    expect(response).toMatchObject({ total: 1, page: 1, pageSize: 20 })
    expect(response.items).toHaveLength(1)
    expect(response.items[0]).toMatchObject({
      tsCode: TS_CODE,
      signalKey: SAR_BEARISH,
      signalDate: '20260102',
      direction: 'BEARISH',
      outcomes: [
        {
          horizon: 2,
          qualityStatus: 'VALID',
          rawReturnPct: -8,
          directionalReturnPct: 8,
          rawMfePct: 4,
          rawMaePct: -12,
          directionalMfePct: 12,
          directionalMaePct: -4,
        },
      ],
    })
  })

  it('[BIZ] rejects occurrence detail requests extending beyond the recent five-year window', async () => {
    const timeline = buildTimeline({
      dates: ['20260101', '20260102', '20260105', '20260106'],
      bars: [quote('20260101', 100), quote('20260102', 100), quote('20260105', 96), quote('20260106', 92)],
    })
    repository.loadTimeline.mockResolvedValueOnce(timeline)

    await expect(
      service.listOccurrences({
        tsCode: TS_CODE,
        signalKey: SAR_BEARISH,
        startDate: '20201231',
        endDate: '20260106',
      } as TechnicalSignalOccurrenceListRequestDto),
    ).rejects.toMatchObject({ status: 400, message: expect.stringContaining('CUSTOM 最多 5 年') })
  })

  it('[BIZ] computes HS300 excess return using same entry mode and target date', async () => {
    const timeline = buildTimeline({
      dates: ['20260101', '20260102', '20260105', '20260106'],
      bars: [quote('20260101', 100), quote('20260102', 100), quote('20260105', 96), quote('20260106', 92)],
      benchmarkBars: [
        benchmarkQuote('20260101', 100),
        benchmarkQuote('20260102', 100),
        benchmarkQuote('20260105', 105),
        benchmarkQuote('20260106', 110),
      ],
    })
    repository.loadTimeline.mockResolvedValueOnce(timeline)
    setIndicatorPoints(service, [
      point('20260101', true),
      point('20260102', false),
      point('20260105', false),
      point('20260106', false),
    ])

    const response = await service.query({
      tsCode: TS_CODE,
      signals: [{ signalKey: SAR_BEARISH }],
      periods: [TechnicalSignalPeriod.CUSTOM],
      customStartDate: '20260101',
      customEndDate: '20260106',
      horizons: [2],
      includeBenchmark: true,
    } as TechnicalSignalStatisticsRequestDto)

    // Stock: 100 -> 92 = -8%; HS300: 100 -> 110 = +10%; excess = -18%.
    const horizon = response.groups[0].horizons[0]
    expect(horizon.excess?.averageReturnPct).toBe(-18)
    expect(horizon.benchmarkMissingCount).toBe(0)
  })

  it.each([
    {
      name: 'malformed compact date',
      request: {
        tsCode: TS_CODE,
        signalKey: SAR_BEARISH,
        startDate: '2026-01-01',
        endDate: '20260106',
      },
    },
    {
      name: 'duplicate quality status',
      request: {
        tsCode: TS_CODE,
        signalKey: SAR_BEARISH,
        startDate: '20260101',
        endDate: '20260106',
        qualityStatuses: ['VALID', 'VALID'],
      },
    },
  ])('[ERR] returns HTTP 400 for $name before reading the repository', async ({ request }) => {
    await expect(service.listOccurrences(request as TechnicalSignalOccurrenceListRequestDto)).rejects.toMatchObject({
      status: 400,
    })
    expect(repository.loadTimeline).not.toHaveBeenCalled()
  })
})

function buildCacheServiceMock() {
  return {
    buildSha256Key: jest.fn(() => 'technical-signal-test-cache-key'),
    rememberJsonWithStatus: jest.fn(async ({ loader }: { loader: () => Promise<unknown> }) => ({
      value: await loader(),
      cacheHit: false,
    })),
  }
}

function setIndicatorPoints(service: TechnicalSignalStatisticsService, points: readonly IndicatorPoint[]): void {
  ;(
    service as unknown as {
      evaluation: { indicatorEngine: { compute: jest.Mock } }
    }
  ).evaluation.indicatorEngine = {
    compute: jest.fn(() => points),
  }
}

function buildTimeline(input: {
  dates: string[]
  bars: TechnicalSignalTimelineSnapshot['bars']
  benchmarkBars?: Array<{ tradeDate: string; open: number; close: number }>
}): TechnicalSignalTimelineSnapshot {
  return {
    stock: {
      tsCode: TS_CODE,
      name: '平安银行',
      exchange: StockExchange.SZSE,
      listDate: '19910403',
      delistDate: null,
    },
    dataAsOf: input.dates[input.dates.length - 1],
    historyStart: input.dates[0],
    calendarExchange: 'SZSE',
    openDates: input.dates,
    bars: input.bars,
    benchmark: input.benchmarkBars
      ? { tsCode: '000300.SH', bars: input.benchmarkBars, version: '000300.SH:20260108' }
      : null,
    suspendedDates: new Set<string>(),
    dataVersions: {
      tradeCal: 'SZSE:20260108',
      daily: 'watermark:20260108',
      adjFactor: 'watermark:20260108',
      suspendD: 'rows:0:through:20260108',
      indexDaily: null,
    },
  }
}

function benchmarkQuote(tradeDate: string, close: number, open = close) {
  return { tradeDate, open, close }
}

function quote(
  tradeDate: string,
  close: number,
  options: Partial<Pick<TechnicalSignalTimelineSnapshot['bars'][number], 'open' | 'high' | 'low' | 'vol'>> = {},
): TechnicalSignalTimelineSnapshot['bars'][number] {
  return {
    tradeDate,
    open: options.open ?? close,
    high: options.high ?? close,
    low: options.low ?? close,
    close,
    vol: options.vol ?? 1_000,
    adjFactor: 1,
  }
}

function point(tradeDate: string, sarBullish: boolean): IndicatorPoint {
  return {
    tradeDate,
    open: 100,
    high: 100,
    low: 100,
    close: 100,
    vol: 1_000,
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
    sar: 100,
    sarBullish,
    volumeAverage20: null,
    volumeRatio20: null,
  }
}
