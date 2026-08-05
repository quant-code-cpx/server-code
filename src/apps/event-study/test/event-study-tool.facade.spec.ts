import { EventStudyToolFacade } from '../event-study-tool.facade'
import { EventType } from '../event-type.registry'

describe('EventStudyToolFacade', () => {
  const date = (value: string) => new Date(`${value}T00:00:00.000Z`)
  const eventStudyService = {
    extractEventSamples: jest.fn(async () => [{ tsCode: '600000.SH', eventDate: '2026-01-06' }]),
  }
  const repository = {
    findTradeDays: jest.fn(async () => [
      { calDate: date('2026-01-05') },
      { calDate: date('2026-01-06') },
      { calDate: date('2026-01-07') },
    ]),
    findBenchmarkDataThrough: jest.fn(async () => date('2026-08-04')),
    findBenchmarkReturns: jest.fn(async () => [
      { tradeDate: date('2026-01-05'), pctChg: 1 },
      { tradeDate: date('2026-01-06'), pctChg: 1 },
      { tradeDate: date('2026-01-07'), pctChg: 1 },
    ]),
    findWindowReturns: jest.fn(async () => [
      { eventKey: '600000.SH:2026-01-06', tradeDate: date('2026-01-05'), pctChg: 2 },
      { eventKey: '600000.SH:2026-01-06', tradeDate: date('2026-01-06'), pctChg: 3 },
      { eventKey: '600000.SH:2026-01-06', tradeDate: date('2026-01-07'), pctChg: 0 },
    ]),
    findStockNames: jest.fn(async () => [{ tsCode: '600000.SH', name: '浦发银行' }]),
  }

  beforeEach(() => jest.clearAllMocks())

  it('[手算验证] AR=[1,2,-1]，最终 CAR=2，不把缺失收益填零', async () => {
    const facade = new EventStudyToolFacade(eventStudyService as never, repository as never)
    const result = await facade.run({
      eventType: EventType.REPURCHASE,
      tsCode: '600000.SH',
      startDate: '2026-01-01',
      endDate: '2026-01-10',
      preTradeDays: 1,
      postTradeDays: 1,
      minSamples: 1,
      maxSamples: 10,
      includeTopSamples: true,
    })

    expect(result.data.aarSeries.map((point) => point.value)).toEqual([1, 2, -1])
    expect(result.data.caarSeries.map((point) => point.value)).toEqual([1, 3, 2])
    expect(result.data.finalCar).toMatchObject({ mean: 2, median: 2, positiveRate: 1 })
    expect(result.data.topPositiveSamples?.[0]).toMatchObject({ tsCode: '600000.SH', finalCar: 2 })
  })

  it('[DATA] 股票收益窗口缺点时排除样本并返回 DATA_NOT_READY', async () => {
    repository.findWindowReturns.mockResolvedValueOnce([
      { eventKey: '600000.SH:2026-01-06', tradeDate: date('2026-01-05'), pctChg: 2 },
      { eventKey: '600000.SH:2026-01-06', tradeDate: date('2026-01-06'), pctChg: 3 },
    ])
    const facade = new EventStudyToolFacade(eventStudyService as never, repository as never)

    await expect(
      facade.run({
        eventType: EventType.REPURCHASE,
        tsCode: '600000.SH',
        startDate: '2026-01-01',
        endDate: '2026-01-10',
        preTradeDays: 1,
        postTradeDays: 1,
        minSamples: 1,
        maxSamples: 10,
      }),
    ).rejects.toMatchObject({ code: 'DATA_NOT_READY', message: expect.stringContaining('STOCK_RETURN_MISSING') })
  })

  it('[VALIDATION] 市场样本 minSamples 不允许小于 10', async () => {
    const facade = new EventStudyToolFacade(eventStudyService as never, repository as never)
    await expect(facade.run({ eventType: EventType.FORECAST, minSamples: 1 })).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    })
  })
})
