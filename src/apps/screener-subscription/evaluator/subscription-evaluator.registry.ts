import { Injectable } from '@nestjs/common'
import { SubscriptionRuleType } from '../rule'
import { SubscriptionEvaluator } from './subscription-evaluator.interface'
import { FactorScreeningEvaluator } from './factor-screening.evaluator'
import { StockScreeningEvaluator } from './stock-screening.evaluator'
import { SignalEventEvaluator } from './signal-event.evaluator'

@Injectable()
export class SubscriptionEvaluatorRegistry {
  private readonly evaluators = new Map<SubscriptionRuleType, SubscriptionEvaluator>()

  constructor(
    stockScreening: StockScreeningEvaluator,
    factorScreening: FactorScreeningEvaluator,
    signalEvent: SignalEventEvaluator,
  ) {
    this.evaluators.set(stockScreening.type, stockScreening)
    this.evaluators.set(factorScreening.type, factorScreening)
    this.evaluators.set(signalEvent.type, signalEvent)
  }

  get(type: SubscriptionRuleType): SubscriptionEvaluator {
    const evaluator = this.evaluators.get(type)
    if (!evaluator) throw new SubscriptionEvaluatorUnsupportedError(type)
    return evaluator
  }
}

export class SubscriptionEvaluatorUnsupportedError extends Error {
  constructor(type: SubscriptionRuleType) {
    super(`规则类型 ${type} 尚未满足数据就绪门槛`)
  }
}
