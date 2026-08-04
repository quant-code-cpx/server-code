import { RuleFingerprintService } from '../../rule/rule-fingerprint.service'
import { RuleNormalizerService } from '../../rule/rule-normalizer.service'
import { RuleSpecValidatorService } from '../../rule/rule-spec-validator.service'
import { SubscriptionRuleType } from '../../rule/subscription-rule.types'

const createFingerprintService = () => {
  const validator = new RuleSpecValidatorService()
  return new RuleFingerprintService(new RuleNormalizerService(validator))
}

describe('RuleFingerprintService', () => {
  it('忽略对象 key 顺序、-0 和语义版本输入顺序', () => {
    const service = createFingerprintService()
    const base = {
      type: SubscriptionRuleType.STOCK_SCREENING,
      version: 1,
      universe: { type: 'ALL_A' as const, excludeSt: true, excludeSuspended: true, excludeBse: false },
      filters: { maxPeTtm: 20, minPeTtm: -0 },
    }
    const reordered = {
      filters: { minPeTtm: 0, maxPeTtm: 20 },
      universe: { excludeBse: false, excludeSuspended: true, excludeSt: true, type: 'ALL_A' as const },
      version: 1,
      type: SubscriptionRuleType.STOCK_SCREENING,
    }

    expect(service.fingerprint(base, ['macd.v1', 'boll.v1'])).toBe(
      service.fingerprint(reordered, ['boll.v1', 'macd.v1', 'macd.v1']),
    )
  })
})
