import { UserRole, UserStatus } from '@prisma/client'
import type { ToolAccessContext } from '../../tool-access-context'
import { ToolSchemaValidator } from '../../tool-schema-validator'
import { createTechnicalAnalysisToolDefinitions } from '../technical-analysis-tools'

const context: ToolAccessContext = {
  userId: 1,
  role: UserRole.USER,
  userStatus: UserStatus.ACTIVE,
  scopeId: 'scope',
  conversationId: 'conversation',
  runId: 'run',
  stepId: 'step',
  traceId: 'trace',
  workflowAllowedTools: ['get_stock_technical_indicators', 'get_stock_technical_signals'],
  allowedScopes: ['PUBLIC_MARKET_DATA'],
  callsUsed: 0,
  deadlineAt: new Date(Date.now() + 60_000),
  toolCallId: 'call',
  attempt: 1,
  abortSignal: new AbortController().signal,
}

function harness() {
  const stockTechnical = {
    getIndicators: jest.fn().mockResolvedValue({
      data: {
        tsCode: '600089.SH',
        requestedAsOfDate: null,
        dataThrough: '2026-08-04',
        coverageStart: '2000-01-04',
        source: 'TUSHARE_STK_FACTOR',
        adjustment: 'FORWARD_SNAPSHOT',
        requestedIndicators: ['MACD'],
        units: {
          close: 'CNY_PER_SHARE',
          macd: 'PRICE',
          kdj: 'PERCENT',
          rsi: 'PERCENT',
          boll: 'CNY_PER_SHARE',
        },
        items: [
          {
            tradeDate: '2026-08-04',
            close: 21.5,
            macd: { dif: 0.2, dea: 0.1, histogram: 0.1 },
            kdj: null,
            rsi: null,
            boll: null,
          },
        ],
      },
      warnings: [],
    }),
  }
  const technicalSignal = {
    getSignals: jest.fn().mockResolvedValue({
      data: {
        meta: {
          tsCode: '600089.SH',
          name: '特变电工',
          requestedAsOfDate: null,
          dataThrough: '2026-08-04',
          calculationHistoryStart: '2025-01-01',
          source: 'LOCAL_QFQ_OHLCV',
          adjustment: 'ADJ_FACTOR_RATIO',
          algorithmVersion: 'technical-indicator.v2',
          catalogVersion: 'technical-signal-catalog.v1:test',
        },
        current: { status: 'OK', data: [], error: null },
        occurrences: { status: 'NOT_REQUESTED', data: null, error: null },
        statistics: { status: 'NOT_REQUESTED', data: null, error: null },
        buySignalTriggered: false,
        sellSignalTriggered: false,
      },
      warnings: [],
      definitionHashes: [],
    }),
  }
  const definitions = createTechnicalAnalysisToolDefinitions({
    stockTechnical: stockTechnical as never,
    technicalSignal: technicalSignal as never,
  })
  return { definitions, stockTechnical, technicalSignal }
}

describe('第一批技术分析 Tool adapters', () => {
  it('[CONTRACT] 两个 Definition schema 可编译，执行结果通过输出 schema', async () => {
    const { definitions } = harness()
    const validator = new ToolSchemaValidator()

    for (const definition of definitions) validator.assertDefinitionSchemas(definition)
    const indicator = definitions.find((item) => item.key === 'get_stock_technical_indicators')!
    const indicatorResult = await indicator.execute({ tsCode: '600089.SH', indicators: ['MACD'] }, context)
    expect(validator.validateOutput(indicator, indicatorResult.data)).toEqual({ valid: true, issues: [] })
    expect(indicatorResult).toMatchObject({
      toolVersion: 1,
      provenance: { sourceModels: ['StkFactor'], adjustment: 'FORWARD' },
    })

    const signal = definitions.find((item) => item.key === 'get_stock_technical_signals')!
    const signalResult = await signal.execute({ tsCode: '600089.SH' }, { ...context, toolCallId: 'call_signal' })
    expect(validator.validateOutput(signal, signalResult.data)).toEqual({ valid: true, issues: [] })
    expect(signalResult.provenance.sourceType).toBe('PROGRAM_CALCULATION')
  })

  it('[SEC] CCI/ATR/VR 与未知信号 key 在 Facade 前由严格 schema 拒绝', () => {
    const { definitions, stockTechnical, technicalSignal } = harness()
    const validator = new ToolSchemaValidator()
    const indicator = definitions.find((item) => item.key === 'get_stock_technical_indicators')!
    const signal = definitions.find((item) => item.key === 'get_stock_technical_signals')!

    for (const unsupported of ['CCI', 'ATR', 'VR']) {
      expect(validator.validateInput(indicator, { tsCode: '600089.SH', indicators: [unsupported] }).valid).toBe(false)
    }
    expect(validator.validateInput(signal, { tsCode: '600089.SH', signalKeys: ['made-up.signal'] }).valid).toBe(false)
    expect(stockTechnical.getIndicators).not.toHaveBeenCalled()
    expect(technicalSignal.getSignals).not.toHaveBeenCalled()
  })
})
