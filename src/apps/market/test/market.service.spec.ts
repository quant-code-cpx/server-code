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
})
