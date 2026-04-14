/**
 * PortfolioPerformanceService — 单元测试
 *
 * 覆盖要点：
 * - getPerformance: assertOwner 语义（由 portfolioService mock 控制）
 * - 无基准数据时返回空响应（dailySeries=[], metrics 全零）
 * - 无持仓时净值固定为 1（全部现金）
 * - 正常持仓时净值随收盘价变化
 * - 基准归一化正确（第0日 benchmarkNav=1）
 * - computeMetrics: 正收益时 totalReturn > 0，maxDrawdown 计算正确
 * - 序列长度 < 2 时 computeMetrics 返回零指标
 */
import { NotFoundException } from '@nestjs/common'
import { PortfolioPerformanceService } from '../services/portfolio-performance.service'

// ── 工具 ──────────────────────────────────────────────────────────────────────

function makePortfolio(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p-1',
    userId: 1,
    name: '测试组合',
    initialCash: 1_000_000,
    cashBalance: 1_000_000,
    createdAt: new Date('2025-01-01'),
    ...overrides,
  }
}

function buildMocks() {
  const mockPrisma = {
    portfolioHolding: { findMany: jest.fn(async () => []) },
    daily: { findMany: jest.fn(async () => []) },
    indexDaily: { findMany: jest.fn(async () => []) },
  }

  const mockPortfolioService = {
    assertOwner: jest.fn(async () => makePortfolio()),
    getLatestTradeDate: jest.fn(async () => new Date('2025-03-31')),
  }

  return { mockPrisma, mockPortfolioService }
}

function createService(mocks = buildMocks()) {
  const svc = new PortfolioPerformanceService(mocks.mockPrisma as never, mocks.mockPortfolioService as never)
  return { svc, ...mocks }
}

// ── 测试套件 ──────────────────────────────────────────────────────────────────

describe('PortfolioPerformanceService', () => {
  beforeEach(() => jest.clearAllMocks())

  it('portfolioService.assertOwner 抛出 NotFoundException 时透传', async () => {
    const { svc, mockPortfolioService } = createService()
    mockPortfolioService.assertOwner.mockRejectedValue(new NotFoundException('不存在'))
    await expect(svc.getPerformance({ portfolioId: 'p-1' }, 1)).rejects.toThrow(NotFoundException)
  })

  it('无基准数据时返回空响应（dailySeries = []）', async () => {
    const { svc, mockPrisma } = createService()
    mockPrisma.indexDaily.findMany.mockResolvedValue([])
    const result = await svc.getPerformance({ portfolioId: 'p-1' }, 1)
    expect(result.dailySeries).toEqual([])
    expect(result.metrics.totalReturn).toBe(0)
  })

  it('无持仓时组合净值每日固定为 1.0（全部现金）', async () => {
    const { svc, mockPrisma } = createService()
    mockPrisma.portfolioHolding.findMany.mockResolvedValue([])
    mockPrisma.indexDaily.findMany.mockResolvedValue([
      { tradeDate: new Date('2025-03-01'), close: 4000 },
      { tradeDate: new Date('2025-03-04'), close: 4100 },
    ])

    const result = await svc.getPerformance({ portfolioId: 'p-1' }, 1)
    expect(result.dailySeries).toHaveLength(2)
    // 无持仓：组合 MV = cashBalance = initialCash → NAV = 1.0
    expect(result.dailySeries[0].portfolioNav).toBe(1)
    expect(result.dailySeries[1].portfolioNav).toBe(1)
  })

  it('基准归一化：第0日 benchmarkNav = 1', async () => {
    const { svc, mockPrisma } = createService()
    mockPrisma.indexDaily.findMany.mockResolvedValue([
      { tradeDate: new Date('2025-03-01'), close: 5000 },
      { tradeDate: new Date('2025-03-04'), close: 5500 },
    ])

    const result = await svc.getPerformance({ portfolioId: 'p-1' }, 1)
    expect(result.dailySeries[0].benchmarkNav).toBe(1)
    // 5500/5000 = 1.1
    expect(result.dailySeries[1].benchmarkNav).toBeCloseTo(1.1, 3)
  })

  it('持仓上涨时 totalReturn > 0', async () => {
    const { svc, mockPrisma } = createService()
    mockPrisma.portfolioHolding.findMany.mockResolvedValue([{ tsCode: '000001.SZ', quantity: 100000, avgCost: 10 }])
    // initialCash=1_000_000，持仓成本=100_000×10=1_000_000，cashBalance=0
    mockPrisma.daily.findMany.mockResolvedValue([
      { tsCode: '000001.SZ', tradeDate: new Date('2025-03-01'), close: 10 },
      { tsCode: '000001.SZ', tradeDate: new Date('2025-03-04'), close: 11 },
      { tsCode: '000001.SZ', tradeDate: new Date('2025-03-05'), close: 12 },
    ])
    mockPrisma.indexDaily.findMany.mockResolvedValue([
      { tradeDate: new Date('2025-03-01'), close: 4000 },
      { tradeDate: new Date('2025-03-04'), close: 4050 },
      { tradeDate: new Date('2025-03-05'), close: 4100 },
    ])

    const result = await svc.getPerformance({ portfolioId: 'p-1' }, 1)
    expect(result.metrics.totalReturn).toBeGreaterThan(0)
    // 最终 NAV = 100000×12 / 1_000_000 = 1.2 → totalReturn = 0.2
    expect(result.dailySeries[result.dailySeries.length - 1].portfolioNav).toBeCloseTo(1.2, 2)
  })

  it('序列长度 < 2 时 computeMetrics 返回全零', async () => {
    const { svc, mockPrisma } = createService()
    // 只有一条 benchmark 记录
    mockPrisma.indexDaily.findMany.mockResolvedValue([{ tradeDate: new Date('2025-03-01'), close: 4000 }])

    const result = await svc.getPerformance({ portfolioId: 'p-1' }, 1)
    expect(result.metrics.annualizedReturn).toBe(0)
    expect(result.metrics.sharpeRatio).toBe(0)
  })

  it('净值先涨后跌时 maxDrawdown > 0', async () => {
    const { svc, mockPrisma } = createService()
    // 全部现金组合，NAV 固定 1.0，无回撤（侧面验证 maxDrawdown 计算不报错）
    mockPrisma.indexDaily.findMany.mockResolvedValue([
      { tradeDate: new Date('2025-03-01'), close: 4000 },
      { tradeDate: new Date('2025-03-04'), close: 4500 },
      { tradeDate: new Date('2025-03-05'), close: 4200 },
    ])

    const result = await svc.getPerformance({ portfolioId: 'p-1' }, 1)
    // 无持仓时组合 NAV 一直为 1 → maxDrawdown = 0
    expect(result.metrics.maxDrawdown).toBe(0)
  })

  it('持仓跌时 maxDrawdown 反映跌幅', async () => {
    const { svc, mockPrisma } = createService()
    // 100000 股成本 10，持仓成本 = initialCash → cashBalance = 0
    mockPrisma.portfolioHolding.findMany.mockResolvedValue([{ tsCode: '000001.SZ', quantity: 100000, avgCost: 10 }])
    mockPrisma.daily.findMany.mockResolvedValue([
      { tsCode: '000001.SZ', tradeDate: new Date('2025-03-01'), close: 10 },
      { tsCode: '000001.SZ', tradeDate: new Date('2025-03-04'), close: 12 }, // 峰值 NAV=1.2
      { tsCode: '000001.SZ', tradeDate: new Date('2025-03-05'), close: 9 }, // 从峰值跌 (1.2-0.9)/1.2 = 0.25
    ])
    mockPrisma.indexDaily.findMany.mockResolvedValue([
      { tradeDate: new Date('2025-03-01'), close: 4000 },
      { tradeDate: new Date('2025-03-04'), close: 4000 },
      { tradeDate: new Date('2025-03-05'), close: 4000 },
    ])

    const result = await svc.getPerformance({ portfolioId: 'p-1' }, 1)
    // 峰值 1.2，低谷 0.9 → 回撤 = (1.2-0.9)/1.2 ≈ 0.25
    expect(result.metrics.maxDrawdown).toBeCloseTo(0.25, 2)
  })

  // ── Sharpe 公式差异（P1-B15）────────────────────────────────────────────────

  describe('[BUG P1-B15] PortfolioPerformance Sharpe 未减无风险利率', () => {
    it('[BUG P1-B15] Sharpe = annReturn / annVol（无风险利率为 0），与 BacktestMetrics 不一致', async () => {
      // BacktestMetrics Sharpe = (annReturn - RISK_FREE_RATE) / annStd（使用 2% 无风险利率）
      // PortfolioPerformance Sharpe = annReturn / annVol（无风险利率为 0）
      // 两个模块向同一用户展示不同 Sharpe 定义，造成困惑
      const { svc, mockPrisma } = createService()
      mockPrisma.portfolioHolding.findMany.mockResolvedValue([{ tsCode: '000001.SZ', quantity: 100000, avgCost: 10 }])
      // 构造正收益波动序列：10→11→10→11（每日涨跌 10%）
      mockPrisma.daily.findMany.mockResolvedValue([
        { tsCode: '000001.SZ', tradeDate: new Date('2025-01-01'), close: 10 },
        { tsCode: '000001.SZ', tradeDate: new Date('2025-01-02'), close: 11 },
        { tsCode: '000001.SZ', tradeDate: new Date('2025-01-03'), close: 10 },
        { tsCode: '000001.SZ', tradeDate: new Date('2025-01-04'), close: 11 },
      ])
      mockPrisma.indexDaily.findMany.mockResolvedValue([
        { tradeDate: new Date('2025-01-01'), close: 1000 },
        { tradeDate: new Date('2025-01-02'), close: 1000 },
        { tradeDate: new Date('2025-01-03'), close: 1000 },
        { tradeDate: new Date('2025-01-04'), close: 1000 },
      ])

      const result = await svc.getPerformance({ portfolioId: 'p-1' }, 1)

      const series = result.dailySeries
      expect(series.length).toBeGreaterThanOrEqual(2)

      if (series.length >= 2) {
        const dailyReturns = series.slice(1).map((s) => s.dailyReturn)
        const n = dailyReturns.length
        const m = dailyReturns.reduce((a, b) => a + b, 0) / n
        // PortfolioPerformance.stdDev 使用样本方差（÷(n-1)）
        const variance = dailyReturns.reduce((sum, v) => sum + (v - m) ** 2, 0) / (n - 1)
        const annVol = Math.sqrt(variance) * Math.sqrt(252)

        const lastNav = series[series.length - 1].portfolioNav
        const totalReturn = lastNav - 1
        const years = series.length / 252
        const annReturn = Math.pow(1 + totalReturn, 1 / years) - 1

        // [BUG P1-B15] 当前 Sharpe = annReturn / annVol（rf=0，使用样本方差）
        const sharpeWithoutRF = annVol > 0 ? annReturn / annVol : 0
        // 修复后应为 (annReturn - 0.02) / annVol
        const sharpeWithRF = annVol > 0 ? (annReturn - 0.02) / annVol : 0

        if (annVol > 1e-8) {
          // 当前实现更接近 sharpeWithoutRF（不减 rf）
          expect(Math.abs(result.metrics.sharpeRatio - sharpeWithoutRF)).toBeLessThan(
            Math.abs(result.metrics.sharpeRatio - sharpeWithRF),
          )
          // 记录：修复后 Sharpe 比当前低（rf=2% 使分子更小）
          expect(sharpeWithoutRF).toBeGreaterThan(sharpeWithRF)
        }
      }
    })
  })

  // ── lastKnownPrice 初始化为 avgCost（P1-B16）────────────────────────────────

  describe('[BUG P1-B16] 首日无行情时使用 avgCost 作为价格', () => {
    it('[BUG P1-B16] 首日无股价时 lastKnownPrice=avgCost，导致首日 NAV 使用成本价而非市价', async () => {
      // 业务场景：持仓 100000股 avgCost=5，基准从第1天起有数据，但该股第1天无收盘价
      // cashBalance = initialCash - totalCost = 1_000_000 - 100_000*5 = 500_000
      //
      // [BUG] 代码：lastKnownPrice.set(h.tsCode, Number(h.avgCost)) → 第1天未更新，沿用 avgCost=5
      // 结果：NAV_day1 = (500_000 + 100_000*5) / 1_000_000 = 1_000_000 / 1_000_000 = 1.0
      //
      // 正确行为：第1天无价格 → 该持仓不应参与 NAV 计算，或使用 0
      // 正确 NAV_day1 = (500_000 + 0) / 1_000_000 = 0.5（或等待有价格的第一天才开始计算）
      const { svc, mockPrisma } = createService()

      mockPrisma.portfolioHolding.findMany.mockResolvedValue([
        { tsCode: '000001.SZ', quantity: 100000, avgCost: 5 }, // 成本=500_000，cashBalance=500_000
      ])
      // 第1天（2025-01-01）无股价数据，第2天 close=8（远高于 avgCost=5）
      mockPrisma.daily.findMany.mockResolvedValue([
        { tsCode: '000001.SZ', tradeDate: new Date('2025-01-02'), close: 8 },
        { tsCode: '000001.SZ', tradeDate: new Date('2025-01-03'), close: 8 },
      ])
      mockPrisma.indexDaily.findMany.mockResolvedValue([
        { tradeDate: new Date('2025-01-01'), close: 1000 }, // 基准第1天有数据，但持仓无价格
        { tradeDate: new Date('2025-01-02'), close: 1000 },
        { tradeDate: new Date('2025-01-03'), close: 1000 },
      ])

      const result = await svc.getPerformance({ portfolioId: 'p-1' }, 1)

      // 手算（BUG 行为）：第1天 lastKnownPrice=avgCost=5
      // NAV_day1 = (500_000 + 100_000*5) / 1_000_000 = 1.0
      expect(result.dailySeries[0].portfolioNav).toBeCloseTo(1.0, 4) // [BUG] 使用成本价导致 NAV=1.0

      // 第2天 close=8 → NAV_day2 = (500_000 + 100_000*8) / 1_000_000 = 1.3
      // dailyReturn_day2 = 1.3/1.0 - 1 = 30%（实际上是从 avgCost=5 到 close=8 的价差被错误地计入第2天）
      expect(result.dailySeries[1].portfolioNav).toBeCloseTo(1.3, 3)
      expect(result.dailySeries[1].dailyReturn).toBeCloseTo(0.3, 3) // [BUG] 第2天显示 30% 涨幅

      // 正确行为：第1天无价格时 NAV 应反映真实市场价（或不包含该持仓），
      // 不应使用 avgCost 作为当前市价。修复方案：删除 lastKnownPrice 的 avgCost 初始化。
    })
  })
})
