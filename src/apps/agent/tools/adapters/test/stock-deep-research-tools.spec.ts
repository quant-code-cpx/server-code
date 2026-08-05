import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { UserRole, UserStatus } from '@prisma/client'
import { AGENT_TOOL_KEYS } from '../../../contracts'
import type { ToolAccessContext } from '../../tool-access-context'
import { ToolSchemaValidator } from '../../tool-schema-validator'
import { createStockDeepResearchToolDefinitions } from '../stock-deep-research-tools'

describe('第二批个股深度研究 Tool adapters', () => {
  const keys = [
    'get_stock_chip_profile',
    'get_stock_margin_history',
    'get_stock_relative_strength',
    'get_stock_events',
    'get_stock_shareholder_profile',
  ] as const
  const meta = {
    tsCode: '600000.SH',
    requestedAsOfDate: null,
    dataThrough: '2026-08-04',
    coverageStart: '2026-01-01',
    timezone: 'Asia/Shanghai',
  }
  const section = { status: 'NOT_REQUESTED', data: null, error: null }
  const facades = {
    chip: {
      getProfile: jest
        .fn()
        .mockResolvedValue({ data: { meta, summary: section, distribution: section, history: section }, warnings: [] }),
    },
    margin: {
      getHistory: jest.fn().mockResolvedValue({
        data: {
          meta: {
            ...meta,
            marketPriceDataThrough: '2026-08-04',
            lagVsStockTradingDays: 0,
            algorithmVersion: 'margin-trend.v1',
          },
          summary: section,
          history: section,
          units: { balances: 'CNY', volumes: 'SHARE', close: 'CNY_PER_SHARE', changes: 'PERCENT' },
        },
        warnings: [],
      }),
    },
    relativeStrength: {
      getRelativeStrength: jest.fn().mockResolvedValue({
        data: {
          meta: {
            ...meta,
            benchmarkCode: '000300.SH',
            benchmarkName: '沪深300',
            commonTradeDays: 120,
            adjustment: 'QFQ_RATIO',
            algorithmVersion: 'relative-strength.v1',
          },
          summary: section,
          series: section,
        },
        warnings: [],
      }),
    },
    events: {
      getEvents: jest.fn().mockResolvedValue({
        data: { meta, sections: ['DIVIDEND'], total: 0, page: 1, pageSize: 50, items: [] },
        warnings: [],
        truncated: false,
      }),
    },
    shareholders: {
      getProfile: jest.fn().mockResolvedValue({
        data: { meta, holderCount: section, top10: section, top10Float: section, trades: section, pledge: section },
        warnings: [],
      }),
    },
  }
  const definitions = createStockDeepResearchToolDefinitions(facades as never)
  const context: ToolAccessContext = {
    userId: 1,
    role: UserRole.USER,
    userStatus: UserStatus.ACTIVE,
    scopeId: 'scope',
    conversationId: 'conversation',
    runId: 'run',
    stepId: 'step',
    traceId: 'trace',
    workflowAllowedTools: [...keys],
    allowedScopes: ['PUBLIC_MARKET_DATA'],
    callsUsed: 0,
    deadlineAt: new Date(Date.now() + 60_000),
    toolCallId: 'call',
    attempt: 1,
    abortSignal: new AbortController().signal,
  }

  it('[REGISTRY] 注册五个 canonical key、严格 schema 和只读边界', async () => {
    expect(AGENT_TOOL_KEYS).toEqual(expect.arrayContaining(keys))
    expect(definitions.map((definition) => definition.key)).toEqual(keys)
    const validator = new ToolSchemaValidator()
    for (const definition of definitions) {
      validator.assertDefinitionSchemas(definition)
      expect(validator.validateInput(definition, { tsCode: '600000.SH', unknown: true }).valid).toBe(false)
      expect(definition.policy).toMatchObject({ sideEffect: 'READ', idempotent: true, requiresConfirmation: false })
      const result = await definition.execute({ tsCode: '600000.SH' }, { ...context, toolCallId: definition.key })
      expect(validator.validateOutput(definition, result.data)).toEqual({ valid: true, issues: [] })
      expect(result.provenance.sourceServices.length).toBeGreaterThan(0)
    }
  })

  it('[BOUNDARY] 新模块不得依赖 Tushare Client、API 或 Sync Service', () => {
    const files = [
      'chip/stock-chip.repository.ts',
      'chip/stock-chip-tool.facade.ts',
      'margin/stock-margin.repository.ts',
      'margin/stock-margin-tool.facade.ts',
      'relative-strength/relative-strength.repository.ts',
      'relative-strength/relative-strength-tool.facade.ts',
      'events/stock-event.repository.ts',
      'events/stock-event-tool.facade.ts',
      'shareholders/stock-shareholder.repository.ts',
      'shareholders/stock-shareholder-tool.facade.ts',
    ]
    const source = files.map((file) => readFileSync(resolve('src/apps/stock-deep-research', file), 'utf8')).join('\n')
    expect(source).not.toMatch(/TushareClient|ApiService|SyncService|src\/tushare/)
  })
})
