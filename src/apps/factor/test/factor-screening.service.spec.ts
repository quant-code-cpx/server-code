/**
 * FactorScreeningService — 单元测试
 *
 * 覆盖要点：
 * - screening(): 空条件 / 单因子筛选 / top_pct / bottom_pct / 多条件 AND / 排序 / 分页
 * - passesCondition(): gt / gte / lt / lte / condition.value 为空
 * - rankStocks(): desc 和 asc 排序
 */
import { FactorScreeningService } from '../services/factor-screening.service'
import { FactorScreeningDto } from '../dto/factor-screening.dto'

// ── Mock 工厂 ─────────────────────────────────────────────────────────────────

function buildPrismaMock() {
  return {
    stockBasic: { findMany: jest.fn(async () => []) },
  }
}

function buildComputeMock() {
  return { getRawFactorValuesForDate: jest.fn(async () => []) }
}

function buildRedisMock() {
  return { get: jest.fn(), set: jest.fn() }
}

// ── 辅助数据 ──────────────────────────────────────────────────────────────────

const THREE_STOCKS = [
  { tsCode: '000001.SZ', factorValue: 10 },
  { tsCode: '000002.SZ', factorValue: 5 },
  { tsCode: '000003.SZ', factorValue: 1 },
]

function buildDto(overrides: Partial<FactorScreeningDto> = {}): FactorScreeningDto {
  return {
    conditions: [],
    tradeDate: '20240101',
    ...overrides,
  }
}

// ── 测试套件 ──────────────────────────────────────────────────────────────────

describe('FactorScreeningService', () => {
  let service: FactorScreeningService
  let mockPrisma: ReturnType<typeof buildPrismaMock>
  let mockCompute: ReturnType<typeof buildComputeMock>
  let mockRedis: ReturnType<typeof buildRedisMock>

  beforeEach(() => {
    mockPrisma = buildPrismaMock()
    mockCompute = buildComputeMock()
    mockRedis = buildRedisMock()
    service = new FactorScreeningService(mockPrisma as any, mockCompute as any, mockRedis as any)
  })

  // ── screening() ──────────────────────────────────────────────────────────

  describe('screening()', () => {
    it('空条件列表 → 返回 emptyResult', async () => {
      const result = await service.screening(buildDto({ conditions: [] }))

      expect(result.total).toBe(0)
      expect(result.items).toHaveLength(0)
      expect(result.conditionCount).toBe(0)
    })

    it('单因子 gt 条件 → 仅保留因子值大于阈值的股票', async () => {
      mockCompute.getRawFactorValuesForDate.mockResolvedValueOnce(THREE_STOCKS)

      const result = await service.screening(
        buildDto({ conditions: [{ factorName: 'pe', operator: 'gt', value: 5 }] }),
      )

      expect(result.total).toBe(1)
      expect(result.items[0].tsCode).toBe('000001.SZ')
    })

    it('top_pct 条件 → 保留因子值最高的前 N% 股票', async () => {
      mockCompute.getRawFactorValuesForDate.mockResolvedValueOnce(THREE_STOCKS)

      const result = await service.screening(
        buildDto({ conditions: [{ factorName: 'pe', operator: 'top_pct', percent: 33 }] }),
      )

      expect(result.total).toBe(1)
      expect(result.items[0].tsCode).toBe('000001.SZ') // 最高值
    })

    it('bottom_pct 条件 → 保留因子值最低的前 N% 股票', async () => {
      mockCompute.getRawFactorValuesForDate.mockResolvedValueOnce(THREE_STOCKS)

      const result = await service.screening(
        buildDto({ conditions: [{ factorName: 'pe', operator: 'bottom_pct', percent: 33 }] }),
      )

      expect(result.total).toBe(1)
      expect(result.items[0].tsCode).toBe('000003.SZ') // 最低值
    })

    it('多条件 AND 逻辑 → 仅保留同时满足两个条件的股票', async () => {
      mockCompute.getRawFactorValuesForDate
        .mockResolvedValueOnce(THREE_STOCKS) // pe 因子
        .mockResolvedValueOnce([
          // pb 因子
          { tsCode: '000001.SZ', factorValue: 3 },
          { tsCode: '000002.SZ', factorValue: 7 },
          { tsCode: '000003.SZ', factorValue: 9 },
        ])

      const result = await service.screening(
        buildDto({
          conditions: [
            { factorName: 'pe', operator: 'gt', value: 5 }, // 000001.SZ (10 > 5)
            { factorName: 'pb', operator: 'lt', value: 8 }, // 000001.SZ (3 < 8), 000002.SZ (7 < 8)
          ],
        }),
      )

      // AND 交集：仅 000001.SZ
      expect(result.total).toBe(1)
      expect(result.items[0].tsCode).toBe('000001.SZ')
    })

    it('sortBy + sortOrder desc → 结果按因子值从大到小排序', async () => {
      mockCompute.getRawFactorValuesForDate.mockResolvedValue(THREE_STOCKS) // pe 因子（条件和排序共用）

      const result = await service.screening(
        buildDto({
          conditions: [{ factorName: 'pe', operator: 'gt', value: 0 }], // 全部通过
          sortBy: 'pe',
          sortOrder: 'desc',
        }),
      )

      expect(result.items.map((i) => i.tsCode)).toEqual(['000001.SZ', '000002.SZ', '000003.SZ'])
    })

    it('分页 → 返回正确的 page/pageSize 切片', async () => {
      mockCompute.getRawFactorValuesForDate.mockResolvedValue(THREE_STOCKS)

      const result = await service.screening(
        buildDto({
          conditions: [{ factorName: 'pe', operator: 'gt', value: 0 }],
          page: 2,
          pageSize: 2,
        }),
      )

      expect(result.total).toBe(3)
      expect(result.items).toHaveLength(1) // 第 2 页只有 1 条
      expect(result.page).toBe(2)
      expect(result.pageSize).toBe(2)
    })
  })

  // ── passesCondition() ────────────────────────────────────────────────────

  describe('passesCondition() 私有方法', () => {
    it('gt: 10 > 5 → true', () => {
      expect((service as any).passesCondition(10, { operator: 'gt', value: 5 })).toBe(true)
    })

    it('gt: 5 > 5 → false（不包含等号）', () => {
      expect((service as any).passesCondition(5, { operator: 'gt', value: 5 })).toBe(false)
    })

    it('lt: 1 < 5 → true', () => {
      expect((service as any).passesCondition(1, { operator: 'lt', value: 5 })).toBe(true)
    })

    it('gte: 5 >= 5 → true', () => {
      expect((service as any).passesCondition(5, { operator: 'gte', value: 5 })).toBe(true)
    })

    it('lte: 5 <= 5 → true', () => {
      expect((service as any).passesCondition(5, { operator: 'lte', value: 5 })).toBe(true)
    })

    it('gt 且 condition.value 为 undefined → false', () => {
      expect((service as any).passesCondition(10, { operator: 'gt', value: undefined })).toBe(false)
    })
  })

  // ── rankStocks() ─────────────────────────────────────────────────────────

  describe('rankStocks() 私有方法', () => {
    it('desc 排序 → 因子值从大到小', () => {
      const fMap = new Map([
        ['A', 10],
        ['B', 1],
        ['C', 5],
      ])
      const result: Array<{ tsCode: string; val: number }> = (service as any).rankStocks(fMap, 'desc')
      expect(result.map((r) => r.tsCode)).toEqual(['A', 'C', 'B'])
    })

    it('asc 排序 → 因子值从小到大', () => {
      const fMap = new Map([
        ['A', 10],
        ['B', 1],
        ['C', 5],
      ])
      const result: Array<{ tsCode: string; val: number }> = (service as any).rankStocks(fMap, 'asc')
      expect(result.map((r) => r.tsCode)).toEqual(['B', 'C', 'A'])
    })

    it('null 值股票被排除在外', () => {
      const fMap = new Map<string, number | null>([
        ['A', 10],
        ['B', null],
        ['C', 5],
      ])
      const result: Array<{ tsCode: string; val: number }> = (service as any).rankStocks(fMap, 'desc')
      expect(result.map((r) => r.tsCode)).toEqual(['A', 'C'])
    })
  })
})
