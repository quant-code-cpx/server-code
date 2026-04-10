/**
 * StockFinancialService — 单元测试
 *
 * 覆盖要点：
 * - yoy 计算：正常、prev 为 null、prev 为 0
 * - buildIncomeItems：存在同比期时 YOY 有值，无同比期时为 null
 * - buildBalanceSheetItems：YOY 字段正确
 * - buildCashflowItems：YOY 字段正确
 * - fmtPeriodKey / prevYearKey 行为：通过 getDetailFinancialStatements 间接验证
 * - getDetailFinancials：返回 history 和 latest
 * - getDetailFinancialStatements：income / balanceSheet / cashflow 聚合结构
 */

import { StockFinancialService } from '../stock-financial.service'

// ── Mock 工厂 ─────────────────────────────────────────────────────────────────

function buildPrismaMock() {
  return {
    finaIndicator: { findMany: jest.fn() },
    express: { findMany: jest.fn() },
    top10Holders: { findMany: jest.fn() },
    top10FloatHolders: { findMany: jest.fn() },
    dividend: { findMany: jest.fn(), count: jest.fn() },
    dailyBasic: { findFirst: jest.fn() },
    income: { findMany: jest.fn() },
    balanceSheet: { findMany: jest.fn() },
    cashflow: { findMany: jest.fn() },
    $queryRaw: jest.fn(async () => []),
  }
}

function buildFinancialSyncMock() {
  return { syncDividendsForStock: jest.fn(async () => {}) }
}

function createService(prismaMock = buildPrismaMock(), syncMock = buildFinancialSyncMock()) {
  return new StockFinancialService(prismaMock as any, syncMock as any)
}

/** 构造一条 income / balanceSheet / cashflow 行 */
function makeRow(endDateStr: string, overrides: Record<string, unknown> = {}) {
  return {
    endDate: new Date(endDateStr),
    annDate: new Date(endDateStr),
    reportType: '1',
    // income
    totalRevenue: 1000,
    revenue: 900,
    operateProfit: 200,
    totalProfit: 180,
    nIncome: 150,
    nIncomeAttrP: 140,
    basicEps: 1.0,
    sellExp: 50,
    adminExp: 30,
    finExp: 10,
    rdExp: 20,
    ebit: 190,
    ebitda: 210,
    // balance
    totalAssets: 5000,
    totalCurAssets: 2000,
    totalNca: 3000,
    moneyCap: 800,
    inventories: 400,
    accountsReceiv: 300,
    totalLiab: 3000,
    totalCurLiab: 1500,
    totalNcl: 1500,
    stBorr: 500,
    ltBorr: 800,
    totalHldrEqyExcMinInt: 2000,
    totalHldrEqyIncMinInt: 2100,
    // cashflow
    nCashflowAct: 300,
    nCashflowInvAct: -200,
    nCashFlowsFncAct: -50,
    freeCashflow: 250,
    nIncrCashCashEqu: 50,
    cFrSaleSg: 900,
    cPaidGoodsS: 600,
    ...overrides,
  }
}

// ═══════════════════════════════════════════════════════════════════════════════

describe('StockFinancialService', () => {
  beforeEach(() => jest.clearAllMocks())

  // ── getDetailFinancials() ─────────────────────────────────────────────────

  describe('getDetailFinancials()', () => {
    it('返回 history 和 latest，history 按升序排列', async () => {
      const prisma = buildPrismaMock()
      const rows = [
        { endDate: new Date('2024-09-30'), annDate: new Date('2024-10-30'), eps: 0.5, dtEps: 0.48, roe: 12, dtRoe: 11, roa: 5, grossprofit_margin: 35, netprofit_margin: 15, debtToAssets: 40, currentRatio: 1.5, quickRatio: 1.2, revenueYoy: 10, netprofitYoy: 8, ocfToNetprofit: 1.1, fcff: 200 },
        { endDate: new Date('2024-06-30'), annDate: new Date('2024-07-30'), eps: 0.4, dtEps: 0.38, roe: 11, dtRoe: 10, roa: 4, grossprofit_margin: 33, netprofit_margin: 14, debtToAssets: 41, currentRatio: 1.4, quickRatio: 1.1, revenueYoy: 9, netprofitYoy: 7, ocfToNetprofit: 1.0, fcff: 180 },
      ]
      // findMany 返回降序排列（模拟 orderBy: desc）
      prisma.finaIndicator.findMany.mockResolvedValue(rows)
      prisma.express.findMany.mockResolvedValue([])
      const svc = createService(prisma)

      const result = await svc.getDetailFinancials({ tsCode: '000001.SZ', periods: 8 })

      expect(result.tsCode).toBe('000001.SZ')
      expect(result.history).toHaveLength(2)
      // history 应升序（reverse 后）
      expect(result.history[0].endDate).toEqual(new Date('2024-06-30'))
      expect(result.history[1].endDate).toEqual(new Date('2024-09-30'))
      // latest 指向最新一期
      expect(result.latest).toEqual(result.history[1])
    })

    it('无数据时 latest 为 null，history 为空数组', async () => {
      const prisma = buildPrismaMock()
      prisma.finaIndicator.findMany.mockResolvedValue([])
      prisma.express.findMany.mockResolvedValue([])
      const svc = createService(prisma)

      const result = await svc.getDetailFinancials({ tsCode: '000001.SZ' })

      expect(result.latest).toBeNull()
      expect(result.history).toHaveLength(0)
    })

    it('返回 recentExpress 字段', async () => {
      const prisma = buildPrismaMock()
      prisma.finaIndicator.findMany.mockResolvedValue([])
      prisma.express.findMany.mockResolvedValue([
        { annDate: new Date('2024-10-30'), endDate: new Date('2024-09-30'), revenue: 1000, nIncome: 150, dilutedEps: 0.5, dilutedRoe: 12, yoyNetProfit: 8, yoySales: 10 },
      ])
      const svc = createService(prisma)

      const result = await svc.getDetailFinancials({ tsCode: '000001.SZ' })

      expect(result.recentExpress).toHaveLength(1)
      expect(result.recentExpress[0]).toMatchObject({ revenue: 1000, nIncome: 150 })
    })
  })

  // ── getDetailFinancialStatements() — YOY 逻辑 ────────────────────────────

  describe('getDetailFinancialStatements()', () => {
    const tsCode = '000001.SZ'

    describe('income YOY', () => {
      it('当上一年同期数据存在时，YOY 字段有值', async () => {
        const prisma = buildPrismaMock()
        // 当期：2024-09-30，同比期：2023-09-30（上一年）
        const rows = [
          makeRow('2024-09-30', { totalRevenue: 1100, nIncome: 165, operateProfit: 220 }),
          makeRow('2023-09-30', { totalRevenue: 1000, nIncome: 150, operateProfit: 200 }),
        ]
        prisma.income.findMany.mockResolvedValue(rows)
        prisma.balanceSheet.findMany.mockResolvedValue([])
        prisma.cashflow.findMany.mockResolvedValue([])
        const svc = createService(prisma)

        const result = await svc.getDetailFinancialStatements({ tsCode, periods: 8 })
        const item = result.income[0] // 最新一期 2024-09-30

        expect(item.endDate).toEqual(new Date('2024-09-30'))
        // totalRevenueYoy = (1100-1000)/|1000| * 100 = 10
        expect(item.totalRevenueYoy).toBe(10)
        // nIncomeYoy = (165-150)/|150| * 100 ≈ 10
        expect(item.nIncomeYoy).toBe(10)
        // operateProfitYoy = (220-200)/|200| * 100 = 10
        expect(item.operateProfitYoy).toBe(10)
      })

      it('当上一年同期数据不存在时，YOY 字段为 null', async () => {
        const prisma = buildPrismaMock()
        // 只有一期，无同比期
        const rows = [makeRow('2024-09-30')]
        prisma.income.findMany.mockResolvedValue(rows)
        prisma.balanceSheet.findMany.mockResolvedValue([])
        prisma.cashflow.findMany.mockResolvedValue([])
        const svc = createService(prisma)

        const result = await svc.getDetailFinancialStatements({ tsCode, periods: 8 })
        const item = result.income[0]

        expect(item.totalRevenueYoy).toBeNull()
        expect(item.nIncomeYoy).toBeNull()
        expect(item.operateProfitYoy).toBeNull()
      })

      it('上一年同期 totalRevenue 为 0 时，totalRevenueYoy 为 null', async () => {
        const prisma = buildPrismaMock()
        const rows = [
          makeRow('2024-09-30', { totalRevenue: 500 }),
          makeRow('2023-09-30', { totalRevenue: 0 }),
        ]
        prisma.income.findMany.mockResolvedValue(rows)
        prisma.balanceSheet.findMany.mockResolvedValue([])
        prisma.cashflow.findMany.mockResolvedValue([])
        const svc = createService(prisma)

        const result = await svc.getDetailFinancialStatements({ tsCode, periods: 8 })

        expect(result.income[0].totalRevenueYoy).toBeNull()
      })

      it('上一年同期 nIncome 为 null 时，nIncomeYoy 为 null', async () => {
        const prisma = buildPrismaMock()
        const rows = [
          makeRow('2024-09-30', { nIncome: 150 }),
          makeRow('2023-09-30', { nIncome: null }),
        ]
        prisma.income.findMany.mockResolvedValue(rows)
        prisma.balanceSheet.findMany.mockResolvedValue([])
        prisma.cashflow.findMany.mockResolvedValue([])
        const svc = createService(prisma)

        const result = await svc.getDetailFinancialStatements({ tsCode, periods: 8 })

        expect(result.income[0].nIncomeYoy).toBeNull()
      })
    })

    describe('balanceSheet YOY', () => {
      it('存在同比期时，totalAssetsYoy 和 equityYoy 有值', async () => {
        const prisma = buildPrismaMock()
        const rows = [
          makeRow('2024-09-30', { totalAssets: 5500, totalHldrEqyExcMinInt: 2200 }),
          makeRow('2023-09-30', { totalAssets: 5000, totalHldrEqyExcMinInt: 2000 }),
        ]
        prisma.income.findMany.mockResolvedValue([])
        prisma.balanceSheet.findMany.mockResolvedValue(rows)
        prisma.cashflow.findMany.mockResolvedValue([])
        const svc = createService(prisma)

        const result = await svc.getDetailFinancialStatements({ tsCode, periods: 8 })
        const item = result.balanceSheet[0]

        // totalAssetsYoy = (5500-5000)/5000 * 100 = 10
        expect(item.totalAssetsYoy).toBe(10)
        // equityYoy = (2200-2000)/2000 * 100 = 10
        expect(item.equityYoy).toBe(10)
      })

      it('无同比期时，YOY 字段为 null', async () => {
        const prisma = buildPrismaMock()
        prisma.income.findMany.mockResolvedValue([])
        prisma.balanceSheet.findMany.mockResolvedValue([makeRow('2024-09-30')])
        prisma.cashflow.findMany.mockResolvedValue([])
        const svc = createService(prisma)

        const result = await svc.getDetailFinancialStatements({ tsCode, periods: 8 })

        expect(result.balanceSheet[0].totalAssetsYoy).toBeNull()
        expect(result.balanceSheet[0].equityYoy).toBeNull()
      })
    })

    describe('cashflow YOY', () => {
      it('存在同比期时，nCashflowActYoy 和 freeCashflowYoy 有值', async () => {
        const prisma = buildPrismaMock()
        const rows = [
          makeRow('2024-09-30', { nCashflowAct: 330, freeCashflow: 275 }),
          makeRow('2023-09-30', { nCashflowAct: 300, freeCashflow: 250 }),
        ]
        prisma.income.findMany.mockResolvedValue([])
        prisma.balanceSheet.findMany.mockResolvedValue([])
        prisma.cashflow.findMany.mockResolvedValue(rows)
        const svc = createService(prisma)

        const result = await svc.getDetailFinancialStatements({ tsCode, periods: 8 })
        const item = result.cashflow[0]

        // nCashflowActYoy = (330-300)/300 * 100 = 10
        expect(item.nCashflowActYoy).toBe(10)
        // freeCashflowYoy = (275-250)/250 * 100 = 10
        expect(item.freeCashflowYoy).toBe(10)
      })

      it('无同比期时，YOY 字段为 null', async () => {
        const prisma = buildPrismaMock()
        prisma.income.findMany.mockResolvedValue([])
        prisma.balanceSheet.findMany.mockResolvedValue([])
        prisma.cashflow.findMany.mockResolvedValue([makeRow('2024-09-30')])
        const svc = createService(prisma)

        const result = await svc.getDetailFinancialStatements({ tsCode, periods: 8 })

        expect(result.cashflow[0].nCashflowActYoy).toBeNull()
        expect(result.cashflow[0].freeCashflowYoy).toBeNull()
      })

      it('freeCashflow 为 0 时，freeCashflowYoy 为 null', async () => {
        const prisma = buildPrismaMock()
        const rows = [
          makeRow('2024-09-30', { freeCashflow: 100 }),
          makeRow('2023-09-30', { freeCashflow: 0 }),
        ]
        prisma.income.findMany.mockResolvedValue([])
        prisma.balanceSheet.findMany.mockResolvedValue([])
        prisma.cashflow.findMany.mockResolvedValue(rows)
        const svc = createService(prisma)

        const result = await svc.getDetailFinancialStatements({ tsCode, periods: 8 })

        expect(result.cashflow[0].freeCashflowYoy).toBeNull()
      })
    })

    describe('periods 限制', () => {
      it('限制返回条数不超过 periods', async () => {
        const prisma = buildPrismaMock()
        // 6 条数据，但 periods=3
        const rows = [
          makeRow('2024-09-30'),
          makeRow('2024-06-30'),
          makeRow('2024-03-31'),
          makeRow('2023-09-30'),
          makeRow('2023-06-30'),
          makeRow('2023-03-31'),
        ]
        prisma.income.findMany.mockResolvedValue(rows)
        prisma.balanceSheet.findMany.mockResolvedValue(rows)
        prisma.cashflow.findMany.mockResolvedValue(rows)
        const svc = createService(prisma)

        const result = await svc.getDetailFinancialStatements({ tsCode, periods: 3 })

        expect(result.income).toHaveLength(3)
        expect(result.balanceSheet).toHaveLength(3)
        expect(result.cashflow).toHaveLength(3)
      })
    })

    describe('fmtPeriodKey / prevYearKey 行为验证', () => {
      it('2025-01-01 的同比期匹配 2024-01-01（UTC 日期）', async () => {
        const prisma = buildPrismaMock()
        // 这里模拟 2025-01-01T00:00:00Z 的数据
        const rows = [
          makeRow('2025-01-01', { totalRevenue: 1100 }),
          makeRow('2024-01-01', { totalRevenue: 1000 }),
        ]
        prisma.income.findMany.mockResolvedValue(rows)
        prisma.balanceSheet.findMany.mockResolvedValue([])
        prisma.cashflow.findMany.mockResolvedValue([])
        const svc = createService(prisma)

        const result = await svc.getDetailFinancialStatements({ tsCode, periods: 8 })
        const item2025 = result.income.find((i) => (i.endDate as Date).getUTCFullYear() === 2025)

        expect(item2025).toBeDefined()
        // 同比期 2024-01-01 存在，应计算出 YOY
        expect(item2025!.totalRevenueYoy).not.toBeNull()
        expect(item2025!.totalRevenueYoy).toBe(10)
      })

      it('多期数据中只有部分有同比期', async () => {
        const prisma = buildPrismaMock()
        const rows = [
          makeRow('2024-09-30', { totalRevenue: 1100 }),
          makeRow('2024-06-30', { totalRevenue: 1050 }),
          // 2023-09-30 存在（作为 2024-09-30 的同比）
          makeRow('2023-09-30', { totalRevenue: 1000 }),
          // 2023-06-30 不存在（2024-06-30 无同比）
        ]
        prisma.income.findMany.mockResolvedValue(rows)
        prisma.balanceSheet.findMany.mockResolvedValue([])
        prisma.cashflow.findMany.mockResolvedValue([])
        const svc = createService(prisma)

        const result = await svc.getDetailFinancialStatements({ tsCode, periods: 8 })

        const item0 = result.income[0] // 2024-09-30，有同比
        const item1 = result.income[1] // 2024-06-30，无同比

        expect(item0.totalRevenueYoy).not.toBeNull()
        expect(item1.totalRevenueYoy).toBeNull()
      })
    })

    describe('空数据', () => {
      it('三张表均无数据时，返回空数组', async () => {
        const prisma = buildPrismaMock()
        prisma.income.findMany.mockResolvedValue([])
        prisma.balanceSheet.findMany.mockResolvedValue([])
        prisma.cashflow.findMany.mockResolvedValue([])
        const svc = createService(prisma)

        const result = await svc.getDetailFinancialStatements({ tsCode, periods: 8 })

        expect(result.income).toHaveLength(0)
        expect(result.balanceSheet).toHaveLength(0)
        expect(result.cashflow).toHaveLength(0)
      })
    })
  })

  // ── getDetailShareCapital() ───────────────────────────────────────────────

  describe('getDetailShareCapital()', () => {
    it('有数据时返回 latest 和 history', async () => {
      const prisma = buildPrismaMock()
      prisma.dailyBasic.findFirst.mockResolvedValue({
        tradeDate: new Date('2024-10-30'),
        totalShare: 1000,
        floatShare: 800,
        freeShare: 750,
      })
      prisma.$queryRaw.mockResolvedValue([
        { tradeDate: new Date('2024-01-01'), totalShare: 1000, floatShare: 800 },
      ])
      const svc = createService(prisma)

      const result = await svc.getDetailShareCapital({ tsCode: '000001.SZ' })

      expect(result.latest).not.toBeNull()
      expect(result.latest!.totalShare).toBe(1000)
      expect(result.latest!.restrictedShare).toBe(200)
      expect(result.history).toHaveLength(1)
    })

    it('无数据时 latest 为 null', async () => {
      const prisma = buildPrismaMock()
      prisma.dailyBasic.findFirst.mockResolvedValue(null)
      prisma.$queryRaw.mockResolvedValue([])
      const svc = createService(prisma)

      const result = await svc.getDetailShareCapital({ tsCode: '000001.SZ' })

      expect(result.latest).toBeNull()
    })
  })
})
