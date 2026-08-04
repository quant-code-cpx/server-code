import { Injectable } from '@nestjs/common'
import {
  LEGACY_ALL_A_UNIVERSE,
  FactorScreeningRuleSpec,
  RuleJsonObject,
  RuleJsonValue,
  StockScreeningRuleSpec,
  SignalEventRuleSpec,
  SubscriptionRuleType,
  SubscriptionTriggerSpec,
} from './subscription-rule.types'
import { RuleSpecValidatorService } from './rule-spec-validator.service'

/**
 * 规则在 create/update/preview/正式执行前共用此规范化入口。
 * 保留数组顺序，避免误改区间或有序条件的业务含义；对象 key 则稳定排序。
 */
@Injectable()
export class RuleNormalizerService {
  constructor(private readonly validator: RuleSpecValidatorService) {}

  normalizeRuleSpec(input: unknown): StockScreeningRuleSpec | FactorScreeningRuleSpec | SignalEventRuleSpec {
    const ruleSpec = this.validator.validateRuleSpec(input)
    const universe = {
      type: 'ALL_A' as const,
      excludeSt: ruleSpec.universe.excludeSt,
      excludeSuspended: ruleSpec.universe.excludeSuspended,
      excludeBse: ruleSpec.universe.excludeBse,
    }
    if (ruleSpec.type === SubscriptionRuleType.STOCK_SCREENING) {
      return { type: ruleSpec.type, version: 1, universe, filters: normalizeJsonObject(ruleSpec.filters) }
    }
    if (ruleSpec.type === SubscriptionRuleType.SIGNAL_EVENT) {
      return {
        type: ruleSpec.type,
        version: 1,
        universe,
        conditions: ruleSpec.conditions.map((condition) => ({ ...condition })),
        minSatisfied: ruleSpec.minSatisfied,
      }
    }
    return {
      type: ruleSpec.type,
      version: 1,
      universe,
      conditions: ruleSpec.conditions.map((condition) => ({ ...condition })),
      ...(ruleSpec.sortBy ? { sortBy: ruleSpec.sortBy } : {}),
      ...(ruleSpec.sortOrder ? { sortOrder: ruleSpec.sortOrder } : {}),
    } as FactorScreeningRuleSpec
  }

  normalizeTriggerSpec(
    input: unknown = undefined,
    ruleType = SubscriptionRuleType.STOCK_SCREENING,
  ): SubscriptionTriggerSpec {
    return this.validator.validateTriggerSpec(input, ruleType)
  }

  /** 将存量 filters 显式包装为冻结的 B0 ruleSpec，供迁移/双读适配器调用。 */
  normalizeLegacyStockScreeningRule(filters: unknown): StockScreeningRuleSpec {
    const ruleSpec = this.normalizeRuleSpec({
      type: SubscriptionRuleType.STOCK_SCREENING,
      version: 1,
      universe: { ...LEGACY_ALL_A_UNIVERSE },
      filters,
    })
    if (ruleSpec.type !== SubscriptionRuleType.STOCK_SCREENING) throw new TypeError('legacy 规则必须是基础选股规则')
    return ruleSpec
  }
}

export function normalizeJsonObject(value: RuleJsonObject): RuleJsonObject {
  const normalized: RuleJsonObject = {}
  for (const key of Object.keys(value).sort()) {
    normalized[key] = normalizeJsonValue(value[key])
  }
  return normalized
}

export function normalizeJsonValue(value: RuleJsonValue): RuleJsonValue {
  if (Array.isArray(value)) return value.map((item) => normalizeJsonValue(item))
  if (value !== null && typeof value === 'object') return normalizeJsonObject(value)
  if (typeof value === 'number' && Object.is(value, -0)) return 0
  return value
}

/** JSON 语义稳定序列化；调用方必须先完成 validator 校验。 */
export function stableRuleStringify(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') return JSON.stringify(Object.is(value, -0) ? 0 : value)
  if (Array.isArray(value)) return `[${value.map((item) => stableRuleStringify(item)).join(',')}]`
  if (value === null || typeof value !== 'object') throw new TypeError('stableRuleStringify 只支持 JSON 值')

  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableRuleStringify(record[key])}`)
    .join(',')}}`
}
