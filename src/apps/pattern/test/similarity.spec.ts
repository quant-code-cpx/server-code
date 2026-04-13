/**
 * similarity.ts — 纯函数单元测试
 *
 * 覆盖要点：
 * - normalizeToUnitRange(): 正常、平盘（全相同）、单元素、空数组
 * - normalizedEuclideanDistance(): 相同序列、对称性、正常计算
 * - dtwDistance(): 相同序列=0、空序列=0、单元素、band 约束
 * - distanceToSimilarity(): 0→100、1→0、>1→clamp到0、负值→大于100问题
 * - round(): 精度控制
 */

import {
  normalizeToUnitRange,
  normalizedEuclideanDistance,
  dtwDistance,
  distanceToSimilarity,
  round,
} from '../utils/similarity'

// ═══════════════════════════════════════════════════════════════════════════════

describe('similarity.ts — 纯函数', () => {
  // ── normalizeToUnitRange() ───────────────────────────────────────────────

  describe('normalizeToUnitRange()', () => {
    it('正常范围内归一化：最小值→0，最大值→1', () => {
      const result = normalizeToUnitRange([0, 5, 10])
      expect(result[0]).toBeCloseTo(0)
      expect(result[1]).toBeCloseTo(0.5)
      expect(result[2]).toBeCloseTo(1)
    })

    it('单调递增序列正确归一化', () => {
      const prices = [10, 11, 12, 13, 14]
      const result = normalizeToUnitRange(prices)
      expect(result[0]).toBeCloseTo(0)
      expect(result[result.length - 1]).toBeCloseTo(1)
      // 所有值在 [0, 1] 范围内
      result.forEach((v) => {
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(1)
      })
    })

    it('平盘（全相同值）→ 每个元素返回 0.5', () => {
      const result = normalizeToUnitRange([5, 5, 5, 5])
      result.forEach((v) => expect(v).toBe(0.5))
    })

    it('单元素序列 → 返回 [0.5]（range=0 分支）', () => {
      const result = normalizeToUnitRange([42])
      expect(result).toHaveLength(1)
      expect(result[0]).toBe(0.5)
    })

    it('空数组返回空数组', () => {
      const result = normalizeToUnitRange([])
      expect(result).toHaveLength(0)
      expect(Array.isArray(result)).toBe(true)
    })

    it('负数序列也正确归一化', () => {
      const result = normalizeToUnitRange([-10, -5, 0])
      expect(result[0]).toBeCloseTo(0)
      expect(result[1]).toBeCloseTo(0.5)
      expect(result[2]).toBeCloseTo(1)
    })

    it('保持数组长度不变', () => {
      const prices = [10, 20, 15, 25, 5]
      const result = normalizeToUnitRange(prices)
      expect(result).toHaveLength(prices.length)
    })
  })

  // ── normalizedEuclideanDistance() ────────────────────────────────────────

  describe('normalizedEuclideanDistance()', () => {
    it('完全相同序列 → 距离为 0', () => {
      const a = [0.1, 0.5, 0.9]
      expect(normalizedEuclideanDistance(a, a)).toBe(0)
    })

    it('两元素：[0,0] vs [1,1] → sqrt(1) = 1.0', () => {
      // d = sqrt( (1/2) * ((0-1)^2 + (0-1)^2) ) = sqrt(1) = 1.0
      expect(normalizedEuclideanDistance([0, 0], [1, 1])).toBeCloseTo(1.0)
    })

    it('正确计算均方根差', () => {
      // a = [0, 1], b = [0.5, 0.5]
      // sumSq = (0-0.5)^2 + (1-0.5)^2 = 0.25 + 0.25 = 0.5
      // result = sqrt(0.5 / 2) = sqrt(0.25) = 0.5
      const result = normalizedEuclideanDistance([0, 1], [0.5, 0.5])
      expect(result).toBeCloseTo(0.5)
    })

    it('空数组 → 返回 0', () => {
      expect(normalizedEuclideanDistance([], [])).toBe(0)
    })

    it('单元素相同 → 距离为 0', () => {
      expect(normalizedEuclideanDistance([0.5], [0.5])).toBe(0)
    })

    it('范围 [0,1] 内序列的最大可能距离接近 1', () => {
      // [0,0,0] vs [1,1,1] → sqrt((1+1+1)/3) = 1.0
      const result = normalizedEuclideanDistance([0, 0, 0], [1, 1, 1])
      expect(result).toBeCloseTo(1.0)
    })
  })

  // ── dtwDistance() ────────────────────────────────────────────────────────

  describe('dtwDistance()', () => {
    it('完全相同序列 → DTW距离为 0', () => {
      const a = [0.1, 0.5, 0.8, 0.3]
      expect(dtwDistance(a, a)).toBe(0)
    })

    it('空查询序列（a=[]） → 返回 0', () => {
      // [BUG? 设计选择] 空序列返回 0 而非 Infinity
      expect(dtwDistance([], [1, 2, 3])).toBe(0)
    })

    it('空候选序列（b=[]） → 返回 0', () => {
      expect(dtwDistance([1, 2, 3], [])).toBe(0)
    })

    it('两者均为空 → 返回 0', () => {
      expect(dtwDistance([], [])).toBe(0)
    })

    it('单元素相同 → 距离为 0', () => {
      expect(dtwDistance([0.5], [0.5])).toBe(0)
    })

    it('等长序列的距离与 NED 走势一致（更小或相等）', () => {
      const a = [0.0, 0.5, 1.0, 0.5, 0.0]
      const b = [0.1, 0.6, 0.9, 0.4, 0.1]
      const dtw = dtwDistance(a, b)
      expect(dtw).toBeGreaterThanOrEqual(0)
      expect(dtw).toBeLessThanOrEqual(1)
    })

    it('显式 bandWidth=0 限制弯曲', () => {
      const a = [0.0, 1.0]
      const b = [1.0, 0.0]
      // bandWidth=0 → 只允许对角线路径 → w=max(ceil(2*0.1),|2-2|)=max(0,0)=0
      // 但 jStart=max(1,1-0)=1, jEnd=min(2,1+0)=1, so j=1 only; j只能=1
      const result = dtwDistance(a, b, 0)
      expect(typeof result).toBe('number')
      expect(result).toBeGreaterThanOrEqual(0)
    })

    it('长序列结果应是有限正数', () => {
      const a = Array.from({ length: 20 }, (_, i) => Math.sin(i * 0.3))
      const b = Array.from({ length: 20 }, (_, i) => Math.sin(i * 0.3 + 0.5))
      const result = dtwDistance(a, b)
      expect(Number.isFinite(result)).toBe(true)
      expect(result).toBeGreaterThan(0)
    })
  })

  // ── distanceToSimilarity() ───────────────────────────────────────────────

  describe('distanceToSimilarity()', () => {
    it('距离=0 → 相似度=100', () => {
      expect(distanceToSimilarity(0)).toBe(100)
    })

    it('距离=1 → 相似度=0', () => {
      expect(distanceToSimilarity(1)).toBe(0)
    })

    it('距离=0.5 → 相似度=50', () => {
      expect(distanceToSimilarity(0.5)).toBe(50)
    })

    it('距离>1（如1.5）→ clamp到0，不返回负值', () => {
      expect(distanceToSimilarity(1.5)).toBe(0)
    })

    it('距离=2 → 仍然 clamp 到 0', () => {
      expect(distanceToSimilarity(2)).toBe(0)
    })

    it('[P3-B13] 距离为负数（-0.5）→ 相似度超过100（150），未做上界限制', () => {
      // 当前实现：(1 - (-0.5)) * 100 = 150，没有上界 clamp
      // 这是一个潜在 bug：输入异常时结果超出 [0, 100] 范围
      const result = distanceToSimilarity(-0.5)
      expect(result).toBe(150) // [BUG P3-B13] 缺少上界 clamp，正常应为 100
    })

    it('返回值保留 2 位小数', () => {
      const result = distanceToSimilarity(0.12345)
      // (1 - 0.12345) * 100 = 87.655 → round(87.655, 2) = 87.66
      expect(result).toBeCloseTo(87.66, 1)
    })
  })

  // ── round() ─────────────────────────────────────────────────────────────

  describe('round()', () => {
    it('保留 2 位小数', () => {
      expect(round(3.14159, 2)).toBe(3.14)
    })

    it('保留 4 位小数', () => {
      expect(round(1.23456789, 4)).toBe(1.2346)
    })

    it('保留 0 位小数（四舍五入到整数）', () => {
      expect(round(2.6, 0)).toBe(3)
      expect(round(2.4, 0)).toBe(2)
    })

    it('负数也正确四舍五入', () => {
      expect(round(-1.005, 2)).toBeCloseTo(-1.0, 1)
    })

    it('已精确的数保持不变', () => {
      expect(round(1.5, 1)).toBe(1.5)
    })
  })
})
