/**
 * StockAnalysisService — 单元测试
 *
 * 覆盖要点：
 * - getTechnicalIndicators()：空数据 → 默认结构，有数据 → history 非空
 * - applyAdjFactor()：adjFactor=1.0 → close 不变，adjFactor=2.0 → close 翻倍，null → 默认 1.0
 * - buildMaStatus()：数据不足时各字段为 null
 * - getRelativeStrength()：两者均无数据时返回 history:[]
 */

import { StockAnalysisService } from '../stock-analysis.service'

// ── Mock 工厂 ─────────────────────────────────────────────────────────────────

function buildPrismaMock() {
  return {
    $queryRaw: jest.fn(async () => []),
  }
}

function createService(prismaMock = buildPrismaMock()) {
  return new StockAnalysisService(prismaMock as any)
}

/** 构造一条 OhlcvRow（匹配 fetchOhlcvRows 返回结构） */
function makeOhlcvRow(overrides: Partial<{
  tradeDate: Date
  open: number | null
  high: number | null
  low: number | null
  close: number | null
  preClose: number | null
  pctChg: number | null
  vol: number | null
  amount: number | null
  adjFactor: number | null
}> = {}) {
  return {
    tradeDate: new Date('2024-01-02'),
    open: 10,
    high: 11,
    low: 9,
    close: 10,
    preClose: 10,
    pctChg: 0,
    vol: 10000,
    amount: 100000,
    adjFactor: 1.0,
    ...overrides,
  }
}

/** 生成 n 条连续递增收盘价的 OhlcvRow 数组（日期连续） */
function makeOhlcvRows(n: number, baseClose = 10, adjFactor = 1.0) {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date('2024-01-02')
    d.setDate(d.getDate() + i)
    return makeOhlcvRow({
      tradeDate: d,
      open: baseClose + i * 0.01,
      high: baseClose + i * 0.01 + 0.5,
      low: baseClose + i * 0.01 - 0.5,
      close: baseClose + i * 0.01,
      preClose: i > 0 ? baseClose + (i - 1) * 0.01 : baseClose,
      adjFactor,
    })
  })
}

// ═══════════════════════════════════════════════════════════════════════════════

describe('StockAnalysisService', () => {
  beforeEach(() => jest.clearAllMocks())

  // ── getTechnicalIndicators() ──────────────────────────────────────────────

  describe('getTechnicalIndicators()', () => {
    it('数据库无行情时返回默认空结构', async () => {
      const prisma = buildPrismaMock()
      prisma.$queryRaw.mockResolvedValue([])
      const svc = createService(prisma)

      const result = await svc.getTechnicalIndicators({ tsCode: '000001.SZ' })

      expect(result.tsCode).toBe('000001.SZ')
      expect(result.history).toHaveLength(0)
      expect(result.dataDate).toBeNull()
      expect(result.maStatus.bullishAlign).toBeNull()
      expect(result.maStatus.bearishAlign).toBeNull()
      expect(result.maStatus.aboveMa20).toBeNull()
      expect(result.maStatus.latestCross).toBeNull()
      expect(result.signals.macd).toBeNull()
      expect(result.signals.rsi).toBeNull()
    })

    it('有足够行情数据时 history 非空', async () => {
      const prisma = buildPrismaMock()
      const rows = makeOhlcvRows(150)
      prisma.$queryRaw.mockResolvedValue(rows)
      const svc = createService(prisma)

      const result = await svc.getTechnicalIndicators({ tsCode: '000001.SZ', days: 60 })

      expect(result.history.length).toBeGreaterThan(0)
      expect(result.history.length).toBeLessThanOrEqual(60)
      expect(result.dataDate).not.toBeNull()
    })

    it('period 参数切换到 W 时仍正确返回', async () => {
      const prisma = buildPrismaMock()
      prisma.$queryRaw.mockResolvedValue([])
      const svc = createService(prisma)

      const result = await svc.getTechnicalIndicators({ tsCode: '000001.SZ', period: 'W' })

      expect(result.period).toBe('W')
      expect(result.history).toHaveLength(0)
    })

    it('days 参数控制 history 长度不超过 days', async () => {
      const prisma = buildPrismaMock()
      const rows = makeOhlcvRows(200)
      prisma.$queryRaw.mockResolvedValue(rows)
      const svc = createService(prisma)

      const result = await svc.getTechnicalIndicators({ tsCode: '000001.SZ', days: 30 })

      expect(result.history.length).toBeLessThanOrEqual(30)
    })
  })

  // ── applyAdjFactor() 私有方法 ─────────────────────────────────────────────

  describe('applyAdjFactor() [private]', () => {
    it('adjFactor=1.0 时 close 保持不变', () => {
      const svc = createService()
      const rows = [makeOhlcvRow({ close: 20, open: 20, high: 21, low: 19, adjFactor: 1.0 })]

      const bars = (svc as any).applyAdjFactor(rows)

      expect(bars).toHaveLength(1)
      expect(bars[0].close).toBe(20)
    })

    it('adjFactor=2.0（历史）且最新 adjFactor=1.0 时，close 减半（前复权）', () => {
      const svc = createService()
      // 两条数据：历史 adjFactor=2.0，最新 adjFactor=1.0
      // 前复权：multiplier = latestAdj / factor = 1.0 / 2.0 = 0.5
      const rows = [
        makeOhlcvRow({ tradeDate: new Date('2024-01-01'), close: 20, open: 20, high: 21, low: 19, adjFactor: 2.0 }),
        makeOhlcvRow({ tradeDate: new Date('2024-01-02'), close: 10, open: 10, high: 11, low: 9, adjFactor: 1.0 }),
      ]

      const bars = (svc as any).applyAdjFactor(rows)

      expect(bars).toHaveLength(2)
      // 历史行：close=20 * (1.0/2.0) = 10
      expect(bars[0].close).toBe(10)
      // 最新行：close=10 * (1.0/1.0) = 10
      expect(bars[1].close).toBe(10)
    })

    it('adjFactor=null 时默认使用 1.0（不复权）', () => {
      const svc = createService()
      const rows = [makeOhlcvRow({ close: 15, open: 15, high: 16, low: 14, adjFactor: null })]

      const bars = (svc as any).applyAdjFactor(rows)

      expect(bars).toHaveLength(1)
      expect(bars[0].close).toBe(15)
    })

    it('close 为 null 的行被过滤掉', () => {
      const svc = createService()
      const rows = [
        makeOhlcvRow({ close: null, adjFactor: 1.0 }),
        makeOhlcvRow({ close: 10, open: 10, high: 11, low: 9, adjFactor: 1.0 }),
      ]

      const bars = (svc as any).applyAdjFactor(rows)

      // null close 的行被过滤
      expect(bars).toHaveLength(1)
    })

    it('空数组输入返回空数组', () => {
      const svc = createService()

      const bars = (svc as any).applyAdjFactor([])

      expect(bars).toHaveLength(0)
    })

    it('adjFactor=0 时 multiplier 退化为 1（防除零）', () => {
      const svc = createService()
      const rows = [makeOhlcvRow({ close: 10, open: 10, high: 11, low: 9, adjFactor: 0 })]

      const bars = (svc as any).applyAdjFactor(rows)

      expect(bars).toHaveLength(1)
      // factor=0 → multiplier=1 → close 不变
      expect(bars[0].close).toBe(10)
    })
  })

  // ── buildMaStatus() 私有方法 ──────────────────────────────────────────────

  describe('buildMaStatus() [private]', () => {
    it('history 为空时所有字段为 null', () => {
      const svc = createService()

      const status = (svc as any).buildMaStatus([])

      expect(status.bullishAlign).toBeNull()
      expect(status.bearishAlign).toBeNull()
      expect(status.aboveMa20).toBeNull()
      expect(status.aboveMa60).toBeNull()
      expect(status.aboveMa250).toBeNull()
      expect(status.latestCross).toBeNull()
    })

    it('单条 history 时 MA 均为 null，bullishAlign/bearishAlign 为 null', async () => {
      const prisma = buildPrismaMock()
      // 只有 1 条数据，所有 MA 都无法计算
      const rows = makeOhlcvRows(1)
      prisma.$queryRaw.mockResolvedValue(rows)
      const svc = createService(prisma)

      const result = await svc.getTechnicalIndicators({ tsCode: '000001.SZ' })

      expect(result.maStatus.bullishAlign).toBeNull()
      expect(result.maStatus.bearishAlign).toBeNull()
    })
  })

  // ── getRelativeStrength() ─────────────────────────────────────────────────

  describe('getRelativeStrength()', () => {
    it('股票无数据时返回空 history 和 null 摘要', async () => {
      const prisma = buildPrismaMock()
      prisma.$queryRaw.mockResolvedValue([])
      const svc = createService(prisma)

      const result = await svc.getRelativeStrength({ tsCode: '000001.SZ', benchmarkCode: '000300.SH', days: 60 })

      expect(result.tsCode).toBe('000001.SZ')
      expect(result.benchmarkCode).toBe('000300.SH')
      expect(result.benchmarkName).toBe('沪深300')
      expect(result.history).toHaveLength(0)
      expect(result.summary.stockTotalReturn).toBeNull()
    })

    it('benchmarkCode 未知时 benchmarkName 退化为 benchmarkCode 本身', async () => {
      const prisma = buildPrismaMock()
      prisma.$queryRaw.mockResolvedValue([])
      const svc = createService(prisma)

      const result = await svc.getRelativeStrength({ tsCode: '000001.SZ', benchmarkCode: 'UNKNOWN.XX', days: 60 })

      expect(result.benchmarkName).toBe('UNKNOWN.XX')
    })

    it('有共同交易日时计算累计收益率', async () => {
      const prisma = buildPrismaMock()

      const makeRow = (date: string, pctChg: number, close: number) => ({
        tradeDate: new Date(date),
        pctChg,
        close,
      })

      const stockRows = [
        makeRow('2024-01-02', 0, 10),
        makeRow('2024-01-03', 2, 10.2),
        makeRow('2024-01-04', 1, 10.3),
      ]
      const benchmarkRows = [
        makeRow('2024-01-02', 0, 3000),
        makeRow('2024-01-03', 1, 3030),
        makeRow('2024-01-04', 0.5, 3045),
      ]

      // 第一次 $queryRaw 返回 stockRows，第二次返回 benchmarkRows
      prisma.$queryRaw
        .mockResolvedValueOnce(stockRows)
        .mockResolvedValueOnce(benchmarkRows)

      const svc = createService(prisma)

      const result = await svc.getRelativeStrength({ tsCode: '000001.SZ', days: 60 })

      expect(result.history.length).toBeGreaterThan(0)
      expect(result.history[0].tradeDate).toBeDefined()
    })
  })

  // ── getTimingSignals() ────────────────────────────────────────────────────

  describe('getTimingSignals()', () => {
    it('无数据时 signals 为空数组', async () => {
      const prisma = buildPrismaMock()
      prisma.$queryRaw.mockResolvedValue([])
      const svc = createService(prisma)

      const result = await svc.getTimingSignals({ tsCode: '000001.SZ' })

      expect(result.tsCode).toBe('000001.SZ')
      expect(result.signals).toHaveLength(0)
    })

    it('有数据时返回 scoreSummary', async () => {
      const prisma = buildPrismaMock()
      const rows = makeOhlcvRows(150)
      prisma.$queryRaw.mockResolvedValue(rows)
      const svc = createService(prisma)

      const result = await svc.getTimingSignals({ tsCode: '000001.SZ', days: 30 })

      expect(result.scoreSummary).toBeDefined()
    })
  })
})
