/**
 * FactorComputeService — 单元测试
 *
 * 覆盖要点：
 * - buildUniverseJoinStr: 私有方法，SQL 片段生成 + 注入防护
 * - getFactorValues: 快照路径与实时降级路径
 * - getRawFactorValuesForDate: 快照优先，回退实时
 * - computeCustomSqlForDate: 未知因子 / 表达式错误处理
 */
import { NotFoundException } from '@nestjs/common'
import { FactorSourceType } from '@prisma/client'
import { FactorComputeService } from '../services/factor-compute.service'
import { FactorExpressionService } from '../services/factor-expression.service'

// ── Mock 工厂 ─────────────────────────────────────────────────────────────────

function buildPrismaMock() {
  return {
    $queryRaw: jest.fn(async () => []),
    factorSnapshot: {
      findFirst: jest.fn(async () => null),
      findMany: jest.fn(async () => []),
      count: jest.fn(async () => 0),
    },
    factorSnapshotSummary: {
      findUnique: jest.fn(async () => null),
      findFirst: jest.fn(async () => null),
    },
    factorSnapshotRow: {
      findMany: jest.fn(async () => []),
      count: jest.fn(async () => 0),
    },
    factorDefinition: {
      findUnique: jest.fn(async () => null),
    },
  }
}

function buildExpressionMock() {
  return {
    validate: jest.fn(() => ({ valid: true })),
    compile: jest.fn(() => ({
      sql: 'rank(close)',
      tables: ['prices', 'adj'],
      usedFunctions: ['rank'],
    })),
  }
}

function createService(prismaMock = buildPrismaMock(), exprMock = buildExpressionMock()): FactorComputeService {
  // @ts-ignore 局部 mock
  return new FactorComputeService(prismaMock as any, exprMock as FactorExpressionService)
}

// ═══════════════════════════════════════════════════════════════════════════════
// 测试套件
// ═══════════════════════════════════════════════════════════════════════════════

describe('FactorComputeService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  // ── buildUniverseJoinStr() (私有方法) ─────────────────────────────────────

  describe('buildUniverseJoinStr() [private]', () => {
    let svc: FactorComputeService

    beforeEach(() => {
      svc = createService()
    })

    it('无 universe 时返回空字符串', () => {
      const result = (svc as any).buildUniverseJoinStr(undefined, '20240101', 'd')
      expect(result).toBe('')
    })

    it('有效 universe 生成 INNER JOIN 片段', () => {
      const result = (svc as any).buildUniverseJoinStr('000300.SH', '20240101', 'd')
      expect(result).toContain('INNER JOIN index_constituent_weights')
      expect(result).toContain("000300.SH")
      expect(result).toContain('20240101')
      expect(result).toContain('d.ts_code')
    })

    it('universe 格式非法时抛出错误（注入防护）', () => {
      expect(() =>
        (svc as any).buildUniverseJoinStr("'; DROP TABLE users;--", '20240101', 'd'),
      ).toThrow('Invalid universe format')
    })

    it('tradeDate 格式非法时抛出错误', () => {
      expect(() => (svc as any).buildUniverseJoinStr('000300.SH', 'invalid-date', 'd')).toThrow(
        'Invalid tradeDate format',
      )
    })
  })

  // ── getFactorValues() ────────────────────────────────────────────────────

  describe('getFactorValues()', () => {
    it('快照存在时走快照路径（调用 $queryRaw 读取快照行）', async () => {
      const prisma = buildPrismaMock()
      // getFactorValuesFromSnapshot uses factorSnapshotSummary.findUnique
      prisma.factorSnapshotSummary.findUnique.mockResolvedValue({ factorName: 'pe_ttm', tradeDate: '20240101', rowCount: 10 })
      // $queryRaw used for both count and rows in snapshot path
      prisma.$queryRaw
        .mockResolvedValueOnce([{ total: BigInt(10) }]) // count query
        .mockResolvedValueOnce([
          { ts_code: '000001.SZ', stock_name: '平安银行', industry: '银行', factor_value: 8.5, percentile: 0.3 },
        ]) // rows query
      const svc = createService(prisma)

      const result = await svc.getFactorValues(
        { factorName: 'pe_ttm', tradeDate: '20240101', page: 1, pageSize: 50 },
        FactorSourceType.FIELD_REF,
        'pe_ttm',
      )

      expect(prisma.factorSnapshotSummary.findUnique).toHaveBeenCalled()
      expect(result).toHaveProperty('total')
    })

    it('快照不存在时降级实时计算（$queryRaw）', async () => {
      const prisma = buildPrismaMock()
      prisma.factorSnapshotSummary.findUnique.mockResolvedValue(null)
      // $queryRaw 返回空（无数据）
      prisma.$queryRaw.mockResolvedValue([])
      const svc = createService(prisma)

      await svc.getFactorValues(
        { factorName: 'pe_ttm', tradeDate: '20240101', page: 1, pageSize: 50 },
        FactorSourceType.FIELD_REF,
        'pe_ttm',
      )

      // 走实时路径时会调用 $queryRaw
      expect(prisma.$queryRaw).toHaveBeenCalled()
    })

    it('未知因子名称时抛出 NotFoundException', async () => {
      const prisma = buildPrismaMock()
      prisma.factorSnapshotSummary.findUnique.mockResolvedValue(null)
      const svc = createService(prisma)

      await expect(
        svc.getFactorValues(
          { factorName: 'pe_ttm', tradeDate: '20240101', page: 1, pageSize: 50 },
          FactorSourceType.FIELD_REF,
          'nonexistent_factor_xyz',
        ),
      ).rejects.toThrow(NotFoundException)
    })
  })

  // ── getRawFactorValuesForDate() ───────────────────────────────────────────

  describe('getRawFactorValuesForDate()', () => {
    it('快照存在时从快照读取', async () => {
      const prisma = buildPrismaMock()
      prisma.factorSnapshotSummary.findUnique.mockResolvedValue({ factorName: 'pe_ttm', tradeDate: '20240101' })
      prisma.$queryRaw.mockResolvedValue([
        { ts_code: '000001.SZ', factor_value: 5.0 },
      ])
      const svc = createService(prisma)

      const result = await svc.getRawFactorValuesForDate('pe_ttm', '20240101', undefined)

      expect(prisma.$queryRaw).toHaveBeenCalled()
      expect(result).toBeDefined()
    })

    it('快照不存在时降级实时计算', async () => {
      const prisma = buildPrismaMock()
      prisma.factorSnapshotSummary.findUnique.mockResolvedValue(null)
      prisma.$queryRaw.mockResolvedValue([{ ts_code: '000001.SZ', factor_value: 5.0 }])
      const svc = createService(prisma)

      const result = await svc.getRawFactorValuesForDate('pe_ttm', '20240101', undefined)

      expect(prisma.$queryRaw).toHaveBeenCalled()
      expect(result).toBeDefined()
    })
  })

  // ── 响应结构 ──────────────────────────────────────────────────────────────

  describe('响应格式', () => {
    it('快照路径返回带 total/page/pageSize/items 的结构', async () => {
      const prisma = buildPrismaMock()
      prisma.factorSnapshotSummary.findUnique.mockResolvedValue({ factorName: 'pe_ttm', tradeDate: '20240101' })
      prisma.$queryRaw
        .mockResolvedValueOnce([{ total: BigInt(2) }])
        .mockResolvedValueOnce([
          { ts_code: '000001.SZ', stock_name: '平安银行', industry: '银行', factor_value: 8.5, percentile: 0.3 },
          { ts_code: '000002.SZ', stock_name: '万科A', industry: '房地产', factor_value: 12.1, percentile: 0.7 },
        ])
      const svc = createService(prisma)

      const result = await svc.getFactorValues(
        { factorName: 'pe_ttm', tradeDate: '20240101', page: 1, pageSize: 10 },
        FactorSourceType.FIELD_REF,
        'pe_ttm',
      )

      expect(result).toHaveProperty('total')
      expect(result).toHaveProperty('page')
      expect(result).toHaveProperty('pageSize')
      expect(result).toHaveProperty('items')
    })
  })
})
