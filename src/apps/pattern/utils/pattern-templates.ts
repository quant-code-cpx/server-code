/**
 * pattern-templates.ts
 *
 * 预定义经典 K 线形态模板（归一化序列 [0, 1]）。
 */

export interface PatternTemplate {
  name: string
  description: string
  /** 归一化价格序列，每个值 ∈ [0, 1] */
  series: number[]
}

export const PATTERN_TEMPLATES: Record<string, PatternTemplate> = {
  HEAD_SHOULDERS_TOP: {
    name: '头肩顶',
    description: '左肩 → 头部 → 右肩，看跌反转形态',
    series: [0.3, 0.5, 0.6, 0.5, 0.3, 0.5, 0.8, 1.0, 0.8, 0.5, 0.3, 0.5, 0.6, 0.5, 0.3, 0.2, 0.0],
  },
  HEAD_SHOULDERS_BOTTOM: {
    name: '头肩底',
    description: '反向头肩，看涨反转形态',
    series: [0.7, 0.5, 0.4, 0.5, 0.7, 0.5, 0.2, 0.0, 0.2, 0.5, 0.7, 0.5, 0.4, 0.5, 0.7, 0.8, 1.0],
  },
  DOUBLE_TOP: {
    name: '双顶（M 顶）',
    description: '两个高点接近，中间有回调，看跌形态',
    series: [0.0, 0.3, 0.6, 0.9, 1.0, 0.8, 0.5, 0.4, 0.5, 0.8, 1.0, 0.9, 0.6, 0.3, 0.0],
  },
  DOUBLE_BOTTOM: {
    name: '双底（W 底）',
    description: '两个低点接近，中间有反弹，看涨形态',
    series: [1.0, 0.7, 0.4, 0.1, 0.0, 0.2, 0.5, 0.6, 0.5, 0.2, 0.0, 0.1, 0.4, 0.7, 1.0],
  },
  ASCENDING_TRIANGLE: {
    name: '上升三角形',
    description: '顶部水平，底部逐步抬高，通常向上突破',
    series: [0.0, 0.5, 1.0, 0.6, 0.2, 0.6, 1.0, 0.65, 0.35, 0.7, 1.0, 0.7, 0.5, 0.75, 1.0],
  },
  DESCENDING_TRIANGLE: {
    name: '下降三角形',
    description: '底部水平，顶部逐步降低，通常向下突破',
    series: [1.0, 0.5, 0.0, 0.4, 0.8, 0.4, 0.0, 0.35, 0.65, 0.3, 0.0, 0.3, 0.5, 0.25, 0.0],
  },
  FLAG_BULLISH: {
    name: '牛旗',
    description: '急涨后小幅回调整理，看涨延续',
    series: [0.0, 0.1, 0.3, 0.6, 0.85, 1.0, 0.95, 0.9, 0.85, 0.8, 0.78, 0.82, 0.8, 0.78, 0.82],
  },
  V_REVERSAL: {
    name: 'V 形反转',
    description: '急跌后快速回升',
    series: [1.0, 0.8, 0.6, 0.3, 0.1, 0.0, 0.1, 0.3, 0.6, 0.8, 1.0],
  },
}
