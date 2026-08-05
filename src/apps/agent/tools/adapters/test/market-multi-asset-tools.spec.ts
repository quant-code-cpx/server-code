import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { UserRole, UserStatus } from '@prisma/client'
import { AGENT_TOOL_KEYS } from '../../../contracts'
import type { ToolAccessContext } from '../../tool-access-context'
import { ToolSchemaValidator } from '../../tool-schema-validator'
import { createMarketMultiAssetToolDefinitions } from '../market-multi-asset-tools'

describe('第三批市场与多资产 Tool adapters', () => {
  const keys = [
    'get_index_market_data',
    'get_fund_research',
    'get_industry_rotation',
    'get_factor_analysis',
    'get_macro_snapshot',
  ] as const
  const section = { status: 'NOT_REQUESTED', data: null, error: null }
  const facades = {
    index: {
      getMarketData: jest.fn(async () => ({
        data: {
          meta: {
            indexCode: '000300.SH',
            name: '沪深300',
            requestedAsOfDate: null,
            dataThroughBySection: { QUOTE: '2026-08-04' },
            coverageStartBySection: { QUOTE: '2021-01-01' },
            currency: 'CNY',
            adjustment: 'NONE',
            frequency: 'D',
            algorithmVersion: null,
          },
          basic: section,
          quote: section,
          history: section,
          valuation: section,
          constituents: section,
          units: {},
        },
        warnings: [],
      })),
    },
    fund: {
      getResearch: jest.fn(async () => ({
        data: {
          meta: {
            fundCode: '510300.SH',
            name: '沪深300ETF',
            requestedAsOfDate: null,
            dataThroughBySection: { NAV: '2026-08-04' },
            coverageStartBySection: { NAV: '2020-01-01' },
            seriesStatsBySection: { NAV: null },
          },
          basic: section,
          nav: section,
          price: section,
          share: section,
          holdings: section,
          etfFlow: section,
          units: {},
        },
        warnings: [],
      })),
    },
    industry: {
      getRotation: jest.fn(async () => ({
        data: {
          meta: {
            classification: 'THS',
            requestedAsOfDate: null,
            dataThroughBySection: { RETURN: '2026-08-04' },
            algorithmVersion: 'industry-rotation.v1',
            primaryReturnPeriod: 20,
            rankingPopulation: 777,
          },
          returns: section,
          momentum: section,
          flow: section,
          valuation: section,
          heatmap: section,
          detail: section,
        },
        warnings: [],
      })),
    },
    factor: {
      analyze: jest.fn(async () => ({
        data: {
          analysis: 'VALUES',
          factorDefinitions: [],
          universe: 'ALL',
          requestedAsOfDate: null,
          dataThrough: '2026-07-24',
          sampleCount: 0,
          result: {},
          algorithmVersion: 'factor-values.v1',
        },
        warnings: [],
      })),
    },
    macro: {
      getSnapshot: jest.fn(async () => ({
        data: {
          requestedSeries: ['CPI'],
          dataThroughBySeries: { CPI: '202607' },
          coverageStartBySeries: { CPI: '198601' },
          latest: section,
          history: section,
          unitsByField: {},
        },
        warnings: [],
      })),
    },
  }
  const definitions = createMarketMultiAssetToolDefinitions(facades as never)
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
    get_index_market_data: { indexCode: '000300.SH' },
    get_fund_research: { fundCode: '510300.SH' },
    get_industry_rotation: {},
    get_factor_analysis: { analysis: 'VALUES', factorNames: ['pe_ttm'] },
    get_macro_snapshot: {},
  }

  it('[REGISTRY] 注册五个 canonical key、严格 schema 和只读边界', async () => {
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

  it('[BOUNDARY] 第三批业务模块无 Tushare Client/API/Sync 和自定义因子写服务依赖', () => {
    const files = [
      'src/apps/index/index-research.repository.ts',
      'src/apps/index/index-research-tool.facade.ts',
      'src/apps/fund/fund-research.repository.ts',
      'src/apps/fund/fund-research-tool.facade.ts',
      'src/apps/industry-rotation/industry-rotation-research.repository.ts',
      'src/apps/industry-rotation/industry-rotation-tool.facade.ts',
      'src/apps/factor/factor-analysis-tool.facade.ts',
      'src/apps/macro-research/macro-research.repository.ts',
      'src/apps/macro-research/macro-research-tool.facade.ts',
    ]
    const source = files.map((file) => readFileSync(resolve(file), 'utf8')).join('\n')
    expect(source).not.toMatch(
      /TushareClient|ApiService|SyncService|FactorCustomService|FactorExpressionService|FactorPrecomputeService/,
    )
  })
})
