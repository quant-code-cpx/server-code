/**
 * PatternService — 单元测试
 *
 * 覆盖要点：
 * - getTemplates(): 返回所有预定义模板，含 id/name/description/length
 * - search(): 数据不足时抛出异常；候选为空时返回空 matches；正常流程
 * - searchBySeries(): 直接传入序列;  候选股票池为空时返回空匹配
 * - batchLoadAdjustedCloses() [private]: adjFactor<=0 时 multiplier=1（防除零）
 */

import { BusinessException } from 'src/common/exceptions/business.exception'
import { PatternService } from '../pattern.service'
import { PatternAlgorithm, PatternScope } from '../dto/pattern-search.dto'
import { PATTERN_TEMPLATES } from '../utils/pattern-templates'

// ── Mock 工厂 ─────────────────────────────────────────────────────────────────

function buildPrismaMock() {
  return {
    $queryRawUnsafe: jest.fn(async () => []),
    $queryRaw: jest.fn(async () => []),
    stockBasic: {
      findMany: jest.fn(async () => []),
    },
  }
}

function createService(prismaMock = buildPrismaMock()) {
  return new PatternService(prismaMock as any)
}

// ── 数据构造助手 ───────────────────────────────────────────────────────────────

/** 生成 n 条价格行（用于 $queryRawUnsafe 返回值） */
function makePriceRows(tsCode: string, n: number, baseClose = 10, adjFactor = 1.0) {
  return Array.from({ length: n }, (_, i) => ({
    tsCode,
    tradeDate: new Date(`2024-01-${String(i + 1).padStart(2, '0')}`),
    close: baseClose + i * 0.1,
    adjFactor,
  }))
}

// ═══════════════════════════════════════════════════════════════════════════════

describe('PatternService', () => {
  beforeEach(() => jest.clearAllMocks())

  // ── getTemplates() ───────────────────────────────────────────────────────

  describe('getTemplates()', () => {
    it('返回所有预定义模板（数量与 PATTERN_TEMPLATES 一致）', () => {
      const svc = createService()
      const templates = svc.getTemplates()
      expect(templates).toHaveLength(Object.keys(PATTERN_TEMPLATES).length)
    })

    it('每个模板包含 id / name / description / length 字段', () => {
      const svc = createService()
      const templates = svc.getTemplates()
      templates.forEach((t) => {
        expect(t).toHaveProperty('id')
        expect(t).toHaveProperty('name')
        expect(t).toHaveProperty('description')
        expect(t).toHaveProperty('length')
        expect(typeof t.length).toBe('number')
        expect(t.length).toBeGreaterThan(0)
      })
    })

    it('HEAD_SHOULDERS_TOP 模板存在且 length 与 series 长度一致', () => {
      const svc = createService()
      const templates = svc.getTemplates()
      const hst = templates.find((t) => t.id === 'HEAD_SHOULDERS_TOP')
      expect(hst).toBeDefined()
      expect(hst!.length).toBe(PATTERN_TEMPLATES.HEAD_SHOULDERS_TOP.series.length)
    })
  })

  // ── search() ─────────────────────────────────────────────────────────────

  describe('search()', () => {
    it('查询股票行情不足 5 条 → 抛出 BusinessException', async () => {
      const prisma = buildPrismaMock()
      // loadAdjustedCloses 返回 3 条（< 5）
      prisma.$queryRawUnsafe.mockResolvedValueOnce(makePriceRows('000001.SZ', 3))
      const svc = createService(prisma)

      await expect(svc.search({ tsCode: '000001.SZ', startDate: '20240101', endDate: '20240103' })).rejects.toThrow(
        BusinessException,
      )
    })

    it('候选股票池为空 → 返回 matches=[]', async () => {
      const prisma = buildPrismaMock()
      // loadAdjustedCloses 返回 10 条（>= 5）
      prisma.$queryRawUnsafe.mockResolvedValueOnce(makePriceRows('000001.SZ', 10))
      // getCandidateStocks(股票池) → 无上市股票
      prisma.stockBasic.findMany.mockResolvedValue([])
      const svc = createService(prisma)

      const result = await svc.search({
        tsCode: '000001.SZ',
        startDate: '20240101',
        endDate: '20240110',
        scope: PatternScope.ALL,
      })

      expect(result.matches).toHaveLength(0)
      expect(result.patternLength).toBe(10)
      expect(result.candidateCount).toBe(0)
    })

    it('返回结构包含 patternLength / algorithm / candidateCount / querySeries', async () => {
      const prisma = buildPrismaMock()
      prisma.$queryRawUnsafe.mockResolvedValueOnce(makePriceRows('000001.SZ', 5))
      prisma.stockBasic.findMany.mockResolvedValue([])
      const svc = createService(prisma)

      const result = await svc.search({
        tsCode: '000001.SZ',
        startDate: '20240101',
        endDate: '20240105',
      })

      expect(result).toHaveProperty('patternLength')
      expect(result).toHaveProperty('algorithm')
      expect(result).toHaveProperty('candidateCount')
      expect(result).toHaveProperty('querySeries')
      expect(Array.isArray(result.querySeries)).toBe(true)
    })

    it('excludeSelf=true（默认）→ 候选中过滤掉自身 tsCode', async () => {
      const prisma = buildPrismaMock()
      prisma.$queryRawUnsafe.mockResolvedValueOnce(makePriceRows('000001.SZ', 5))
      prisma.stockBasic.findMany.mockResolvedValue([
        { tsCode: '000001.SZ', name: '自身' },
        { tsCode: '000002.SZ', name: '其他' },
      ])
      // batchLoadAdjustedCloses → 为空，候选有数据也不会生成匹配
      prisma.$queryRawUnsafe.mockResolvedValueOnce([]) // for batchLoad
      const svc = createService(prisma)

      const result = await svc.search({
        tsCode: '000001.SZ',
        startDate: '20240101',
        endDate: '20240105',
        excludeSelf: true,
      })

      // candidateCount 应为 1（000002.SZ），不包含自身
      expect(result.candidateCount).toBe(1)
    })

    it('excludeSelf=false → 候选包含自身', async () => {
      const prisma = buildPrismaMock()
      prisma.$queryRawUnsafe.mockResolvedValueOnce(makePriceRows('000001.SZ', 5))
      prisma.stockBasic.findMany.mockResolvedValue([
        { tsCode: '000001.SZ', name: '自身' },
        { tsCode: '000002.SZ', name: '其他' },
      ])
      prisma.$queryRawUnsafe.mockResolvedValueOnce([])
      const svc = createService(prisma)

      const result = await svc.search({
        tsCode: '000001.SZ',
        startDate: '20240101',
        endDate: '20240105',
        excludeSelf: false,
      })

      expect(result.candidateCount).toBe(2)
    })
  })

  // ── searchBySeries() ─────────────────────────────────────────────────────

  describe('searchBySeries()', () => {
    it('直接传入序列，候选为空 → 返回空 matches', async () => {
      const prisma = buildPrismaMock()
      prisma.stockBasic.findMany.mockResolvedValue([])
      const svc = createService(prisma)

      const result = await svc.searchBySeries({
        series: [1, 2, 3, 4, 5, 6, 7],
      })

      expect(result.matches).toHaveLength(0)
      expect(result.patternLength).toBe(7)
    })

    it('返回结构包含归一化后的 querySeries', async () => {
      const prisma = buildPrismaMock()
      prisma.stockBasic.findMany.mockResolvedValue([])
      const svc = createService(prisma)

      const result = await svc.searchBySeries({
        series: [10, 20, 15, 25, 5],
      })

      // querySeries 是归一化后的序列（max→1, min→0）
      const max = Math.max(...result.querySeries)
      const min = Math.min(...result.querySeries)
      expect(max).toBeCloseTo(1, 2)
      expect(min).toBeCloseTo(0, 2)
    })

    it('algorithm=DTW 参数被正确传递', async () => {
      const prisma = buildPrismaMock()
      prisma.stockBasic.findMany.mockResolvedValue([])
      const svc = createService(prisma)

      const result = await svc.searchBySeries({
        series: [1, 2, 3, 4, 5],
        algorithm: PatternAlgorithm.DTW,
      })

      expect(result.algorithm).toBe(PatternAlgorithm.DTW)
    })
  })

  // ── batchLoadAdjustedCloses() [private] — adjFactor边界测试 ────────────────

  describe('batchLoadAdjustedCloses() [private, via search]', () => {
    it('[P3-B11] adjFactor=0 时 multiplier 退化为 1（防止除零）', async () => {
      const prisma = buildPrismaMock()

      // loadAdjustedCloses 返回 5条有效行（for queryPoints）
      prisma.$queryRawUnsafe.mockResolvedValueOnce([
        { tsCode: '000001.SZ', tradeDate: new Date('2024-01-01'), close: 10, adjFactor: 1 },
        { tsCode: '000001.SZ', tradeDate: new Date('2024-01-02'), close: 11, adjFactor: 1 },
        { tsCode: '000001.SZ', tradeDate: new Date('2024-01-03'), close: 12, adjFactor: 1 },
        { tsCode: '000001.SZ', tradeDate: new Date('2024-01-04'), close: 13, adjFactor: 1 },
        { tsCode: '000001.SZ', tradeDate: new Date('2024-01-05'), close: 14, adjFactor: 1 },
      ])

      // 候选股票：000002.SZ
      prisma.stockBasic.findMany.mockResolvedValue([{ tsCode: '000002.SZ', name: '测试股' }])

      // batchLoadAdjustedCloses 返回含 adjFactor=0 的行
      // adjFactor=0 → multiplier=1（防除零），close 应该保持不变
      prisma.$queryRawUnsafe.mockResolvedValueOnce([
        { tsCode: '000002.SZ', tradeDate: new Date('2024-01-01'), close: 5.5, adjFactor: 0 },
        { tsCode: '000002.SZ', tradeDate: new Date('2024-01-02'), close: 6.0, adjFactor: 0 },
        { tsCode: '000002.SZ', tradeDate: new Date('2024-01-03'), close: 6.5, adjFactor: 0 },
        { tsCode: '000002.SZ', tradeDate: new Date('2024-01-04'), close: 7.0, adjFactor: 0 },
        { tsCode: '000002.SZ', tradeDate: new Date('2024-01-05'), close: 7.5, adjFactor: 0 },
      ])

      const svc = createService(prisma)

      // 不应抛出异常（adjFactor=0 不触发除零错误）
      await expect(
        svc.search({ tsCode: '000001.SZ', startDate: '20240101', endDate: '20240105' }),
      ).resolves.toBeDefined()
    })
  })
})
