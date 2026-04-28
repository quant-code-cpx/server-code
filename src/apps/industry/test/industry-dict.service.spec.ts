/**
 * IndustryDictService — 单元测试
 *
 * 覆盖要点：
 * 1. 31 个申万 L1 全部精确匹配时，coverage.matched = 31，matchRate = 1
 * 2. 某个申万行业找不到东财板块时，返回 dcTsCode = null，matchType = 'none'
 * 3. includeUnmatched=false 时，过滤 matchType = 'none' 的项
 * 4. dcBoardCode 正确去掉 .DC 后缀
 * 5. coverage.matchRate 小数计算正确（matched / total）
 * 6. 上市股票覆盖率统计使用 is_new = 'Y' 条件
 */
import { IndustryDictService } from '../industry-dict.service'

// ── Mock 工厂 ─────────────────────────────────────────────────────────────────

function buildPrismaMock() {
  return {
    $queryRawUnsafe: jest.fn(),
  }
}

function buildCacheMock() {
  return {
    buildKey: jest.fn((_prefix: string, obj: Record<string, unknown>) => JSON.stringify(obj)),
    rememberJson: jest.fn(
      async ({ loader }: { loader: () => Promise<unknown> }) => loader(),
    ),
  }
}

// ── 测试数据 ──────────────────────────────────────────────────────────────────

const swL1Rows = [
  { index_code: '801120.SI', industry_name: '食品饮料', src: 'SW2021' },
  { index_code: '801780.SI', industry_name: '银行', src: 'SW2021' },
  { index_code: '801050.SI', industry_name: '有色金属', src: 'SW2021' },
]

const dcRows = [
  { ts_code: 'BK0438.DC', board_code: 'BK0438', name: '食品饮料', trade_date: new Date('2026-04-27') },
  { ts_code: 'BK1283.DC', board_code: 'BK1283', name: '银行', trade_date: new Date('2026-04-27') },
  // 有色金属故意不匹配
]

const stockCountRows = [{ total: 5510n, mapped: 5491n }]

// ── 测试套件 ──────────────────────────────────────────────────────────────────

describe('IndustryDictService', () => {
  let service: IndustryDictService
  let mockPrisma: ReturnType<typeof buildPrismaMock>
  let mockCache: ReturnType<typeof buildCacheMock>

  beforeEach(() => {
    mockPrisma = buildPrismaMock()
    mockCache = buildCacheMock()
    service = new IndustryDictService(mockPrisma as any, mockCache as any)
  })

  /** 设置默认的三阶段 $queryRawUnsafe 返回值 */
  function setupDefaultMocks(opts?: { swRows?: typeof swL1Rows; dcRows?: typeof dcRows }) {
    const sw = opts?.swRows ?? swL1Rows
    const dc = opts?.dcRows ?? dcRows
    mockPrisma.$queryRawUnsafe
      .mockResolvedValueOnce(sw)        // 申万 L1
      .mockResolvedValueOnce(dc)        // 东财行业板块
      .mockResolvedValueOnce(stockCountRows) // 股票覆盖率
  }

  // ── 基本匹配 ─────────────────────────────────────────────────────────────

  it('31/31 全部精确匹配时 coverage.matched = 31, matchRate = 1', async () => {
    // 构造 31 个申万 L1，每个都有对应东财板块
    const sw = Array.from({ length: 31 }, (_, i) => ({
      index_code: `8${String(i).padStart(5, '0')}.SI`,
      industry_name: `行业${i}`,
      src: 'SW2021',
    }))
    const dc = sw.map((s) => ({
      ts_code: `BK${String(sw.indexOf(s)).padStart(4, '0')}.DC`,
      board_code: `BK${String(sw.indexOf(s)).padStart(4, '0')}`,
      name: s.industry_name,
      trade_date: new Date('2026-04-27'),
    }))

    setupDefaultMocks({ swRows: sw, dcRows: dc })

    const result = await service.getDictMapping({})

    expect(result.coverage.total).toBe(31)
    expect(result.coverage.matched).toBe(31)
    expect(result.coverage.unmatched).toBe(0)
    expect(result.coverage.matchRate).toBe(1)
    expect(result.items.every((item) => item.matchType === 'exact')).toBe(true)
  })

  it('某个申万行业找不到东财板块 → dcTsCode = null, matchType = none', async () => {
    setupDefaultMocks()

    const result = await service.getDictMapping({})

    const unmatchedItem = result.items.find((item) => item.swName === '有色金属')
    expect(unmatchedItem).toBeDefined()
    expect(unmatchedItem!.dcTsCode).toBeNull()
    expect(unmatchedItem!.dcBoardCode).toBeNull()
    expect(unmatchedItem!.dcName).toBeNull()
    expect(unmatchedItem!.matchType).toBe('none')
    expect(unmatchedItem!.confidence).toBe(0)
  })

  it('includeUnmatched=false 时过滤 matchType=none 的项', async () => {
    setupDefaultMocks()

    const result = await service.getDictMapping({ includeUnmatched: false })

    // 只返回匹配的 2 个（食品饮料、银行），有色金属被过滤
    expect(result.items).toHaveLength(2)
    expect(result.items.every((item) => item.matchType === 'exact')).toBe(true)
    // coverage 仍然反映真实匹配情况
    expect(result.coverage.total).toBe(3)
    expect(result.coverage.matched).toBe(2)
    expect(result.coverage.unmatched).toBe(1)
  })

  // ── dcBoardCode 去后缀 ───────────────────────────────────────────────────

  it('dcBoardCode 正确去掉 .DC 后缀', async () => {
    setupDefaultMocks()

    const result = await service.getDictMapping({})

    const foodItem = result.items.find((item) => item.swName === '食品饮料')
    expect(foodItem!.dcTsCode).toBe('BK0438.DC')
    expect(foodItem!.dcBoardCode).toBe('BK0438')

    const bankItem = result.items.find((item) => item.swName === '银行')
    expect(bankItem!.dcTsCode).toBe('BK1283.DC')
    expect(bankItem!.dcBoardCode).toBe('BK1283')
  })

  // ── matchRate 小数精度 ───────────────────────────────────────────────────

  it('coverage.matchRate 小数计算正确（2/3 ≈ 0.6667）', async () => {
    setupDefaultMocks()

    const result = await service.getDictMapping({})

    // 2 matched / 3 total = 0.6666... → 四位小数 0.6667
    expect(result.coverage.matchRate).toBeCloseTo(2 / 3, 4)
  })

  // ── 上市股票覆盖率 ───────────────────────────────────────────────────────

  it('上市股票覆盖率统计正确', async () => {
    setupDefaultMocks()

    const result = await service.getDictMapping({})

    expect(result.coverage.listedStockCount).toBe(5510)
    expect(result.coverage.listedStockMappedCount).toBe(5491)
    // 5491 / 5510 = 0.99655... → 四位小数 0.9966
    expect(result.coverage.listedStockMappedRate).toBeCloseTo(5491 / 5510, 4)
  })

  // ── 元数据字段 ───────────────────────────────────────────────────────────

  it('返回正确的 source / target / version / tradeDate', async () => {
    setupDefaultMocks()

    const result = await service.getDictMapping({})

    expect(result.source).toBe('sw_l1')
    expect(result.target).toBe('dc_industry')
    expect(result.version).toBe('SW2021')
    expect(result.tradeDate).toBe('20260427')
  })

  it('无数据时返回空 items 和零覆盖率', async () => {
    mockPrisma.$queryRawUnsafe
      .mockResolvedValueOnce([])   // 空申万
      .mockResolvedValueOnce([])   // 空东财
      .mockResolvedValueOnce([{ total: 0n, mapped: 0n }])

    const result = await service.getDictMapping({})

    expect(result.items).toHaveLength(0)
    expect(result.coverage.total).toBe(0)
    expect(result.coverage.matched).toBe(0)
    expect(result.coverage.matchRate).toBe(0)
    expect(result.version).toBeNull()
    expect(result.tradeDate).toBeNull()
  })

  // ── 东财同名板块去重 ─────────────────────────────────────────────────────

  it('东财同名板块只取第一个（去重）', async () => {
    const dcWithDuplicates = [
      { ts_code: 'BK0438.DC', board_code: 'BK0438', name: '食品饮料', trade_date: new Date('2026-04-27') },
      { ts_code: 'BK9999.DC', board_code: 'BK9999', name: '食品饮料', trade_date: new Date('2026-04-27') },
      { ts_code: 'BK1283.DC', board_code: 'BK1283', name: '银行', trade_date: new Date('2026-04-27') },
    ]
    mockPrisma.$queryRawUnsafe
      .mockResolvedValueOnce(swL1Rows)
      .mockResolvedValueOnce(dcWithDuplicates)
      .mockResolvedValueOnce(stockCountRows)

    const result = await service.getDictMapping({})

    const foodItem = result.items.find((item) => item.swName === '食品饮料')
    // 应该取第一个 BK0438.DC，不是 BK9999.DC
    expect(foodItem!.dcTsCode).toBe('BK0438.DC')
  })

  // ── 缓存行为 ─────────────────────────────────────────────────────────────

  it('缓存 key 包含 source 和 target 参数', async () => {
    setupDefaultMocks()

    await service.getDictMapping({ source: 'sw_l1', target: 'dc_industry' })

    expect(mockCache.buildKey).toHaveBeenCalledWith('industry:dict-mapping', {
      source: 'sw_l1',
      target: 'dc_industry',
    })
    expect(mockCache.rememberJson).toHaveBeenCalledWith(
      expect.objectContaining({
        namespace: 'industry',
        ttlSeconds: 24 * 3600,
      }),
    )
  })
})
