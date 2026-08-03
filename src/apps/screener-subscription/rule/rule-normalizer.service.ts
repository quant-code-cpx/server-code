import { Injectable } from '@nestjs/common'
import {
  LEGACY_ALL_A_UNIVERSE,
  RuleJsonObject,
  RuleJsonValue,
  StockScreeningRuleSpec,
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

  normalizeRuleSpec(input: unknown): StockScreeningRuleSpec {
    const ruleSpec = this.validator.validateRuleSpec(input)
    if (ruleSpec.universe.type !== 'ALL_A') {
      // validator 已保证此分支不可达；保留防线，避免未来放宽类型后静默改变 B0 语义。
      throw new TypeError('B0 仅支持 ALL_A universe')
    }
    return {
      type: SubscriptionRuleType.STOCK_SCREENING,
      version: 1,
      universe: {
        type: 'ALL_A',
        excludeSt: ruleSpec.universe.excludeSt,
        excludeSuspended: ruleSpec.universe.excludeSuspended,
        excludeBse: ruleSpec.universe.excludeBse,
      },
      filters: normalizeJsonObject(ruleSpec.filters),
    }
  }

  normalizeTriggerSpec(input: unknown = undefined): SubscriptionTriggerSpec {
    return this.validator.validateTriggerSpec(input)
  }

  /** 将存量 filters 显式包装为冻结的 B0 ruleSpec，供迁移/双读适配器调用。 */
  normalizeLegacyStockScreeningRule(filters: unknown): StockScreeningRuleSpec {
    return this.normalizeRuleSpec({
      type: SubscriptionRuleType.STOCK_SCREENING,
      version: 1,
      universe: { ...LEGACY_ALL_A_UNIVERSE },
      filters,
    })
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
