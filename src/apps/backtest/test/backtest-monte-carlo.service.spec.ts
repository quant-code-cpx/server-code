/**
 * BacktestMonteCarloService — 单元测试
 *
 * 覆盖要点：
 * - makeRng: 有种子时确定性，无种子时随机性
 * - compute: finalNavDistribution、timeSeries、percentile 排序
 * - compute: 固定种子的可重现性
 * - compute: 单日收益的边界情况
 * - runMonteCarloSimulation: Prisma 异常路径（run不存在、数据不足、初始NAV为0）
 */
import { NotFoundException } from '@nestjs/common'
import { BacktestMonteCarloService } from '../services/backtest-monte-carlo.service'

// ── mock 工厂 ─────────────────────────────────────────────────────────────────

function buildPrismaMock() {
  return {
    backtestRun: { findUnique: jest.fn() },
    backtestDailyNav: { findMany: jest.fn() },
  }
}

function createService(prismaMock = buildPrismaMock()): BacktestMonteCarloService {
  // @ts-ignore 局部 mock，跳过 DI
  return new BacktestMonteCarloService(prismaMock)
}

// ── 测试数据工厂 ───────────────────────────────────────────────────────────────

/** 构造 N 行 navRows，每天稳定 +0.1% 收益 */
function buildNavRows(n: number, dailyReturn = 0.001) {
  const rows: Array<{ nav: number | null; dailyReturn: number | null }> = []
  let nav = 1.0
  for (let i = 0; i < n; i++) {
    nav = nav * (1 + dailyReturn)
    rows.push({ nav, dailyReturn })
  }
  return rows
}

// ═══════════════════════════════════════════════════════════════════════════════
// 测试套件
// ═══════════════════════════════════════════════════════════════════════════════

describe('BacktestMonteCarloService', () => {
  let service: BacktestMonteCarloService

  beforeEach(() => {
    jest.clearAllMocks()
    service = createService()
  })

  // ── makeRng ────────────────────────────────────────────────────────────────

  describe('makeRng()', () => {
    it('固定种子产生确定性序列', () => {
      const rng1 = (service as any).makeRng(42)
      const rng2 = (service as any).makeRng(42)
      const seq1 = Array.from({ length: 10 }, () => rng1())
      const seq2 = Array.from({ length: 10 }, () => rng2())
      expect(seq1).toEqual(seq2)
    })

    it('所有值在 [0, 1) 范围内', () => {
      const rng = (service as any).makeRng(123)
      for (let i = 0; i < 100; i++) {
        const v = rng()
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(1)
      }
    })

    it('不同种子产生不同序列', () => {
      const rng1 = (service as any).makeRng(1)
      const rng2 = (service as any).makeRng(2)
      const seq1 = Array.from({ length: 5 }, () => rng1())
      const seq2 = Array.from({ length: 5 }, () => rng2())
      expect(seq1).not.toEqual(seq2)
    })
  })

  // ── compute ────────────────────────────────────────────────────────────────

  describe('compute()', () => {
    const defaultOptions = {
      numSimulations: 500,
      confidenceLevels: [0.05, 0.25, 0.5, 0.75, 0.95],
      seed: 42,
    }

    it('finalNavDistribution.mean 在合理范围内（0.5 ~ 2.0）', () => {
      const navRows = buildNavRows(60, 0.001)
      const result = (service as any).compute(navRows, defaultOptions)
      expect(result.finalNavDistribution.mean).toBeGreaterThan(0.5)
      expect(result.finalNavDistribution.mean).toBeLessThan(2.0)
    })

    it('positiveReturnProbability 在 [0, 1] 范围内', () => {
      const navRows = buildNavRows(60, 0.001)
      const result = (service as any).compute(navRows, defaultOptions)
      expect(result.finalNavDistribution.positiveReturnProbability).toBeGreaterThanOrEqual(0)
      expect(result.finalNavDistribution.positiveReturnProbability).toBeLessThanOrEqual(1)
    })

    it('timeSeries 长度等于 dailyReturns.length + 1', () => {
      const navRows = buildNavRows(30)
      const result = (service as any).compute(navRows, defaultOptions)
      expect(result.timeSeries).toHaveLength(navRows.length + 1)
    })

    it('百分位数按序排列（5th < 25th < 50th < 75th < 95th）', () => {
      const navRows = buildNavRows(60)
      const result = (service as any).compute(navRows, defaultOptions)
      const p = result.finalNavDistribution.percentiles
      expect(p['5']).toBeLessThanOrEqual(p['25'])
      expect(p['25']).toBeLessThanOrEqual(p['50'])
      expect(p['50']).toBeLessThanOrEqual(p['75'])
      expect(p['75']).toBeLessThanOrEqual(p['95'])
    })

    it('固定种子产生完全相同的结果（可重现性）', () => {
      const navRows = buildNavRows(50)
      const result1 = (service as any).compute(navRows, { ...defaultOptions, seed: 99 })
      const result2 = (service as any).compute(navRows, { ...defaultOptions, seed: 99 })
      expect(result1.finalNavDistribution.mean).toBe(result2.finalNavDistribution.mean)
      expect(result1.finalNavDistribution.std).toBe(result2.finalNavDistribution.std)
      expect(result1.originalFinalNav).toBe(result2.originalFinalNav)
    })

    it('单日收益也能产生有效结果', () => {
      const navRows = buildNavRows(1, 0.005)
      const result = (service as any).compute(navRows, { ...defaultOptions, numSimulations: 100 })
      expect(result.timeSeries).toHaveLength(2) // 1 return + 1 initial
      expect(result.finalNavDistribution.mean).toBeGreaterThan(0)
    })

    it('originalFinalNav 和 originalTotalReturn 基于原始 nav 数组', () => {
      const navRows = buildNavRows(10, 0.01)
      const result = (service as any).compute(navRows, defaultOptions)
      // navRows[0].nav 是第一天，navRows[9].nav 是最后一天
      const firstNav = Number(navRows[0].nav)
      const lastNav = Number(navRows[9].nav)
      expect(result.originalFinalNav).toBeCloseTo(lastNav / firstNav, 6)
      expect(result.originalTotalReturn).toBeCloseTo(result.originalFinalNav - 1, 6)
    })

    it('numSimulations 正确传入并反映在输出中', () => {
      const navRows = buildNavRows(20)
      const result = (service as any).compute(navRows, { ...defaultOptions, numSimulations: 200 })
      expect(result.numSimulations).toBe(200)
    })

    it('maxDrawdownDistribution.mean <= 0', () => {
      const navRows = buildNavRows(60)
      const result = (service as any).compute(navRows, defaultOptions)
      expect(result.maxDrawdownDistribution.mean).toBeLessThanOrEqual(0)
    })
  })

  // ── runMonteCarloSimulation（Prisma 异常路径）─────────────────────────────

  describe('runMonteCarloSimulation()', () => {
    it('run 不存在时抛出 NotFoundException', async () => {
      const prismaMock = buildPrismaMock()
      prismaMock.backtestRun.findUnique.mockResolvedValue(null)
      const svc = createService(prismaMock)

      await expect(svc.runMonteCarloSimulation('nonexistent-id', {} as any)).rejects.toThrow(NotFoundException)
    })

    it('NAV 数据不足（< 2 行）时抛出 NotFoundException', async () => {
      const prismaMock = buildPrismaMock()
      prismaMock.backtestRun.findUnique.mockResolvedValue({ id: 'run-1' })
      prismaMock.backtestDailyNav.findMany.mockResolvedValue([{ nav: 1.0, dailyReturn: 0 }])
      const svc = createService(prismaMock)

      await expect(svc.runMonteCarloSimulation('run-1', {} as any)).rejects.toThrow(NotFoundException)
    })

    it('初始 NAV 为 0 时抛出 NotFoundException', async () => {
      const prismaMock = buildPrismaMock()
      prismaMock.backtestRun.findUnique.mockResolvedValue({ id: 'run-1' })
      prismaMock.backtestDailyNav.findMany.mockResolvedValue([
        { nav: 0, dailyReturn: 0 },
        { nav: 1.0, dailyReturn: 0 },
      ])
      const svc = createService(prismaMock)

      await expect(svc.runMonteCarloSimulation('run-1', {} as any)).rejects.toThrow(NotFoundException)
    })

    it('正常数据时返回包含 finalNavDistribution 的结果', async () => {
      const prismaMock = buildPrismaMock()
      prismaMock.backtestRun.findUnique.mockResolvedValue({ id: 'run-1' })
      prismaMock.backtestDailyNav.findMany.mockResolvedValue(buildNavRows(30))
      const svc = createService(prismaMock)

      const result = await svc.runMonteCarloSimulation('run-1', { numSimulations: 100, seed: 42 } as any)
      expect(result).toHaveProperty('finalNavDistribution')
      expect(result).toHaveProperty('timeSeries')
    })
  })
})
