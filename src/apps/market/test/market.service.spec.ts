/**
 * MarketService — 单元测试
 *
 * 覆盖要点：
 * - getMarketMoneyFlow(): 带 trade_date / 无数据返回 []
 * - getSectorFlow(): 带 trade_date / 无数据返回空结构
 * - getMarketSentiment(): 返回涨跌家数结构 / 无数据返回 null
 * - getIndexQuote(): 返回指数行情列表
 */
import { MarketService } from '../market.service'

// ── Mock 工厂 ─────────────────────────────────────────────────────────────────

function buildPrismaMock() {
  return {
    $queryRaw: jest.fn(async () => []),
    moneyflowMktDc: {
      findMany: jest.fn(async () => []),
      findFirst: jest.fn(async () => null),
    },
    moneyflowIndDc: {
      findMany: jest.fn(async () => []),
      findFirst: jest.fn(async () => null),
    },
    daily: {
      count: jest.fn(async () => 0),
      findFirst: jest.fn(async () => null),
    },
    dailyBasic: { findFirst: jest.fn(async () => null) },
    indexDaily: {
      findMany: jest.fn(async () => []),
      findFirst: jest.fn(async () => null),
    },
    moneyflowHsgt: {
      findMany: jest.fn(async () => []),
      findFirst: jest.fn(async () => null),
    },
    moneyflow: { findFirst: jest.fn(async () => null) },
  }
}

function buildCacheMock() {
  return {
    rememberJson: jest.fn(({ loader }: { loader: () => Promise<unknown> }) => loader()),
  }
}

// ── 测试套件 ──────────────────────────────────────────────────────────────────

describe('MarketService', () => {
  let service: MarketService
  let mockPrisma: ReturnType<typeof buildPrismaMock>
  let mockCache: ReturnType<typeof buildCacheMock>

  beforeEach(() => {
    mockPrisma = buildPrismaMock()
    mockCache = buildCacheMock()
    service = new MarketService(mockPrisma as any, mockCache as any)
  })

  // ── getMarketMoneyFlow() ──────────────────────────────────────────────────

  describe('getMarketMoneyFlow()', () => {
    it('指定 trade_date → 调用 moneyflowMktDc.findMany 并返回结果', async () => {
      const mockRows = [{ tradeDate: new Date('2024-01-02'), netMfAmount: 100 }]
      mockPrisma.moneyflowMktDc.findMany.mockResolvedValueOnce(mockRows)

      const result = await service.getMarketMoneyFlow({ trade_date: '20240102' })

      expect(result).toEqual(mockRows)
      expect(mockPrisma.moneyflowMktDc.findMany).toHaveBeenCalledTimes(1)
    })

    it('无 trade_date 且数据库无数据 → 返回空数组', async () => {
      mockPrisma.moneyflowMktDc.findFirst.mockResolvedValueOnce(null) // resolveLatestMarketTradeDate → null

      const result = await service.getMarketMoneyFlow({})

      expect(result).toEqual([])
      expect(mockPrisma.moneyflowMktDc.findMany).not.toHaveBeenCalled()
    })

    it('有最新交易日 → 调用 findMany 查询该日数据', async () => {
      const tradeDate = new Date('2024-01-02')
      mockPrisma.moneyflowMktDc.findFirst.mockResolvedValueOnce({ tradeDate })
      mockPrisma.moneyflowMktDc.findMany.mockResolvedValueOnce([{ tradeDate, netMfAmount: 200 }])

      const result = await service.getMarketMoneyFlow({})

      expect(Array.isArray(result)).toBe(true)
      expect(mockPrisma.moneyflowMktDc.findMany).toHaveBeenCalledTimes(1)
    })
  })

  // ── getSectorFlow() ───────────────────────────────────────────────────────

  describe('getSectorFlow()', () => {
    it('指定 trade_date → 返回包含 industry/concept/region 的结构', async () => {
      mockPrisma.moneyflowIndDc.findMany.mockResolvedValueOnce([
        { contentType: 'INDUSTRY', rank: 1, netAmount: 100, name: '电子' },
        { contentType: 'CONCEPT', rank: 1, netAmount: 50, name: '半导体' },
      ] as any)

      const result = await service.getSectorFlow({ trade_date: '20240102' })

      expect(result).toHaveProperty('industry')
      expect(result).toHaveProperty('concept')
      expect(result).toHaveProperty('region')
      expect(Array.isArray(result.industry)).toBe(true)
    })

    it('无 trade_date 且数据库无数据 → 返回空结构', async () => {
      mockPrisma.moneyflowIndDc.findFirst.mockResolvedValueOnce(null) // resolveLatestSectorTradeDate → null

      const result = await service.getSectorFlow({})

      expect(result.tradeDate).toBeNull()
      expect(result.industry).toHaveLength(0)
      expect(result.concept).toHaveLength(0)
      expect(result.region).toHaveLength(0)
    })
  })

  // ── getMarketSentiment() ──────────────────────────────────────────────────

  describe('getMarketSentiment()', () => {
    it('指定 trade_date → 返回涨跌家数结构', async () => {
      mockPrisma.daily.count
        .mockResolvedValueOnce(10) // bigRise
        .mockResolvedValueOnce(500) // rise
        .mockResolvedValueOnce(200) // flat
        .mockResolvedValueOnce(400) // fall
        .mockResolvedValueOnce(50) // bigFall

      const result = await service.getMarketSentiment({ trade_date: '20240102' })

      expect(result).not.toBeNull()
      expect(result!.bigRise).toBe(10)
      expect(result!.rise).toBe(500)
      expect(result!.flat).toBe(200)
      expect(result!.fall).toBe(400)
      expect(result!.bigFall).toBe(50)
      expect(result!.total).toBe(1160)
    })

    it('无 trade_date 且数据库无数据 → 返回 null', async () => {
      mockPrisma.daily.findFirst.mockResolvedValueOnce(null) // resolveLatestDailyTradeDate → null

      const result = await service.getMarketSentiment({})

      expect(result).toBeNull()
    })
  })

  // ── getIndexQuote() ───────────────────────────────────────────────────────

  describe('getIndexQuote()', () => {
    it('指定 trade_date → 返回指数行情列表', async () => {
      const mockRows = [{ tsCode: '000300.SH', tradeDate: new Date('2024-01-02'), close: 3500 }]
      mockPrisma.indexDaily.findMany.mockResolvedValueOnce(mockRows)

      const result = await service.getIndexQuote({ trade_date: '20240102' })

      expect(result).toEqual(mockRows)
      expect(mockPrisma.indexDaily.findMany).toHaveBeenCalledTimes(1)
    })

    it('无 trade_date 且数据库无数据 → 返回空数组', async () => {
      mockPrisma.indexDaily.findFirst.mockResolvedValueOnce(null) // resolveLatestIndexTradeDate → null

      const result = await service.getIndexQuote({})

      expect(result).toEqual([])
    })
  })

  // ── computeValuationPercentile() [private] ─────────────────────────────────

  describe('computeValuationPercentile() [private, via (svc as any)]', () => {
    /**
     * P3-B17: 百分位公式为 rank/total，其中 rank = count(v <= currentVal)。
     * 当当前值 = 历史最小值时，rank=1 而非 0，导致最低百分位为 1/n*100 而非 0。
     */
    it('[P3-B17] 当前值等于历史最小值 → 百分位非0（rank包含自身）', async () => {
      const prisma = buildPrismaMock()
      const cache = buildCacheMock()

      // 5个historical medians: [10, 20, 30, 40, 50]，当前=10（最小值）
      // rank = filter(v <= 10).length = 1
      // percentile = round(1/5 * 100) = 20（不是0）
      const medians = [
        { daily_median: '10' },
        { daily_median: '20' },
        { daily_median: '30' },
        { daily_median: '40' },
        { daily_median: '50' }, // 当前值（最后一个，ORDER BY trade_date）
      ]
      // Wait, currentVal = last element = '50' in medians order...
      // Actually current = dailyMedians[length-1] = 50, allVals sorted = [10,20,30,40,50]
      // rank = filter(v <= 50).length = 5 → percentile = 100%
      // To test minimum: current = '10' (first/last in sorted order)
      // Make current the smallest: medians in date order, last = smallest
      const mediansForMin = [
        { daily_median: '50' },
        { daily_median: '40' },
        { daily_median: '30' },
        { daily_median: '20' },
        { daily_median: '10' }, // 当前（最后一个 trade_date）= 10（历史最小）
      ]
      prisma.$queryRaw.mockResolvedValue(mediansForMin)
      const svc = new (require('../market.service').MarketService)(prisma as any, cache as any)

      const tradeDate = new Date('2024-01-15')
      const result = await (svc as any).computeValuationPercentile(tradeDate, 'pe_ttm')

      // [BUG P3-B17] currentVal=10 → rank=filter(v<=10).length=1 → percentile=round(1/5*100)=20
      // 正确应为 0%, 但实现返回 20%（最低值不能是上界百分之一）
      expect(result.oneYear).toBe(20)
    })

    it('当前值等于历史最大值 → 百分位=100', async () => {
      const prisma = buildPrismaMock()
      const cache = buildCacheMock()

      // medians in trade_date order, last = largest (current)
      const medians = [
        { daily_median: '10' },
        { daily_median: '20' },
        { daily_median: '30' },
        { daily_median: '40' },
        { daily_median: '50' }, // 当前值（最后）= 50（历史最大）
      ]
      prisma.$queryRaw.mockResolvedValue(medians)
      const svc = new (require('../market.service').MarketService)(prisma as any, cache as any)

      const tradeDate = new Date('2024-01-15')
      const result = await (svc as any).computeValuationPercentile(tradeDate, 'pe_ttm')

      expect(result.oneYear).toBe(100)
    })

    it('dailyMedians < 2 → 返回 null', async () => {
      const prisma = buildPrismaMock()
      const cache = buildCacheMock()

      prisma.$queryRaw.mockResolvedValue([{ daily_median: '25' }]) // 只有1条
      const svc = new (require('../market.service').MarketService)(prisma as any, cache as any)

      const tradeDate = new Date('2024-01-15')
      const result = await (svc as any).computeValuationPercentile(tradeDate, 'pe_ttm')

      expect(result.oneYear).toBeNull()
    })

    it('[P3-B16] Feb 29 平年退回: setFullYear 对闰年2月29日减1年 → 滚动到3月1日', () => {
      // 验证 JS setFullYear(year-1) 在 Feb 29 时的行为
      const date = new Date('2024-02-29') // 闰年
      const oneYearAgo = new Date(date)
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)

      // [BUG P3-B16] 2023 年无 Feb 29，JS 溢出为 March 1, 2023
      expect(oneYearAgo.getMonth()).toBe(2) // 2 = March（0-indexed）！不是 February
      expect(oneYearAgo.getDate()).toBe(1)
      expect(oneYearAgo.getFullYear()).toBe(2023)
      // 结果：窗口少了 1 天（从 3/1/2023 而非 2/28/2023）
    })
  })
})
