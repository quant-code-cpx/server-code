/**
 * StockListService — 单元测试
 *
 * 覆盖要点：
 * - findAll(): 基本分页返回结构
 * - requiresMetricJoin（通过 findAll 行为验证）：
 *   - minPeTtm / maxPeTtm / minTotalMv / maxTotalMv 等 metric 条件存在时，
 *     count 查询使用含 JOIN 的 SQL（$queryRaw 调用两次，count 位置参数 >= 1）
 *   - 无 metric 条件时，count 走简单路径（$queryRaw 调用两次，两次调用均被触发）
 *   - conceptCodes 条件存在时即使无 metric 也走 JOIN 路径
 * - findAll(): keyword 搜索、industries 数组过滤返回正确 items
 */

import { StockListService } from '../stock-list.service'
import { PrismaService } from 'src/shared/prisma.service'
import { CacheService } from 'src/shared/cache.service'
import { StockListQueryDto, StockSortBy } from '../dto/stock-list-query.dto'

// ── mock 工厂 ──────────────────────────────────────────────────────────────────

function buildPrismaMock() {
  return {
    $queryRaw: jest.fn(),
  }
}

function buildCacheServiceMock() {
  return {
    rememberJson: jest.fn(async (opts: { loader: () => Promise<unknown> }) => opts.loader()),
    buildKey: jest.fn((_prefix: string, params: unknown) => JSON.stringify(params)),
  }
}

function createService(prisma = buildPrismaMock(), cache = buildCacheServiceMock()): StockListService {
  // @ts-ignore — 局部 mock，跳过完整 DI 类型检查
  return new StockListService(prisma as PrismaService, cache as CacheService)
}

const MOCK_ITEM = {
  tsCode: '000001.SZ',
  symbol: '000001',
  name: '平安银行',
  fullname: null,
  exchange: 'SZSE',
  currType: null,
  market: null,
  industry: '银行',
  area: '广东',
  listStatus: 'L',
  listDate: null,
  latestTradeDate: null,
  isHs: null,
  cnspell: null,
  peTtm: 6.5,
  pb: 0.7,
  dvTtm: null,
  totalMv: 120000,
  circMv: 100000,
  turnoverRate: 0.8,
  pctChg: 1.2,
  amount: 50000,
  close: 12.5,
  vol: 4000,
}

/** 设置 $queryRaw: 第一次返回 count，第二次返回 items */
function mockQueryRaw(prisma: ReturnType<typeof buildPrismaMock>, count = 1, items = [MOCK_ITEM]) {
  prisma.$queryRaw.mockResolvedValueOnce([{ count: BigInt(count) }]).mockResolvedValueOnce(items)
}

// ══════════════════════════════════════════════════════════════════════════════

describe('StockListService', () => {
  describe('findAll()', () => {
    it('无任何筛选条件时返回分页结构', async () => {
      const prisma = buildPrismaMock()
      const cache = buildCacheServiceMock()
      mockQueryRaw(prisma, 1, [MOCK_ITEM])
      const service = createService(prisma, cache)

      const result = await service.findAll({} as StockListQueryDto)

      expect(result).toMatchObject({ page: 1, pageSize: 20, total: 1 })
      expect(result.items).toHaveLength(1)
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(2)
    })

    it('有 minPeTtm 时 count 走含 metric JOIN 的路径（两次 $queryRaw）', async () => {
      const prisma = buildPrismaMock()
      const cache = buildCacheServiceMock()
      mockQueryRaw(prisma, 5, [MOCK_ITEM])
      const service = createService(prisma, cache)

      const query: Partial<StockListQueryDto> = { minPeTtm: 5 }
      const result = await service.findAll(query as StockListQueryDto)

      expect(result.total).toBe(5)
      // count 与 items 各一次
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(2)
      // 确认 count SQL（TemplateStringsArray）包含 LEFT JOIN LATERAL（含 metric JOIN 路径）
      const countStrings = prisma.$queryRaw.mock.calls[0][0] as string[]
      const countSql = Array.from(countStrings).join('')
      expect(countSql).toMatch(/LEFT JOIN LATERAL/)
    })

    it('有 maxPeTtm 时 count 同样走含 metric JOIN 的路径', async () => {
      const prisma = buildPrismaMock()
      const cache = buildCacheServiceMock()
      mockQueryRaw(prisma, 10, [])
      const service = createService(prisma, cache)

      await service.findAll({ maxPeTtm: 30 } as StockListQueryDto)

      const countStrings = prisma.$queryRaw.mock.calls[0][0] as string[]
      expect(Array.from(countStrings).join('')).toMatch(/LEFT JOIN LATERAL/)
    })

    it('有 minTotalMv 时 count 走含 metric JOIN 的路径', async () => {
      const prisma = buildPrismaMock()
      const cache = buildCacheServiceMock()
      mockQueryRaw(prisma, 20, [])
      const service = createService(prisma, cache)

      await service.findAll({ minTotalMv: 50000 } as StockListQueryDto)

      const countStrings = prisma.$queryRaw.mock.calls[0][0] as string[]
      expect(Array.from(countStrings).join('')).toMatch(/LEFT JOIN LATERAL/)
    })

    it('有 conceptCodes 时无论是否有 metric 条件都走含 JOIN 的路径', async () => {
      const prisma = buildPrismaMock()
      const cache = buildCacheServiceMock()
      mockQueryRaw(prisma, 3, [])
      const service = createService(prisma, cache)

      await service.findAll({ conceptCodes: ['885001.TI'] } as StockListQueryDto)

      // conceptJoinSql 是嵌套 Prisma.Sql，作为 template 参数传入，出现在 mock.calls[0][1] 的 strings 里
      const conceptSqlArg = prisma.$queryRaw.mock.calls[0][1] as { strings?: string[] } | undefined
      const conceptSqlText = conceptSqlArg?.strings ? Array.from(conceptSqlArg.strings).join('') : ''
      expect(conceptSqlText).toMatch(/ths_index_members/)
    })

    it('无 metric 且无 concept 条件时 count 走简单路径（不含 LEFT JOIN LATERAL）', async () => {
      const prisma = buildPrismaMock()
      const cache = buildCacheServiceMock()
      mockQueryRaw(prisma, 100, [])
      const service = createService(prisma, cache)

      await service.findAll({ keyword: '银行' } as StockListQueryDto)

      const countStrings = prisma.$queryRaw.mock.calls[0][0] as string[]
      expect(Array.from(countStrings).join('')).not.toMatch(/LEFT JOIN LATERAL/)
    })

    it('industries 数组过滤时走简单 count 路径（无 metric）', async () => {
      const prisma = buildPrismaMock()
      const cache = buildCacheServiceMock()
      mockQueryRaw(prisma, 50, [])
      const service = createService(prisma, cache)

      await service.findAll({ industries: ['银行', '保险'] } as StockListQueryDto)

      const countStrings = prisma.$queryRaw.mock.calls[0][0] as string[]
      expect(Array.from(countStrings).join('')).not.toMatch(/LEFT JOIN LATERAL/)
    })

    it('同时有 minPeTtm 和 conceptCodes 时，count 走含所有 JOIN 的路径', async () => {
      const prisma = buildPrismaMock()
      const cache = buildCacheServiceMock()
      mockQueryRaw(prisma, 2, [])
      const service = createService(prisma, cache)

      await service.findAll({
        minPeTtm: 5,
        conceptCodes: ['885001.TI'],
      } as StockListQueryDto)

      // count SQL 字符串包含 LEFT JOIN LATERAL（metric join）
      const countStrings = prisma.$queryRaw.mock.calls[0][0] as string[]
      expect(Array.from(countStrings).join('')).toMatch(/LEFT JOIN LATERAL/)
      // conceptJoinSql 嵌套在 mock.calls[0][1] 的 strings 里
      const conceptSqlArg = prisma.$queryRaw.mock.calls[0][1] as { strings?: string[] } | undefined
      const conceptSqlText = conceptSqlArg?.strings ? Array.from(conceptSqlArg.strings).join('') : ''
      expect(conceptSqlText).toMatch(/ths_index_members/)
    })

    it('sortBy=PE_TTM 但无 metric 过滤条件时，count 仍走简单路径', async () => {
      const prisma = buildPrismaMock()
      const cache = buildCacheServiceMock()
      mockQueryRaw(prisma, 30, [])
      const service = createService(prisma, cache)

      await service.findAll({ sortBy: StockSortBy.PE_TTM } as StockListQueryDto)

      const countStrings = prisma.$queryRaw.mock.calls[0][0] as string[]
      // 排序不影响 count，count 走简单路径
      expect(Array.from(countStrings).join('')).not.toMatch(/LEFT JOIN LATERAL/)
    })
  })
})
