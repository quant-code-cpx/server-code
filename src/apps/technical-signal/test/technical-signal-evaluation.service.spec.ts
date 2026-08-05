import { StockExchange } from '@prisma/client'
import type { IndicatorPoint } from '../domain'
import type { TechnicalSignalTimelineSnapshot } from '../repositories/prisma-technical-signal.repository'
import { TechnicalSignalDefinitionService } from '../services/technical-signal-definition.service'
import { TechnicalSignalEvaluationService } from '../services/technical-signal-evaluation.service'

describe('TechnicalSignalEvaluationService', () => {
  it('[BIZ] DIF 从 -1 上穿 0 轴 DEA 后，MACD 金叉在 dataThrough 当日明确触发', async () => {
    const repository = { loadTimeline: jest.fn().mockResolvedValue(timeline()) }
    const service = new TechnicalSignalEvaluationService(repository as never, new TechnicalSignalDefinitionService())
    ;(service as unknown as { indicatorEngine: { compute: jest.Mock } }).indicatorEngine = {
      compute: jest.fn(() => [point('20260803', -1, 0), point('20260804', 1, 0)]),
    }

    const result = await service.evaluate({
      tsCode: '600089.SH',
      requestedAsOf: '20260804',
      signalKeys: ['macd.golden-cross'],
      lookbackTradeDays: 20,
    })

    expect(result.current).toEqual([
      expect.objectContaining({
        signalKey: 'macd.golden-cross',
        evaluable: true,
        triggeredOnDataThrough: true,
        latestOccurrenceDate: '20260804',
      }),
    ])
    expect(result.occurrences).toHaveLength(1)
    expect(result.current[0].evidence).toMatchObject({
      previous: { macdDif: -1, macdDea: 0 },
      current: { macdDif: 1, macdDea: 0 },
    })
    expect(repository.loadTimeline).toHaveBeenCalledWith(expect.objectContaining({ historyTradeDays: 270 }))
  })

  it('[BIZ] 没有穿越时明确返回 triggeredOnDataThrough=false，而不是省略结果', async () => {
    const repository = { loadTimeline: jest.fn().mockResolvedValue(timeline()) }
    const service = new TechnicalSignalEvaluationService(repository as never, new TechnicalSignalDefinitionService())
    ;(service as unknown as { indicatorEngine: { compute: jest.Mock } }).indicatorEngine = {
      compute: jest.fn(() => [point('20260803', 1, 0), point('20260804', 2, 0)]),
    }

    const result = await service.evaluate({
      tsCode: '600089.SH',
      signalKeys: ['macd.golden-cross'],
      lookbackTradeDays: 20,
    })

    expect(result.current[0]).toMatchObject({
      evaluable: true,
      triggeredOnDataThrough: false,
      latestOccurrenceDate: null,
      evidence: null,
    })
  })
})

function timeline(): TechnicalSignalTimelineSnapshot {
  return {
    stock: {
      tsCode: '600089.SH',
      name: '特变电工',
      exchange: StockExchange.SSE,
      listDate: '19970618',
      delistDate: null,
    },
    dataAsOf: '20260804',
    historyStart: '20260803',
    calendarExchange: 'SSE',
    openDates: ['20260803', '20260804'],
    bars: [rawBar('20260803'), rawBar('20260804')],
    benchmark: null,
    suspendedDates: new Set(),
    dataVersions: {
      tradeCal: 'test',
      daily: 'test',
      adjFactor: 'test',
      suspendD: 'test',
      indexDaily: null,
    },
  }
}

function rawBar(tradeDate: string) {
  return { tradeDate, open: 10, high: 11, low: 9, close: 10, vol: 100, adjFactor: 1 }
}

function point(tradeDate: string, macdDif: number, macdDea: number): IndicatorPoint {
  return {
    ...rawBar(tradeDate),
    ma5: 10,
    ma10: 10,
    ma20: 10,
    ma60: 10,
    macdDif,
    macdDea,
    kdjK: 50,
    kdjD: 50,
    kdjJ: 50,
    rsi6: 50,
    bollUpper: 12,
    bollMid: 10,
    bollLower: 8,
    sar: 9,
    sarBullish: true,
    volumeAverage20: 100,
    volumeRatio20: 1,
  }
}
