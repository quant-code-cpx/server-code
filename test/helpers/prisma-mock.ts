/**
 * Prisma Mock 工厂
 *
 * 使用方式：
 *   const prisma = createMockPrismaService()
 *   prisma.stockBasic.findMany.mockResolvedValue([...])
 *
 * 每次调用 createMockPrismaService() 返回一个全新的 mock 实例，
 * 避免跨测试用例的状态污染。
 */

/** 为单个 Prisma model 生成标准 CRUD mock 方法 */
function buildModelMock() {
  return {
    findMany: jest.fn().mockResolvedValue([]),
    findFirst: jest.fn().mockResolvedValue(null),
    findUnique: jest.fn().mockResolvedValue(null),
    count: jest.fn().mockResolvedValue(0),
    create: jest.fn().mockResolvedValue({}),
    createMany: jest.fn().mockResolvedValue({ count: 0 }),
    update: jest.fn().mockResolvedValue({}),
    updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    upsert: jest.fn().mockResolvedValue({}),
    delete: jest.fn().mockResolvedValue({}),
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    aggregate: jest.fn().mockResolvedValue({}),
    groupBy: jest.fn().mockResolvedValue([]),
  }
}

/** 完整的 Prisma mock service */
export function createMockPrismaService() {
  return {
    // ── 行情 ──────────────────────────────────────────────────────────────
    daily: buildModelMock(),
    dailyBasic: buildModelMock(),
    adjFactor: buildModelMock(),
    weekly: buildModelMock(),
    monthly: buildModelMock(),
    indexDaily: buildModelMock(),
    indexDailybasic: buildModelMock(),
    indexWeight: buildModelMock(),

    // ── 基础信息 ──────────────────────────────────────────────────────────
    stockBasic: buildModelMock(),
    stockCompany: buildModelMock(),
    tradeCal: buildModelMock(),
    thsIndex: buildModelMock(),
    thsMember: buildModelMock(),
    indexClassify: buildModelMock(),
    indexMemberAll: buildModelMock(),
    cbBasic: buildModelMock(),
    cbDaily: buildModelMock(),

    // ── 财务 ──────────────────────────────────────────────────────────────
    income: buildModelMock(),
    balanceSheet: buildModelMock(),
    cashflow: buildModelMock(),
    finaIndicator: buildModelMock(),
    finaAudit: buildModelMock(),
    finaMainbz: buildModelMock(),
    express: buildModelMock(),
    forecast: buildModelMock(),
    dividend: buildModelMock(),
    top10Holders: buildModelMock(),
    top10FloatHolders: buildModelMock(),
    disclosureDate: buildModelMock(),

    // ── 资金流向 ──────────────────────────────────────────────────────────
    moneyflow: buildModelMock(),
    moneyflowIndDc: buildModelMock(),
    moneyflowMktDc: buildModelMock(),
    moneyflowHsgt: buildModelMock(),
    marginDetail: buildModelMock(),

    // ── 另类数据 ──────────────────────────────────────────────────────────
    topList: buildModelMock(),
    topInst: buildModelMock(),
    blockTrade: buildModelMock(),
    shareFloat: buildModelMock(),
    pledgeStat: buildModelMock(),
    repurchase: buildModelMock(),
    stkHolderNumber: buildModelMock(),
    stkHolderTrade: buildModelMock(),
    stkLimit: buildModelMock(),
    suspendD: buildModelMock(),
    hkHold: buildModelMock(),

    // ── 业务 ──────────────────────────────────────────────────────────────
    user: buildModelMock(),
    watchlist: buildModelMock(),
    watchlistItem: buildModelMock(),
    strategy: buildModelMock(),
    strategyDraft: buildModelMock(),
    backtest: buildModelMock(),
    factor: buildModelMock(),
    factorSnapshot: buildModelMock(),
    heatmapSnapshot: buildModelMock(),
    researchNote: buildModelMock(),
    screenerStrategy: buildModelMock(),
    screenerSubscription: buildModelMock(),
    auditLog: buildModelMock(),
    dataQualityCheck: buildModelMock(),
    tushareSyncLog: buildModelMock(),
    tushareSyncRetryQueue: buildModelMock(),

    // ── 事务 & 原始查询 ────────────────────────────────────────────────────
    $transaction: jest.fn(async (arg: unknown) => {
      if (typeof arg === 'function') return arg({})
      if (Array.isArray(arg)) return Promise.all(arg)
      return arg
    }),
    $executeRaw: jest.fn().mockResolvedValue(0),
    $queryRaw: jest.fn().mockResolvedValue([]),
    $connect: jest.fn().mockResolvedValue(undefined),
    $disconnect: jest.fn().mockResolvedValue(undefined),
  }
}

export type MockPrismaService = ReturnType<typeof createMockPrismaService>
