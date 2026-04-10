/**
 * BacktestDataReadinessService — 单元测试
 *
 * 覆盖要点：
 * - tradeCal count=0 → errors 包含 '交易日历'
 * - daily count=0 → errors 包含 '股票日线'
 * - adjFactor count=0 → errors 包含 '复权因子'
 * - indexDaily count=0 → errors 包含 '基准指数'
 * - stkLimit count=0, enableTradeConstraints=true → warnings 包含 '涨跌停'
 * - suspendD count=0, enableTradeConstraints=true → warnings 包含 '停牌'
 * - enableTradeConstraints=false → 不产生 stkLimit/suspendD 警告
 * - universe != ALL_A 且 indexWeight count=0 → errors 包含 indexWeight 相关
 * - 所有数据齐全 → isValid=true, errors=[]
 */
import { BacktestDataReadinessService } from '../services/backtest-data-readiness.service'

// ── Mock 工厂 ─────────────────────────────────────────────────────────────────

type PrismaMock = ReturnType<typeof buildPrismaMock>

function buildPrismaMock() {
  return {
    tradeCal: { count: jest.fn(async () => 0) },
    daily: {
      count: jest.fn(async () => 0),
      findFirst: jest.fn(async () => null),
      groupBy: jest.fn(async () => []),
    },
    adjFactor: { count: jest.fn(async () => 0) },
    indexDaily: { count: jest.fn(async () => 0) },
    stkLimit: { count: jest.fn(async () => 0) },
    suspendD: { count: jest.fn(async () => 0) },
    indexWeight: { count: jest.fn(async () => 0) },
  }
}

/** 将 Prisma mock 所有 count 设为正值（数据充足状态） */
function setAllCountsPositive(prisma: PrismaMock, value = 100) {
  prisma.tradeCal.count.mockResolvedValue(value)
  prisma.daily.count.mockResolvedValue(value)
  prisma.adjFactor.count.mockResolvedValue(value)
  prisma.indexDaily.count.mockResolvedValue(value)
  prisma.stkLimit.count.mockResolvedValue(value)
  prisma.suspendD.count.mockResolvedValue(value)
  prisma.indexWeight.count.mockResolvedValue(value)
  prisma.daily.groupBy.mockResolvedValue(Array.from({ length: 200 }, (_, i) => ({ tsCode: `00000${i}.SZ` })))
}

function createService(prisma = buildPrismaMock()): BacktestDataReadinessService {
  // @ts-ignore 局部 mock
  return new BacktestDataReadinessService(prisma as any)
}

const baseDto = {
  startDate: '20230101',
  endDate: '20231231',
  strategyType: 'FACTOR_RANKING' as const,
  strategyConfig: {},
  universe: 'ALL_A' as const,
  initialCapital: 1_000_000,
  enableTradeConstraints: true,
}

// ═══════════════════════════════════════════════════════════════════════════════
// 测试套件
// ═══════════════════════════════════════════════════════════════════════════════

describe('BacktestDataReadinessService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  // ── 所有数据齐全 ───────────────────────────────────────────────────────────

  describe('所有数据齐全时', () => {
    it('isValid=true，errors 为空', async () => {
      const prisma = buildPrismaMock()
      setAllCountsPositive(prisma)
      const svc = createService(prisma)

      const result = await svc.checkReadiness(baseDto)

      expect(result.isValid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('dataReadiness 各字段均为 true', async () => {
      const prisma = buildPrismaMock()
      setAllCountsPositive(prisma)
      const svc = createService(prisma)

      const result = await svc.checkReadiness(baseDto)

      expect(result.dataReadiness.hasDaily).toBe(true)
      expect(result.dataReadiness.hasAdjFactor).toBe(true)
      expect(result.dataReadiness.hasTradeCal).toBe(true)
      expect(result.dataReadiness.hasIndexDaily).toBe(true)
    })
  })

  // ── 交易日历缺失 ───────────────────────────────────────────────────────────

  describe('tradeCal count=0', () => {
    it('errors 包含 "交易日历"', async () => {
      const prisma = buildPrismaMock()
      setAllCountsPositive(prisma)
      prisma.tradeCal.count.mockResolvedValue(0)
      const svc = createService(prisma)

      const result = await svc.checkReadiness(baseDto)

      const hasError = result.errors.some((e) => e.includes('交易日历'))
      expect(hasError).toBe(true)
    })

    it('isValid=false', async () => {
      const prisma = buildPrismaMock()
      setAllCountsPositive(prisma)
      prisma.tradeCal.count.mockResolvedValue(0)
      const svc = createService(prisma)

      const result = await svc.checkReadiness(baseDto)

      expect(result.isValid).toBe(false)
    })
  })

  // ── 股票日线缺失 ───────────────────────────────────────────────────────────

  describe('daily count=0', () => {
    it('errors 包含 "股票日线"', async () => {
      const prisma = buildPrismaMock()
      setAllCountsPositive(prisma)
      prisma.daily.count.mockResolvedValue(0)
      const svc = createService(prisma)

      const result = await svc.checkReadiness(baseDto)

      const hasError = result.errors.some((e) => e.includes('股票日线'))
      expect(hasError).toBe(true)
    })
  })

  // ── 复权因子缺失 ───────────────────────────────────────────────────────────

  describe('adjFactor count=0', () => {
    it('errors 包含 "复权因子"', async () => {
      const prisma = buildPrismaMock()
      setAllCountsPositive(prisma)
      prisma.adjFactor.count.mockResolvedValue(0)
      const svc = createService(prisma)

      const result = await svc.checkReadiness(baseDto)

      const hasError = result.errors.some((e) => e.includes('复权因子'))
      expect(hasError).toBe(true)
    })
  })

  // ── 基准指数缺失 ───────────────────────────────────────────────────────────

  describe('indexDaily count=0', () => {
    it('errors 包含 "基准指数"', async () => {
      const prisma = buildPrismaMock()
      setAllCountsPositive(prisma)
      prisma.indexDaily.count.mockResolvedValue(0)
      const svc = createService(prisma)

      const result = await svc.checkReadiness(baseDto)

      const hasError = result.errors.some((e) => e.includes('基准指数'))
      expect(hasError).toBe(true)
    })
  })

  // ── 涨跌停数据缺失 ────────────────────────────────────────────────────────

  describe('stkLimit count=0, enableTradeConstraints=true', () => {
    it('warnings 包含 "涨跌停"', async () => {
      const prisma = buildPrismaMock()
      setAllCountsPositive(prisma)
      prisma.stkLimit.count.mockResolvedValue(0)
      const svc = createService(prisma)

      const result = await svc.checkReadiness({ ...baseDto, enableTradeConstraints: true })

      const hasWarning = result.warnings.some((w) => w.includes('涨跌停'))
      expect(hasWarning).toBe(true)
    })

    it('enableTradeConstraints=false → 不产生涨跌停警告', async () => {
      const prisma = buildPrismaMock()
      setAllCountsPositive(prisma)
      prisma.stkLimit.count.mockResolvedValue(0)
      const svc = createService(prisma)

      const result = await svc.checkReadiness({ ...baseDto, enableTradeConstraints: false })

      const hasWarning = result.warnings.some((w) => w.includes('涨跌停'))
      expect(hasWarning).toBe(false)
    })
  })

  // ── 停牌数据缺失 ──────────────────────────────────────────────────────────

  describe('suspendD count=0, enableTradeConstraints=true', () => {
    it('warnings 包含 "停牌"', async () => {
      const prisma = buildPrismaMock()
      setAllCountsPositive(prisma)
      prisma.suspendD.count.mockResolvedValue(0)
      const svc = createService(prisma)

      const result = await svc.checkReadiness({ ...baseDto, enableTradeConstraints: true })

      const hasWarning = result.warnings.some((w) => w.includes('停牌'))
      expect(hasWarning).toBe(true)
    })

    it('enableTradeConstraints=false → 不产生停牌警告', async () => {
      const prisma = buildPrismaMock()
      setAllCountsPositive(prisma)
      prisma.suspendD.count.mockResolvedValue(0)
      const svc = createService(prisma)

      const result = await svc.checkReadiness({ ...baseDto, enableTradeConstraints: false })

      const hasWarning = result.warnings.some((w) => w.includes('停牌'))
      expect(hasWarning).toBe(false)
    })
  })

  // ── 指数成分权重缺失 ──────────────────────────────────────────────────────

  describe('indexWeight count=0，universe 非 ALL_A/CUSTOM', () => {
    it('universe=HS300 且 indexWeight 缺失 → errors 包含权重相关信息', async () => {
      const prisma = buildPrismaMock()
      setAllCountsPositive(prisma)
      prisma.indexWeight.count.mockResolvedValue(0)
      const svc = createService(prisma)

      const result = await svc.checkReadiness({ ...baseDto, universe: 'HS300' as any })

      const hasError = result.errors.some((e) => e.includes('HS300') || e.toLowerCase().includes('weight') || e.includes('成分') || e.includes('指数'))
      expect(hasError).toBe(true)
      expect(result.isValid).toBe(false)
    })

    it('universe=ALL_A 时 indexWeight 不影响结果', async () => {
      const prisma = buildPrismaMock()
      setAllCountsPositive(prisma)
      prisma.indexWeight.count.mockResolvedValue(0)
      const svc = createService(prisma)

      const result = await svc.checkReadiness({ ...baseDto, universe: 'ALL_A' as any })

      // ALL_A 不需要 indexWeight，无相关 error
      const hasIndexWeightError = result.errors.some(
        (e) => e.includes('成分权重') || e.includes('indexWeight'),
      )
      expect(hasIndexWeightError).toBe(false)
    })

    it('universe=CUSTOM 时 indexWeight 不影响结果', async () => {
      const prisma = buildPrismaMock()
      setAllCountsPositive(prisma)
      prisma.indexWeight.count.mockResolvedValue(0)
      const svc = createService(prisma)

      const result = await svc.checkReadiness({ ...baseDto, universe: 'CUSTOM' as any })

      const hasIndexWeightError = result.errors.some(
        (e) => e.includes('成分权重') || e.includes('indexWeight'),
      )
      expect(hasIndexWeightError).toBe(false)
    })
  })

  // ── 统计信息 ──────────────────────────────────────────────────────────────

  describe('stats', () => {
    it('返回 tradingDays（tradeCalCount）', async () => {
      const prisma = buildPrismaMock()
      setAllCountsPositive(prisma)
      prisma.tradeCal.count.mockResolvedValue(244)
      const svc = createService(prisma)

      const result = await svc.checkReadiness(baseDto)

      expect(result.stats.tradingDays).toBe(244)
    })

    it('无日线数据时 estimatedUniverseSize=null', async () => {
      const prisma = buildPrismaMock()
      setAllCountsPositive(prisma)
      prisma.daily.count.mockResolvedValue(0)
      const svc = createService(prisma)

      const result = await svc.checkReadiness(baseDto)

      expect(result.stats.estimatedUniverseSize).toBeNull()
    })
  })
})
