import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { UserRole, UserStatus } from '@prisma/client'
import type { ToolAccessContext } from '../../tool-access-context'
import { ToolSchemaValidator } from '../../tool-schema-validator'
import { createPrivateAnalyticsToolDefinitions } from '../private-analytics-tools'

const notRequested = { status: 'NOT_REQUESTED', data: null, error: null }

function harness() {
  const backtest = {
    analyze: jest.fn(async () => ({
      data: {
        ownerScoped: true,
        backtestRunId: 'run-1',
        runStatus: 'COMPLETED',
        reproducibility: null,
        monteCarlo: { status: 'OK', data: { seed: 42, paths: [] }, error: null },
        brinsonAttribution: notRequested,
        costSensitivity: notRequested,
        paramSweepResult: notRequested,
        walkForwardResult: notRequested,
        comparisonResult: notRequested,
        partial: false,
      },
      asOf: '2026-08-04',
      sourceModels: ['BacktestRun'],
      warnings: [],
      rowCount: 1,
    })),
  }
  const portfolio = {
    analyze: jest.fn(async () => ({
      data: {
        meta: {
          portfolioId: 'p-1',
          name: '核心组合',
          coverageStart: '2026-08-01',
          requestedAsOfDate: null,
          dataThrough: '2026-08-04',
          benchmarkCode: '000300.SH',
          algorithmVersion: 'portfolio-nav.v1',
          ownerScoped: true,
        },
        overview: { status: 'OK', data: { totalAssets: 10_000, topPositions: [] }, error: null },
        performance: notRequested,
        pnl: notRequested,
        drift: notRequested,
        trades: notRequested,
      },
      asOf: '2026-08-04',
      sourceModels: ['PortfolioDailySnapshot'],
      warnings: [],
      rowCount: 1,
    })),
  }
  return { definitions: createPrivateAnalyticsToolDefinitions({ backtest, portfolio } as never), backtest, portfolio }
}

const context: ToolAccessContext = {
  userId: 7,
  role: UserRole.USER,
  userStatus: UserStatus.ACTIVE,
  scopeId: 'scope',
  conversationId: 'conversation',
  runId: 'agent-run',
  stepId: 'step',
  traceId: 'trace',
  workflowAllowedTools: ['get_backtest_analytics', 'get_portfolio_analytics'],
  allowedScopes: ['USER_PRIVATE'],
  callsUsed: 0,
  deadlineAt: new Date(Date.now() + 60_000),
  toolCallId: 'call',
  attempt: 1,
  abortSignal: new AbortController().signal,
}

describe('第五批高级分析与私有数据 Tool adapters', () => {
  it('[REGISTRY] canonical key、严格 schema、owner context 和私有只读策略', async () => {
    const { definitions, backtest, portfolio } = harness()
    const validator = new ToolSchemaValidator()
    expect(definitions.map((definition) => definition.key)).toEqual([
      'get_backtest_analytics',
      'get_portfolio_analytics',
    ])

    for (const definition of definitions) {
      validator.assertDefinitionSchemas(definition)
      expect(definition.policy).toMatchObject({
        sideEffect: 'READ',
        idempotent: true,
        requiresConfirmation: false,
        allowedDataScopes: ['USER_PRIVATE'],
      })
    }
    const backtestDefinition = definitions[0]
    const portfolioDefinition = definitions[1]
    expect(
      validator.validateInput(backtestDefinition, {
        analyses: ['MONTE_CARLO'],
        backtestRunId: 'run-1',
        monteCarlo: { simulations: 100, seed: 42 },
        userId: 99,
      }).valid,
    ).toBe(false)
    expect(validator.validateInput(portfolioDefinition, { portfolioId: 'p-1', ownerId: 99 }).valid).toBe(false)

    const backtestResult = await backtestDefinition.execute(
      { analyses: ['MONTE_CARLO'], backtestRunId: 'run-1', monteCarlo: { simulations: 100, seed: 42 } },
      { ...context, toolCallId: 'backtest-call' },
    )
    const portfolioResult = await portfolioDefinition.execute(
      { portfolioId: 'p-1', sections: ['OVERVIEW'] },
      { ...context, toolCallId: 'portfolio-call' },
    )
    expect(backtest.analyze).toHaveBeenCalledWith(7, expect.not.objectContaining({ userId: expect.anything() }))
    expect(portfolio.analyze).toHaveBeenCalledWith(7, expect.not.objectContaining({ userId: expect.anything() }))
    expect(validator.validateOutput(backtestDefinition, backtestResult.data)).toEqual({ valid: true, issues: [] })
    expect(validator.validateOutput(portfolioDefinition, portfolioResult.data)).toEqual({ valid: true, issues: [] })
    expect(backtestResult.provenance.dataVersion).toBe('private-backtest-analytics-v1')
    expect(portfolioResult.provenance.algorithmVersion).toBe('portfolio-nav.v1')
  })

  it('[ARCH] Tool adapter 不注入 Queue、写 Service 或 Tushare 客户端', () => {
    const source = readFileSync(resolve('src/apps/agent/tools/adapters/private-analytics-tools.ts'), 'utf8')
    expect(source).not.toMatch(/Queue|enqueue|createRun|Tushare|ApiService/)
  })
})
