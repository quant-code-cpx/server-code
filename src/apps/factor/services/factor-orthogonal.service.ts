import { Injectable, Logger } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from 'src/shared/prisma.service'
import { FactorComputeService } from './factor-compute.service'
import { FactorOrthogonalizeDto, FamaMacBethDto } from '../dto/factor-orthogonal.dto'

// ── Linear algebra helpers (small matrices, no external dep) ─────────────────

function mean(arr: number[]): number {
  if (!arr.length) return 0
  return arr.reduce((s, v) => s + v, 0) / arr.length
}

function stdDev(arr: number[], mu?: number): number {
  if (arr.length < 2) return 0
  const m = mu ?? mean(arr)
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1))
}

/** Transpose a matrix (array of columns → array of rows, or vice versa) */
function transpose(m: number[][]): number[][] {
  if (!m.length || !m[0].length) return []
  const rows = m.length
  const cols = m[0].length
  const result: number[][] = Array.from({ length: cols }, () => new Array(rows))
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      result[j][i] = m[i][j]
    }
  }
  return result
}

/** Matrix multiply A (m×k) * B (k×n) → C (m×n) */
function matMul(A: number[][], B: number[][]): number[][] {
  const m = A.length
  const k = A[0]?.length ?? 0
  const n = B[0]?.length ?? 0
  const C: number[][] = Array.from({ length: m }, () => new Array(n).fill(0))
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      for (let p = 0; p < k; p++) {
        C[i][j] += A[i][p] * B[p][j]
      }
    }
  }
  return C
}

/** Invert a small square matrix via Gauss-Jordan elimination. Returns null if singular. */
function invertMatrix(mat: number[][]): number[][] | null {
  const n = mat.length
  const aug: number[][] = mat.map((row, i) => {
    const augRow = new Array(2 * n).fill(0)
    for (let j = 0; j < n; j++) augRow[j] = row[j]
    augRow[n + i] = 1
    return augRow
  })

  for (let col = 0; col < n; col++) {
    // Partial pivoting
    let maxRow = col
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(aug[row][col]) > Math.abs(aug[maxRow][col])) maxRow = row
    }
    if (maxRow !== col) [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]]

    const pivot = aug[col][col]
    if (Math.abs(pivot) < 1e-12) return null // singular

    for (let j = 0; j < 2 * n; j++) aug[col][j] /= pivot

    for (let row = 0; row < n; row++) {
      if (row === col) continue
      const factor = aug[row][col]
      for (let j = 0; j < 2 * n; j++) aug[row][j] -= factor * aug[col][j]
    }
  }

  return aug.map((row) => row.slice(n))
}

/** OLS: beta = (X'X)^{-1} X'y. Returns beta vector. */
function olsBeta(X: number[][], y: number[]): number[] | null {
  const Xt = transpose(X)
  const XtX = matMul(Xt, X)
  const inv = invertMatrix(XtX)
  if (!inv) return null
  const yCol = y.map((v) => [v])
  const Xty = matMul(Xt, yCol)
  const beta = matMul(inv, Xty)
  return beta.map((row) => row[0])
}

/** Compute residuals y - X * beta */
function residuals(X: number[][], y: number[], beta: number[]): number[] {
  return y.map((yi, i) => {
    const predicted = X[i].reduce((s, xij, j) => s + xij * beta[j], 0)
    return yi - predicted
  })
}

/** Compute R² */
function rSquared(y: number[], yHat: number[]): number {
  const mu = mean(y)
  const ssTot = y.reduce((s, v) => s + (v - mu) ** 2, 0)
  if (ssTot === 0) return 0
  const ssRes = y.reduce((s, v, i) => s + (v - yHat[i]) ** 2, 0)
  return 1 - ssRes / ssTot
}

/** Compute Cholesky decomposition L, then return L^{-1} for symmetric orthogonalization. */
function symmetricMatSqrtInv(C: number[][]): number[][] | null {
  const n = C.length
  // Simple approach: Cholesky decomposition L, then L^{-1}
  // For small n (<=20) this is sufficient
  const L: number[][] = Array.from({ length: n }, () => new Array(n).fill(0))
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = C[i][j]
      for (let k = 0; k < j; k++) sum -= L[i][k] * L[j][k]
      if (i === j) {
        if (sum <= 0) return null // not positive definite
        L[i][j] = Math.sqrt(sum)
      } else {
        L[i][j] = sum / L[j][j]
      }
    }
  }

  // Invert L
  const Linv = invertMatrix(L)
  if (!Linv) return null
  return Linv
}

// ── Trading date helper ──────────────────────────────────────────────────────

interface TradeCalRow {
  cal_date: Date
}

function formatDateStr(d: Date): string {
  const dd = d instanceof Date ? d : new Date(d)
  return `${dd.getUTCFullYear()}${String(dd.getUTCMonth() + 1).padStart(2, '0')}${String(dd.getUTCDate()).padStart(2, '0')}`
}

// ── Service ──────────────────────────────────────────────────────────────────

/** Hard cap on number of factors to prevent unbounded iteration */
const MAX_FACTORS = 20

@Injectable()
export class FactorOrthogonalService {
  private readonly logger = new Logger(FactorOrthogonalService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly compute: FactorComputeService,
  ) {}

  // ── Orthogonalization ──────────────────────────────────────────────────────

  async orthogonalize(dto: FactorOrthogonalizeDto) {
    const { factorNames, tradeDate, universe, method = 'regression' } = dto

    // 1. Load factor values for all factors
    const factorMaps = new Map<string, Map<string, number>>()
    for (const fn of factorNames) {
      const raw = await this.compute.getRawFactorValuesForDate(fn, tradeDate, universe)
      const map = new Map<string, number>()
      for (const r of raw) if (r.factorValue != null) map.set(r.tsCode, r.factorValue)
      factorMaps.set(fn, map)
    }

    // 2. Find common stocks
    const commonCodes = this.findCommonCodes(factorMaps, factorNames)
    if (commonCodes.length < 10) {
      return {
        method,
        tradeDate,
        error: `共同股票数量不足（${commonCodes.length} < 10），无法正交化`,
      }
    }

    // 3. Build factor matrix (stocks × factors)
    const factorMatrix: number[][] = commonCodes.map((code) =>
      factorNames.map((fn) => factorMaps.get(fn)!.get(code)!),
    )

    // 4. Standardize (z-score)
    const standardized = this.standardizeColumns(factorMatrix)

    // 5. Compute original correlation
    const origCorr = this.correlationMatrix(standardized)

    // 6. Orthogonalize
    let orthMatrix: number[][]
    let orthNames: string[]
    if (method === 'regression') {
      const result = this.regressionOrthogonalize(standardized, factorNames)
      orthMatrix = result.matrix
      orthNames = result.names
    } else {
      const result = this.symmetricOrthogonalize(standardized, factorNames)
      if (!result) {
        return { method, tradeDate, error: '对称正交化失败（相关矩阵不正定）' }
      }
      orthMatrix = result.matrix
      orthNames = result.names
    }

    // 7. Compute orthogonalized correlation (should be near-identity)
    const orthCorr = this.correlationMatrix(orthMatrix)

    // 8. Build output factor values
    const factorValues: Record<string, Array<{ tsCode: string; value: number }>> = {}
    for (let j = 0; j < orthNames.length; j++) {
      factorValues[orthNames[j]] = commonCodes.map((code, i) => ({
        tsCode: code,
        value: Number(orthMatrix[i][j].toFixed(6)),
      }))
    }

    return {
      method,
      tradeDate,
      originalCorrelation: {
        factors: factorNames,
        matrix: origCorr.map((row) => row.map((v) => Number(v.toFixed(4)))),
      },
      orthogonalCorrelation: {
        factors: orthNames,
        matrix: orthCorr.map((row) => row.map((v) => Number(v.toFixed(4)))),
      },
      factorValues: {
        stockCount: commonCodes.length,
        factors: factorValues,
      },
    }
  }

  // ── Fama-MacBeth ───────────────────────────────────────────────────────────

  async famaMacBeth(dto: FamaMacBethDto) {
    const { factorNames, startDate, endDate, universe, forwardDays = 5 } = dto

    // 1. Get trade dates
    const tradeDates = await this.getTradeDates(startDate, endDate)
    if (tradeDates.length < 10) {
      return { error: `交易日数量不足（${tradeDates.length} < 10）` }
    }

    // 2. For each trade date, run cross-sectional regression
    const results: Array<{
      tradeDate: string
      betas: number[] // factor premiums
      r2: number
    }> = []

    for (let i = 0; i < tradeDates.length - forwardDays; i++) {
      const td = tradeDates[i]
      const tdForward = tradeDates[i + forwardDays]
      if (!tdForward) break

      // Load factor values
      const factorMaps = new Map<string, Map<string, number>>()
      for (const fn of factorNames) {
        const raw = await this.compute.getRawFactorValuesForDate(fn, td, universe)
        const map = new Map<string, number>()
        for (const r of raw) if (r.factorValue != null) map.set(r.tsCode, r.factorValue)
        factorMaps.set(fn, map)
      }

      // Load forward returns
      const returns = await this.getAdjReturns(td, tdForward)

      // Find common stocks
      const commonCodes = this.findCommonCodesWithReturns(factorMaps, factorNames, returns)
      if (commonCodes.length < 30) continue

      // Build X (with intercept) and y
      const X = commonCodes.map((code) => {
        const row = [1] // intercept
        for (const fn of factorNames) {
          const v = factorMaps.get(fn)!.get(code)!
          row.push(v)
        }
        return row
      })

      const y = commonCodes.map((code) => returns.get(code)!)

      // Standardize X columns (skip intercept)
      const Xstd = this.standardizeXWithIntercept(X)

      const beta = olsBeta(Xstd, y)
      if (!beta) continue

      // R²
      const yHat = Xstd.map((row) => row.reduce((s, v, j) => s + v * beta[j], 0))
      const r2 = rSquared(y, yHat)

      results.push({
        tradeDate: td,
        betas: beta.slice(1), // skip intercept
        r2,
      })
    }

    if (!results.length) {
      return { error: '没有足够的截面日期完成 Fama-MacBeth 回归' }
    }

    // 3. Aggregate factor premium time series
    const factorResults = factorNames.map((fn, idx) => {
      const premiums = results.map((r) => r.betas[idx])
      const avg = mean(premiums)
      const std = stdDev(premiums)
      const tStat = std > 0 ? (avg / std) * Math.sqrt(premiums.length) : 0
      const pValue = this.tStatToPValue(tStat, premiums.length - 1)

      return {
        factorName: fn,
        label: fn, // will be enriched below
        avgPremium: Number(avg.toFixed(6)),
        tStat: Number(tStat.toFixed(2)),
        pValue: Number(pValue.toFixed(4)),
        significant: Math.abs(tStat) > 2,
      }
    })

    // Enrich labels
    for (const fr of factorResults) {
      const def = await this.prisma.factorDefinition.findUnique({
        where: { name: fr.factorName },
        select: { label: true },
      })
      if (def) fr.label = def.label
    }

    const r2Series = results.map((r) => ({
      tradeDate: r.tradeDate,
      r2: Number(r.r2.toFixed(4)),
    }))

    return {
      startDate,
      endDate,
      forwardDays,
      results: factorResults,
      r2Series,
      avgR2: Number(mean(results.map((r) => r.r2)).toFixed(4)),
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private findCommonCodes(
    factorMaps: Map<string, Map<string, number>>,
    factorNames: string[],
  ): string[] {
    const maps = factorNames.map((fn) => factorMaps.get(fn)!)
    const firstMap = maps[0]
    if (!firstMap) return []
    return Array.from(firstMap.keys()).filter((code) =>
      maps.every((m) => m.has(code)),
    )
  }

  private findCommonCodesWithReturns(
    factorMaps: Map<string, Map<string, number>>,
    factorNames: string[],
    returns: Map<string, number>,
  ): string[] {
    const common = this.findCommonCodes(factorMaps, factorNames)
    return common.filter((code) => returns.has(code))
  }

  private standardizeColumns(matrix: number[][]): number[][] {
    if (!matrix.length) return []
    const nCols = matrix[0].length
    const result = matrix.map((row) => [...row])
    for (let j = 0; j < nCols; j++) {
      const col = matrix.map((row) => row[j])
      const mu = mean(col)
      const sd = stdDev(col, mu)
      if (sd > 0) {
        for (let i = 0; i < result.length; i++) {
          result[i][j] = (result[i][j] - mu) / sd
        }
      }
    }
    return result
  }

  private standardizeXWithIntercept(X: number[][]): number[][] {
    if (!X.length) return []
    const result = X.map((row) => [...row])
    const nCols = X[0].length
    // Skip col 0 (intercept), standardize the rest
    for (let j = 1; j < nCols; j++) {
      const col = X.map((row) => row[j])
      const mu = mean(col)
      const sd = stdDev(col, mu)
      if (sd > 0) {
        for (let i = 0; i < result.length; i++) {
          result[i][j] = (result[i][j] - mu) / sd
        }
      }
    }
    return result
  }

  private correlationMatrix(matrix: number[][]): number[][] {
    if (!matrix.length) return []
    const nCols = matrix[0].length
    const result: number[][] = Array.from({ length: nCols }, () => new Array(nCols).fill(0))
    for (let i = 0; i < nCols; i++) {
      result[i][i] = 1
      for (let j = i + 1; j < nCols; j++) {
        const xs = matrix.map((row) => row[i])
        const ys = matrix.map((row) => row[j])
        const corr = this.pearsonCorr(xs, ys)
        result[i][j] = corr
        result[j][i] = corr
      }
    }
    return result
  }

  private pearsonCorr(xs: number[], ys: number[]): number {
    const n = xs.length
    if (n < 3) return 0
    const mx = mean(xs)
    const my = mean(ys)
    let num = 0
    let dx = 0
    let dy = 0
    for (let i = 0; i < n; i++) {
      num += (xs[i] - mx) * (ys[i] - my)
      dx += (xs[i] - mx) ** 2
      dy += (ys[i] - my) ** 2
    }
    const denom = Math.sqrt(dx) * Math.sqrt(dy)
    return denom > 0 ? num / denom : 0
  }

  /**
   * Regression orthogonalization: sequentially regress each factor on all preceding factors
   * and take the residuals.
   */
  private regressionOrthogonalize(
    matrix: number[][],
    factorNames: string[],
  ): { matrix: number[][]; names: string[] } {
    const n = matrix.length
    // Cap k to MAX_FACTORS (validated by DTO @ArrayMaxSize but enforce here for safety)
    const k = Math.min(factorNames.length, MAX_FACTORS)
    const orthMatrix = matrix.map((row) => [...row])
    const orthNames = [factorNames[0], ...factorNames.slice(1, k).map((fn) => `${fn}_orth`)]

    for (let j = 1; j < k; j++) {
      // Regress column j on columns 0..j-1
      const y = orthMatrix.map((row) => row[j])
      const X = orthMatrix.map((row) => row.slice(0, j))
      const beta = olsBeta(X, y)
      if (beta) {
        const resid = residuals(X, y, beta)
        for (let i = 0; i < n; i++) {
          orthMatrix[i][j] = resid[i]
        }
      }
    }

    return { matrix: orthMatrix, names: orthNames }
  }

  /**
   * Symmetric orthogonalization via Cholesky decomposition: F_orth = F * L^{-1}
   */
  private symmetricOrthogonalize(
    matrix: number[][],
    factorNames: string[],
  ): { matrix: number[][]; names: string[] } | null {
    const corrMatrix = this.correlationMatrix(matrix)
    const sqrtInv = symmetricMatSqrtInv(corrMatrix)
    if (!sqrtInv) return null

    // F_orth = F * L^{-1}
    const n = matrix.length
    // Cap k to MAX_FACTORS
    const k = Math.min(factorNames.length, MAX_FACTORS)
    const orthMatrix: number[][] = Array.from({ length: n }, () => new Array(k).fill(0))

    for (let i = 0; i < n; i++) {
      for (let j = 0; j < k; j++) {
        for (let p = 0; p < k; p++) {
          orthMatrix[i][j] += matrix[i][p] * sqrtInv[p][j]
        }
      }
    }

    const orthNames = factorNames.map((fn) => `${fn}_orth`)

    return { matrix: orthMatrix, names: orthNames }
  }

  private async getTradeDates(startDate: string, endDate: string): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<TradeCalRow[]>(Prisma.sql`
      SELECT cal_date FROM exchange_trade_calendars
      WHERE exchange = 'SSE' AND is_open = '1'
        AND cal_date >= ${startDate}::date
        AND cal_date <= ${endDate}::date
      ORDER BY cal_date ASC
    `)
    return rows.map((r) => formatDateStr(r.cal_date))
  }

  private async getAdjReturns(fromDate: string, toDate: string): Promise<Map<string, number>> {
    interface RetRow {
      ts_code: string
      forward_return: number | null
    }

    const rows = await this.prisma.$queryRaw<RetRow[]>(Prisma.sql`
      SELECT
        d1.ts_code,
        (d2.close * af2.adj_factor) / NULLIF(d1.close * af1.adj_factor, 0) - 1 AS forward_return
      FROM stock_daily_prices d1
      JOIN stock_daily_prices d2 ON d2.ts_code = d1.ts_code AND d2.trade_date = ${toDate}::date
      JOIN stock_adjustment_factors af1 ON af1.ts_code = d1.ts_code AND af1.trade_date = d1.trade_date
      JOIN stock_adjustment_factors af2 ON af2.ts_code = d2.ts_code AND af2.trade_date = d2.trade_date
      WHERE d1.trade_date = ${fromDate}::date
    `)

    const map = new Map<string, number>()
    for (const r of rows) {
      if (r.forward_return != null) map.set(r.ts_code, Number(r.forward_return))
    }
    return map
  }

  /** Approximate two-tailed p-value from t-statistic via normal distribution */
  private tStatToPValue(t: number, df: number): number {
    // For df > 30, approximate with standard normal
    const z = Math.abs(t)
    // Approximation: 2 * (1 - Φ(z))
    // Using Abramowitz & Stegun approximation for the normal CDF
    const a1 = 0.254829592
    const a2 = -0.284496736
    const a3 = 1.421413741
    const a4 = -1.453152027
    const a5 = 1.061405429
    const p = 0.3275911
    const x = z / Math.SQRT2
    const tt = 1 / (1 + p * x)
    const erfApprox = 1 - (((((a5 * tt + a4) * tt) + a3) * tt + a2) * tt + a1) * tt * Math.exp(-x * x)
    const phi = 0.5 * (1 + erfApprox)
    return 2 * (1 - phi)
  }
}
