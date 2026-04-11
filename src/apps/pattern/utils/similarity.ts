/**
 * similarity.ts
 *
 * K 线形态匹配的纯函数工具库：
 *   - 归一化（Min-Max）
 *   - 归一化欧氏距离（NED）
 *   - 动态时间弯曲（DTW，带 Sakoe-Chiba Band）
 *   - 相似度百分比换算
 */

// ─── 归一化 ───────────────────────────────────────────────────────────────────

/**
 * 将价格序列归一化到 [0, 1] 区间（Min-Max）。
 * 若序列全相同（平盘），返回全 0.5 序列。
 */
export function normalizeToUnitRange(prices: number[]): number[] {
  const min = Math.min(...prices)
  const max = Math.max(...prices)
  const range = max - min
  if (range === 0) return prices.map(() => 0.5)
  return prices.map(p => (p - min) / range)
}

// ─── 归一化欧氏距离（NED） ─────────────────────────────────────────────────────

/**
 * 归一化欧氏距离 — O(n)，适合快速粗筛。
 *
 * d = sqrt( (1/n) × Σ (a[i] - b[i])² )
 *
 * 返回值范围 [0, 1]（两序列均已归一化到 [0,1]）。
 */
export function normalizedEuclideanDistance(a: number[], b: number[]): number {
  const n = a.length
  if (n === 0) return 0
  let sumSq = 0
  for (let i = 0; i < n; i++) {
    const d = a[i] - b[i]
    sumSq += d * d
  }
  return Math.sqrt(sumSq / n)
}

// ─── 动态时间弯曲（DTW） ──────────────────────────────────────────────────────

/**
 * DTW 距离（带 Sakoe-Chiba Band 约束）— O(n × w)。
 *
 * @param a 查询序列（已归一化）
 * @param b 候选序列（已归一化）
 * @param bandWidth 弯曲带宽，默认 ceil(max(|a|,|b|) × 0.1)
 */
export function dtwDistance(a: number[], b: number[], bandWidth?: number): number {
  const n = a.length
  const m = b.length
  if (n === 0 || m === 0) return 0

  const w = bandWidth ?? Math.max(Math.ceil(Math.max(n, m) * 0.1), Math.abs(n - m))

  // 使用两行滚动数组节省内存
  const INF = Infinity
  let prev = new Array(m + 1).fill(INF) as number[]
  prev[0] = 0
  let curr = new Array(m + 1).fill(INF) as number[]

  for (let i = 1; i <= n; i++) {
    curr.fill(INF)
    const jStart = Math.max(1, i - w)
    const jEnd = Math.min(m, i + w)
    for (let j = jStart; j <= jEnd; j++) {
      const cost = (a[i - 1] - b[j - 1]) ** 2
      curr[j] = cost + Math.min(prev[j], curr[j - 1], prev[j - 1])
    }
    const tmp = prev
    prev = curr
    curr = tmp
  }

  return Math.sqrt(prev[m] / Math.max(n, m))
}

// ─── Helper ───────────────────────────────────────────────────────────────────

/** Round to n decimal places */
export function round(v: number, n: number): number {
  const f = 10 ** n
  return Math.round(v * f) / f
}

/**
 * 将距离值转换为相似度百分比（0–100）。
 * 对 NED（范围 0–1）使用线性映射:  similarity = (1 - distance) × 100
 * 对 DTW（范围不固定但通常 0–1）相同映射，clamp 到 0。
 */
export function distanceToSimilarity(distance: number): number {
  return round(Math.max(0, (1 - distance) * 100), 2)
}
