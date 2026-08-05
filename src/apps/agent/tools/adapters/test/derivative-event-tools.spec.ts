import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { UserRole, UserStatus } from '@prisma/client'
import { AGENT_TOOL_KEYS } from '../../../contracts'
import type { ToolAccessContext } from '../../tool-access-context'
import { ToolSchemaValidator } from '../../tool-schema-validator'
import { createDerivativeEventToolDefinitions } from '../derivative-event-tools'

describe('第四批衍生品与事件研究 Tool adapters', () => {
  const keys = ['get_option_market', 'get_convertible_bond_market', 'run_event_study'] as const
  const dependencies = {
    option: {
      getMarket: jest.fn(async () => ({
        data: { operation: 'SEARCH', asOfDate: '2026-08-04', total: 0, page: 1, pageSize: 50, items: [] },
        warnings: [],
        truncated: false,
      })),
    },
    convertibleBond: {
      getMarket: jest.fn(async () => ({
        data: { operation: 'BASIC', bond: { bondCode: '110059.SH' } },
        warnings: [],
        truncated: false,
      })),
    },
    eventStudy: {
      run: jest.fn(async () => ({
        data: {
          eventType: 'REPURCHASE',
          eventLabel: '股票回购',
          requestedRange: { startDate: '2025-08-04', endDate: '2026-08-04' },
          actualEventRange: { startDate: null, endDate: null },
          benchmarkCode: '000300.SH',
          preTradeDays: 5,
          postTradeDays: 20,
          sampleCount: 0,
          excludedSampleCount: 0,
          exclusionReasons: {},
          aarSeries: [],
          caarSeries: [],
          finalCar: { mean: null, median: null, positiveRate: null, tStatistic: null, pValue: null },
          topPositiveSamples: null,
          topNegativeSamples: null,
          algorithmVersion: 'event-study.market-adjusted.v1',
          eventDefinitionHash: 'a'.repeat(64),
        },
        warnings: [],
        truncated: false,
      })),
    },
  }
  const definitions = createDerivativeEventToolDefinitions(dependencies as never)
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
  const validInputs = {
    get_option_market: { operation: 'SEARCH' },
    get_convertible_bond_market: { operation: 'BASIC', bondCode: '110059.SH' },
    run_event_study: { eventType: 'REPURCHASE' },
  }

  it('[REGISTRY] 注册三个 canonical key、严格 schema 和只读策略', async () => {
    expect(AGENT_TOOL_KEYS).toEqual(expect.arrayContaining(keys))
    expect(definitions.map((definition) => definition.key)).toEqual(keys)
    const validator = new ToolSchemaValidator()
    for (const definition of definitions) {
      validator.assertDefinitionSchemas(definition)
      expect(validator.validateInput(definition, { ...validInputs[definition.key], unknown: true }).valid).toBe(false)
      expect(definition.policy).toMatchObject({ sideEffect: 'READ', idempotent: true, requiresConfirmation: false })
      const result = await definition.execute(validInputs[definition.key], { ...context, toolCallId: definition.key })
      expect(validator.validateOutput(definition, result.data)).toEqual({ valid: true, issues: [] })
      expect(result.provenance.sourceServices.length).toBeGreaterThan(0)
    }
  })

  it('[BOUNDARY] 领域模块只读本地库，不直接依赖 Tushare 请求或同步服务', () => {
    const files = [
      'src/apps/option-market/option-market.repository.ts',
      'src/apps/option-market/option-market-tool.facade.ts',
      'src/apps/convertible-bond/convertible-bond.repository.ts',
      'src/apps/convertible-bond/convertible-bond-tool.facade.ts',
      'src/apps/event-study/event-study-tool.repository.ts',
      'src/apps/event-study/event-study-tool.facade.ts',
    ]
    const source = files.map((file) => readFileSync(resolve(file), 'utf8')).join('\n')
    expect(source).not.toMatch(/TushareClient|ApiService|SyncService|fetch\(|axios|got\(/)
  })
})
