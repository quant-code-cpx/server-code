import { SubscriptionRuleSpec } from '../rule'

export interface EvaluationContext {
  userId: number
  tradeDate: string
  previousSuccessfulTradeDate: string | null
  ruleVersion: number
  preview: boolean
  eventWindow?: 'CURRENT_TRADE_DATE' | 'SINCE_LAST_SUCCESS'
}

export interface EvaluationEvidence {
  tsCode: string
  kind: 'MATCH' | 'ENTER' | 'EXIT' | 'EVENT'
  reason: string
  details: Record<string, unknown>
}

export interface EvaluationEventHit {
  tsCode: string
  eventTradeDate: string
}

export interface EvaluationOutcome {
  asOfTradeDate: string
  universeCount: number
  matchedCodes: string[]
  dataVersions: Record<string, string>
  warnings: Array<{ code: string; message: string }>
  /** 事件规则不做集合差集；每条为已按 minSatisfied 聚合的日级事件命中。 */
  eventHits?: EvaluationEventHit[]
}

export interface SubscriptionEvaluator<TSpec extends SubscriptionRuleSpec = SubscriptionRuleSpec> {
  readonly type: TSpec['type']
  evaluate(context: EvaluationContext, spec: TSpec): Promise<EvaluationOutcome>
  explain(
    context: EvaluationContext,
    spec: TSpec,
    candidates: Array<{ tsCode: string; kind: EvaluationEvidence['kind']; eventTradeDate?: string }>,
  ): Promise<EvaluationEvidence[]>
}
