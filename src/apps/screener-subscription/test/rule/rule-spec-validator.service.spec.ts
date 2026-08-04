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

  it('接受 B2/B3 规则，并拒绝未开放类型和非 ALL_A universe', () => {
    expect(
      service.validateRuleSpec({
        type: SubscriptionRuleType.FACTOR_SCREENING,
        version: 1,
        universe: validRule().universe,
        conditions: [{ factorId: 'pe_ttm', operator: 'BETWEEN', value: [0, 20] }],
      }),
    ).toMatchObject({ type: SubscriptionRuleType.FACTOR_SCREENING })

    expect(
      service.validateRuleSpec({
        type: SubscriptionRuleType.SIGNAL_EVENT,
        version: 1,
        universe: validRule().universe,
        conditions: [{ metricId: 'signal.macd', eventType: 'GOLDEN_CROSS' }],
        minSatisfied: 1,
      }),
    ).toMatchObject({ type: SubscriptionRuleType.SIGNAL_EVENT })

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

    expect(service.validateTriggerSpec(undefined, SubscriptionRuleType.SIGNAL_EVENT)).toMatchObject({
      mode: 'EVENT',
      notifyOnInitialMatch: true,
      eventWindow: 'CURRENT_TRADE_DATE',
    })
    expect(() => service.validateTriggerSpec({ mode: 'ENTER' }, SubscriptionRuleType.SIGNAL_EVENT)).toThrow(
      RuleSpecValidationException,
    )
  })

  it('拒绝无法由基础选股执行器消费的未知筛选字段，避免静默全市场命中', () => {
    expect(() =>
      service.validateRuleSpec({
        ...validRule(),
        filters: { 'valuation.peTtm': 0 },
      }),
    ).toThrow(RuleSpecValidationException)
  })
})
