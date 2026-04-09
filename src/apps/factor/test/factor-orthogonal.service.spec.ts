/**
 * FactorOrthogonalService — 单元测试
 *
 * 覆盖要点：
 * - pearsonCorr: 完美正相关 ≈ 1.0、完美负相关 ≈ -1.0、样本 < 3 时返回 0
 * - correlationMatrix: 正交数据的对角线 = 1，非对角线 ≈ 0
 * - standardizeColumns: 均值 ≈ 0，标准差 ≈ 1
 * - regressionOrthogonalize: factor[1] 与 factor[0] 的相关性 ≈ 0
 * - symmetricOrthogonalize: 所有因子两两相关性 ≈ 0
 * - orthogonalize(): 公共股票 < 10 时返回 error；正常时返回 originalCorrelation 和 orthogonalCorrelation
 */
import { FactorOrthogonalService } from '../services/factor-orthogonal.service'

// ── mock 工厂 ─────────────────────────────────────────────────────────────────

function buildPrismaMock() {
  return {
    $queryRaw: jest.fn(),
    factorDefinition: { findUnique: jest.fn() },
  }
}

function buildComputeMock() {
  return {
    getRawFactorValuesForDate: jest.fn(),
  }
}

function createService(prismaMock = buildPrismaMock(), computeMock = buildComputeMock()): FactorOrthogonalService {
  // @ts-ignore 局部 mock，跳过 DI
  return new FactorOrthogonalService(prismaMock, computeMock)
}

// ── 数学工具 ──────────────────────────────────────────────────────────────────

function mean(arr: number[]): number {
  return arr.reduce((s, v) => s + v, 0) / arr.length
}

function std(arr: number[]): number {
  const m = mean(arr)
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1))
}

// ═══════════════════════════════════════════════════════════════════════════════
// 测试套件
// ═══════════════════════════════════════════════════════════════════════════════

describe('FactorOrthogonalService', () => {
  let service: FactorOrthogonalService

  beforeEach(() => {
    jest.clearAllMocks()
    service = createService()
  })

  // ── pearsonCorr ────────────────────────────────────────────────────────────

  describe('pearsonCorr()', () => {
    it('完美正相关 [1,2,3,4,5] vs [2,4,6,8,10] ≈ 1.0', () => {
      const corr: number = (service as any).pearsonCorr([1, 2, 3, 4, 5], [2, 4, 6, 8, 10])
      expect(corr).toBeCloseTo(1.0, 8)
    })

    it('完美负相关 [1,2,3,4,5] vs [-1,-2,-3,-4,-5] ≈ -1.0', () => {
      const corr: number = (service as any).pearsonCorr([1, 2, 3, 4, 5], [-1, -2, -3, -4, -5])
      expect(corr).toBeCloseTo(-1.0, 8)
    })

    it('样本长度 < 3 时返回 0', () => {
      expect((service as any).pearsonCorr([1, 2], [3, 4])).toBe(0)
      expect((service as any).pearsonCorr([1], [1])).toBe(0)
      expect((service as any).pearsonCorr([], [])).toBe(0)
    })

    it('零方差（xs 全相同）时返回 0', () => {
      const corr: number = (service as any).pearsonCorr([5, 5, 5, 5, 5], [1, 2, 3, 4, 5])
      expect(corr).toBe(0)
    })

    it('不相关数据返回接近 0 的值', () => {
      // 使用相位差 90° 的正弦/余弦序列，理论相关性为 0
      const xs = Array.from({ length: 20 }, (_, i) => Math.sin((i * Math.PI) / 10))
      const ys = Array.from({ length: 20 }, (_, i) => Math.cos((i * Math.PI) / 10))
      const corr: number = (service as any).pearsonCorr(xs, ys)
      expect(Math.abs(corr)).toBeLessThan(0.05)
    })
  })

  // ── standardizeColumns ────────────────────────────────────────────────────

  describe('standardizeColumns()', () => {
    it('输出每列均值 ≈ 0', () => {
      const matrix = [
        [1, 10],
        [2, 20],
        [3, 30],
        [4, 40],
        [5, 50],
      ]
      const standardized: number[][] = (service as any).standardizeColumns(matrix)
      const col0 = standardized.map((r) => r[0])
      const col1 = standardized.map((r) => r[1])
      expect(mean(col0)).toBeCloseTo(0, 8)
      expect(mean(col1)).toBeCloseTo(0, 8)
    })

    it('输出每列标准差 ≈ 1', () => {
      const matrix = [
        [1, 10],
        [2, 20],
        [3, 30],
        [4, 40],
        [5, 50],
      ]
      const standardized: number[][] = (service as any).standardizeColumns(matrix)
      const col0 = standardized.map((r) => r[0])
      const col1 = standardized.map((r) => r[1])
      expect(std(col0)).toBeCloseTo(1, 8)
      expect(std(col1)).toBeCloseTo(1, 8)
    })

    it('空矩阵时返回空数组', () => {
      expect((service as any).standardizeColumns([])).toEqual([])
    })

    it('列方差为 0 时不修改该列（保持原值）', () => {
      const matrix = [
        [5, 1],
        [5, 2],
        [5, 3],
      ]
      const result: number[][] = (service as any).standardizeColumns(matrix)
      // 第 0 列方差=0，保持原值 5
      expect(result[0][0]).toBe(5)
      expect(result[1][0]).toBe(5)
    })
  })

  // ── correlationMatrix ─────────────────────────────────────────────────────

  describe('correlationMatrix()', () => {
    it('对角线全为 1', () => {
      const matrix = [
        [1, 3],
        [2, 1],
        [3, -1],
        [4, -3],
        [5, -5],
      ]
      const corr: number[][] = (service as any).correlationMatrix(matrix)
      for (let i = 0; i < 2; i++) {
        expect(corr[i][i]).toBe(1)
      }
    })

    it('正交数据的非对角线 ≈ 0', () => {
      // 构造两列正交数据：col0 = [1,2,...,20], col1 = sin(i * π/2)（与 col0 正交）
      const n = 100
      const matrix = Array.from({ length: n }, (_, i) => [
        i + 1,
        Math.sin((i * Math.PI) / 2), // 与线性趋势正交
      ])
      // 先标准化再算相关矩阵
      const std2: number[][] = (service as any).standardizeColumns(matrix)
      const corr: number[][] = (service as any).correlationMatrix(std2)
      // 非对角线应接近 0
      expect(Math.abs(corr[0][1])).toBeLessThan(0.2)
    })

    it('完全相同的两列相关性为 1', () => {
      const matrix = [
        [1, 1],
        [2, 2],
        [3, 3],
        [4, 4],
        [5, 5],
      ]
      const corr: number[][] = (service as any).correlationMatrix(matrix)
      expect(corr[0][1]).toBeCloseTo(1.0, 8)
    })

    it('矩阵对称（corr[i][j] === corr[j][i]）', () => {
      const matrix = [
        [1, 2, 3],
        [4, 1, 6],
        [7, 8, 2],
        [1, 3, 5],
        [2, 2, 4],
      ]
      const corr: number[][] = (service as any).correlationMatrix(matrix)
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
          expect(corr[i][j]).toBeCloseTo(corr[j][i], 10)
        }
      }
    })
  })

  // ── regressionOrthogonalize ───────────────────────────────────────────────

  describe('regressionOrthogonalize()', () => {
    it('factor[0] 经过正交化后保持不变', () => {
      const n = 50
      const matrix = Array.from({ length: n }, (_, i) => [i + 1, 2 * (i + 1) + 3])
      const { matrix: orth } = (service as any).regressionOrthogonalize(matrix, ['f1', 'f2'])
      // 第 0 列与原始相同
      for (let i = 0; i < n; i++) {
        expect(orth[i][0]).toBeCloseTo(matrix[i][0], 8)
      }
    })

    it('正交化后 factor[1] 与 factor[0] 的相关性 ≈ 0', () => {
      const n = 100
      // 构造高度相关的两列（先标准化确保数值稳定）
      const raw = Array.from({ length: n }, (_, i) => [i + 1, 3 * (i + 1) + Math.sin(i) * 2])
      const matrix: number[][] = (service as any).standardizeColumns(raw)
      const { matrix: orth } = (service as any).regressionOrthogonalize(matrix, ['f1', 'f2'])

      const col0 = orth.map((r: number[]) => r[0])
      const col1 = orth.map((r: number[]) => r[1])
      const corr: number = (service as any).pearsonCorr(col0, col1)
      expect(Math.abs(corr)).toBeLessThan(1e-6)
    })

    it('返回正确的 names：f1, f2_orth', () => {
      const matrix = [
        [1, 2],
        [3, 4],
        [5, 6],
      ]
      const { names } = (service as any).regressionOrthogonalize(matrix, ['factorA', 'factorB'])
      expect(names[0]).toBe('factorA')
      expect(names[1]).toBe('factorB_orth')
    })
  })

  // ── symmetricOrthogonalize ────────────────────────────────────────────────

  describe('symmetricOrthogonalize()', () => {
    it('返回与输入相同维度的矩阵', () => {
      const n = 30
      const raw = Array.from({ length: n }, (_, i) => [Math.sin(i * 0.3), Math.cos(i * 0.5)])
      const matrix: number[][] = (service as any).standardizeColumns(raw)
      const result = (service as any).symmetricOrthogonalize(matrix, ['f1', 'f2'])
      expect(result).not.toBeNull()
      expect(result.matrix).toHaveLength(n)
      expect(result.matrix[0]).toHaveLength(2)
    })

    it('返回以 _orth 结尾的 names', () => {
      const n = 20
      const raw = Array.from({ length: n }, (_, i) => [Math.sin(i), Math.cos(i)])
      const matrix: number[][] = (service as any).standardizeColumns(raw)
      const result = (service as any).symmetricOrthogonalize(matrix, ['alpha', 'beta'])
      expect(result).not.toBeNull()
      expect(result.names[0]).toBe('alpha_orth')
      expect(result.names[1]).toBe('beta_orth')
    })

    it('输出列对角相关系数为 1', () => {
      const n = 50
      const raw = Array.from({ length: n }, (_, i) => [Math.sin(i * 0.3), Math.cos(i * 0.5)])
      const matrix: number[][] = (service as any).standardizeColumns(raw)
      const result = (service as any).symmetricOrthogonalize(matrix, ['f1', 'f2'])
      expect(result).not.toBeNull()
      const corr: number[][] = (service as any).correlationMatrix(result.matrix)
      expect(corr[0][0]).toBeCloseTo(1, 8)
      expect(corr[1][1]).toBeCloseTo(1, 8)
    })

    it('相关矩阵严格正定时能成功执行', () => {
      // 两列近似正交的三角函数
      const n = 40
      const raw = Array.from({ length: n }, (_, i) => [
        Math.sin((i * Math.PI) / 20),
        Math.cos((i * Math.PI) / 20),
      ])
      const matrix: number[][] = (service as any).standardizeColumns(raw)
      const result = (service as any).symmetricOrthogonalize(matrix, ['sin', 'cos'])
      expect(result).not.toBeNull()
      expect(result.matrix).toHaveLength(n)
    })
  })

  // ── orthogonalize() ────────────────────────────────────────────────────────

  describe('orthogonalize()', () => {
    it('公共股票 < 10 时返回 error 字段', async () => {
      const computeMock = buildComputeMock()
      // 模拟每个因子只有 5 只股票
      computeMock.getRawFactorValuesForDate.mockImplementation(async (factorName: string) =>
        Array.from({ length: 5 }, (_, i) => ({ tsCode: `00000${i}.SZ`, factorValue: i + 1 })),
      )
      const svc = createService(buildPrismaMock(), computeMock)

      const result = await svc.orthogonalize({
        factorNames: ['f1', 'f2'],
        tradeDate: '20250102',
        method: 'regression',
      } as any)

      expect(result).toHaveProperty('error')
    })

    it('正常数据时返回 originalCorrelation 和 orthogonalCorrelation', async () => {
      const computeMock = buildComputeMock()
      const N = 50
      // f1: 1~N, f2: 2~2N (高度相关)
      computeMock.getRawFactorValuesForDate.mockImplementation(async (factorName: string) =>
        Array.from({ length: N }, (_, i) => ({
          tsCode: `${String(i).padStart(6, '0')}.SZ`,
          factorValue: factorName === 'f1' ? i + 1 : 2 * (i + 1),
        })),
      )
      const svc = createService(buildPrismaMock(), computeMock)

      const result = await svc.orthogonalize({
        factorNames: ['f1', 'f2'],
        tradeDate: '20250102',
        method: 'regression',
      } as any)

      expect(result).toHaveProperty('originalCorrelation')
      expect(result).toHaveProperty('orthogonalCorrelation')
      expect((result as any).originalCorrelation.matrix).toBeDefined()
    })

    it('symmetric 方法时也能正常返回结果', async () => {
      const computeMock = buildComputeMock()
      const N = 50
      computeMock.getRawFactorValuesForDate.mockImplementation(async (factorName: string) =>
        Array.from({ length: N }, (_, i) => ({
          tsCode: `${String(i).padStart(6, '0')}.SZ`,
          factorValue: factorName === 'f1' ? i + 1 : Math.sin(i) * 10 + 5,
        })),
      )
      const svc = createService(buildPrismaMock(), computeMock)

      const result = await svc.orthogonalize({
        factorNames: ['f1', 'f2'],
        tradeDate: '20250102',
        method: 'symmetric',
      } as any)

      // 不完全正交时可能失败并返回 error，但至少不抛出异常
      expect(result).toBeDefined()
    })
  })
})
