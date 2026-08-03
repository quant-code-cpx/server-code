import { BadRequestException, Injectable } from '@nestjs/common'
import {
  DEFAULT_STOCK_SCREENING_TRIGGER_SPEC,
  RuleJsonObject,
  RuleJsonValue,
  RuleValidationIssue,
  StockScreeningRuleSpec,
  SubscriptionRuleType,
  SubscriptionTriggerSpec,
} from './subscription-rule.types'

const RULE_SPEC_KEYS = new Set(['type', 'version', 'universe', 'filters'])
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
 * B0 只接受已冻结的 STOCK_SCREENING v1 + ALL_A 协议。
 * 类型先保留未来枚举，但任何尚未实现的规则都必须在边界处失败，不能降级成空结果。
 */
@Injectable()
export class RuleSpecValidatorService {
  validate(input: unknown): StockScreeningRuleSpec {
    return this.validateRuleSpec(input)
  }

  validateRuleSpec(input: unknown): StockScreeningRuleSpec {
    const issues: RuleValidationIssue[] = []
    if (!isPlainRecord(input)) {
      throw new RuleSpecValidationException([issue('RULE_SPEC_INVALID', '$', 'ruleSpec 必须是对象')])
    }

    validateAllowedKeys(input, RULE_SPEC_KEYS, '$', issues)

    if (input.type !== SubscriptionRuleType.STOCK_SCREENING) {
      const code = Object.values(SubscriptionRuleType).includes(input.type as SubscriptionRuleType)
        ? 'RULE_TYPE_UNSUPPORTED'
        : 'RULE_TYPE_INVALID'
      issues.push(issue(code, '$.type', 'B0 仅支持 STOCK_SCREENING 规则'))
    }

    if (input.version !== 1) {
      issues.push(issue('RULE_VERSION_INVALID', '$.version', 'STOCK_SCREENING 规则版本必须为 1'))
    }

    const universe = this.validateAllAUniverse(input.universe, issues)
    const filters = this.validateFilters(input.filters, issues)

    const byteLength = serializedByteLength(input)
    if (byteLength === null) {
      issues.push(issue('RULE_SPEC_INVALID', '$', 'ruleSpec 必须是可序列化 JSON'))
    } else if (byteLength > MAX_RULE_SPEC_BYTES) {
      issues.push(issue('RULE_SPEC_TOO_LARGE', '$', `ruleSpec 不能超过 ${MAX_RULE_SPEC_BYTES} 字节`))
    }

    if (issues.length > 0) throw new RuleSpecValidationException(issues)

    return {
      type: SubscriptionRuleType.STOCK_SCREENING,
      version: 1,
      universe: universe!,
      filters: filters!,
    }
  }

  validateTriggerSpec(input: unknown = undefined): SubscriptionTriggerSpec {
    if (input === undefined) return { ...DEFAULT_STOCK_SCREENING_TRIGGER_SPEC }

    const issues: RuleValidationIssue[] = []
    if (!isPlainRecord(input)) {
      throw new RuleSpecValidationException([issue('TRIGGER_SPEC_INVALID', '$.triggerSpec', 'triggerSpec 必须是对象')])
    }

    validateAllowedKeys(input, TRIGGER_SPEC_KEYS, '$.triggerSpec', issues)

    const mode = input.mode === undefined ? DEFAULT_STOCK_SCREENING_TRIGGER_SPEC.mode : input.mode
    if (mode !== 'ENTER' && mode !== 'EXIT' && mode !== 'BOTH' && mode !== 'EVENT') {
      issues.push(issue('TRIGGER_MODE_INVALID', '$.triggerSpec.mode', 'mode 必须是 ENTER、EXIT、BOTH 或 EVENT'))
    } else if (mode === 'EVENT') {
      issues.push(issue('TRIGGER_MODE_UNSUPPORTED', '$.triggerSpec.mode', 'B0 的 STOCK_SCREENING 不支持 EVENT mode'))
    }

    const notifyOnInitialMatch =
      input.notifyOnInitialMatch === undefined
        ? DEFAULT_STOCK_SCREENING_TRIGGER_SPEC.notifyOnInitialMatch
        : input.notifyOnInitialMatch
    if (typeof notifyOnInitialMatch !== 'boolean') {
      issues.push(
        issue(
          'TRIGGER_INITIAL_MATCH_INVALID',
          '$.triggerSpec.notifyOnInitialMatch',
          'notifyOnInitialMatch 必须是布尔值',
        ),
      )
    } else if (notifyOnInitialMatch) {
      // D-02：集合类首跑只能建立基线。初次全量通知需独立版本评审后才开放。
      issues.push(
        issue('TRIGGER_INITIAL_MATCH_UNSUPPORTED', '$.triggerSpec.notifyOnInitialMatch', 'B0 不支持首次执行通知'),
      )
    }

    const eventWindow =
      input.eventWindow === undefined ? DEFAULT_STOCK_SCREENING_TRIGGER_SPEC.eventWindow : input.eventWindow
    if (eventWindow !== 'CURRENT_TRADE_DATE' && eventWindow !== 'SINCE_LAST_SUCCESS') {
      issues.push(issue('TRIGGER_EVENT_WINDOW_INVALID', '$.triggerSpec.eventWindow', 'eventWindow 无效'))
    }

    const cooldownTradingDays =
      input.cooldownTradingDays === undefined
        ? DEFAULT_STOCK_SCREENING_TRIGGER_SPEC.cooldownTradingDays
        : input.cooldownTradingDays
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
      input.maxHitsPerNotification === undefined
        ? DEFAULT_STOCK_SCREENING_TRIGGER_SPEC.maxHitsPerNotification
        : input.maxHitsPerNotification
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

  private validateAllAUniverse(value: unknown, issues: RuleValidationIssue[]) {
    if (!isPlainRecord(value)) {
      issues.push(issue('UNIVERSE_INVALID', '$.universe', 'universe 必须是对象'))
      return undefined
    }

    validateAllowedKeys(value, ALL_A_UNIVERSE_KEYS, '$.universe', issues)
    if (value.type !== 'ALL_A') {
      issues.push(issue('UNIVERSE_UNSUPPORTED', '$.universe.type', 'B0 仅支持 ALL_A universe'))
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
    if (!isJsonValue(value, '$.filters', issues, seen, 0)) return undefined
    return value as RuleJsonObject
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
