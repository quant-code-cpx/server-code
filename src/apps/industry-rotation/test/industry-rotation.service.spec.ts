/**
 * IndustryRotationService — 单元测试
 *
 * 覆盖要点：
 * - getReturnComparison: 正常返回 / 无数据返回空
 * - getMomentumRanking: weighted 和 simple 模式 / limit 截取
 * - getFlowAnalysis: 累计净流入 / 流动量 / summary 统计
 * - getIndustryValuation: 中位数 + 百分位 / 估值标签
 * - getOverview: 并行聚合四个维度
 * - getDetail: 行业→板块代码映射 / 趋势 + 成分股
 * - getHeatmap: 复用 return-comparison 逻辑
 */
import { IndustryRotationService } from '../industry-rotation.service'

// ── Mock 工厂 ─────────────────────────────────────────────────────────────────

function buildPrismaMock() {
  return {
    moneyflowIndDc: {
      findFirst: jest.fn(async () => ({ tradeDate: new Date('2024-06-28T00:00:00.000Z') })),
    },
    dailyBasic: {
      findFirst: jest.fn(async () => ({ tradeDate: new Date('2024-06-28T00:00:00.000Z') })),
    },
    $queryRawUnsafe: jest.fn(async () => []),
  }
}

function buildCacheMock() {
  return {
    buildKey: jest.fn((prefix: string, payload?: unknown) => `${prefix}:mock`),
    rememberJson: jest.fn(async ({ loader }: any) => loader()),
  }
}

function createService(overrides?: { prisma?: any; cache?: any }) {
  const prisma = overrides?.prisma ?? buildPrismaMock()
  const cache = overrides?.cache ?? buildCacheMock()
  // @ts-ignore 局部 mock
  return new IndustryRotationService(prisma as any, cache as any)
}

// ═══════════════════════════════════════════════════════════════════════════════

describe('IndustryRotationService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  // ── getReturnComparison ───────────────────────────────────────────────────

  describe('getReturnComparison', () => {
    it('无数据时返回空 industries', async () => {
      const prisma = buildPrismaMock()
      prisma.moneyflowIndDc.findFirst.mockResolvedValue(null)
      const svc = createService({ prisma })

      const result = await svc.getReturnComparison({})
      expect(result.industries).toEqual([])
    })

    it('正常返回行业收益率', async () => {
      const prisma = buildPrismaMock()
      prisma.$queryRawUnsafe.mockResolvedValue([
        {
          ts_code: 'BK0475',
          name: '银行',
          latest_close: 1000,
          latest_pct_change: 1.5,
          return_5: 2.5,
          return_20: 5.0,
          return_60: 10.0,
        },
      ])
      const svc = createService({ prisma })

      const result = await svc.getReturnComparison({ trade_date: '20240628' })

      expect(result.tradeDate).toBe('20240628')
      expect(result.industries).toHaveLength(1)
      expect(result.industries[0].tsCode).toBe('BK0475')
      expect(result.industries[0].returns[5]).toBe(2.5)
      expect(result.industries[0].returns[20]).toBe(5.0)
      expect(result.industries[0].returns[60]).toBe(10.0)
    })

    it('null 收益率保持为 null', async () => {
      const prisma = buildPrismaMock()
      prisma.$queryRawUnsafe.mockResolvedValue([
        {
          ts_code: 'BK0001',
          name: '测试',
          latest_close: 100,
          latest_pct_change: null,
          return_5: null,
          return_20: 3.0,
          return_60: null,
        },
      ])
      const svc = createService({ prisma })

      const result = await svc.getReturnComparison({ trade_date: '20240628' })

      expect(result.industries[0].returns[5]).toBeNull()
      expect(result.industries[0].returns[60]).toBeNull()
      expect(result.industries[0].latestPctChange).toBeNull()
    })
  })

  // ── getMomentumRanking ─────────────────────────────────────────────────────

  describe('getMomentumRanking', () => {
    const mockReturnData = [
      {
        ts_code: 'BK0001',
        name: '行业A',
        latest_close: 100,
        latest_pct_change: 1,
        return_5: 3,
        return_20: 6,
        return_60: 12,
      },
      {
        ts_code: 'BK0002',
        name: '行业B',
        latest_close: 200,
        latest_pct_change: -1,
        return_5: 1,
        return_20: 2,
        return_60: 4,
      },
    ]

    it('weighted 模式按加权分排序', async () => {
      const prisma = buildPrismaMock()
      prisma.$queryRawUnsafe.mockResolvedValue(mockReturnData)
      const svc = createService({ prisma })

      const result = await svc.getMomentumRanking({ trade_date: '20240628', method: 'weighted' })

      expect(result.method).toBe('weighted')
      expect(result.industries).toHaveLength(2)
      // 行业A should rank higher (higher returns)
      expect(result.industries[0].name).toBe('行业A')
      expect(result.industries[0].rank).toBe(1)
      expect(result.industries[1].rank).toBe(2)
    })

    it('simple 模式使用 20 日收益率', async () => {
      const prisma = buildPrismaMock()
      prisma.$queryRawUnsafe.mockResolvedValue(mockReturnData)
      const svc = createService({ prisma })

      const result = await svc.getMomentumRanking({ trade_date: '20240628', method: 'simple' })

      expect(result.method).toBe('simple')
      expect(result.industries[0].momentumScore).toBe(6)
      expect(result.industries[1].momentumScore).toBe(2)
    })

    it('limit 截取 Top N', async () => {
      const prisma = buildPrismaMock()
      prisma.$queryRawUnsafe.mockResolvedValue(mockReturnData)
      const svc = createService({ prisma })

      const result = await svc.getMomentumRanking({ trade_date: '20240628', limit: 1 })

      expect(result.industries).toHaveLength(1)
    })
  })

  // ── getFlowAnalysis ────────────────────────────────────────────────────────

  describe('getFlowAnalysis', () => {
    it('无数据时返回空', async () => {
      const prisma = buildPrismaMock()
      prisma.moneyflowIndDc.findFirst.mockResolvedValue(null)
      const svc = createService({ prisma })

      const result = await svc.getFlowAnalysis({})

      expect(result.industries).toEqual([])
      expect(result.summary.inflowCount).toBe(0)
    })

    it('正常返回资金流分析数据', async () => {
      const prisma = buildPrismaMock()
      // First call: main flow query; second call: return query
      prisma.$queryRawUnsafe
        .mockResolvedValueOnce([
          {
            ts_code: 'BK0001',
            name: '银行',
            cumulative_net: 50000,
            avg_daily_net: 10000,
            cum_buy_elg: 30000,
            cum_buy_lg: 20000,
            recent_half_net: 30000,
            earlier_half_net: 20000,
            prev_period_net: 40000,
            latest_rank: 1,
          },
        ])
        .mockResolvedValueOnce([{ ts_code: 'BK0001', cumulative_return: 3.5 }])
      const svc = createService({ prisma })

      const result = await svc.getFlowAnalysis({ trade_date: '20240628', days: 5 })

      expect(result.days).toBe(5)
      expect(result.industries).toHaveLength(1)
      expect(result.industries[0].cumulativeNetAmount).toBe(50000)
      expect(result.industries[0].flowMomentum).toBe(10000)
      expect(result.industries[0].cumulativeReturn).toBe(3.5)
      expect(result.summary.inflowCount).toBe(1)
      expect(result.summary.outflowCount).toBe(0)
    })
  })

  // ── getIndustryValuation ──────────────────────────────────────────────────

  describe('getIndustryValuation', () => {
    it('无数据时返回空', async () => {
      const prisma = buildPrismaMock()
      prisma.dailyBasic.findFirst.mockResolvedValue(null)
      const svc = createService({ prisma })

      const result = await svc.getIndustryValuation({})
      expect(result.industries).toEqual([])
    })

    it('正常返回估值数据及标签', async () => {
      const prisma = buildPrismaMock()
      prisma.$queryRawUnsafe.mockResolvedValueOnce([
        { industry: '银行', stock_count: 42, pe_ttm_median: 6.5, pb_median: 0.6, pe_pctl_1y: 15, pb_pctl_1y: 20, pe_pctl_3y: 10, pb_pctl_3y: 18 },
      ])
      const svc = createService({ prisma })

      const result = await svc.getIndustryValuation({ trade_date: '20240628' })

      expect(result.industries).toHaveLength(1)
      expect(result.industries[0].industry).toBe('银行')
      expect(result.industries[0].stockCount).toBe(42)
      expect(result.industries[0].peTtmMedian).toBe(6.5)
      expect(result.industries[0].valuationLabel).toBe('低估')
    })

    it('PE 百分位 > 75 标为高估', async () => {
      const prisma = buildPrismaMock()
      prisma.$queryRawUnsafe.mockResolvedValueOnce([
        { industry: '白酒', stock_count: 20, pe_ttm_median: 45, pb_median: 8, pe_pctl_1y: 85, pb_pctl_1y: 90, pe_pctl_3y: 80, pb_pctl_3y: 88 },
      ])
      const svc = createService({ prisma })

      const result = await svc.getIndustryValuation({ trade_date: '20240628' })

      expect(result.industries[0].valuationLabel).toBe('高估')
    })
  })

  // ── getOverview ────────────────────────────────────────────────────────────

  describe('getOverview', () => {
    it('返回四个维度的快照结构', async () => {
      const prisma = buildPrismaMock()
      // Since Promise.all makes call order non-deterministic,
      // use mockResolvedValue (always return same) instead of mockResolvedValueOnce
      prisma.$queryRawUnsafe.mockResolvedValue(
        Array.from({ length: 10 }, (_, i) => ({
          ts_code: `BK${i.toString().padStart(4, '0')}`,
          name: `行业${i}`,
          industry: `行业${i}`,
          latest_close: 100 + i,
          latest_pct_change: i,
          return_5: 5 - i * 0.5,
          return_20: 10 - i,
          return_60: 15 - i * 1.5,
          cumulative_net: 50000 - i * 10000,
          avg_daily_net: 10000 - i * 2000,
          cum_buy_elg: 20000,
          cum_buy_lg: 10000,
          recent_half_net: 15000,
          earlier_half_net: 10000,
          prev_period_net: null,
          latest_rank: i + 1,
          cumulative_return: 5 - i,
          stock_count: 20,
          pe_ttm_median: 10 + i,
          pb_median: 1 + i * 0.1,
          pe_percentile: i * 10,
          pb_percentile: i * 10,
        })),
      )
      const svc = createService({ prisma })

      const result = await svc.getOverview({})

      expect(result).toHaveProperty('returnSnapshot')
      expect(result).toHaveProperty('momentumSnapshot')
      expect(result).toHaveProperty('flowSnapshot')
      expect(result).toHaveProperty('valuationSnapshot')
      expect(result.returnSnapshot.topGainers.length).toBeGreaterThan(0)
      expect(result.momentumSnapshot.leaders.length).toBeGreaterThan(0)
      expect(result.flowSnapshot.topInflow.length).toBeGreaterThan(0)
    })
  })

  // ── getDetail ──────────────────────────────────────────────────────────────

  describe('getDetail', () => {
    it('行业名称未匹配时 tsCode 为 null', async () => {
      const prisma = buildPrismaMock()
      prisma.$queryRawUnsafe
        .mockResolvedValueOnce([]) // sector lookup returns empty
        .mockResolvedValueOnce([]) // valuation: current medians
        .mockResolvedValueOnce([]) // valuation: 1y pctls
        .mockResolvedValueOnce([]) // valuation: 3y pctls
        .mockResolvedValueOnce([]) // top stocks
      const svc = createService({ prisma })

      const result = await svc.getDetail({ industry: '不存在的行业' })

      expect(result.tsCode).toBeNull()
      expect(result.returnTrend).toEqual([])
      expect(result.flowTrend).toEqual([])
    })

    it('正常返回行业详情（industry 参数）', async () => {
      const prisma = buildPrismaMock()
      prisma.$queryRawUnsafe
        .mockResolvedValueOnce([{ ts_code: 'BK0475', name: '银行' }]) // sector lookup (by industry name)
        .mockResolvedValueOnce([
          { trade_date: new Date('2024-06-27'), close: 100, pct_change: 0 },
          { trade_date: new Date('2024-06-28'), close: 102, pct_change: 2 },
        ]) // return trend
        .mockResolvedValueOnce([
          { trade_date: new Date('2024-06-27'), net_amount: 5000, buy_elg_amount: 3000, buy_lg_amount: 2000 },
          { trade_date: new Date('2024-06-28'), net_amount: 6000, buy_elg_amount: 4000, buy_lg_amount: 2000 },
        ]) // flow trend
        .mockResolvedValueOnce([{ industry: '银行', stock_count: 42, pe_ttm_median: 6.5, pb_median: 0.6, pe_pctl_1y: 15, pb_pctl_1y: 20, pe_pctl_3y: 10, pb_pctl_3y: 18 }]) // valuation
        .mockResolvedValueOnce([
          { ts_code: '601398.SH', name: '工商银行', pct_chg: 1.5, pe_ttm: 5.2, pb: 0.5, total_mv: 1_800_000 },
        ]) // top stocks
      const svc = createService({ prisma })

      const result = await svc.getDetail({ industry: '银行', days: 5 })

      expect(result.tsCode).toBe('BK0475')
      expect(result.returnTrend).toHaveLength(2)
      expect(result.flowTrend).toHaveLength(2)
      expect(result.topStocks).toHaveLength(1)
      expect(result.topStocks[0].tsCode).toBe('601398.SH')
    })

    it('tsCode 参数直接使用，跳过名称解析', async () => {
      const prisma = buildPrismaMock()
      prisma.$queryRawUnsafe
        .mockResolvedValueOnce([{ name: '银行' }]) // name lookup by tsCode
        .mockResolvedValueOnce([
          { trade_date: new Date('2024-06-28'), close: 102, pct_change: 2 },
        ]) // return trend
        .mockResolvedValueOnce([
          { trade_date: new Date('2024-06-28'), net_amount: 6000, buy_elg_amount: 4000, buy_lg_amount: 2000 },
        ]) // flow trend
        .mockResolvedValueOnce([{ industry: '银行', stock_count: 42, pe_ttm_median: 6.5, pb_median: 0.6, pe_pctl_1y: 15, pb_pctl_1y: 20, pe_pctl_3y: 10, pb_pctl_3y: 18 }]) // valuation
        .mockResolvedValueOnce([
          { ts_code: '601398.SH', name: '工商银行', pct_chg: 1.5, pe_ttm: 5.2, pb: 0.5, total_mv: 1_800_000 },
        ]) // top stocks
      const svc = createService({ prisma })

      const result = await svc.getDetail({ tsCode: 'BK0475.DC', days: 5 })

      expect(result.tsCode).toBe('BK0475.DC')
      expect(result.industry).toBe('银行')
      expect(result.returnTrend).toHaveLength(1)
    })
  })

  // ── getHeatmap ─────────────────────────────────────────────────────────────

  describe('getHeatmap', () => {
    it('返回热力图矩阵', async () => {
      const prisma = buildPrismaMock()
      prisma.$queryRawUnsafe.mockResolvedValue([
        {
          ts_code: 'BK0001',
          name: '银行',
          latest_close: 100,
          latest_pct_change: 1,
          return_1: 1,
          return_5: 3,
          return_10: 5,
          return_20: 8,
          return_60: 15,
        },
      ])
      const svc = createService({ prisma })

      const result = await svc.getHeatmap({ trade_date: '20240628' })

      expect(result.periods).toEqual([1, 5, 10, 20, 60])
      expect(result.industries).toHaveLength(1)
      expect(result.industries[0].returns[1]).toBe(1)
      expect(result.industries[0].returns[60]).toBe(15)
    })
  })
})
