import { RuleSpecValidationException, RuleSpecValidatorService } from '../../rule/rule-spec-validator.service'
import { SubscriptionRuleType } from '../../rule/subscription-rule.types'

const validRule = () => ({
  type: SubscriptionRuleType.STOCK_SCREENING,
  version: 1,
  universe: {
    type: 'ALL_A' as const,
    excludeSt: true,
    excludeSuspended: true,
    excludeBse: false,
  },
  filters: { minPeTtm: 10, industries: ['银行', '券商'] },
})

describe('RuleSpecValidatorService', () => {
  const service = new RuleSpecValidatorService()

  it('接受冻结的 B0 STOCK_SCREENING + ALL_A 协议', () => {
    expect(service.validateRuleSpec(validRule())).toEqual(validRule())
  })

  it('拒绝尚未开放的未来规则类型和非 ALL_A universe', () => {
    expect(() =>
      service.validateRuleSpec({
        ...validRule(),
        type: SubscriptionRuleType.FACTOR_SCREENING,
      }),
    ).toThrow(RuleSpecValidationException)

    expect(() =>
      service.validateRuleSpec({
        ...validRule(),
        universe: { type: 'INDEX', indexCode: '000300.SH', excludeSt: true, excludeSuspended: true },
      }),
    ).toThrow(RuleSpecValidationException)
  })

  it('对 triggerSpec 应用首次执行默认不通知，并拒绝 EVENT mode 和首次通知', () => {
    expect(service.validateTriggerSpec()).toMatchObject({
      mode: 'ENTER',
      notifyOnInitialMatch: false,
      cooldownTradingDays: 0,
      maxHitsPerNotification: 20,
    })

    expect(() => service.validateTriggerSpec({ mode: 'EVENT' })).toThrow(RuleSpecValidationException)
    expect(() => service.validateTriggerSpec({ notifyOnInitialMatch: true })).toThrow(RuleSpecValidationException)
  })
})
