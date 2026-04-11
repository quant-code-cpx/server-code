/**
 * FactorOptimizationService
 *
 * 纯 TypeScript 实现的投资组合优化器，支持四种模式：
 *   - MVO  (均值-方差最优，最大化 Sharpe)
 *   - MIN_VARIANCE  (最小方差)
 *   - RISK_PARITY   (风险平价，Equal Risk Contribution)
 *   - MAX_DIVERSIFICATION (最大分散化比率)
 *
 * 协方差矩阵使用 Ledoit-Wolf 线性收缩估计。
 * 权重求解采用 Projected Gradient Descent + Barzilai-Borwein 自适应步长。
 */

import { Injectable } from '@nestjs/common'
import { PrismaService } from 'src/shared/prisma.service'
import { FactorOptimizationDto, OptimizationMode } from '../dto/factor-optimization.dto'

// ─── 数值工具函数 ─────────────────────────────────────────────────────────────

/** 矩阵向量乘法 Σ·w，返回新向量 */
function matVecMul(mat: number[][], vec: number[]): number[] {
  return mat.map((row) => row.reduce((s, v, j) => s + v * vec[j], 0))
}

/** 向量点积 */
function dot(a: number[], b: number[]): number {
  return a.reduce((s, v, i) => s + v * b[i], 0)
}

/** 向量加法 */
function vecAdd(a: number[], b: number[], scale = 1): number[] {
  return a.map((v, i) => v + scale * b[i])
}

/** 样本均值 */
function mean(arr: number[]): number {
  return arr.reduce((s, v) => s + v, 0) / arr.length
}

/** 投影到单纯形：sum=1，minW ≤ w_i ≤ maxW（Iterative Clipping 方法） */
function projectToSimplex(w: number[], minW: number, maxW: number, n: number): number[] {
  // 先 clip 到 [minW, maxW]，再把超出 sum=1 的部分迭代裁剪
  const result = w.map((v) => Math.min(maxW, Math.max(minW, v)))
  // 简单迭代调整到 sum=1
  for (let iter = 0; iter < 200; iter++) {
    const s = result.reduce((a, b) => a + b, 0)
    const excess = s - 1
    if (Math.abs(excess) < 1e-10) break
    const free = result.filter((v) => v > minW + 1e-12 && v < maxW - 1e-12).length
    if (free === 0) break
    const adj = excess / Math.max(free, 1)
    for (let i = 0; i < n; i++) {
      if (result[i] > minW + 1e-12 && result[i] < maxW - 1e-12) {
        result[i] -= adj
        result[i] = Math.min(maxW, Math.max(minW, result[i]))
      }
    }
  }
  // Final renormalize
  const total = result.reduce((a, b) => a + b, 0)
  return result.map((v) => v / total)
}

/** Ledoit-Wolf 线性收缩（Oracle 近似公式） */
function ledoitWolfShrink(returns: number[][], target: 'identity' | 'constant_correlation' = 'identity'): number[][] {
  const T = returns.length
  const n = returns[0].length

  // 样本均值
  const means = Array.from({ length: n }, (_, j) => returns.reduce((s, r) => s + r[j], 0) / T)

  // 样本协方差
  const S: number[][] = Array.from({ length: n }, () => new Array(n).fill(0))
  for (let t = 0; t < T; t++) {
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        S[i][j] += (returns[t][i] - means[i]) * (returns[t][j] - means[j])
      }
    }
  }
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) S[i][j] /= T - 1

  // 收缩目标矩阵
  const F: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => {
      if (i === j) return S[i][i]
      if (target === 'identity') return 0
      // constant_correlation: rho * sqrt(S[i][i] * S[j][j])
      const sigI = Math.sqrt(Math.max(S[i][i], 1e-10))
      const sigJ = Math.sqrt(Math.max(S[j][j], 1e-10))
      // Average off-diagonal correlation
      let sumCorr = 0,
        cnt = 0
      for (let a = 0; a < n; a++) {
        for (let b = a + 1; b < n; b++) {
          const sigA = Math.sqrt(Math.max(S[a][a], 1e-10))
          const sigB = Math.sqrt(Math.max(S[b][b], 1e-10))
          sumCorr += S[a][b] / (sigA * sigB)
          cnt++
        }
      }
      const rhoBar = cnt > 0 ? sumCorr / cnt : 0
      return rhoBar * sigI * sigJ
    }),
  )

  // Ledoit-Wolf oracle 近似公式（分析解）
  // alpha = ||S - F||^2_F / T
  let num = 0,
    denom = 0
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const diff = S[i][j] - F[i][j]
      num += diff * diff
    }
  }
  // Estimation error term (simplified oracle)
  for (let t = 0; t < T; t++) {
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const d = (returns[t][i] - means[i]) * (returns[t][j] - means[j]) - S[i][j]
        denom += d * d
      }
    }
  }
  denom = T > 1 ? denom / (T * (T - 1)) : 1
  const shrinkage = denom > 0 ? Math.min(1, Math.max(0, num / denom)) : 0

  // Σ_shrink = (1 - α) * S + α * F
  return S.map((row, i) => row.map((v, j) => (1 - shrinkage) * v + shrinkage * F[i][j]))
}

// ─── 服务实现 ─────────────────────────────────────────────────────────────────

export interface OptimizationResult {
  weights: Array<{ tsCode: string; weight: number }>
  portfolioMetrics: {
    expectedReturn: number
    volatility: number
    sharpe: number
    diversificationRatio: number
    effectiveN: number
  }
  shrinkageIntensity: number
  converged: boolean
  iterations: number
  strategyId?: string
}

@Injectable()
export class FactorOptimizationService {
  constructor(private readonly prisma: PrismaService) {}

  async optimize(dto: FactorOptimizationDto, userId: number): Promise<OptimizationResult> {
    const {
      tsCodes,
      mode,
      lookbackDays = 252,
      riskAversionLambda = 1,
      maxWeight = 1,
      minWeight = 0,
      maxIterations = 500,
      shrinkageTarget = 'identity',
      saveAsStrategy = false,
    } = dto

    const n = tsCodes.length
    if (n < 2) throw new Error('至少需要 2 只股票才能进行组合优化')

    // ─── 1. 获取收益率序列 ─────────────────────────────────────────────────
    const endDate = await this.resolveEndDate(dto.endDate)

    const dailyRows = await this.prisma.daily.findMany({
      where: { tsCode: { in: tsCodes }, tradeDate: { lte: endDate } },
      orderBy: { tradeDate: 'asc' },
      select: { tsCode: true, tradeDate: true, pctChg: true },
    })

    // Group by date, align dates
    const dateMap = new Map<string, Map<string, number>>()
    for (const row of dailyRows) {
      const d = row.tradeDate instanceof Date ? row.tradeDate.getTime() : new Date(row.tradeDate).getTime()
      const key = String(d)
      if (!dateMap.has(key)) dateMap.set(key, new Map())
      dateMap.get(key)!.set(row.tsCode, (row.pctChg ?? 0) / 100)
    }

    const sortedDates = [...dateMap.keys()].sort()
    const cutoff = sortedDates.length > lookbackDays ? sortedDates.length - lookbackDays : 0
    const windowDates = sortedDates.slice(cutoff)

    // Build aligned return matrix [T x n], skip rows with missing codes
    const returnMatrix: number[][] = []
    for (const d of windowDates) {
      const row = dateMap.get(d)!
      if (tsCodes.every((c) => row.has(c))) {
        returnMatrix.push(tsCodes.map((c) => row.get(c)!))
      }
    }

    const T = returnMatrix.length
    if (T < 10) throw new Error(`数据不足：有效对齐交易日仅 ${T} 天，至少需要 10 天`)

    // ─── 2. 估计期望收益率和协方差矩阵 ────────────────────────────────────
    const meanReturns = Array.from({ length: n }, (_, j) => returnMatrix.reduce((s, r) => s + r[j], 0) / T)

    // Ledoit-Wolf 收缩协方差
    const sigmaShrunken = ledoitWolfShrink(returnMatrix, shrinkageTarget)

    // 估算收缩强度（对角线偏差指标）
    const sampleDiag = Array.from(
      { length: n },
      (_, i) => returnMatrix.reduce((s, r) => s + (r[i] - meanReturns[i]) ** 2, 0) / (T - 1),
    )
    const totalDiff = sampleDiag.reduce((s, v, i) => s + Math.abs(sigmaShrunken[i][i] - v), 0)
    const shrinkageIntensity = totalDiff / (sampleDiag.reduce((a, b) => a + b, 0) + 1e-10)

    // ─── 3. 优化权重 ────────────────────────────────────────────────────────
    const effectiveMin = Math.min(minWeight, 1 / n)
    const effectiveMax = Math.min(maxWeight, 1)

    // 初始权重：等权
    let w = new Array(n).fill(1 / n)

    let converged = false
    let iterations = 0
    let gradPrev: number[] | null = null
    let wPrev: number[] | null = null
    let stepSize = 1 / (n * 10)

    for (let it = 0; it < maxIterations; it++) {
      const grad = this.computeGradient(mode, w, sigmaShrunken, meanReturns, riskAversionLambda, n)

      // BB 步长
      if (gradPrev !== null && wPrev !== null) {
        const dw = w.map((v, i) => v - wPrev![i])
        const dg = grad.map((v, i) => v - gradPrev![i])
        const dwDg = dot(dw, dg)
        const dgDg = dot(dg, dg)
        if (Math.abs(dwDg) > 1e-14 && dgDg > 1e-14) {
          stepSize = Math.min(Math.max(Math.abs(dwDg / dgDg), 1e-8), 1e2)
        }
      }

      gradPrev = [...grad]
      wPrev = [...w]

      // Gradient descent step
      const wNew = projectToSimplex(vecAdd(w, grad, -stepSize), effectiveMin, effectiveMax, n)

      const diff = Math.sqrt(wNew.reduce((s, v, i) => s + (v - w[i]) ** 2, 0))
      w = wNew
      iterations = it + 1

      if (diff < 1e-7) {
        converged = true
        break
      }
    }

    // ─── 4. 计算组合指标 ──────────────────────────────────────────────────
    const Sw = matVecMul(sigmaShrunken, w)
    const portfolioVar = dot(w, Sw)
    const portfolioVol = Math.sqrt(Math.max(portfolioVar, 0)) * Math.sqrt(252)
    const portfolioRet = dot(w, meanReturns) * 252
    const sharpe = portfolioVol > 1e-10 ? portfolioRet / portfolioVol : 0

    // Diversification Ratio = weighted-avg-vol / portfolio-vol
    const stockVols = sigmaShrunken.map((_, i) => Math.sqrt(Math.max(sigmaShrunken[i][i], 0)) * Math.sqrt(252))
    const weightedAvgVol = dot(w, stockVols)
    const diversificationRatio = portfolioVol > 1e-10 ? weightedAvgVol / portfolioVol : 1

    // Effective N (inverse of Herfindahl)
    const hhi = w.reduce((s, v) => s + v * v, 0)
    const effectiveN = hhi > 1e-10 ? 1 / hhi : n

    const portfolioMetrics = {
      expectedReturn: Number(portfolioRet.toFixed(6)),
      volatility: Number(portfolioVol.toFixed(6)),
      sharpe: Number(sharpe.toFixed(4)),
      diversificationRatio: Number(diversificationRatio.toFixed(4)),
      effectiveN: Number(effectiveN.toFixed(2)),
    }

    const weights = tsCodes.map((tsCode, i) => ({
      tsCode,
      weight: Number(w[i].toFixed(6)),
    }))

    // ─── 5. 可选：保存为策略 ──────────────────────────────────────────────
    let strategyId: string | undefined
    if (saveAsStrategy) {
      const strategyName =
        dto.strategyName ?? `${mode} 组合优化 (${tsCodes.length}只股票/${new Date().toISOString().slice(0, 10)})`
      const record = await this.prisma.strategy.create({
        data: {
          userId,
          name: strategyName,
          strategyType: 'CUSTOM_POOL_REBALANCE',
          description: `${mode} 模式优化，${tsCodes.length} 只股票，查看期 ${lookbackDays} 天`,
          strategyConfig: {
            mode,
            tsCodes,
            weights: weights.reduce(
              (acc, { tsCode, weight }) => ({ ...acc, [tsCode]: weight }),
              {} as Record<string, number>,
            ),
            lookbackDays,
            portfolioMetrics,
          },
          isPublic: false,
        },
        select: { id: true },
      })
      strategyId = record.id
    }

    return {
      weights,
      portfolioMetrics,
      shrinkageIntensity: Number(shrinkageIntensity.toFixed(4)),
      converged,
      iterations,
      ...(strategyId ? { strategyId } : {}),
    }
  }

  /** 根据优化模式计算目标函数的梯度（最小化形式） */
  private computeGradient(
    mode: OptimizationMode,
    w: number[],
    sigma: number[][],
    mu: number[],
    lambda: number,
    n: number,
  ): number[] {
    const Sw = matVecMul(sigma, w)

    switch (mode) {
      case OptimizationMode.MVO: {
        // min  lambda * w^T Σ w - w^T μ
        return Sw.map((v, i) => 2 * lambda * v - mu[i])
      }
      case OptimizationMode.MIN_VARIANCE: {
        // min  w^T Σ w
        return Sw.map((v) => 2 * v)
      }
      case OptimizationMode.RISK_PARITY: {
        // min  Σ_i (w_i (Σw)_i - 1/n)^2  [ERC: equal risk contribution]
        const wVar = dot(w, Sw)
        const rc = w.map((wi, i) => wi * Sw[i]) // risk contributions
        const targetRc = wVar / n
        // gradient of Σ_i (rc_i - target)^2
        const grad = new Array(n).fill(0)
        for (let i = 0; i < n; i++) {
          const err = rc[i] - targetRc
          // d/dw_j [ w_i (Σw)_i ] = delta(i,j)(Σw)_i + w_i sigma[i][j]
          for (let j = 0; j < n; j++) {
            grad[j] += 2 * err * ((i === j ? Sw[i] : 0) + w[i] * sigma[i][j])
          }
        }
        return grad
      }
      case OptimizationMode.MAX_DIVERSIFICATION: {
        // max  DR = (Σ w_i σ_i) / sqrt(w^T Σ w)
        // equiv min  - (Σ w_i σ_i) / sqrt(w^T Σ w)
        const stockVols = sigma.map((_, i) => Math.sqrt(Math.max(sigma[i][i], 1e-12)))
        const numerator = dot(w, stockVols)
        const denomSq = Math.max(dot(w, Sw), 1e-12)
        const denom = Math.sqrt(denomSq)

        return stockVols.map((si, i) => {
          const dNum = si // d(numerator)/dw_i
          const dDenom = Sw[i] / denom // d(denom)/dw_i
          // d/dw_i (-f) = -(dNum * denom - numerator * dDenom) / denom^2
          return -(dNum * denom - numerator * dDenom) / denomSq
        })
      }
    }
  }

  private async resolveEndDate(endDate?: string): Promise<Date> {
    if (endDate) {
      const y = parseInt(endDate.slice(0, 4), 10)
      const m = parseInt(endDate.slice(4, 6), 10) - 1
      const d = parseInt(endDate.slice(6, 8), 10)
      return new Date(y, m, d)
    }
    const latest = await this.prisma.daily.findFirst({
      orderBy: { tradeDate: 'desc' },
      select: { tradeDate: true },
    })
    return latest?.tradeDate ?? new Date()
  }
}
