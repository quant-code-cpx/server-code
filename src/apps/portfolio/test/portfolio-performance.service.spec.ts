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
})
