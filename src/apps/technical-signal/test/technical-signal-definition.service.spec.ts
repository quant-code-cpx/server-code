import { BadRequestException } from '@nestjs/common'
import { TechnicalSignalDefinitionService } from '../services/technical-signal-definition.service'

describe('TechnicalSignalDefinitionService', () => {
  const service = new TechnicalSignalDefinitionService()

  it('[BIZ] returns 14 stable v1 definitions with public audit metadata', () => {
    const response = service.list({})

    expect(response.definitions).toHaveLength(14)
    expect(new Set(response.definitions.map((definition) => definition.signalKey)).size).toBe(14)
    expect(response.definitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          signalKey: 'macd.golden-cross',
          semanticsVersion: 'macd.v1',
          displayName: 'MACD 金叉',
          direction: 'BULLISH',
          source: 'LOCAL_QFQ_OHLCV',
          parameters: { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 },
          stable: true,
          deprecatedAt: null,
        }),
        expect.objectContaining({
          signalKey: 'volume-ratio20.expand-enter',
          direction: 'CONTEXTUAL',
          parameters: { period: 20, threshold: 1.5 },
        }),
      ]),
    )
    expect(response.definitions.every((definition) => /^[a-f0-9]{64}$/.test(definition.definitionHash))).toBe(true)
  })

  it('[BIZ] filters requested standard definitions without exposing non-requested definitions', () => {
    const response = service.list({ signalKeys: ['macd.golden-cross', 'rsi6.oversold-enter'] })

    expect(response.definitions.map((definition) => definition.signalKey)).toEqual([
      'macd.golden-cross',
      'rsi6.oversold-enter',
    ])
    expect(response.definitions.map((definition) => definition.semanticsVersion)).toEqual(['macd.v1', 'rsi6.v1'])
  })

  it.each([
    {
      name: 'duplicate list key',
      execute: () => service.list({ signalKeys: ['macd.golden-cross', 'macd.golden-cross'] }),
    },
    {
      name: 'unknown list key',
      execute: () => service.list({ signalKeys: ['unknown.signal'] }),
    },
    {
      name: 'empty selector list',
      execute: () => service.resolveSelectors([]),
    },
    {
      name: 'duplicate selector',
      execute: () =>
        service.resolveSelectors([
          { signalKey: 'macd.golden-cross' },
          { signalKey: 'macd.golden-cross', semanticsVersion: 'macd.v1' },
        ]),
    },
    {
      name: 'unknown semantic version',
      execute: () => service.resolveOne('macd.golden-cross', 'macd.v999'),
    },
  ])('[ERR] rejects $name', ({ execute }) => {
    expect(execute).toThrow(BadRequestException)
  })

  it('[BIZ] resolves omitted selectors to complete catalog and explicit selector to current stable version', () => {
    const allDefinitions = service.resolveSelectors()
    const [definition] = service.resolveSelectors([{ signalKey: 'sar.bearish-state-enter' }])

    expect(allDefinitions).toHaveLength(14)
    expect(definition).toMatchObject({
      signalKey: 'sar.bearish-state-enter',
      semanticsVersion: 'sar.v1',
      direction: 'BEARISH',
    })
  })
})
