import { BadRequestException, Injectable } from '@nestjs/common'
import {
  DEFAULT_SIGNAL_EVENT_TRIGGER_SPEC,
  DEFAULT_STOCK_SCREENING_TRIGGER_SPEC,
  AllAUniverseSpec,
  FactorConditionSpec,
  FactorScreeningRuleSpec,
  RuleJsonObject,
  RuleJsonValue,
  RuleValidationIssue,
  SignalConditionSpec,
  SignalEventRuleSpec,
  StockScreeningRuleSpec,
  SubscriptionRuleType,
  SubscriptionTriggerSpec,
} from './subscription-rule.types'

const STOCK_RULE_SPEC_KEYS = new Set(['type', 'version', 'universe', 'filters'])
const FACTOR_RULE_SPEC_KEYS = new Set(['type', 'version', 'universe', 'conditions', 'sortBy', 'sortOrder'])
const SIGNAL_RULE_SPEC_KEYS = new Set(['type', 'version', 'universe', 'conditions', 'minSatisfied'])
const ALL_A_UNIVERSE_KEYS = new Set(['type', 'excludeSt', 'excludeSuspended', 'excludeBse'])
const TRIGGER_SPEC_KEYS = new Set([
  'mode',
  'notifyOnInitialMatch',
  'eventWindow',
  'cooldownTradingDays',
  'maxHitsPerNotification',
])
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
const MAX_RULE_SPEC_BYTES = 32 * 1024
const MAX_JSON_DEPTH = 20
const MAX_FACTOR_CONDITIONS = 10
const FACTOR_OPERATORS = new Set(['GT', 'GTE', 'LT', 'LTE', 'BETWEEN', 'TOP_PERCENT', 'BOTTOM_PERCENT'])
const SIGNAL_EVENTS_BY_METRIC: Record<string, ReadonlySet<SignalConditionSpec['eventType']>> = {
  'signal.macd': new Set(['GOLDEN_CROSS', 'DEATH_CROSS']),
  'signal.kdj': new Set(['GOLDEN_CROSS', 'DEATH_CROSS']),
  'signal.rsi6': new Set(['OVERBOUGHT_ENTER', 'OVERSOLD_ENTER']),
  'signal.boll': new Set(['BREAK_UP', 'BREAK_DOWN']),
}
const STOCK_SCREENING_FILTER_KEYS = new Set([
  'exchange',
  'market',
  'industry',
  'area',
  'isHs',
  'industries',
  'areas',
  'conceptCodes',
  'minPeTtm',
  'maxPeTtm',
  'minPb',
  'maxPb',
  'minDvTtm',
  'minTotalMv',
  'maxTotalMv',
  'minCircMv',
  'maxCircMv',
  'minPsTtm',
  'maxPsTtm',
  'minPctChg',
  'maxPctChg',
  'minTurnoverRate',
  'maxTurnoverRate',
  'minAmount',
  'maxAmount',
  'minRevenueYoy',
  'maxRevenueYoy',
  'minNetprofitYoy',
  'maxNetprofitYoy',
  'minRoe',
  'maxRoe',
  'minGrossMargin',
  'maxGrossMargin',
  'minNetMargin',
  'maxNetMargin',
  'maxDebtToAssets',
  'minCurrentRatio',
  'minQuickRatio',
  'minOcfToNetprofit',
  'minMainNetInflow5d',
  'minMainNetInflow20d',
  'minBuySignalCount',
  'macdSignal',
  'kdjSignal',
  'rsiSignal',
  'minRsi6',
  'maxRsi6',
  'bollSignal',
  'maTrend',
  'northboundOnly',
])

/**
 * 统一为全局异常格式提供 RULE_INVALID code，同时保留字段级错误给 DTO/API 使用方。
 */
export class RuleSpecValidationException extends BadRequestException {
  constructor(issues: RuleValidationIssue[]) {
    super({
      code: 'RULE_INVALID',
      message: issues[0]?.message ?? '规则无效',
      details: issues,
    })
  }
}

/**
 * 已开放的规则均要求 ALL_A universe；未实现类型必须在边界处失败，不能降级成空结果。
 */
@Injectable()
export class RuleSpecValidatorService {
  validate(input: unknown): StockScreeningRuleSpec | FactorScreeningRuleSpec | SignalEventRuleSpec {
    return this.validateRuleSpec(input)
  }

  validateRuleSpec(input: unknown): StockScreeningRuleSpec | FactorScreeningRuleSpec | SignalEventRuleSpec {
    const issues: RuleValidationIssue[] = []
    if (!isPlainRecord(input)) {
      throw new RuleSpecValidationException([issue('RULE_SPEC_INVALID', '$', 'ruleSpec 必须是对象')])
    }

    if (
      input.type !== SubscriptionRuleType.STOCK_SCREENING &&
      input.type !== SubscriptionRuleType.FACTOR_SCREENING &&
      input.type !== SubscriptionRuleType.SIGNAL_EVENT
    ) {
      const code = Object.values(SubscriptionRuleType).includes(input.type as SubscriptionRuleType)
        ? 'RULE_TYPE_UNSUPPORTED'
        : 'RULE_TYPE_INVALID'
      issues.push(issue(code, '$.type', '当前仅支持 STOCK_SCREENING、FACTOR_SCREENING 或 SIGNAL_EVENT 规则'))
    }

    if (input.version !== 1) {
      issues.push(issue('RULE_VERSION_INVALID', '$.version', '规则版本必须为 1'))
    }

    const universe = this.validateAllAUniverse(input.universe, issues)
    const isStockRule = input.type === SubscriptionRuleType.STOCK_SCREENING
    const isFactorRule = input.type === SubscriptionRuleType.FACTOR_SCREENING
    validateAllowedKeys(
      input,
      isStockRule ? STOCK_RULE_SPEC_KEYS : isFactorRule ? FACTOR_RULE_SPEC_KEYS : SIGNAL_RULE_SPEC_KEYS,
      '$',
      issues,
    )
    const filters = isStockRule ? this.validateFilters(input.filters, issues) : undefined
    const conditions = isFactorRule ? this.validateFactorConditions(input.conditions, issues) : undefined
    const signalConditions =
      input.type === SubscriptionRuleType.SIGNAL_EVENT
        ? this.validateSignalConditions(input.conditions, issues)
        : undefined

    if (isFactorRule) {
      if (input.sortBy !== undefined && (typeof input.sortBy !== 'string' || input.sortBy.trim().length === 0)) {
        issues.push(issue('FACTOR_SORT_INVALID', '$.sortBy', 'sortBy 必须是非空因子 ID'))
      }
      if (input.sortOrder !== undefined && input.sortOrder !== 'ASC' && input.sortOrder !== 'DESC') {
        issues.push(issue('FACTOR_SORT_ORDER_INVALID', '$.sortOrder', 'sortOrder 必须是 ASC 或 DESC'))
      }
    }

    const byteLength = serializedByteLength(input)
    if (byteLength === null) {
      issues.push(issue('RULE_SPEC_INVALID', '$', 'ruleSpec 必须是可序列化 JSON'))
    } else if (byteLength > MAX_RULE_SPEC_BYTES) {
      issues.push(issue('RULE_SPEC_TOO_LARGE', '$', `ruleSpec 不能超过 ${MAX_RULE_SPEC_BYTES} 字节`))
    }

    if (issues.length > 0) throw new RuleSpecValidationException(issues)

    if (isStockRule) {
      return {
        type: SubscriptionRuleType.STOCK_SCREENING,
        version: 1,
        universe: universe!,
        filters: filters!,
      }
    }
    if (input.type === SubscriptionRuleType.SIGNAL_EVENT) {
      const minSatisfied = input.minSatisfied
      if (
        typeof minSatisfied !== 'number' ||
        !Number.isInteger(minSatisfied) ||
        minSatisfied < 1 ||
        !signalConditions ||
        minSatisfied > signalConditions.length
      ) {
        throw new RuleSpecValidationException([
          issue('SIGNAL_MIN_SATISFIED_INVALID', '$.minSatisfied', 'minSatisfied 必须在 1 到条件数量之间'),
        ])
      }
      return {
        type: SubscriptionRuleType.SIGNAL_EVENT,
        version: 1,
        universe: universe!,
        conditions: signalConditions,
        minSatisfied,
      }
    }
    return {
      type: SubscriptionRuleType.FACTOR_SCREENING,
      version: 1,
      universe: universe!,
      conditions: conditions!,
      ...(typeof input.sortBy === 'string' ? { sortBy: input.sortBy } : {}),
      ...(input.sortOrder === 'ASC' || input.sortOrder === 'DESC' ? { sortOrder: input.sortOrder } : {}),
    }
  }

  validateTriggerSpec(
    input: unknown = undefined,
    ruleType = SubscriptionRuleType.STOCK_SCREENING,
  ): SubscriptionTriggerSpec {
    const defaults =
      ruleType === SubscriptionRuleType.SIGNAL_EVENT
        ? DEFAULT_SIGNAL_EVENT_TRIGGER_SPEC
        : DEFAULT_STOCK_SCREENING_TRIGGER_SPEC
    if (input === undefined) return { ...defaults }

    const issues: RuleValidationIssue[] = []
    if (!isPlainRecord(input)) {
      throw new RuleSpecValidationException([issue('TRIGGER_SPEC_INVALID', '$.triggerSpec', 'triggerSpec 必须是对象')])
    }

    validateAllowedKeys(input, TRIGGER_SPEC_KEYS, '$.triggerSpec', issues)

    const mode = input.mode === undefined ? defaults.mode : input.mode
    if (mode !== 'ENTER' && mode !== 'EXIT' && mode !== 'BOTH' && mode !== 'EVENT') {
      issues.push(issue('TRIGGER_MODE_INVALID', '$.triggerSpec.mode', 'mode 必须是 ENTER、EXIT、BOTH 或 EVENT'))
    } else if (ruleType === SubscriptionRuleType.SIGNAL_EVENT && mode !== 'EVENT') {
      issues.push(issue('TRIGGER_MODE_UNSUPPORTED', '$.triggerSpec.mode', 'SIGNAL_EVENT 仅支持 EVENT mode'))
    } else if (ruleType !== SubscriptionRuleType.SIGNAL_EVENT && mode === 'EVENT') {
      issues.push(issue('TRIGGER_MODE_UNSUPPORTED', '$.triggerSpec.mode', '集合规则不支持 EVENT mode'))
    }

    const notifyOnInitialMatch =
      input.notifyOnInitialMatch === undefined ? defaults.notifyOnInitialMatch : input.notifyOnInitialMatch
    if (typeof notifyOnInitialMatch !== 'boolean') {
      issues.push(
        issue(
          'TRIGGER_INITIAL_MATCH_INVALID',
          '$.triggerSpec.notifyOnInitialMatch',
          'notifyOnInitialMatch 必须是布尔值',
        ),
      )
    } else if (ruleType !== SubscriptionRuleType.SIGNAL_EVENT && notifyOnInitialMatch) {
      // D-02：集合类首跑只能建立基线。初次全量通知需独立版本评审后才开放。
      issues.push(
        issue('TRIGGER_INITIAL_MATCH_UNSUPPORTED', '$.triggerSpec.notifyOnInitialMatch', 'B0 不支持首次执行通知'),
      )
    }

    const eventWindow = input.eventWindow === undefined ? defaults.eventWindow : input.eventWindow
    if (eventWindow !== 'CURRENT_TRADE_DATE' && eventWindow !== 'SINCE_LAST_SUCCESS') {
      issues.push(issue('TRIGGER_EVENT_WINDOW_INVALID', '$.triggerSpec.eventWindow', 'eventWindow 无效'))
    }

    const cooldownTradingDays =
      input.cooldownTradingDays === undefined ? defaults.cooldownTradingDays : input.cooldownTradingDays
    if (
      typeof cooldownTradingDays !== 'number' ||
      !Number.isInteger(cooldownTradingDays) ||
      cooldownTradingDays !== 0
    ) {
      issues.push(
        issue('TRIGGER_COOLDOWN_UNSUPPORTED', '$.triggerSpec.cooldownTradingDays', 'B0 仅支持 cooldownTradingDays=0'),
      )
    }

    const maxHitsPerNotification =
      input.maxHitsPerNotification === undefined ? defaults.maxHitsPerNotification : input.maxHitsPerNotification
    if (
      typeof maxHitsPerNotification !== 'number' ||
      !Number.isInteger(maxHitsPerNotification) ||
      maxHitsPerNotification < 1 ||
      maxHitsPerNotification > 100
    ) {
      issues.push(
        issue(
          'TRIGGER_MAX_HITS_INVALID',
          '$.triggerSpec.maxHitsPerNotification',
          'maxHitsPerNotification 必须为 1 到 100 的整数',
        ),
      )
    }

    if (issues.length > 0) throw new RuleSpecValidationException(issues)

    return {
      mode: mode as SubscriptionTriggerSpec['mode'],
      notifyOnInitialMatch: notifyOnInitialMatch as boolean,
      eventWindow: eventWindow as SubscriptionTriggerSpec['eventWindow'],
      cooldownTradingDays: cooldownTradingDays as number,
      maxHitsPerNotification: maxHitsPerNotification as number,
    }
  }

  private validateAllAUniverse(value: unknown, issues: RuleValidationIssue[]): AllAUniverseSpec | undefined {
    if (!isPlainRecord(value)) {
      issues.push(issue('UNIVERSE_INVALID', '$.universe', 'universe 必须是对象'))
      return undefined
    }

    validateAllowedKeys(value, ALL_A_UNIVERSE_KEYS, '$.universe', issues)
    if (value.type !== 'ALL_A') {
      issues.push(issue('UNIVERSE_UNSUPPORTED', '$.universe.type', '当前仅支持 ALL_A universe'))
    }

    for (const key of ['excludeSt', 'excludeSuspended', 'excludeBse'] as const) {
      if (typeof value[key] !== 'boolean') {
        issues.push(issue('UNIVERSE_FIELD_INVALID', `$.universe.${key}`, `${key} 必须是布尔值`))
      }
    }

    if (
      value.type !== 'ALL_A' ||
      ['excludeSt', 'excludeSuspended', 'excludeBse'].some((key) => typeof value[key] !== 'boolean')
    ) {
      return undefined
    }

    return {
      type: 'ALL_A' as const,
      excludeSt: value.excludeSt as boolean,
      excludeSuspended: value.excludeSuspended as boolean,
      excludeBse: value.excludeBse as boolean,
    }
  }

  private validateFilters(value: unknown, issues: RuleValidationIssue[]): RuleJsonObject | undefined {
    if (!isPlainRecord(value)) {
      issues.push(issue('FILTERS_INVALID', '$.filters', 'filters 必须是 JSON 对象'))
      return undefined
    }

    const seen = new WeakSet<object>()
    let valid = isJsonValue(value, '$.filters', issues, seen, 0)
    for (const key of Object.keys(value)) {
      if (!STOCK_SCREENING_FILTER_KEYS.has(key)) {
        issues.push(issue('FILTERS_FIELD_UNKNOWN', `$.filters.${key}`, '不是已支持的基础选股筛选字段'))
        valid = false
      }
    }
    if (!valid) return undefined
    return value as RuleJsonObject
  }

  private validateFactorConditions(value: unknown, issues: RuleValidationIssue[]): FactorConditionSpec[] | undefined {
    if (!Array.isArray(value) || value.length < 1 || value.length > MAX_FACTOR_CONDITIONS) {
      issues.push(
        issue('FACTOR_CONDITIONS_INVALID', '$.conditions', `因子条件数量必须为 1 到 ${MAX_FACTOR_CONDITIONS}`),
      )
      return undefined
    }

    const seenFactorIds = new Set<string>()
    const normalized: FactorConditionSpec[] = []
    for (const [index, condition] of value.entries()) {
      const path = `$.conditions[${index}]`
      if (!isPlainRecord(condition)) {
        issues.push(issue('FACTOR_CONDITION_INVALID', path, '因子条件必须是对象'))
        continue
      }
      validateAllowedKeys(condition, new Set(['factorId', 'operator', 'value']), path, issues)
      if (typeof condition.factorId !== 'string' || condition.factorId.trim().length === 0) {
        issues.push(issue('FACTOR_ID_INVALID', `${path}.factorId`, 'factorId 必须是非空字符串'))
        continue
      }
      if (seenFactorIds.has(condition.factorId)) {
        issues.push(issue('FACTOR_ID_DUPLICATE', `${path}.factorId`, '同一因子只能出现一次'))
      }
      seenFactorIds.add(condition.factorId)
      if (typeof condition.operator !== 'string' || !FACTOR_OPERATORS.has(condition.operator)) {
        issues.push(issue('FACTOR_OPERATOR_INVALID', `${path}.operator`, '因子操作符无效'))
        continue
      }
      const operator = condition.operator as FactorConditionSpec['operator']
      const valueIsNumber = typeof condition.value === 'number' && Number.isFinite(condition.value)
      const valueIsRange =
        Array.isArray(condition.value) &&
        condition.value.length === 2 &&
        condition.value.every((item) => typeof item === 'number' && Number.isFinite(item))
      const isPercentOperator = operator === 'TOP_PERCENT' || operator === 'BOTTOM_PERCENT'
      if (operator === 'BETWEEN') {
        if (!valueIsRange || (condition.value as number[])[0] > (condition.value as number[])[1]) {
          issues.push(issue('FACTOR_VALUE_INVALID', `${path}.value`, 'BETWEEN 的 value 必须是递增的两个有限数字'))
          continue
        }
      } else if (!valueIsNumber) {
        issues.push(issue('FACTOR_VALUE_INVALID', `${path}.value`, 'value 必须是有限数字'))
        continue
      } else if (
        (isPercentOperator && (condition.value as number) <= 0) ||
        (isPercentOperator && (condition.value as number) > 100)
      ) {
        issues.push(issue('FACTOR_PERCENT_INVALID', `${path}.value`, 'Top/Bottom 百分位必须在 (0, 100]'))
        continue
      }
      normalized.push({
        factorId: condition.factorId.trim(),
        operator,
        value: condition.value as number | [number, number],
      })
    }
    return normalized.length === value.length ? normalized : undefined
  }

  private validateSignalConditions(value: unknown, issues: RuleValidationIssue[]): SignalConditionSpec[] | undefined {
    if (!Array.isArray(value) || value.length < 1 || value.length > MAX_FACTOR_CONDITIONS) {
      issues.push(
        issue('SIGNAL_CONDITIONS_INVALID', '$.conditions', `技术事件条件数量必须为 1 到 ${MAX_FACTOR_CONDITIONS}`),
      )
      return undefined
    }
    const seenMetrics = new Set<string>()
    const normalized: SignalConditionSpec[] = []
    for (const [index, condition] of value.entries()) {
      const path = `$.conditions[${index}]`
      if (!isPlainRecord(condition)) {
        issues.push(issue('SIGNAL_CONDITION_INVALID', path, '技术事件条件必须是对象'))
        continue
      }
      validateAllowedKeys(condition, new Set(['metricId', 'eventType', 'threshold', 'strengthAtLeast']), path, issues)
      if (typeof condition.metricId !== 'string' || !SIGNAL_EVENTS_BY_METRIC[condition.metricId]) {
        issues.push(issue('SIGNAL_METRIC_INVALID', `${path}.metricId`, '不是可订阅的技术事件指标'))
        continue
      }
      if (seenMetrics.has(condition.metricId)) {
        issues.push(issue('SIGNAL_METRIC_DUPLICATE', `${path}.metricId`, '同一技术事件指标只能出现一次'))
      }
      seenMetrics.add(condition.metricId)
      if (
        typeof condition.eventType !== 'string' ||
        !SIGNAL_EVENTS_BY_METRIC[condition.metricId].has(condition.eventType as SignalConditionSpec['eventType'])
      ) {
        issues.push(issue('SIGNAL_EVENT_INVALID', `${path}.eventType`, '事件类型不属于该技术指标'))
        continue
      }
      if (
        condition.threshold !== undefined &&
        (typeof condition.threshold !== 'number' || !Number.isFinite(condition.threshold))
      ) {
        issues.push(issue('SIGNAL_THRESHOLD_INVALID', `${path}.threshold`, 'threshold 必须是有限数字'))
        continue
      }
      if (
        condition.strengthAtLeast !== undefined &&
        (typeof condition.strengthAtLeast !== 'number' ||
          !Number.isFinite(condition.strengthAtLeast) ||
          condition.strengthAtLeast < 0)
      ) {
        issues.push(
          issue('SIGNAL_STRENGTH_INVALID', `${path}.strengthAtLeast`, 'strengthAtLeast 必须是不小于 0 的有限数字'),
        )
        continue
      }
      normalized.push({
        metricId: condition.metricId,
        eventType: condition.eventType as SignalConditionSpec['eventType'],
        ...(condition.threshold !== undefined ? { threshold: condition.threshold as number } : {}),
        ...(condition.strengthAtLeast !== undefined ? { strengthAtLeast: condition.strengthAtLeast as number } : {}),
      })
    }
    return normalized.length === value.length ? normalized : undefined
  }
}

function issue(code: string, path: string, message: string): RuleValidationIssue {
  return { code, path, message }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function validateAllowedKeys(
  value: Record<string, unknown>,
  allowedKeys: Set<string>,
  path: string,
  issues: RuleValidationIssue[],
): void {
  for (const key of Object.keys(value)) {
    if (UNSAFE_KEYS.has(key)) {
      issues.push(issue('RULE_FIELD_UNSAFE', `${path}.${key}`, '不允许原型链相关字段'))
    } else if (!allowedKeys.has(key)) {
      issues.push(issue('RULE_FIELD_UNKNOWN', `${path}.${key}`, '存在未定义字段'))
    }
  }
}

function isJsonValue(
  value: unknown,
  path: string,
  issues: RuleValidationIssue[],
  seen: WeakSet<object>,
  depth: number,
): value is RuleJsonValue {
  if (depth > MAX_JSON_DEPTH) {
    issues.push(issue('FILTERS_TOO_DEEP', path, `filters 嵌套不能超过 ${MAX_JSON_DEPTH} 层`))
    return false
  }

  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return true
    issues.push(issue('FILTERS_NUMBER_INVALID', path, 'filters 中数字必须有限'))
    return false
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      issues.push(issue('FILTERS_CYCLE_INVALID', path, 'filters 不能包含循环引用'))
      return false
    }
    seen.add(value)
    let valid = true
    value.forEach((item, index) => {
      valid = isJsonValue(item, `${path}[${index}]`, issues, seen, depth + 1) && valid
    })
    seen.delete(value)
    return valid
  }

  if (!isPlainRecord(value)) {
    issues.push(issue('FILTERS_VALUE_INVALID', path, 'filters 只能包含 JSON 值'))
    return false
  }

  if (seen.has(value)) {
    issues.push(issue('FILTERS_CYCLE_INVALID', path, 'filters 不能包含循环引用'))
    return false
  }
  seen.add(value)

  let valid = true
  for (const [key, nested] of Object.entries(value)) {
    if (UNSAFE_KEYS.has(key)) {
      issues.push(issue('FILTERS_FIELD_UNSAFE', `${path}.${key}`, '不允许原型链相关字段'))
      valid = false
      continue
    }
    valid = isJsonValue(nested, `${path}.${key}`, issues, seen, depth + 1) && valid
  }
  seen.delete(value)
  return valid
}

function serializedByteLength(value: unknown): number | null {
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8')
  } catch {
    return null
  }
}
