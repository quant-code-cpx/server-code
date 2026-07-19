import { UserRole, UserStatus } from '@prisma/client'
import { AGENT_TOOL_KEYS } from 'src/apps/agent/contracts'
import type { ToolAccessContext } from '../../tool-access-context'
import { ToolAdapterError } from '../../contracts/tool-error'
import { ToolRegistryService } from '../../tool-registry.service'
import { ToolSchemaValidator } from '../../tool-schema-validator'
import { createStockMarketToolDefinitions } from '../stock-market-tools'

const enabledTools = [
  'resolve_security',
  'get_stock_price_history',
  'get_stock_overview',
  'get_market_snapshot',
  'get_sector_membership',
  'get_user_watchlist',
] as const

const config = {
  enabledTools: [...enabledTools],
  maxCallsPerRun: 20,
  defaultTimeoutMs: 10_000,
  maxResultBytes: 256_000,
  maxConcurrentPerRun: 3,
  priceMaxBars: 5_000,
  marketCacheTtlSeconds: 300,
}

function context(overrides: Partial<ToolAccessContext> = {}): ToolAccessContext {
  return {
    userId: 7,
    role: UserRole.USER,
    userStatus: UserStatus.ACTIVE,
    scopeId: 'scope_1',
    conversationId: 'conversation_1',
    runId: 'run_1',
    stepId: 'step_1',
    traceId: 'trace_1',
    workflowAllowedTools: [...enabledTools],
    allowedScopes: ['PUBLIC_MARKET_DATA', 'USER_PRIVATE'],
    callsUsed: 0,
    deadlineAt: new Date(Date.now() + 60_000),
    toolCallId: 'tool_call_1',
    attempt: 1,
    abortSignal: new AbortController().signal,
    ...overrides,
  }
}

function harness() {
  const stock = {
    resolveSecurity: jest.fn().mockResolvedValue({
      query: '浦发银行',
      candidates: [
        {
          tsCode: '600000.SH',
          name: '浦发银行',
          securityType: 'STOCK',
          exchange: 'SSE',
          listStatus: 'L',
          listDate: '1999-11-10',
          delistDate: null,
          matchScore: 1,
        },
      ],
      ambiguous: false,
      sourceModels: ['StockBasic'],
    }),
    getPriceHistory: jest.fn().mockResolvedValue({
      data: {
        tsCode: '600000.SH',
        frequency: 'DAILY',
        adjustment: 'FORWARD',
        startDate: '2024-01-01',
        endDate: '2024-01-31',
        fields: ['close'],
        units: {
          price: 'CNY',
          pctChange: 'PERCENT',
          volume: 'LOT',
          amount: 'CNY_THOUSAND',
          turnoverRate: 'PERCENT',
          peTtm: 'MULTIPLE',
        },
        bars: [{ tradeDate: '2024-01-31', close: 10 }],
      },
      truncated: false,
      asOf: '2024-01-31',
      adjustmentFactorAsOf: '2024-01-31',
      sourceModels: ['Daily', 'AdjFactor', 'DailyBasic'],
    }),
    getOverview: jest.fn().mockResolvedValue({
      data: {
        requestedAsOfDate: null,
        sections: ['BASIC'],
        items: [{ tsCode: '600000.SH', found: false }],
      },
      asOf: null,
      sourceModels: ['StockBasic'],
    }),
  }
  const market = {
    snapshot: jest.fn().mockResolvedValue({
      data: {
        requestedTradeDate: null,
        sectorType: 'INDUSTRY',
        topN: 10,
        sections: [
          {
            section: 'INDEX_QUOTES',
            status: 'MISSING',
            asOf: null,
            facts: [],
            rows: [],
            warning: '该市场分区在请求时点无数据',
          },
        ],
      },
      asOf: null,
      sourceModels: ['IndexDaily'],
    }),
  }
  const sector = {
    membership: jest.fn().mockResolvedValue({
      data: {
        mode: 'SECTORS_FOR_SECURITY',
        tsCode: '600000.SH',
        sectorCode: null,
        sectorType: 'INDUSTRY',
        effectiveDate: null,
        items: [],
      },
      truncated: false,
      asOf: null,
      warningCodes: [],
      sourceModels: ['IndexMemberAll'],
    }),
  }
  const watchlist = {
    read: jest.fn().mockResolvedValue({
      data: {
        requestedWatchlistId: null,
        includeLatestQuote: false,
        groups: [],
      },
      truncated: false,
      asOf: null,
      sourceModels: ['Watchlist', 'WatchlistStock'],
    }),
  }
  const definitions = createStockMarketToolDefinitions({
    stock: stock as never,
    market: market as never,
    sector: sector as never,
    watchlist: watchlist as never,
    config: config as never,
  })
  return { definitions, stock, market, sector, watchlist }
}

describe('Batch 007 stock/market Tool adapters', () => {
  it('[SMT-E2E-001] 六 definitions schema 可编译、Registry 唯一注册且均为 READ/idempotent', () => {
    const { definitions } = harness()
    const validator = new ToolSchemaValidator()
    const registry = new ToolRegistryService(validator, config as never, definitions)
    registry.onModuleInit()

    expect(definitions.map((definition) => definition.key)).toEqual(enabledTools)
    expect(
      definitions.every((definition) => definition.policy.sideEffect === 'READ' && definition.policy.idempotent),
    ).toBe(true)
    expect(registry.freezeSnapshot().entries).toHaveLength(6)
    expect(Object.keys(registry.implementationStatus())).toEqual([...AGENT_TOOL_KEYS])
    for (const key of enabledTools) expect(registry.implementationStatus()[key]).toEqual([1])
  })

  it('[SMT-SEC-001] strict schema 拒绝伪造 userId/where/orderBy，Facade 零调用', () => {
    const { definitions, watchlist } = harness()
    const validator = new ToolSchemaValidator()
    const definition = definitions.find((item) => item.key === 'get_user_watchlist')!
    validator.assertDefinitionSchemas(definition)

    for (const input of [{ userId: 999 }, { where: { userId: 999 } }, { orderBy: 'id' }]) {
      expect(validator.validateInput(definition, input).valid).toBe(false)
    }
    expect(watchlist.read).not.toHaveBeenCalled()
  })

  it('[SMT-SEC-002/003] Watchlist userId 只取 context，不接受 ADMIN 角色绕过 owner', async () => {
    const { definitions, watchlist } = harness()
    const definition = definitions.find((item) => item.key === 'get_user_watchlist')!

    const result = await definition.execute(
      { watchlistId: 12, includeLatestQuote: false, limit: 100 },
      context({ role: UserRole.ADMIN, userId: 7 }),
    )

    expect(watchlist.read).toHaveBeenCalledWith(7, { watchlistId: 12, includeLatestQuote: false, limit: 100 })
    expect(result.provenance.inputHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('[SMT-ERR-001] 反向行情日期和非法 sector 参数组合在 Facade 前拒绝', async () => {
    const { definitions, stock, sector } = harness()
    const priceDefinition = definitions.find((item) => item.key === 'get_stock_price_history')!
    const sectorDefinition = definitions.find((item) => item.key === 'get_sector_membership')!

    await expect(
      priceDefinition.execute(
        {
          tsCode: '600000.SH',
          startDate: '2024-02-01',
          endDate: '2024-01-01',
          frequency: 'DAILY',
          adjustment: 'NONE',
        },
        context(),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    await expect(
      sectorDefinition.execute(
        { mode: 'SECTORS_FOR_SECURITY', tsCode: '600000.SH', sectorCode: '801780.SI' },
        context(),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    expect(stock.getPriceHistory).not.toHaveBeenCalled()
    expect(sector.membership).not.toHaveBeenCalled()
  })

  it('[SMT-DATA-003] 行情结果通过 output schema，复权和 inputHash 进入 provenance', async () => {
    const { definitions } = harness()
    const validator = new ToolSchemaValidator()
    const definition = definitions.find((item) => item.key === 'get_stock_price_history')!
    validator.assertDefinitionSchemas(definition)
    const input = {
      tsCode: '600000.SH',
      startDate: '2024-01-01',
      endDate: '2024-01-31',
      frequency: 'DAILY',
      adjustment: 'FORWARD',
      fields: ['close'],
      limit: 100,
    }

    const result = await definition.execute(input, context())

    expect(validator.validateOutput(definition, result.data)).toEqual({ valid: true, issues: [] })
    expect(result.provenance).toMatchObject({
      adjustment: 'FORWARD',
      currency: 'CNY',
      dataVersion: expect.stringContaining('market-price-percent-v1'),
      inputHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    })
  })

  it('[SMT-ERR-002] 未知依赖错误统一映射为可重试 UPSTREAM_FAILED，不泄露原错误', async () => {
    const { definitions, stock } = harness()
    stock.resolveSecurity.mockRejectedValueOnce(new Error('SELECT secret FROM private_table'))
    const definition = definitions.find((item) => item.key === 'resolve_security')!

    try {
      await definition.execute({ query: '浦发银行' }, context())
      throw new Error('expected rejection')
    } catch (error) {
      expect(error).toBeInstanceOf(ToolAdapterError)
      expect(error).toMatchObject({ code: 'UPSTREAM_FAILED', retryable: true })
      expect((error as Error).message).not.toContain('private_table')
    }
  })

  it('[SMT-ERR-003] Market 全分区失败时返回 UPSTREAM_FAILED，不输出伪成功 snapshot', async () => {
    const { definitions, market } = harness()
    market.snapshot.mockResolvedValueOnce({
      data: {
        requestedTradeDate: null,
        sectorType: 'INDUSTRY',
        topN: 10,
        sections: [
          {
            section: 'INDEX_QUOTES',
            status: 'ERROR',
            asOf: null,
            facts: [],
            rows: [],
            warning: '该市场分区暂时不可用',
          },
        ],
      },
      asOf: null,
      sourceModels: ['IndexDaily'],
    })
    const definition = definitions.find((item) => item.key === 'get_market_snapshot')!

    await expect(definition.execute({ sections: ['INDEX_QUOTES'] }, context())).rejects.toMatchObject({
      code: 'UPSTREAM_FAILED',
      retryable: true,
    })
  })

  it('[SMT-LOAD-001] 20 Run 并发调用六 Tool fixture，无跨 Run/user 参数污染', async () => {
    const { definitions, stock, market, sector, watchlist } = harness()
    const inputByKey = {
      resolve_security: { query: '浦发银行' },
      get_stock_price_history: {
        tsCode: '600000.SH',
        startDate: '2024-01-01',
        endDate: '2024-01-31',
        frequency: 'DAILY',
        adjustment: 'FORWARD',
        fields: ['close'],
        limit: 100,
      },
      get_stock_overview: { tsCodes: ['600000.SH'], sections: ['BASIC'] },
      get_market_snapshot: { sections: ['INDEX_QUOTES'] },
      get_sector_membership: {
        mode: 'SECTORS_FOR_SECURITY',
        tsCode: '600000.SH',
        sectorType: 'INDUSTRY',
      },
      get_user_watchlist: { limit: 100 },
    } as const

    const results = await Promise.all(
      Array.from({ length: 20 }, (_, runIndex) =>
        Promise.all(
          definitions.map((definition, toolIndex) =>
            definition.execute(
              inputByKey[definition.key as keyof typeof inputByKey],
              context({
                userId: runIndex + 1,
                runId: `run_${runIndex}`,
                toolCallId: `call_${runIndex}_${toolIndex}`,
              }),
            ),
          ),
        ),
      ),
    )

    expect(results.flat()).toHaveLength(120)
    expect(results.flat().every((result) => result.ok)).toBe(true)
    expect(stock.resolveSecurity).toHaveBeenCalledTimes(20)
    expect(stock.getPriceHistory).toHaveBeenCalledTimes(20)
    expect(stock.getOverview).toHaveBeenCalledTimes(20)
    expect(market.snapshot).toHaveBeenCalledTimes(20)
    expect(sector.membership).toHaveBeenCalledTimes(20)
    expect(watchlist.read.mock.calls.map((call) => call[0])).toEqual(
      Array.from({ length: 20 }, (_, index) => index + 1),
    )
  })

  it('[SMT-STRESS-001] 5000 bars/500 members/200 watchlist 边界有界，5001 bars 被 schema 拒绝', () => {
    const { definitions } = harness()
    const validator = new ToolSchemaValidator()
    const price = definitions.find((item) => item.key === 'get_stock_price_history')!
    const sector = definitions.find((item) => item.key === 'get_sector_membership')!
    const watchlist = definitions.find((item) => item.key === 'get_user_watchlist')!
    validator.assertDefinitionSchemas(price)
    const bars = Array.from({ length: 5_000 }, () => ({ tradeDate: '2024-01-31', close: 10 }))
    const priceData = {
      tsCode: '600000.SH',
      frequency: 'DAILY',
      adjustment: 'NONE',
      startDate: '2024-01-01',
      endDate: '2024-01-31',
      fields: ['close'],
      units: {
        price: 'CNY',
        pctChange: 'PERCENT',
        volume: 'LOT',
        amount: 'CNY_THOUSAND',
        turnoverRate: 'PERCENT',
        peTtm: 'MULTIPLE',
      },
      bars,
    }

    expect(validator.validateOutput(price, priceData).valid).toBe(true)
    expect(price.countRows!(priceData)).toBe(5_000)
    expect(validator.validateOutput(price, { ...priceData, bars: [...bars, bars[0]] }).valid).toBe(false)
    expect(sector.countRows!({ items: Array.from({ length: 500 }) })).toBe(500)
    expect(watchlist.countRows!({ groups: [{ members: Array.from({ length: 200 }) }] })).toBe(200)
  })
})
