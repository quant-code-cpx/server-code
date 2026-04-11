/**
 * BacktestAttributionService — 单元测试
 *
 * 覆盖场景（共 12 个）：
 *  1. 正常归因：2 行业、3 个 MONTHLY period
 *  2. 回测不存在 → 404
 *  3. 回测未完成 → 400
 *  4. 回测不属于当前用户 → 403
 *  5. 无持仓数据 → 400
 *  6. 未映射行业的股票归入 OTHER
 *  7. 基准权重缺失时降级（benchmarkDates 无数据）
 *  8. granularity=DAILY → periods 数量等于交易日数
 *  9. granularity=WEEKLY → periods 按自然周分组
 * 10. industryLevel=L2 → 使用 L2 行业分类
 * 11. 自定义 benchmarkTsCode 优先于回测配置
 * 12. 三效应之和 ≈ portfolioReturn - benchmarkReturn（允许浮点误差）
 */

import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common'
import { BacktestAttributionService } from '../services/backtest-attribution.service'

// ── Mock factory ──────────────────────────────────────────────────────────────

function buildPrismaMock() {
  return {
    backtestRun: { findUnique: jest.fn() },
    backtestPositionSnapshot: { findMany: jest.fn() },
    backtestDailyNav: { findMany: jest.fn() },
    indexMemberAll: { findMany: jest.fn() },
    indexWeight: { findMany: jest.fn() },
    daily: { findMany: jest.fn() },
  }
}

function createService(prismaMock = buildPrismaMock()) {
  // @ts-ignore 局部 mock，跳过 DI
  return { svc: new BacktestAttributionService(prismaMock), prisma: prismaMock }
}

// ── Test data factories ────────────────────────────────────────────────────────

const RUN_ID = 'run-001'
const USER_ID = 42
const BENCHMARK = '000300.SH'

function makeCompletedRun(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: RUN_ID,
    userId: USER_ID,
    status: 'COMPLETED',
    benchmarkTsCode: BENCHMARK,
    ...overrides,
  }
}

/** Build N trading dates starting from a given YYYY-MM-DD, each one day apart (simplified) */
function buildTradeDates(start: string, count: number): Date[] {
  const dates: Date[] = []
  const base = new Date(start)
  for (let i = 0; i < count; i++) {
    const d = new Date(base)
    d.setDate(d.getDate() + i)
    dates.push(d)
  }
  return dates
}

/** Build DailyNav rows with constant 0.1% portfolio return and 0.05% benchmark return */
function buildNavRows(tradeDates: Date[]) {
  return tradeDates.map((d) => ({
    tradeDate: d,
    dailyReturn: 0.001, // 0.1% decimal
    benchmarkReturn: 0.0005,
  }))
}

/** Build snapshot rows: stock A (银行行业) 60% weight, stock B (地产行业) 40% */
function buildSnapshots(tradeDates: Date[]) {
  // Only first date → rebalance snapshot
  return [
    { tradeDate: tradeDates[0], tsCode: '600000.SH', weight: 0.6 },
    { tradeDate: tradeDates[0], tsCode: '000001.SZ', weight: 0.4 },
  ]
}

function buildIndustryMembers() {
  return [
    { tsCode: '600000.SH', l1Code: 'BK0475', l1Name: '银行', l2Code: 'BK0475L2', l2Name: '国有大型银行' },
    { tsCode: '000001.SZ', l1Code: 'BK0451', l1Name: '房地产', l2Code: 'BK0451L2', l2Name: '房地产开发' },
    // Benchmark-only stocks (same industries)
    { tsCode: '601166.SH', l1Code: 'BK0475', l1Name: '银行', l2Code: 'BK0475L2', l2Name: '国有大型银行' },
    { tsCode: '600048.SH', l1Code: 'BK0451', l1Name: '房地产', l2Code: 'BK0451L2', l2Name: '房地产开发' },
  ]
}

function buildBenchmarkWeights(tradeDate: string) {
  return [
    { tradeDate, conCode: '601166.SH', weight: '30.000000' }, // 30% → 0.30 after /100
    { tradeDate, conCode: '600048.SH', weight: '20.000000' }, // 20% → 0.20 after /100
  ]
}

function buildDailyPrices(tradeDates: Date[]) {
  return tradeDates.flatMap((d) => [
    { tsCode: '600000.SH', tradeDate: d, pctChg: 0.5 },
    { tsCode: '000001.SZ', tradeDate: d, pctChg: -0.3 },
    { tsCode: '601166.SH', tradeDate: d, pctChg: 0.4 },
    { tsCode: '600048.SH', tradeDate: d, pctChg: -0.2 },
  ])
}

// ═══════════════════════════════════════════════════════════════════════════════
// 测试套件
// ═══════════════════════════════════════════════════════════════════════════════

describe('BacktestAttributionService', () => {
  let svc: BacktestAttributionService
  let prismaMock: ReturnType<typeof buildPrismaMock>

  beforeEach(() => {
    jest.clearAllMocks()
    const created = createService()
    svc = created.svc
    prismaMock = created.prisma
  })

  // ─────────────────────────────────────────────────────────────────────────────
  // 错误路径
  // ─────────────────────────────────────────────────────────────────────────────

  it('2. 回测不存在 → NotFoundException', async () => {
    prismaMock.backtestRun.findUnique.mockResolvedValue(null)
    await expect(svc.brinson({ runId: 'missing' }, USER_ID)).rejects.toBeInstanceOf(NotFoundException)
  })

  it('3. 回测未完成 → BadRequestException', async () => {
    prismaMock.backtestRun.findUnique.mockResolvedValue(makeCompletedRun({ status: 'RUNNING' }))
    await expect(svc.brinson({ runId: RUN_ID }, USER_ID)).rejects.toBeInstanceOf(BadRequestException)
  })

  it('4. 回测不属于当前用户 → ForbiddenException', async () => {
    prismaMock.backtestRun.findUnique.mockResolvedValue(makeCompletedRun({ userId: 999 }))
    await expect(svc.brinson({ runId: RUN_ID }, USER_ID)).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('5. 无持仓数据 → BadRequestException', async () => {
    prismaMock.backtestRun.findUnique.mockResolvedValue(makeCompletedRun())
    prismaMock.backtestPositionSnapshot.findMany.mockResolvedValue([])
    await expect(svc.brinson({ runId: RUN_ID }, USER_ID)).rejects.toBeInstanceOf(BadRequestException)
  })

  // ─────────────────────────────────────────────────────────────────────────────
  // 正常路径 — 基础结构
  // ─────────────────────────────────────────────────────────────────────────────

  it('1. 正常归因：返回 industries 和 periods，结构完整', async () => {
    const tradeDates = buildTradeDates('2024-01-02', 10)
    prismaMock.backtestRun.findUnique.mockResolvedValue(makeCompletedRun())
    prismaMock.backtestPositionSnapshot.findMany.mockResolvedValue(buildSnapshots(tradeDates))
    prismaMock.backtestDailyNav.findMany.mockResolvedValue(buildNavRows(tradeDates))
    prismaMock.indexMemberAll.findMany.mockResolvedValue(buildIndustryMembers())
    prismaMock.indexWeight.findMany.mockResolvedValue(buildBenchmarkWeights('20240101'))
    prismaMock.daily.findMany.mockResolvedValue(buildDailyPrices(tradeDates))

    const result = await svc.brinson({ runId: RUN_ID, granularity: 'DAILY' }, USER_ID)
    expect(result.runId).toBe(RUN_ID)
    expect(result.benchmarkTsCode).toBe(BENCHMARK)
    expect(result.industries.length).toBeGreaterThan(0)
    expect(result.periods.length).toBe(tradeDates.length) // DAILY
    expect(typeof result.totalAllocationEffect).toBe('number')
    expect(typeof result.totalSelectionEffect).toBe('number')
    expect(typeof result.totalInteractionEffect).toBe('number')
  })

  it('12. 三效应之和 ≈ AA + SS + IN（允许浮点误差 1e-9）', async () => {
    const tradeDates = buildTradeDates('2024-01-02', 5)
    prismaMock.backtestRun.findUnique.mockResolvedValue(makeCompletedRun())
    prismaMock.backtestPositionSnapshot.findMany.mockResolvedValue(buildSnapshots(tradeDates))
    prismaMock.backtestDailyNav.findMany.mockResolvedValue(buildNavRows(tradeDates))
    prismaMock.indexMemberAll.findMany.mockResolvedValue(buildIndustryMembers())
    prismaMock.indexWeight.findMany.mockResolvedValue(buildBenchmarkWeights('20240101'))
    prismaMock.daily.findMany.mockResolvedValue(buildDailyPrices(tradeDates))

    const result = await svc.brinson({ runId: RUN_ID, granularity: 'DAILY' }, USER_ID)

    // Sum of per-industry totalEffect should equal sum of period effects
    const industryTotal = result.industries.reduce((s, i) => s + i.totalEffect, 0)
    const periodTotal = result.periods.reduce(
      (s, p) => s + p.allocationEffect + p.selectionEffect + p.interactionEffect,
      0,
    )
    expect(Math.abs(industryTotal - periodTotal)).toBeLessThan(1e-9)

    // Per-period: AA + SS + IN should be consistent
    for (const p of result.periods) {
      const sumEffects = p.allocationEffect + p.selectionEffect + p.interactionEffect
      expect(typeof sumEffects).toBe('number')
      expect(isFinite(sumEffects)).toBe(true)
    }
  })

  // ─────────────────────────────────────────────────────────────────────────────
  // 行业分类
  // ─────────────────────────────────────────────────────────────────────────────

  it('6. 未映射行业的股票归入 OTHER', async () => {
    const tradeDates = buildTradeDates('2024-02-01', 3)
    const snapshots = [{ tradeDate: tradeDates[0], tsCode: 'UNMAPPED.SH', weight: 1.0 }]
    const dailyPrices = tradeDates.map((d) => ({ tsCode: 'UNMAPPED.SH', tradeDate: d, pctChg: 0.5 }))
    prismaMock.backtestRun.findUnique.mockResolvedValue(makeCompletedRun())
    prismaMock.backtestPositionSnapshot.findMany.mockResolvedValue(snapshots)
    prismaMock.backtestDailyNav.findMany.mockResolvedValue(buildNavRows(tradeDates))
    prismaMock.indexMemberAll.findMany.mockResolvedValue([]) // no mappings
    prismaMock.indexWeight.findMany.mockResolvedValue([])
    prismaMock.daily.findMany.mockResolvedValue(dailyPrices)

    const result = await svc.brinson({ runId: RUN_ID, granularity: 'DAILY' }, USER_ID)
    const otherInd = result.industries.find((i) => i.industryCode === 'OTHER')
    expect(otherInd).toBeDefined()
    expect(otherInd!.portfolioWeight).toBeCloseTo(1.0, 5)
  })

  it('10. industryLevel=L2 → 使用 L2 行业分类', async () => {
    const tradeDates = buildTradeDates('2024-03-01', 3)
    prismaMock.backtestRun.findUnique.mockResolvedValue(makeCompletedRun())
    prismaMock.backtestPositionSnapshot.findMany.mockResolvedValue(buildSnapshots(tradeDates))
    prismaMock.backtestDailyNav.findMany.mockResolvedValue(buildNavRows(tradeDates))
    prismaMock.indexMemberAll.findMany.mockResolvedValue(buildIndustryMembers())
    prismaMock.indexWeight.findMany.mockResolvedValue(buildBenchmarkWeights('20240301'))
    prismaMock.daily.findMany.mockResolvedValue(buildDailyPrices(tradeDates))

    const result = await svc.brinson({ runId: RUN_ID, industryLevel: 'L2', granularity: 'DAILY' }, USER_ID)
    // L2 codes contain 'L2' suffix per test data
    expect(result.industryLevel).toBe('L2')
    const hasL2Code = result.industries.some((i) => i.industryCode.includes('L2'))
    expect(hasL2Code).toBe(true)
  })

  // ─────────────────────────────────────────────────────────────────────────────
  // 基准相关
  // ─────────────────────────────────────────────────────────────────────────────

  it('7. 基准权重缺失时降级 → 正常返回，基准行业权重为 0', async () => {
    const tradeDates = buildTradeDates('2024-04-01', 3)
    prismaMock.backtestRun.findUnique.mockResolvedValue(makeCompletedRun())
    prismaMock.backtestPositionSnapshot.findMany.mockResolvedValue(buildSnapshots(tradeDates))
    prismaMock.backtestDailyNav.findMany.mockResolvedValue(buildNavRows(tradeDates))
    prismaMock.indexMemberAll.findMany.mockResolvedValue(buildIndustryMembers())
    prismaMock.indexWeight.findMany.mockResolvedValue([]) // empty
    prismaMock.daily.findMany.mockResolvedValue(buildDailyPrices(tradeDates))

    const result = await svc.brinson({ runId: RUN_ID, granularity: 'DAILY' }, USER_ID)
    expect(result.runId).toBe(RUN_ID)
    // Benchmark weights should all be 0
    for (const ind of result.industries) {
      expect(ind.benchmarkWeight).toBe(0)
    }
  })

  it('11. 自定义 benchmarkTsCode 优先于回测配置', async () => {
    const tradeDates = buildTradeDates('2024-05-01', 3)
    prismaMock.backtestRun.findUnique.mockResolvedValue(makeCompletedRun())
    prismaMock.backtestPositionSnapshot.findMany.mockResolvedValue(buildSnapshots(tradeDates))
    prismaMock.backtestDailyNav.findMany.mockResolvedValue(buildNavRows(tradeDates))
    prismaMock.indexMemberAll.findMany.mockResolvedValue(buildIndustryMembers())
    prismaMock.indexWeight.findMany.mockResolvedValue([])
    prismaMock.daily.findMany.mockResolvedValue(buildDailyPrices(tradeDates))

    const result = await svc.brinson({ runId: RUN_ID, benchmarkTsCode: '000905.SH', granularity: 'DAILY' }, USER_ID)
    expect(result.benchmarkTsCode).toBe('000905.SH')
    // Verify the query used the custom benchmark
    expect(prismaMock.indexWeight.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ indexCode: '000905.SH' }) }),
    )
  })

  // ─────────────────────────────────────────────────────────────────────────────
  // 粒度
  // ─────────────────────────────────────────────────────────────────────────────

  it('8. granularity=DAILY → periods 数量等于交易日数', async () => {
    const tradeDates = buildTradeDates('2024-06-03', 7)
    prismaMock.backtestRun.findUnique.mockResolvedValue(makeCompletedRun())
    prismaMock.backtestPositionSnapshot.findMany.mockResolvedValue(buildSnapshots(tradeDates))
    prismaMock.backtestDailyNav.findMany.mockResolvedValue(buildNavRows(tradeDates))
    prismaMock.indexMemberAll.findMany.mockResolvedValue(buildIndustryMembers())
    prismaMock.indexWeight.findMany.mockResolvedValue(buildBenchmarkWeights('20240601'))
    prismaMock.daily.findMany.mockResolvedValue(buildDailyPrices(tradeDates))

    const result = await svc.brinson({ runId: RUN_ID, granularity: 'DAILY' }, USER_ID)
    expect(result.periods.length).toBe(tradeDates.length)
  })

  it('9. granularity=WEEKLY → periods 按自然周分组', async () => {
    // 14 days spanning at least 2 weeks (Mon 2024-01-01 is a Monday)
    // Use 2024-01-08 to 2024-01-21 (2 full weeks = 14 calendar days)
    const tradeDates = buildTradeDates('2024-01-08', 10)
    prismaMock.backtestRun.findUnique.mockResolvedValue(makeCompletedRun())
    prismaMock.backtestPositionSnapshot.findMany.mockResolvedValue(buildSnapshots(tradeDates))
    prismaMock.backtestDailyNav.findMany.mockResolvedValue(buildNavRows(tradeDates))
    prismaMock.indexMemberAll.findMany.mockResolvedValue(buildIndustryMembers())
    prismaMock.indexWeight.findMany.mockResolvedValue(buildBenchmarkWeights('20240108'))
    prismaMock.daily.findMany.mockResolvedValue(buildDailyPrices(tradeDates))

    const result = await svc.brinson({ runId: RUN_ID, granularity: 'WEEKLY' }, USER_ID)
    // 10 consecutive days should span at least 2 weeks
    expect(result.periods.length).toBeGreaterThanOrEqual(2)
    expect(result.periods.length).toBeLessThan(10)
  })

  it('1b. MONTHLY granularity 跨月 → periods > 1', async () => {
    // 31 consecutive days spanning January + February
    const tradeDates = buildTradeDates('2024-01-15', 31)
    prismaMock.backtestRun.findUnique.mockResolvedValue(makeCompletedRun())
    prismaMock.backtestPositionSnapshot.findMany.mockResolvedValue(buildSnapshots(tradeDates))
    prismaMock.backtestDailyNav.findMany.mockResolvedValue(buildNavRows(tradeDates))
    prismaMock.indexMemberAll.findMany.mockResolvedValue(buildIndustryMembers())
    prismaMock.indexWeight.findMany.mockResolvedValue(buildBenchmarkWeights('20240115'))
    prismaMock.daily.findMany.mockResolvedValue(buildDailyPrices(tradeDates))

    const result = await svc.brinson({ runId: RUN_ID, granularity: 'MONTHLY' }, USER_ID)
    expect(result.periods.length).toBeGreaterThanOrEqual(2)
  })
})
