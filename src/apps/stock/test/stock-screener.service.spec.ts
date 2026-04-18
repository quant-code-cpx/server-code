/**
 * StockScreenerService — 单元测试
 *
 * 覆盖要点：
 * - screener(): $queryRaw 被调用；返回 { page, pageSize, total, items } 结构；
 *   items 字段经过数值类型转换（Number）；空结果时 items 为 []
 *   V2 新增：psTtm 字段、concepts 字段、概念/北向/布林带/均线筛选
 * - getScreenerPresets(): 返回内置预设列表，每项含 id/name/description/filters/type
 *   V2 新增预设：northbound / tech_breakout / oversold_rebound / low_ps_growth
 * - getScreenerConcepts(): 从缓存或 DB 获取概念板块列表
 * - getStrategies(userId): 从 prisma.screenerStrategy.findMany 获取数据并格式化
 * - createStrategy(): 达到上限 → BadRequestException；正常创建 → 返回序列化策略
 * - updateStrategy(): 不存在 → NotFoundException；正常更新 → 返回序列化策略
 * - deleteStrategy(): 不存在 → NotFoundException；正常删除 → 返回成功消息
 */

import { BadRequestException, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { StockScreenerService } from '../stock-screener.service'
import { PrismaService } from 'src/shared/prisma.service'
import { CacheService } from 'src/shared/cache.service'
import { ScreenerSortBy } from '../dto/stock-screener-query.dto'
import { StockScreenerQueryDto } from '../dto/stock-screener-query.dto'

// ── mock 工厂 ─────────────────────────────────────────────────────────────────

function buildPrismaMock() {
  return {
    $queryRaw: jest.fn(),
    screenerStrategy: {
      findMany: jest.fn(async () => []),
      findFirst: jest.fn(async () => null),
      count: jest.fn(async () => 0),
      create: jest.fn(async () => ({
        id: 1,
        userId: 1,
        name: '测试策略',
        description: null,
        filters: {},
        sortBy: null,
        sortOrder: null,
        createdAt: new Date('2025-01-01'),
        updatedAt: new Date('2025-01-01'),
      })),
      update: jest.fn(async () => ({
        id: 1,
        userId: 1,
        name: '更新策略',
        description: null,
        filters: {},
        sortBy: null,
        sortOrder: null,
        createdAt: new Date('2025-01-01'),
        updatedAt: new Date('2025-01-02'),
      })),
      delete: jest.fn(async () => ({})),
    },
  }
}

function buildCacheServiceMock() {
  return {
    getOrSet: jest.fn(async (_key: unknown, _ns: unknown, _ttl: unknown, loader: () => Promise<unknown>) => loader()),
    rememberJson: jest.fn(async (opts: { loader: () => Promise<unknown> }) => opts.loader()),
  }
}

function createService(prisma = buildPrismaMock(), cache = buildCacheServiceMock()): StockScreenerService {
  // @ts-ignore 局部 mock，跳过 DI
  return new StockScreenerService(prisma as PrismaService, cache as CacheService)
}

/** 构造 screener 的 Prisma $queryRaw 返回值 */
function mockScreenerQueryRaw(prisma: ReturnType<typeof buildPrismaMock>, items: unknown[] = [], total = 0) {
  prisma.$queryRaw
    .mockResolvedValueOnce([{ count: BigInt(total) }]) // count query
    .mockResolvedValueOnce(items) // items query
}

// ══════════════════════════════════════════════════════════════════════════════
// 测试套件
// ══════════════════════════════════════════════════════════════════════════════

describe('StockScreenerService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  // ── screener ───────────────────────────────────────────────────────────────

  describe('screener()', () => {
    it('无任何筛选条件 → 返回正确分页结构', async () => {
      const prisma = buildPrismaMock()
      mockScreenerQueryRaw(prisma, [], 0)
      const service = createService(prisma)

      const result = await service.screener({} as StockScreenerQueryDto)
      expect(result).toHaveProperty('page')
      expect(result).toHaveProperty('pageSize')
      expect(result).toHaveProperty('total')
      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })

    it('有结果时 → items 包含格式化字段（含 V2 新增 psTtm 和 concepts）', async () => {
      const prisma = buildPrismaMock()
      const rawItem = {
        tsCode: '000001.SZ',
        name: '平安银行',
        industry: '银行',
        listDate: new Date('2001-04-09'),
        latestFinDate: new Date('2024-12-31'),
        peTtm: '8.5',
        pb: '0.7',
        psTtm: '1.2',
        dvTtm: '5.2',
        totalMv: '300000000',
        circMv: '250000000',
        turnoverRate: '1.5',
        close: '12.34',
        pctChg: '1.2',
        amount: '5000000',
        revenueYoy: '5.6',
        netprofitYoy: '3.2',
        roe: '10.5',
        grossMargin: '35.0',
        netMargin: '20.0',
        debtToAssets: '45.0',
        currentRatio: null,
        quickRatio: null,
        ocfToNetprofit: null,
        mainNetInflow5d: '100000',
        mainNetInflow20d: '500000',
      }
      mockScreenerQueryRaw(prisma, [rawItem], 1)
      // Mock concept query: returns concept data for this stock
      prisma.$queryRaw.mockResolvedValueOnce([
        { conCode: '000001.SZ', name: '数字经济' },
        { conCode: '000001.SZ', name: '金融科技' },
      ])
      const service = createService(prisma)

      const result = await service.screener({} as StockScreenerQueryDto)
      expect(result.total).toBe(1)
      expect(result.items).toHaveLength(1)

      const item = result.items[0]
      // 数值字段应被转为 Number
      expect(typeof item.peTtm).toBe('number')
      expect(item.peTtm).toBeCloseTo(8.5)
      expect(item.totalMv).toBe(300_000_000)
      // V2 新增: psTtm
      expect(typeof item.psTtm).toBe('number')
      expect(item.psTtm).toBeCloseTo(1.2)
      // V2 新增: concepts
      expect(item.concepts).toEqual(['数字经济', '金融科技'])
      // null 字段保持 null
      expect(item.currentRatio).toBeNull()
    })

    it('空结果 → items 为空数组，total 为 0', async () => {
      const prisma = buildPrismaMock()
      mockScreenerQueryRaw(prisma, [], 0)
      const service = createService(prisma)

      const result = await service.screener({} as StockScreenerQueryDto)
      expect(result.items).toEqual([])
      expect(result.total).toBe(0)
    })

    it('指定分页参数 → page/pageSize 正确反映在返回值中', async () => {
      const prisma = buildPrismaMock()
      mockScreenerQueryRaw(prisma, [], 100)
      const service = createService(prisma)

      const result = await service.screener({ page: 3, pageSize: 10 } as StockScreenerQueryDto)
      expect(result.page).toBe(3)
      expect(result.pageSize).toBe(10)
      expect(result.total).toBe(100)
    })

    it('$queryRaw 被调用两次（count + items），空结果时不调用概念查询', async () => {
      const prisma = buildPrismaMock()
      mockScreenerQueryRaw(prisma, [], 0)
      const service = createService(prisma)

      await service.screener({} as StockScreenerQueryDto)
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(2)
    })

    it('listDate 字段格式化为 YYYY-MM-DD 字符串', async () => {
      const prisma = buildPrismaMock()
      const rawItem = {
        tsCode: '000001.SZ',
        name: '测试',
        industry: null,
        listDate: new Date('2001-04-09'),
        latestFinDate: null,
        peTtm: null,
        pb: null,
        psTtm: null,
        dvTtm: null,
        totalMv: null,
        circMv: null,
        turnoverRate: null,
        close: null,
        pctChg: null,
        amount: null,
        revenueYoy: null,
        netprofitYoy: null,
        roe: null,
        grossMargin: null,
        netMargin: null,
        debtToAssets: null,
        currentRatio: null,
        quickRatio: null,
        ocfToNetprofit: null,
        mainNetInflow5d: null,
        mainNetInflow20d: null,
      }
      mockScreenerQueryRaw(prisma, [rawItem], 1)
      // Mock concept query returning empty array
      prisma.$queryRaw.mockResolvedValueOnce([])
      const service = createService(prisma)

      const result = await service.screener({} as StockScreenerQueryDto)
      expect(result.items[0].listDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    })

    it('无概念数据时 → concepts 字段为 null', async () => {
      const prisma = buildPrismaMock()
      const rawItem = {
        tsCode: '600001.SH',
        name: '测试股',
        industry: null,
        market: null,
        listDate: null,
        latestFinDate: null,
        peTtm: null,
        pb: null,
        psTtm: null,
        dvTtm: null,
        totalMv: null,
        circMv: null,
        turnoverRate: null,
        close: null,
        pctChg: null,
        amount: null,
        revenueYoy: null,
        netprofitYoy: null,
        roe: null,
        grossMargin: null,
        netMargin: null,
        debtToAssets: null,
        currentRatio: null,
        quickRatio: null,
        ocfToNetprofit: null,
        mainNetInflow5d: null,
        mainNetInflow20d: null,
      }
      mockScreenerQueryRaw(prisma, [rawItem], 1)
      // 概念查询返回空数组
      prisma.$queryRaw.mockResolvedValueOnce([])
      const service = createService(prisma)

      const result = await service.screener({} as StockScreenerQueryDto)
      expect(result.items[0].concepts).toBeNull()
    })

    it('概念查询失败时 → 降级为空映射，不影响主查询', async () => {
      const prisma = buildPrismaMock()
      const rawItem = {
        tsCode: '600001.SH',
        name: '测试股',
        industry: null,
        market: null,
        listDate: null,
        latestFinDate: null,
        peTtm: null,
        pb: null,
        psTtm: null,
        dvTtm: null,
        totalMv: null,
        circMv: null,
        turnoverRate: null,
        close: null,
        pctChg: null,
        amount: null,
        revenueYoy: null,
        netprofitYoy: null,
        roe: null,
        grossMargin: null,
        netMargin: null,
        debtToAssets: null,
        currentRatio: null,
        quickRatio: null,
        ocfToNetprofit: null,
        mainNetInflow5d: null,
        mainNetInflow20d: null,
      }
      mockScreenerQueryRaw(prisma, [rawItem], 1)
      // 概念查询抛出错误
      prisma.$queryRaw.mockRejectedValueOnce(new Error('table not found'))
      const service = createService(prisma)

      const result = await service.screener({} as StockScreenerQueryDto)
      expect(result.items).toHaveLength(1)
      expect(result.items[0].concepts).toBeNull()
    })
  })

  // ── getScreenerPresets ─────────────────────────────────────────────────────

  describe('getScreenerPresets()', () => {
    it('返回非空预设列表', () => {
      const service = createService()
      const result = service.getScreenerPresets()
      expect(result.presets).toBeDefined()
      expect(result.presets.length).toBeGreaterThan(0)
    })

    it('每个预设包含必要字段', () => {
      const service = createService()
      const { presets } = service.getScreenerPresets()
      for (const preset of presets) {
        expect(preset).toHaveProperty('id')
        expect(preset).toHaveProperty('name')
        expect(preset).toHaveProperty('description')
        expect(preset).toHaveProperty('filters')
        expect(preset.type).toBe('builtin')
      }
    })

    it('包含内置预设 id: value（低估值蓝筹）', () => {
      const service = createService()
      const { presets } = service.getScreenerPresets()
      const valuePreset = presets.find((p) => p.id === 'value')
      expect(valuePreset).toBeDefined()
    })

    it('V2: 包含新增预设 id: northbound（北向资金重仓）', () => {
      const service = createService()
      const { presets } = service.getScreenerPresets()
      const northboundPreset = presets.find((p) => p.id === 'northbound')
      expect(northboundPreset).toBeDefined()
      expect(northboundPreset!.filters).toHaveProperty('northboundOnly')
    })

    it('V2: 包含新增预设 id: tech_breakout（技术突破）', () => {
      const service = createService()
      const { presets } = service.getScreenerPresets()
      const techPreset = presets.find((p) => p.id === 'tech_breakout')
      expect(techPreset).toBeDefined()
      expect(techPreset!.filters).toHaveProperty('macdSignal')
      expect(techPreset!.filters).toHaveProperty('bollSignal')
    })

    it('V2: 包含新增预设 id: oversold_rebound（超跌反弹）', () => {
      const service = createService()
      const { presets } = service.getScreenerPresets()
      const oversoldPreset = presets.find((p) => p.id === 'oversold_rebound')
      expect(oversoldPreset).toBeDefined()
    })

    it('V2: 包含新增预设 id: low_ps_growth（低PS高成长）', () => {
      const service = createService()
      const { presets } = service.getScreenerPresets()
      const lowPsPreset = presets.find((p) => p.id === 'low_ps_growth')
      expect(lowPsPreset).toBeDefined()
      expect(lowPsPreset!.filters).toHaveProperty('maxPsTtm')
    })

    it('V2: 预设总数应为 10 个', () => {
      const service = createService()
      const { presets } = service.getScreenerPresets()
      // 原始 6 + 新增 4 = 10
      expect(presets).toHaveLength(10)
    })
  })

  // ── getScreenerConcepts ────────────────────────────────────────────────────

  describe('getScreenerConcepts()', () => {
    it('返回概念板块列表', async () => {
      const prisma = buildPrismaMock()
      prisma.$queryRaw.mockResolvedValueOnce([
        { tsCode: 'TS001', name: 'AI概念', count: BigInt(50) },
        { tsCode: 'TS002', name: '新能源', count: BigInt(120) },
      ])
      const service = createService(prisma)

      const result = await service.getScreenerConcepts()
      expect(result.concepts).toHaveLength(2)
      expect(result.concepts[0]).toEqual({ tsCode: 'TS001', name: 'AI概念', count: 50 })
      expect(result.concepts[1]).toEqual({ tsCode: 'TS002', name: '新能源', count: 120 })
    })

    it('无概念数据时返回空数组', async () => {
      const prisma = buildPrismaMock()
      prisma.$queryRaw.mockResolvedValueOnce([])
      const service = createService(prisma)

      const result = await service.getScreenerConcepts()
      expect(result.concepts).toEqual([])
    })
  })

  // ── getStrategies ──────────────────────────────────────────────────────────

  describe('getStrategies()', () => {
    it('无策略时返回空数组', async () => {
      const service = createService()
      const result = await service.getStrategies(1)
      expect(result.strategies).toEqual([])
    })

    it('有策略时格式化并返回', async () => {
      const prisma = buildPrismaMock()
      prisma.screenerStrategy.findMany.mockResolvedValue([
        {
          id: 1,
          userId: 1,
          name: '价值策略',
          description: '低估值',
          filters: { minPeTtm: 5, maxPeTtm: 15 },
          sortBy: ScreenerSortBy.PE_TTM,
          sortOrder: 'asc',
          createdAt: new Date('2025-01-01'),
          updatedAt: new Date('2025-01-02'),
        },
      ] as never)

      const service = createService(prisma)
      const result = await service.getStrategies(1)

      expect(result.strategies).toHaveLength(1)
      expect(result.strategies[0]).toMatchObject({
        id: 1,
        name: '价值策略',
        type: 'user',
      })
      expect(typeof result.strategies[0].createdAt).toBe('string')
    })
  })

  // ── createStrategy ─────────────────────────────────────────────────────────

  describe('createStrategy()', () => {
    it('策略数量已达上限（20）→ 抛出 BadRequestException', async () => {
      const prisma = buildPrismaMock()
      prisma.screenerStrategy.count.mockResolvedValue(20 as never)
      const service = createService(prisma)

      await expect(service.createStrategy(1, { name: '新策略', filters: {} })).rejects.toThrow(BadRequestException)
    })

    it('策略数量未达上限 → 创建并返回序列化策略', async () => {
      const prisma = buildPrismaMock()
      prisma.screenerStrategy.count.mockResolvedValue(5 as never)
      const service = createService(prisma)

      const result = await service.createStrategy(1, { name: '测试策略', filters: {} })
      expect(prisma.screenerStrategy.create).toHaveBeenCalled()
      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('name')
    })

    it('重名策略（P2002 错误）→ 抛出 ConflictException', async () => {
      const prisma = buildPrismaMock()
      prisma.screenerStrategy.count.mockResolvedValue(0 as never)
      const p2002Error = Object.assign(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '5.0.0',
          meta: {},
        }),
      )
      prisma.screenerStrategy.create.mockRejectedValue(p2002Error as never)

      const service = createService(prisma)
      const { ConflictException } = await import('@nestjs/common')
      await expect(service.createStrategy(1, { name: '重名策略', filters: {} })).rejects.toThrow(ConflictException)
    })
  })

  // ── updateStrategy ─────────────────────────────────────────────────────────

  describe('updateStrategy()', () => {
    it('策略不存在 → 抛出 NotFoundException', async () => {
      const prisma = buildPrismaMock()
      prisma.screenerStrategy.findFirst.mockResolvedValue(null)
      const service = createService(prisma)

      await expect(service.updateStrategy(1, 999, { name: '新名' })).rejects.toThrow(NotFoundException)
    })

    it('策略存在 → 更新并返回序列化结果', async () => {
      const prisma = buildPrismaMock()
      prisma.screenerStrategy.findFirst.mockResolvedValue({ id: 1 } as never)
      const service = createService(prisma)

      const result = await service.updateStrategy(1, 1, { name: '更新策略' })
      expect(prisma.screenerStrategy.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 1 } }))
      expect(result).toHaveProperty('id')
    })
  })

  // ── deleteStrategy ─────────────────────────────────────────────────────────

  describe('deleteStrategy()', () => {
    it('策略不存在 → 抛出 NotFoundException', async () => {
      const prisma = buildPrismaMock()
      prisma.screenerStrategy.findFirst.mockResolvedValue(null)
      const service = createService(prisma)

      await expect(service.deleteStrategy(1, 999)).rejects.toThrow(NotFoundException)
    })

    it('策略存在 → 删除并返回成功消息', async () => {
      const prisma = buildPrismaMock()
      prisma.screenerStrategy.findFirst.mockResolvedValue({ id: 1 } as never)
      const service = createService(prisma)

      const result = await service.deleteStrategy(1, 1)
      expect(prisma.screenerStrategy.delete).toHaveBeenCalledWith({ where: { id: 1 } })
      expect(result).toHaveProperty('message')
    })
  })

  // ── screener() — 排序与新增筛选参数 ─────────────────────────────────────

  describe('screener() — 排序与筛选参数', () => {
    it('sortBy=PE_TTM 参数时 $queryRaw 仍被调用', async () => {
      const prisma = buildPrismaMock()
      mockScreenerQueryRaw(prisma, [], 0)
      const service = createService(prisma)

      await service.screener({ sortBy: ScreenerSortBy.PE_TTM, sortOrder: 'asc' } as StockScreenerQueryDto)

      expect(prisma.$queryRaw).toHaveBeenCalledTimes(2)
    })

    it('sortBy=TOTAL_MV 参数时返回正确结构', async () => {
      const prisma = buildPrismaMock()
      mockScreenerQueryRaw(prisma, [], 5)
      const service = createService(prisma)

      const result = await service.screener({
        sortBy: ScreenerSortBy.TOTAL_MV,
        sortOrder: 'desc',
      } as StockScreenerQueryDto)

      expect(result).toHaveProperty('items')
      expect(result.total).toBe(5)
    })

    it('带数值筛选条件时仅调用两次 $queryRaw（count + items）', async () => {
      const prisma = buildPrismaMock()
      mockScreenerQueryRaw(prisma, [], 0)
      const service = createService(prisma)

      await service.screener({
        peTtmMin: 5,
        peTtmMax: 20,
        pbMin: 0.5,
        pbMax: 3.0,
      } as StockScreenerQueryDto)

      expect(prisma.$queryRaw).toHaveBeenCalledTimes(2)
    })

    it('V2: sortBy=PS_TTM → $queryRaw 被调用', async () => {
      const prisma = buildPrismaMock()
      mockScreenerQueryRaw(prisma, [], 0)
      const service = createService(prisma)

      await service.screener({
        sortBy: ScreenerSortBy.PS_TTM,
        sortOrder: 'asc',
      } as StockScreenerQueryDto)

      expect(prisma.$queryRaw).toHaveBeenCalledTimes(2)
    })

    it('V2: sortBy=CLOSE → $queryRaw 被调用', async () => {
      const prisma = buildPrismaMock()
      mockScreenerQueryRaw(prisma, [], 0)
      const service = createService(prisma)

      await service.screener({
        sortBy: ScreenerSortBy.CLOSE,
        sortOrder: 'desc',
      } as StockScreenerQueryDto)

      expect(prisma.$queryRaw).toHaveBeenCalledTimes(2)
    })

    it('V2: 多行业筛选 (industries 数组) → $queryRaw 被调用', async () => {
      const prisma = buildPrismaMock()
      mockScreenerQueryRaw(prisma, [], 0)
      const service = createService(prisma)

      await service.screener({
        industries: ['银行', '保险'],
      } as StockScreenerQueryDto)

      expect(prisma.$queryRaw).toHaveBeenCalledTimes(2)
    })

    it('V2: 多地域筛选 (areas 数组) → $queryRaw 被调用', async () => {
      const prisma = buildPrismaMock()
      mockScreenerQueryRaw(prisma, [], 0)
      const service = createService(prisma)

      await service.screener({
        areas: ['广东', '北京', '上海'],
      } as StockScreenerQueryDto)

      expect(prisma.$queryRaw).toHaveBeenCalledTimes(2)
    })

    it('V2: PS(TTM) 范围筛选 → $queryRaw 被调用', async () => {
      const prisma = buildPrismaMock()
      mockScreenerQueryRaw(prisma, [], 0)
      const service = createService(prisma)

      await service.screener({
        minPsTtm: 1,
        maxPsTtm: 10,
      } as StockScreenerQueryDto)

      expect(prisma.$queryRaw).toHaveBeenCalledTimes(2)
    })

    it('V2: bollSignal 布林带信号筛选 → $queryRaw 被调用', async () => {
      const prisma = buildPrismaMock()
      mockScreenerQueryRaw(prisma, [], 0)
      const service = createService(prisma)

      await service.screener({
        bollSignal: 'above_upper',
      } as StockScreenerQueryDto)

      expect(prisma.$queryRaw).toHaveBeenCalledTimes(2)
    })

    it('V2: maTrend 均线趋势筛选 → $queryRaw 被调用', async () => {
      const prisma = buildPrismaMock()
      mockScreenerQueryRaw(prisma, [], 0)
      const service = createService(prisma)

      await service.screener({
        maTrend: 'bullish',
      } as StockScreenerQueryDto)

      expect(prisma.$queryRaw).toHaveBeenCalledTimes(2)
    })

    it('V2: northboundOnly=true → $queryRaw 被调用', async () => {
      const prisma = buildPrismaMock()
      mockScreenerQueryRaw(prisma, [], 0)
      const service = createService(prisma)

      await service.screener({
        northboundOnly: true,
      } as StockScreenerQueryDto)

      expect(prisma.$queryRaw).toHaveBeenCalledTimes(2)
    })

    it('V2: conceptCodes 概念筛选 → $queryRaw 被调用', async () => {
      const prisma = buildPrismaMock()
      mockScreenerQueryRaw(prisma, [], 0)
      const service = createService(prisma)

      await service.screener({
        conceptCodes: ['TS001', 'TS002'],
      } as StockScreenerQueryDto)

      expect(prisma.$queryRaw).toHaveBeenCalledTimes(2)
    })
  })
})
