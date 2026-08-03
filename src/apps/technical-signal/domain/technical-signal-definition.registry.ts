import { createHash } from 'node:crypto'

import {
  TECHNICAL_INDICATOR_ALGORITHM_VERSION,
  type IndicatorPoint,
  type TechnicalSignalDefinition,
  type TechnicalSignalDirection,
  type TechnicalSignalEvidence,
  type TechnicalSignalEvidenceValue,
} from './technical-signal.types'

const SOURCE = 'LOCAL_QFQ_OHLCV' as const

type DefinitionDraft = Omit<TechnicalSignalDefinition, 'definitionHash'>

/** Immutable standard v1 catalog. No legacy definitions belong here. */
export const TECHNICAL_SIGNAL_DEFINITIONS: readonly TechnicalSignalDefinition[] = Object.freeze([
  define({
    signalKey: 'macd.golden-cross',
    semanticsVersion: 'macd.v1',
    displayName: 'MACD 金叉',
    direction: 'BULLISH',
    source: SOURCE,
    indicatorAlgorithmVersion: TECHNICAL_INDICATOR_ALGORITHM_VERSION,
    requiredFields: ['macdDif', 'macdDea'],
    description: 'DIF 从不高于 DEA 穿越至严格高于 DEA。',
    parameters: { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 },
    triggerExpression: 'prev.dif <= prev.dea && curr.dif > curr.dea',
    evaluate: (previous, current) =>
      crossingEvidence(
        previous,
        current,
        ['macdDif', 'macdDea'],
        { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 },
        previous.macdDif <= previous.macdDea && current.macdDif > current.macdDea,
      ),
  }),
  define({
    signalKey: 'macd.death-cross',
    semanticsVersion: 'macd.v1',
    displayName: 'MACD 死叉',
    direction: 'BEARISH',
    source: SOURCE,
    indicatorAlgorithmVersion: TECHNICAL_INDICATOR_ALGORITHM_VERSION,
    requiredFields: ['macdDif', 'macdDea'],
    description: 'DIF 从不低于 DEA 穿越至严格低于 DEA。',
    parameters: { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 },
    triggerExpression: 'prev.dif >= prev.dea && curr.dif < curr.dea',
    evaluate: (previous, current) =>
      crossingEvidence(
        previous,
        current,
        ['macdDif', 'macdDea'],
        { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 },
        previous.macdDif >= previous.macdDea && current.macdDif < current.macdDea,
      ),
  }),
  define({
    signalKey: 'kdj.golden-cross',
    semanticsVersion: 'kdj.v1',
    displayName: 'KDJ 金叉',
    direction: 'BULLISH',
    source: SOURCE,
    indicatorAlgorithmVersion: TECHNICAL_INDICATOR_ALGORITHM_VERSION,
    requiredFields: ['kdjK', 'kdjD', 'kdjJ'],
    description: 'K 从不高于 D 穿越至严格高于 D。',
    parameters: { period: 9, initialK: 50, initialD: 50 },
    triggerExpression: 'prev.k <= prev.d && curr.k > curr.d',
    evaluate: (previous, current) =>
      crossingEvidence(
        previous,
        current,
        ['kdjK', 'kdjD', 'kdjJ'],
        { period: 9, initialK: 50, initialD: 50 },
        previous.kdjK <= previous.kdjD && current.kdjK > current.kdjD,
      ),
  }),
  define({
    signalKey: 'kdj.death-cross',
    semanticsVersion: 'kdj.v1',
    displayName: 'KDJ 死叉',
    direction: 'BEARISH',
    source: SOURCE,
    indicatorAlgorithmVersion: TECHNICAL_INDICATOR_ALGORITHM_VERSION,
    requiredFields: ['kdjK', 'kdjD', 'kdjJ'],
    description: 'K 从不低于 D 穿越至严格低于 D。',
    parameters: { period: 9, initialK: 50, initialD: 50 },
    triggerExpression: 'prev.k >= prev.d && curr.k < curr.d',
    evaluate: (previous, current) =>
      crossingEvidence(
        previous,
        current,
        ['kdjK', 'kdjD', 'kdjJ'],
        { period: 9, initialK: 50, initialD: 50 },
        previous.kdjK >= previous.kdjD && current.kdjK < current.kdjD,
      ),
  }),
  define({
    signalKey: 'rsi6.oversold-enter',
    semanticsVersion: 'rsi6.v1',
    displayName: 'RSI6 进入超卖',
    direction: 'BULLISH',
    source: SOURCE,
    indicatorAlgorithmVersion: TECHNICAL_INDICATOR_ALGORITHM_VERSION,
    requiredFields: ['rsi6'],
    description: 'RSI6 从不低于 30 进入严格低于 30 的超卖状态。',
    parameters: { period: 6, threshold: 30, smoothing: 'WILDER' },
    triggerExpression: 'prev.rsi6 >= 30 && curr.rsi6 < 30',
    evaluate: (previous, current) =>
      crossingEvidence(
        previous,
        current,
        ['rsi6'],
        { period: 6, threshold: 30, smoothing: 'WILDER' },
        previous.rsi6 >= 30 && current.rsi6 < 30,
      ),
  }),
  define({
    signalKey: 'rsi6.overbought-enter',
    semanticsVersion: 'rsi6.v1',
    displayName: 'RSI6 进入超买',
    direction: 'BEARISH',
    source: SOURCE,
    indicatorAlgorithmVersion: TECHNICAL_INDICATOR_ALGORITHM_VERSION,
    requiredFields: ['rsi6'],
    description: 'RSI6 从不高于 70 进入严格高于 70 的超买状态。',
    parameters: { period: 6, threshold: 70, smoothing: 'WILDER' },
    triggerExpression: 'prev.rsi6 <= 70 && curr.rsi6 > 70',
    evaluate: (previous, current) =>
      crossingEvidence(
        previous,
        current,
        ['rsi6'],
        { period: 6, threshold: 70, smoothing: 'WILDER' },
        previous.rsi6 <= 70 && current.rsi6 > 70,
      ),
  }),
  define({
    signalKey: 'boll.upper-breakout',
    semanticsVersion: 'boll.v1',
    displayName: '布林上轨突破',
    direction: 'BULLISH',
    source: SOURCE,
    indicatorAlgorithmVersion: TECHNICAL_INDICATOR_ALGORITHM_VERSION,
    requiredFields: ['close', 'bollUpper'],
    description: '收盘价从不高于上轨突破至严格高于上轨。',
    parameters: { period: 20, standardDeviationMultiplier: 2, variance: 'POPULATION' },
    triggerExpression: 'prev.close <= prev.upper && curr.close > curr.upper',
    evaluate: (previous, current) =>
      crossingEvidence(
        previous,
        current,
        ['close', 'bollUpper'],
        { period: 20, standardDeviationMultiplier: 2, variance: 'POPULATION' },
        previous.close <= previous.bollUpper && current.close > current.bollUpper,
      ),
  }),
  define({
    signalKey: 'boll.lower-breakdown',
    semanticsVersion: 'boll.v1',
    displayName: '布林下轨跌破',
    direction: 'BEARISH',
    source: SOURCE,
    indicatorAlgorithmVersion: TECHNICAL_INDICATOR_ALGORITHM_VERSION,
    requiredFields: ['close', 'bollLower'],
    description: '收盘价从不低于下轨跌破至严格低于下轨。',
    parameters: { period: 20, standardDeviationMultiplier: 2, variance: 'POPULATION' },
    triggerExpression: 'prev.close >= prev.lower && curr.close < curr.lower',
    evaluate: (previous, current) =>
      crossingEvidence(
        previous,
        current,
        ['close', 'bollLower'],
        { period: 20, standardDeviationMultiplier: 2, variance: 'POPULATION' },
        previous.close >= previous.bollLower && current.close < current.bollLower,
      ),
  }),
  define({
    signalKey: 'ma.bullish-alignment-enter',
    semanticsVersion: 'ma-alignment.v1',
    displayName: '均线多头排列进入',
    direction: 'BULLISH',
    source: SOURCE,
    indicatorAlgorithmVersion: TECHNICAL_INDICATOR_ALGORITHM_VERSION,
    requiredFields: ['ma5', 'ma10', 'ma20', 'ma60'],
    description: '从非严格 MA5>MA10>MA20>MA60 状态进入严格多头排列。',
    parameters: { ma5: 5, ma10: 10, ma20: 20, ma60: 60 },
    triggerExpression: 'prev != MA5>MA10>MA20>MA60 && curr == MA5>MA10>MA20>MA60',
    evaluate: (previous, current) => {
      if (!hasFields(previous, current, ['ma5', 'ma10', 'ma20', 'ma60'])) return null
      return !isBullishAlignment(previous) && isBullishAlignment(current)
        ? evidence(previous, current, ['ma5', 'ma10', 'ma20', 'ma60'], { ma5: 5, ma10: 10, ma20: 20, ma60: 60 })
        : null
    },
  }),
  define({
    signalKey: 'ma.bearish-alignment-enter',
    semanticsVersion: 'ma-alignment.v1',
    displayName: '均线空头排列进入',
    direction: 'BEARISH',
    source: SOURCE,
    indicatorAlgorithmVersion: TECHNICAL_INDICATOR_ALGORITHM_VERSION,
    requiredFields: ['ma5', 'ma10', 'ma20', 'ma60'],
    description: '从非严格 MA5<MA10<MA20<MA60 状态进入严格空头排列。',
    parameters: { ma5: 5, ma10: 10, ma20: 20, ma60: 60 },
    triggerExpression: 'prev != MA5<MA10<MA20<MA60 && curr == MA5<MA10<MA20<MA60',
    evaluate: (previous, current) => {
      if (!hasFields(previous, current, ['ma5', 'ma10', 'ma20', 'ma60'])) return null
      return !isBearishAlignment(previous) && isBearishAlignment(current)
        ? evidence(previous, current, ['ma5', 'ma10', 'ma20', 'ma60'], { ma5: 5, ma10: 10, ma20: 20, ma60: 60 })
        : null
    },
  }),
  define({
    signalKey: 'sar.bullish-state-enter',
    semanticsVersion: 'sar.v1',
    displayName: 'SAR 多头状态进入',
    direction: 'BULLISH',
    source: SOURCE,
    indicatorAlgorithmVersion: TECHNICAL_INDICATOR_ALGORITHM_VERSION,
    requiredFields: ['sar', 'close', 'sarBullish'],
    description: 'SAR 状态从空头翻转为多头。',
    parameters: { initialAf: 0.02, step: 0.02, maxAf: 0.2 },
    triggerExpression: 'prev.sarBullish=false && curr.sarBullish=true',
    evaluate: (previous, current) =>
      stateEntryEvidence(
        previous,
        current,
        ['sar', 'close', 'sarBullish'],
        { initialAf: 0.02, step: 0.02, maxAf: 0.2 },
        previous.sarBullish === false && current.sarBullish === true,
      ),
  }),
  define({
    signalKey: 'sar.bearish-state-enter',
    semanticsVersion: 'sar.v1',
    displayName: 'SAR 空头状态进入',
    direction: 'BEARISH',
    source: SOURCE,
    indicatorAlgorithmVersion: TECHNICAL_INDICATOR_ALGORITHM_VERSION,
    requiredFields: ['sar', 'close', 'sarBullish'],
    description: 'SAR 状态从多头翻转为空头。',
    parameters: { initialAf: 0.02, step: 0.02, maxAf: 0.2 },
    triggerExpression: 'prev.sarBullish=true && curr.sarBullish=false',
    evaluate: (previous, current) =>
      stateEntryEvidence(
        previous,
        current,
        ['sar', 'close', 'sarBullish'],
        { initialAf: 0.02, step: 0.02, maxAf: 0.2 },
        previous.sarBullish === true && current.sarBullish === false,
      ),
  }),
  define({
    signalKey: 'volume-ratio20.expand-enter',
    semanticsVersion: 'volume-ratio20.v1',
    displayName: '20 日量比放量进入',
    direction: 'CONTEXTUAL',
    source: SOURCE,
    indicatorAlgorithmVersion: TECHNICAL_INDICATOR_ALGORITHM_VERSION,
    requiredFields: ['vol', 'volumeAverage20', 'volumeRatio20'],
    description: '20 日量比从不高于 1.5 进入严格高于 1.5。',
    parameters: { period: 20, threshold: 1.5 },
    triggerExpression: 'prev.ratio <= 1.5 && curr.ratio > 1.5',
    evaluate: (previous, current) =>
      crossingEvidence(
        previous,
        current,
        ['vol', 'volumeAverage20', 'volumeRatio20'],
        { period: 20, threshold: 1.5 },
        previous.volumeRatio20 <= 1.5 && current.volumeRatio20 > 1.5,
      ),
  }),
  define({
    signalKey: 'volume-ratio20.shrink-enter',
    semanticsVersion: 'volume-ratio20.v1',
    displayName: '20 日量比缩量进入',
    direction: 'CONTEXTUAL',
    source: SOURCE,
    indicatorAlgorithmVersion: TECHNICAL_INDICATOR_ALGORITHM_VERSION,
    requiredFields: ['vol', 'volumeAverage20', 'volumeRatio20'],
    description: '20 日量比从不低于 0.5 进入严格低于 0.5。',
    parameters: { period: 20, threshold: 0.5 },
    triggerExpression: 'prev.ratio >= 0.5 && curr.ratio < 0.5',
    evaluate: (previous, current) =>
      crossingEvidence(
        previous,
        current,
        ['vol', 'volumeAverage20', 'volumeRatio20'],
        { period: 20, threshold: 0.5 },
        previous.volumeRatio20 >= 0.5 && current.volumeRatio20 < 0.5,
      ),
  }),
])

export function createTechnicalSignalDefinitionRegistry(
  definitions: readonly TechnicalSignalDefinition[] = TECHNICAL_SIGNAL_DEFINITIONS,
): ReadonlyMap<string, TechnicalSignalDefinition> {
  const registry = new Map<string, TechnicalSignalDefinition>()
  for (const definition of definitions) {
    const key = `${definition.signalKey}|${definition.semanticsVersion}`
    if (registry.has(key)) throw new Error(`duplicate technical signal definition: ${key}`)
    registry.set(key, definition)
  }
  return registry
}

export function calculateTechnicalSignalDefinitionHash(definition: DefinitionDraft): string {
  const hashPayload = {
    signalKey: definition.signalKey,
    semanticsVersion: definition.semanticsVersion,
    direction: definition.direction,
    source: definition.source,
    indicatorAlgorithmVersion: definition.indicatorAlgorithmVersion,
    parameters: definition.parameters,
    triggerExpression: definition.triggerExpression,
    requiredFields: definition.requiredFields,
  }
  return createHash('sha256').update(canonicalJson(hashPayload), 'utf8').digest('hex')
}

function define(draft: DefinitionDraft): TechnicalSignalDefinition {
  const requiredFields = Object.freeze([...draft.requiredFields])
  const parameters = Object.freeze({ ...draft.parameters })
  const definition = {
    ...draft,
    requiredFields,
    parameters,
  }
  return Object.freeze({
    ...definition,
    definitionHash: calculateTechnicalSignalDefinitionHash(definition),
  })
}

function crossingEvidence(
  previous: IndicatorPoint,
  current: IndicatorPoint,
  fields: readonly (keyof IndicatorPoint)[],
  parameters: Readonly<Record<string, number | string | boolean>>,
  triggered: boolean,
): TechnicalSignalEvidence | null {
  if (!hasFields(previous, current, fields) || !triggered) return null
  return evidence(previous, current, fields, parameters)
}

function stateEntryEvidence(
  previous: IndicatorPoint,
  current: IndicatorPoint,
  fields: readonly (keyof IndicatorPoint)[],
  parameters: Readonly<Record<string, number | string | boolean>>,
  triggered: boolean,
): TechnicalSignalEvidence | null {
  return crossingEvidence(previous, current, fields, parameters, triggered)
}

function hasFields(
  previous: IndicatorPoint,
  current: IndicatorPoint,
  fields: readonly (keyof IndicatorPoint)[],
): boolean {
  return fields.every((field) => isPresent(previous[field]) && isPresent(current[field]))
}

function isPresent(value: IndicatorPoint[keyof IndicatorPoint]): boolean {
  if (typeof value === 'number') return Number.isFinite(value)
  return value !== null && value !== undefined
}

function isBullishAlignment(point: IndicatorPoint): boolean {
  return point.ma5! > point.ma10! && point.ma10! > point.ma20! && point.ma20! > point.ma60!
}

function isBearishAlignment(point: IndicatorPoint): boolean {
  return point.ma5! < point.ma10! && point.ma10! < point.ma20! && point.ma20! < point.ma60!
}

function evidence(
  previous: IndicatorPoint,
  current: IndicatorPoint,
  fields: readonly (keyof IndicatorPoint)[],
  parameters: Readonly<Record<string, number | string | boolean>>,
): TechnicalSignalEvidence {
  const previousEvidence: Record<string, TechnicalSignalEvidenceValue> = {}
  const currentEvidence: Record<string, TechnicalSignalEvidenceValue> = {}
  for (const field of fields) {
    previousEvidence[field] = previous[field]
    currentEvidence[field] = current[field]
  }
  return Object.freeze({
    previous: Object.freeze(previousEvidence),
    current: Object.freeze(currentEvidence),
    parameters: Object.freeze({ ...parameters }),
  })
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`

  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`
}
