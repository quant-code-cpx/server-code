import { TechnicalSignalToolFacade } from '../technical-signal-tool.facade'

function evaluation(overrides: Record<string, unknown> = {}) {
  return {
    tsCode: '600089.SH',
    name: '特变电工',
    dataThrough: '20260804',
    catalogVersion: 'technical-signal-catalog.v1:test',
    algorithmVersion: 'technical-indicator.v2',
    historyStart: '20250101',
    historyTruncated: true,
    current: [
      {
        signalKey: 'macd.golden-cross',
        displayName: 'MACD 金叉',
        direction: 'BULLISH',
        semanticsVersion: 'macd.v1',
        definitionHash: 'hash',
        evaluable: true,
        notEvaluableReason: null,
        triggeredOnDataThrough: true,
        latestOccurrenceDate: '20260804',
        evidence: { previous: { macdDif: -1 }, current: { macdDif: 1 }, parameters: {} },
      },
    ],
    occurrences: [
      {
        signalKey: 'macd.golden-cross',
        semanticsVersion: 'macd.v1',
        definitionHash: 'hash',
        source: 'LOCAL_QFQ_OHLCV',
        indicatorAlgorithmVersion: 'technical-indicator.v2',
        signalDate: '20260804',
        direction: 'BULLISH',
        evidence: { previous: { macdDif: -1 }, current: { macdDif: 1 }, parameters: {} },
      },
    ],
    timeline: {},
    ...overrides,
  }
}

function harness() {
  const repository = { resolveReadyAsOf: jest.fn().mockResolvedValue('20260804') }
  const evaluator = { evaluate: jest.fn().mockResolvedValue(evaluation()) }
  const statistics = { query: jest.fn().mockResolvedValue({ groups: [{ signalKey: 'macd.golden-cross' }] }) }
  const facade = new TechnicalSignalToolFacade(repository as never, evaluator as never, statistics as never)
  return { facade, repository, evaluator, statistics }
}

describe('TechnicalSignalToolFacade', () => {
  it('[BIZ] 周末请求回退到 READY 日，返回当日 BULLISH 触发和可审计证据', async () => {
    const { facade } = harness()

    const result = await facade.getSignals({
      tsCode: '600089.SH',
      asOfDate: '2026-08-08',
      sections: ['CURRENT', 'OCCURRENCES'],
      signalKeys: ['macd.golden-cross'],
    })

    expect(result.data.meta).toMatchObject({ requestedAsOfDate: '2026-08-08', dataThrough: '2026-08-04' })
    expect(result.data.meta.calculationHistoryStart).toBe('2025-01-01')
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'BOUNDED_CALCULATION_WINDOW' }))
    expect(result.data.current).toMatchObject({
      status: 'OK',
      data: [expect.objectContaining({ triggeredOnDataThrough: true, latestOccurrenceDate: '2026-08-04' })],
    })
    expect(result.data.occurrences).toMatchObject({ status: 'OK', data: [{ signalDate: '2026-08-04' }] })
    expect(result.data.buySignalTriggered).toBe(true)
    expect(result.data.sellSignalTriggered).toBe(false)
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'LATEST_READY_TRADE_DATE_USED' }))
  })

  it('[BIZ] STATISTICS 失败采用 fail-soft，不抹掉成功的 CURRENT', async () => {
    const { facade, statistics } = harness()
    statistics.query.mockRejectedValue(new Error('benchmark unavailable'))

    const result = await facade.getSignals({
      tsCode: '600089.SH',
      sections: ['CURRENT', 'STATISTICS'],
      signalKeys: ['macd.golden-cross'],
      includeBenchmark: true,
    })

    expect(result.data.current.status).toBe('OK')
    expect(result.data.statistics).toEqual({
      status: 'ERROR',
      data: null,
      error: { code: 'UPSTREAM_FAILED', message: '技术信号统计分区暂时不可用' },
    })
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'PARTIAL_SECTION_FAILURE' }))
  })

  it('[ERR] 全部信号不可计算时返回可重试 DATA_NOT_READY', async () => {
    const { facade, evaluator } = harness()
    evaluator.evaluate.mockResolvedValue(
      evaluation({
        current: [
          {
            ...evaluation().current[0],
            evaluable: false,
            notEvaluableReason: 'INSUFFICIENT_HISTORY_OR_FIELDS',
            triggeredOnDataThrough: false,
          },
        ],
      }),
    )

    await expect(facade.getSignals({ tsCode: '600089.SH', signalKeys: ['macd.golden-cross'] })).rejects.toMatchObject({
      code: 'DATA_NOT_READY',
      retryable: true,
    })
  })

  it('[ERR] 未知信号 key 在读取 Repository 前被拒绝', async () => {
    const { facade, repository } = harness()

    await expect(facade.getSignals({ tsCode: '600089.SH', signalKeys: ['made-up.signal'] })).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    })
    expect(repository.resolveReadyAsOf).not.toHaveBeenCalled()
  })

  it('[ERR] 日历中不存在的日期在读取 Repository 前被拒绝', async () => {
    const { facade, repository } = harness()

    await expect(
      facade.getSignals({ tsCode: '600089.SH', asOfDate: '2026-02-30', signalKeys: ['macd.golden-cross'] }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    expect(repository.resolveReadyAsOf).not.toHaveBeenCalled()
  })
})
