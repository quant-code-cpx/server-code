/**
 * FactorOptimizationService — 单元测试
 *
 * 覆盖要点：
 * - MIN_VARIANCE 模式：返回权重之和等于 1，所有权重在 [0,1]
 * - MVO 模式：权重之和等于 1，高夏普情况下能收敛
 * - RISK_PARITY 模式：权重之和等于 1
 * - MAX_DIVERSIFICATION 模式：权重之和等于 1
 * - maxWeight 约束被遵守
 * - 数据不足（T < 10）时抛出错误
 * - saveAsStrategy 时调用 prisma.strategy.create
 */

import { FactorOptimizationService } from '../services/factor-optimization.service'
import { FactorOptimizationDto, OptimizationMode } from '../dto/factor-optimization.dto'

// 构造 T×n 伪收益率矩阵
function makeReturns(n: number, T: number, seed = 1): number[][] {
  const rng = (s: number) => {
    let x = s
    return () => {
      x = (x * 1664525 + 1013904223) & 0xffffffff
      return ((x >>> 0) / 0xffffffff - 0.5) * 0.04
    }
  }
  const r = rng(seed)
  return Array.from({ length: T }, () => Array.from({ length: n }, r))
}

function buildPrismaMock(n = 4, T = 60) {
  const tsCodes = Array.from({ length: n }, (_, i) => `00000${i + 1}.SZ`)
  const tradeDate = new Date('2024-12-31')
  const returnData = makeReturns(n, T)

  // Build daily rows
  const rows: Array<{ tsCode: string; tradeDate: Date; pctChg: number }> = []
  for (let t = 0; t < T; t++) {
    const d = new Date(tradeDate)
    d.setDate(tradeDate.getDate() - (T - t))
    for (let i = 0; i < n; i++) {
      rows.push({ tsCode: tsCodes[i], tradeDate: d, pctChg: returnData[t][i] * 100 })
    }
  }

  return {
    tsCodes,
    prisma: {
      daily: {
        findMany: jest.fn(async () => rows),
        findFirst: jest.fn(async () => ({ tradeDate })),
      },
      strategy: {
        create: jest.fn(async () => ({ id: 'strat-123' })),
      },
    },
  }
}

function createService(prismaMock: ReturnType<typeof buildPrismaMock>['prisma']) {
  return new FactorOptimizationService(prismaMock as any)
}

async function runMode(mode: OptimizationMode, extraDto: Partial<FactorOptimizationDto> = {}) {
  const { tsCodes, prisma } = buildPrismaMock()
  const svc = createService(prisma)
  const dto: FactorOptimizationDto = {
    tsCodes,
    mode,
    lookbackDays: 60,
    maxIterations: 300,
    ...extraDto,
  }
  return { result: await svc.optimize(dto, 1), prisma }
}

describe('FactorOptimizationService', () => {
  it('should produce weights summing to 1 in MIN_VARIANCE mode', async () => {
    const { result } = await runMode(OptimizationMode.MIN_VARIANCE)
    const sumW = result.weights.reduce((s, w) => s + w.weight, 0)
    expect(Math.abs(sumW - 1)).toBeLessThan(1e-4)
    for (const w of result.weights) {
      expect(w.weight).toBeGreaterThanOrEqual(-1e-6)
      expect(w.weight).toBeLessThanOrEqual(1 + 1e-6)
    }
  })

  it('should produce weights summing to 1 in MVO mode', async () => {
    const { result } = await runMode(OptimizationMode.MVO, { riskAversionLambda: 2 })
    const sumW = result.weights.reduce((s, w) => s + w.weight, 0)
    expect(Math.abs(sumW - 1)).toBeLessThan(1e-4)
  })

  it('should produce weights summing to 1 in RISK_PARITY mode', async () => {
    const { result } = await runMode(OptimizationMode.RISK_PARITY)
    const sumW = result.weights.reduce((s, w) => s + w.weight, 0)
    expect(Math.abs(sumW - 1)).toBeLessThan(1e-4)
  })

  it('should produce weights summing to 1 in MAX_DIVERSIFICATION mode', async () => {
    const { result } = await runMode(OptimizationMode.MAX_DIVERSIFICATION)
    const sumW = result.weights.reduce((s, w) => s + w.weight, 0)
    expect(Math.abs(sumW - 1)).toBeLessThan(1e-4)
  })

  it('should respect maxWeight constraint', async () => {
    const { result } = await runMode(OptimizationMode.MIN_VARIANCE, { maxWeight: 0.4 })
    for (const w of result.weights) {
      expect(w.weight).toBeLessThanOrEqual(0.4 + 1e-4)
    }
  })

  it('should return portfolio metrics', async () => {
    const { result } = await runMode(OptimizationMode.MIN_VARIANCE)
    expect(result.portfolioMetrics).toMatchObject({
      expectedReturn: expect.any(Number),
      volatility: expect.any(Number),
      sharpe: expect.any(Number),
      diversificationRatio: expect.any(Number),
      effectiveN: expect.any(Number),
    })
    expect(result.portfolioMetrics.volatility).toBeGreaterThan(0)
    expect(result.portfolioMetrics.effectiveN).toBeGreaterThan(0)
  })

  it('should throw if fewer than 2 stocks', async () => {
    const { prisma } = buildPrismaMock(1)
    const svc = createService(prisma)
    await expect(
      svc.optimize({ tsCodes: ['000001.SZ'], mode: OptimizationMode.MIN_VARIANCE } as FactorOptimizationDto, 1),
    ).rejects.toThrow('至少需要 2 只股票')
  })

  it('should throw if insufficient aligned data', async () => {
    const tsCodes = ['000001.SZ', '000002.SZ']
    // Only 5 days — below the 10-day threshold
    const rows = Array.from({ length: 5 }, (_, t) => [
      { tsCode: '000001.SZ', tradeDate: new Date(2024, 0, t + 1), pctChg: 0.1 },
      { tsCode: '000002.SZ', tradeDate: new Date(2024, 0, t + 1), pctChg: -0.1 },
    ]).flat()
    const prisma = {
      daily: {
        findMany: jest.fn(async () => rows),
        findFirst: jest.fn(async () => ({ tradeDate: new Date() })),
      },
      strategy: { create: jest.fn() },
    }
    const svc = createService(prisma as any)
    await expect(
      svc.optimize({ tsCodes, mode: OptimizationMode.MIN_VARIANCE } as FactorOptimizationDto, 1),
    ).rejects.toThrow('数据不足')
  })

  it('should call strategy.create when saveAsStrategy=true', async () => {
    const { prisma } = buildPrismaMock()
    const svc = createService(prisma)
    const result = await svc.optimize(
      {
        tsCodes: ['000001.SZ', '000002.SZ', '000003.SZ', '000004.SZ'],
        mode: OptimizationMode.MIN_VARIANCE,
        lookbackDays: 60,
        saveAsStrategy: true,
        strategyName: '测试策略',
      } as FactorOptimizationDto,
      1,
    )
    expect(prisma.strategy.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ name: '测试策略', strategyType: 'CUSTOM_POOL_REBALANCE' }),
      }),
    )
    expect(result.strategyId).toBe('strat-123')
  })

  it('should not call strategy.create when saveAsStrategy=false', async () => {
    const { result, prisma } = await runMode(OptimizationMode.MIN_VARIANCE)
    expect(prisma.strategy.create).not.toHaveBeenCalled()
    expect(result.strategyId).toBeUndefined()
  })
})
