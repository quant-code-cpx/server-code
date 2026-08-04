import { Injectable } from '@nestjs/common'
import { createHash } from 'crypto'
import { FactorScreeningRuleSpec, SignalEventRuleSpec, StockScreeningRuleSpec } from './subscription-rule.types'
import { RuleNormalizerService, stableRuleStringify } from './rule-normalizer.service'

export interface RuleFingerprintResult {
  fingerprint: string
  normalizedRuleSpec: StockScreeningRuleSpec | FactorScreeningRuleSpec | SignalEventRuleSpec
  semanticsVersions: string[]
}

/**
 * 指纹只覆盖规则语义及关联技术语义版本；名称、频率、通知摘要上限不参与。
 */
@Injectable()
export class RuleFingerprintService {
  constructor(private readonly normalizer: RuleNormalizerService) {}

  fingerprint(input: unknown, semanticsVersions: readonly string[] = []): string {
    return this.create(input, semanticsVersions).fingerprint
  }

  create(input: unknown, semanticsVersions: readonly string[] = []): RuleFingerprintResult {
    const normalizedRuleSpec = this.normalizer.normalizeRuleSpec(input)
    const normalizedSemanticsVersions = normalizeSemanticsVersions(semanticsVersions)
    const canonical = stableRuleStringify({
      ruleType: normalizedRuleSpec.type,
      normalizedRuleSpec,
      semanticsVersions: normalizedSemanticsVersions,
    })

    return {
      fingerprint: createHash('sha256').update(canonical, 'utf8').digest('hex'),
      normalizedRuleSpec,
      semanticsVersions: normalizedSemanticsVersions,
    }
  }
}

function normalizeSemanticsVersions(values: readonly string[]): string[] {
  const unique = new Set<string>()
  for (const value of values) {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new TypeError('semanticsVersions 必须由非空字符串组成')
    }
    unique.add(value.trim())
  }
  return [...unique].sort()
}
