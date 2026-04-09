/**
 * 测试数据工厂
 *
 * 提供各 Prisma model 的最小合法数据，支持 overrides 灵活覆盖字段。
 * 所有工厂函数返回纯对象（非 Prisma 实例），适合直接作为 mock 返回值。
 */

// ── 股票基础信息 ────────────────────────────────────────────────────────────

export function buildStockBasic(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    tsCode: '000001.SZ',
    symbol: '000001',
    name: '平安银行',
    area: '深圳',
    industry: '银行',
    market: 'main',
    listDate: new Date('2001-04-09'),
    listStatus: 'L',
    isHs: 'H',
    syncedAt: new Date(),
    ...overrides,
  }
}

// ── 交易日历 ────────────────────────────────────────────────────────────────

export function buildTradeCal(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    exchange: 'SSE',
    calDate: new Date('2026-04-09'),
    isOpen: '1',
    preTradeDate: new Date('2026-04-08'),
    syncedAt: new Date(),
    ...overrides,
  }
}

// ── 日线行情 ────────────────────────────────────────────────────────────────

export function buildDailyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    tsCode: '000001.SZ',
    tradeDate: new Date('2026-04-09'),
    open: 12.5,
    high: 13.0,
    low: 12.3,
    close: 12.8,
    preClose: 12.6,
    change: 0.2,
    pctChg: 1.59,
    vol: 1_000_000,
    amount: 12_800_000,
    syncedAt: new Date(),
    ...overrides,
  }
}

// ── 财务报告期通用（income / balanceSheet / cashflow 共用结构） ─────────────

export function buildFinancialRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    tsCode: '000001.SZ',
    annDate: new Date('2026-01-30'),
    endDate: new Date('2025-12-31'),
    reportType: '1',
    compType: '1',
    syncedAt: new Date(),
    ...overrides,
  }
}

// ── 业绩预告 ────────────────────────────────────────────────────────────────

export function buildForecastRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    tsCode: '000001.SZ',
    annDate: new Date('2026-01-15'),
    endDate: new Date('2025-12-31'),
    type: '预增',
    p_change_min: 20.0,
    p_change_max: 50.0,
    netProfitMin: 10_000_000,
    netProfitMax: 15_000_000,
    lastParentNetProfit: 9_000_000,
    firstAnnDate: new Date('2026-01-15'),
    summary: '业绩预增',
    syncedAt: new Date(),
    ...overrides,
  }
}

// ── 用户 ────────────────────────────────────────────────────────────────────

export function buildUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-1',
    username: 'testuser',
    passwordHash: '$2b$10$mockhash',
    role: 'USER',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

// ── 策略 ────────────────────────────────────────────────────────────────────

export function buildStrategy(overrides: Record<string, unknown> = {}) {
  return {
    id: 'strategy-1',
    userId: 'user-1',
    name: '测试策略',
    description: '用于单测',
    config: { factors: [], filters: [] },
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

// ── 回测 ────────────────────────────────────────────────────────────────────

export function buildBacktest(overrides: Record<string, unknown> = {}) {
  return {
    id: 'backtest-1',
    userId: 'user-1',
    strategyId: 'strategy-1',
    status: 'PENDING',
    startDate: new Date('2020-01-01'),
    endDate: new Date('2025-12-31'),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

// ── 自选股列表 ──────────────────────────────────────────────────────────────

export function buildWatchlist(overrides: Record<string, unknown> = {}) {
  return {
    id: 'wl-1',
    userId: 'user-1',
    name: '自选股1',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

// ── 资金流向（个股） ────────────────────────────────────────────────────────

export function buildMoneyflowRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    tsCode: '000001.SZ',
    tradeDate: new Date('2026-04-09'),
    buySmVol: 1000,
    buySmAmount: 1_000_000,
    sellSmVol: 800,
    sellSmAmount: 800_000,
    netMfAmount: 200_000,
    syncedAt: new Date(),
    ...overrides,
  }
}
