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
    valuationDailyMedian: { findFirst: jest.fn(async () => null) },
    indexDaily: {
      findMany: jest.fn(async () => []),
      findFirst: jest.fn(async () => null),
    },
    moneyflowHsgt: {
      findMany: jest.fn(async () => []),
      findFirst: jest.fn(async () => null),
    },
    moneyflow: {
      findFirst: jest.fn(async () => null),
      aggregate: jest.fn(async () => ({
        _sum: {
          buyElgAmount: null,
          sellElgAmount: null,
          buyLgAmount: null,
          sellLgAmount: null,
          buyMdAmount: null,
          sellMdAmount: null,
          buySmAmount: null,
          sellSmAmount: null,
          netMfAmount: null,
        },
      })),
    },
  }
}

function buildCacheMock() {
  return {
    rememberJson: jest.fn(({ loader }: { loader: () => Promise<unknown>; skipCacheIf?: (value: unknown) => boolean }) =>
      loader(),
    ),
  }
}

function readSqlText(sqlArg: unknown): string {
  const sql = sqlArg as { sql?: string; strings?: string[] }
  return sql.sql ?? sql.strings?.join('') ?? String(sqlArg)
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
    it('指定 trade_date → 汇总 moneyflow 并返回大盘资金结构', async () => {
      mockPrisma.moneyflow.aggregate.mockResolvedValueOnce({
        _sum: {
          buyElgAmount: 10,
          sellElgAmount: 3,
          buyLgAmount: 5,
          sellLgAmount: 2,
          buyMdAmount: 4,
          sellMdAmount: 6,
          buySmAmount: 1,
          sellSmAmount: 2,
          netMfAmount: 7,
        },
      })

      const result = await service.getMarketMoneyFlow({ trade_date: '20240102' })

      expect(result).toMatchObject({ netMfAmount: 70000, totalAmount: 200000 })
      expect(mockPrisma.moneyflow.aggregate).toHaveBeenCalledTimes(1)
    })

    it('无 trade_date 且数据库无数据 → 返回空数组', async () => {
      mockPrisma.moneyflow.findFirst.mockResolvedValueOnce(null) // resolveLatestStockFlowTradeDate → null

      const result = await service.getMarketMoneyFlow({})

      expect(result).toEqual([])
      expect(mockPrisma.moneyflow.aggregate).not.toHaveBeenCalled()
    })

    it('有最新交易日 → 调用 aggregate 汇总该日数据', async () => {
      const tradeDate = new Date('2024-01-02')
      mockPrisma.moneyflow.findFirst.mockResolvedValueOnce({ tradeDate })

      const result = await service.getMarketMoneyFlow({})

      expect(result).toHaveProperty('tradeDate')
      expect(mockPrisma.moneyflow.aggregate).toHaveBeenCalledTimes(1)
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
    it('指定 trade_date → 返回指数行情列表（含基期/基点）', async () => {
      const mockRows = [{ tsCode: '000300.SH', tradeDate: new Date('2024-01-02'), close: 3500 }]
      mockPrisma.indexDaily.findMany.mockResolvedValueOnce(mockRows)

      const result = await service.getIndexQuote({ trade_date: '20240102' })

      expect(result).toHaveLength(1)
      expect(result[0].tsCode).toBe('000300.SH')
      expect(result[0].close).toBe(3500)
      expect(result[0].baseDate).toBe('20041231')
      expect(result[0].basePoint).toBe(1000)
      expect(mockPrisma.indexDaily.findMany).toHaveBeenCalledTimes(1)
    })

    it('无 trade_date 且数据库无数据 → 返回空数组', async () => {
      mockPrisma.indexDaily.findFirst.mockResolvedValueOnce(null) // resolveLatestIndexTradeDate → null

      const result = await service.getIndexQuote({})

      expect(result).toEqual([])
    })
  })

  // ── getIndexTrend() ───────────────────────────────────────────────────────

  describe('getIndexTrend()', () => {
    it('新指数尚未回补时不缓存空走势，后续同步完成可立即读到数据', async () => {
      const latestTradeDate = new Date('2026-07-10T00:00:00.000Z')
      mockPrisma.indexDaily.findFirst.mockResolvedValueOnce({ tradeDate: latestTradeDate })
      mockPrisma.indexDaily.findMany.mockResolvedValueOnce([])

      const result = await service.getIndexTrend({ ts_code: '000680.SH', period: '1m' })
      const cacheOptions = mockCache.rememberJson.mock.calls[0][0]

      expect(result).toMatchObject({ tsCode: '000680.SH', name: '科创综指', data: [] })
      expect(cacheOptions.skipCacheIf?.(result)).toBe(true)
    })

    it('已有走势数据时保留缓存', async () => {
      const latestTradeDate = new Date('2026-07-10T00:00:00.000Z')
      mockPrisma.indexDaily.findFirst.mockResolvedValueOnce({ tradeDate: latestTradeDate })
      mockPrisma.indexDaily.findMany.mockResolvedValueOnce([
        {
          tradeDate: latestTradeDate,
          close: 2348.7458,
          pctChg: -4.499,
          vol: 79504717,
          amount: 603444791.407,
        },
      ])

      const result = await service.getIndexTrend({ ts_code: '000680.SH', period: '1m' })
      const cacheOptions = mockCache.rememberJson.mock.calls[0][0]

      expect(result.data).toHaveLength(1)
      expect(cacheOptions.skipCacheIf?.(result)).toBe(false)
    })
  })

  // ── getMainFlowRanking() ─────────────────────────────────────────────────

  describe('getMainFlowRanking()', () => {
    it('默认按主力净流入排行 → 先在资金表 Top-N，再关联个股资料', async () => {
      mockPrisma.$queryRaw.mockResolvedValueOnce([
        {
          ts_code: '000001.SZ',
          name: '平安银行',
          industry: '银行',
          main_net_inflow: 30,
          elg_net_inflow: 20,
          lg_net_inflow: 10,
          md_net_inflow: -5,
          sm_net_inflow: -25,
          pct_chg: 1.5,
          amount: 1000,
        },
      ])

      const result = await service.getMainFlowRanking({ trade_date: '20240102', limit: 20 })

      expect(result).toEqual({
        tradeDate: new Date('2024-01-02T00:00:00.000Z'),
        data: [
          {
            tsCode: '000001.SZ',
            name: '平安银行',
            industry: '银行',
            mainNetInflow: 30,
            elgNetInflow: 20,
            lgNetInflow: 10,
            mdNetInflow: -5,
            smNetInflow: -25,
            pctChg: 1.5,
            amount: 1000,
          },
        ],
      })
      const sql = readSqlText((mockPrisma.$queryRaw.mock.calls[0] as unknown[])[0])
      expect(sql).toContain('WITH ranked_flow AS MATERIALIZED')
      expect(sql).toContain('FROM stock_capital_flows mf')
      expect(sql).toContain('LIMIT')
      expect(sql).toContain('LEFT JOIN stock_daily_prices d')
      expect(sql.indexOf('LIMIT')).toBeLessThan(sql.indexOf('LEFT JOIN stock_daily_prices d'))
    })

    it('按 pct_chg 排序 → CTE 内先关联日线并截断，避免全量股票资料 join', async () => {
      mockPrisma.$queryRaw.mockResolvedValueOnce([])

      await service.getMainFlowRanking({ trade_date: '20240102', sort_by: 'pct_chg', order: 'asc', limit: 10 })

      const sql = readSqlText((mockPrisma.$queryRaw.mock.calls[0] as unknown[])[0])
      expect(sql).toContain('WITH ranked_flow AS MATERIALIZED')
      expect(sql).toContain('ORDER BY d.pct_chg')
      expect(sql.indexOf('LIMIT')).toBeLessThan(sql.indexOf('JOIN stock_basic_profiles sb'))
    })

    it('dual=true → 生成流入/流出两条 Top-N 查询', async () => {
      mockPrisma.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([])

      const result = await service.getMainFlowRanking({ trade_date: '20240102', dual: true, limit: 5 })

      expect(result).toEqual({ tradeDate: new Date('2024-01-02T00:00:00.000Z'), topInflow: [], topOutflow: [] })
      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(2)
      expect(readSqlText((mockPrisma.$queryRaw.mock.calls[0] as unknown[])[0])).toContain('DESC')
      expect(readSqlText((mockPrisma.$queryRaw.mock.calls[1] as unknown[])[0])).toContain('ASC')
    })
  })

  // ── computeValuationPercentile() [private] ─────────────────────────────────

  describe('computeValuationPercentile() [private, via (svc as any)]', () => {
    it('getMarketValuation() 使用 valuation_daily_medians 预计算表，避免实时扫描原始估值表', async () => {
      const prisma = buildPrismaMock()
      const cache = buildCacheMock()
      const svc = new MarketService(prisma as any, cache as any)

      prisma.valuationDailyMedian.findFirst.mockResolvedValueOnce({ tradeDate: new Date('2024-01-05T00:00:00.000Z') })
      prisma.$queryRaw.mockResolvedValueOnce([
        { trade_date: new Date('2023-01-05T00:00:00.000Z'), pe_ttm_median: 10, pb_median: 1 },
        { trade_date: new Date('2023-07-05T00:00:00.000Z'), pe_ttm_median: 20, pb_median: 2 },
        { trade_date: new Date('2024-01-05T00:00:00.000Z'), pe_ttm_median: 30, pb_median: 3 },
      ])

      const result = await svc.getMarketValuation({})

      expect(result.peTtmMedian).toBe(30)
      expect(result.pbMedian).toBe(3)
      const sql = String((prisma.$queryRaw.mock.calls[0] as unknown[])[0])
      expect(sql).toContain('valuation_daily_medians')
      expect(sql).toContain("scope = '__ALL__'")
      expect(sql).not.toContain('stock_daily_valuation_metrics')
    })

    it('getMoneyFlowTrend() 先限定最近交易日再聚合，避免对全历史 groupBy', async () => {
      const prisma = buildPrismaMock()
      const cache = buildCacheMock()
      const svc = new MarketService(prisma as any, cache as any)

      prisma.moneyflow.findFirst.mockResolvedValueOnce({ tradeDate: new Date('2024-01-05T00:00:00.000Z') })
      prisma.$queryRaw.mockResolvedValueOnce([
        {
          trade_date: new Date('2024-01-05T00:00:00.000Z'),
          net_mf_amount: 2,
          buy_elg_amount: 5,
          sell_elg_amount: 1,
          buy_lg_amount: 4,
          sell_lg_amount: 2,
          buy_md_amount: 3,
          sell_md_amount: 1,
          buy_sm_amount: 2,
          sell_sm_amount: 1,
        },
      ])

      const result = await svc.getMoneyFlowTrend({ days: 5 })

      expect(result.data[0].netAmount).toBe(20000)
      const sql = String((prisma.$queryRaw.mock.calls[0] as unknown[])[0])
      expect(sql).toContain('WITH RECURSIVE recent_dates')
      expect(sql).toContain('stock_capital_flows')
      expect(sql).not.toContain('GROUP BY "tradeDate"')
    })

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
