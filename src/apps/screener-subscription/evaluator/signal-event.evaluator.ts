import { Injectable } from '@nestjs/common'
import { PrismaService } from 'src/shared/prisma.service'
import { SignalEventRuleSpec, SubscriptionRuleType } from '../rule'
import { isSpecialTreatmentStockName } from '../rule/subscription-universe.util'
import {
  EvaluationContext,
  EvaluationEvidence,
  EvaluationOutcome,
  SubscriptionEvaluator,
} from './subscription-evaluator.interface'

@Injectable()
export class SignalEventEvaluator implements SubscriptionEvaluator<SignalEventRuleSpec> {
  readonly type = SubscriptionRuleType.SIGNAL_EVENT

  constructor(private readonly prisma: PrismaService) {}

  async evaluate(context: EvaluationContext, spec: SignalEventRuleSpec): Promise<EvaluationOutcome> {
    const universe = await this.resolveUniverse(context.tradeDate, spec)
    const startDate =
      context.eventWindow === 'SINCE_LAST_SUCCESS' &&
      context.previousSuccessfulTradeDate &&
      context.previousSuccessfulTradeDate < context.tradeDate
        ? context.previousSuccessfulTradeDate
        : context.tradeDate
    const events = await this.prisma.technicalSignalEvent.findMany({
      where: {
        tradeDate: { gte: startDate, lte: context.tradeDate },
        tsCode: { in: [...universe] },
        OR: spec.conditions.map((condition) => ({
          metricId: condition.metricId,
          eventType: condition.eventType,
          ...(condition.strengthAtLeast !== undefined ? { strength: { gte: condition.strengthAtLeast } } : {}),
        })),
      },
      select: { tsCode: true, tradeDate: true, metricId: true, eventType: true, semanticsVersion: true },
      orderBy: [{ tradeDate: 'asc' }, { tsCode: 'asc' }],
    })
    const conditionKeys = new Set(spec.conditions.map((condition) => `${condition.metricId}:${condition.eventType}`))
    const grouped = new Map<string, { tsCode: string; eventTradeDate: string; matchedConditions: Set<string> }>()
    for (const event of events) {
      const conditionKey = `${event.metricId}:${event.eventType}`
      if (!conditionKeys.has(conditionKey)) continue
      const key = `${event.tsCode}:${event.tradeDate}`
      const group = grouped.get(key) ?? {
        tsCode: event.tsCode,
        eventTradeDate: event.tradeDate,
        matchedConditions: new Set<string>(),
      }
      group.matchedConditions.add(conditionKey)
      grouped.set(key, group)
    }
    const eventHits = [...grouped.values()]
      .filter((group) => group.matchedConditions.size >= spec.minSatisfied)
      .map(({ tsCode, eventTradeDate }) => ({ tsCode, eventTradeDate }))
    return {
      asOfTradeDate: context.tradeDate,
      universeCount: universe.size,
      matchedCodes: [...new Set(eventHits.map((hit) => hit.tsCode))].sort(),
      eventHits,
      dataVersions: {
        TECHNICAL_SIGNAL_EVENT: `window:${startDate}-${context.tradeDate}:semantics:${[...new Set(events.map((event) => event.semanticsVersion))].sort().join(',') || 'none'}`,
      },
      warnings: [],
    }
  }

  async explain(
    _context: EvaluationContext,
    spec: SignalEventRuleSpec,
    candidates: Array<{ tsCode: string; kind: EvaluationEvidence['kind']; eventTradeDate?: string }>,
  ): Promise<EvaluationEvidence[]> {
    const eventCandidates = candidates.filter(
      (candidate): candidate is { tsCode: string; kind: EvaluationEvidence['kind']; eventTradeDate: string } =>
        candidate.eventTradeDate !== undefined,
    )
    if (!eventCandidates.length) return []
    const events = await this.prisma.technicalSignalEvent.findMany({
      where: {
        tsCode: { in: [...new Set(eventCandidates.map((candidate) => candidate.tsCode))] },
        tradeDate: { in: [...new Set(eventCandidates.map((candidate) => candidate.eventTradeDate))] },
        OR: spec.conditions.map((condition) => ({
          metricId: condition.metricId,
          eventType: condition.eventType,
          ...(condition.strengthAtLeast !== undefined ? { strength: { gte: condition.strengthAtLeast } } : {}),
        })),
      },
      select: {
        tsCode: true,
        tradeDate: true,
        metricId: true,
        eventType: true,
        semanticsVersion: true,
        strength: true,
        evidence: true,
      },
    })
    const eventByDateCode = new Map<string, typeof events>()
    for (const event of events) {
      const key = `${event.tsCode}:${event.tradeDate}`
      const values = eventByDateCode.get(key) ?? []
      values.push(event)
      eventByDateCode.set(key, values)
    }
    return eventCandidates.map((candidate) => {
      const matching = eventByDateCode.get(`${candidate.tsCode}:${candidate.eventTradeDate}`) ?? []
      return {
        tsCode: candidate.tsCode,
        kind: candidate.kind,
        reason: '股票满足技术事件订阅规则',
        details: {
          eventTradeDate: candidate.eventTradeDate,
          minSatisfied: spec.minSatisfied,
          events: matching.map((event) => ({
            metricId: event.metricId,
            eventType: event.eventType,
            semanticsVersion: event.semanticsVersion,
            strength: event.strength === null ? null : Number(event.strength),
            evidence: event.evidence,
          })),
        },
      }
    })
  }

  private async resolveUniverse(tradeDate: string, spec: SignalEventRuleSpec): Promise<Set<string>> {
    const targetDate = new Date(
      `${tradeDate.slice(0, 4)}-${tradeDate.slice(4, 6)}-${tradeDate.slice(6, 8)}T00:00:00.000Z`,
    )
    const [stocks, dailyCodes] = await Promise.all([
      this.prisma.stockBasic.findMany({
        where: {
          listStatus: 'L',
          AND: [
            { OR: [{ listDate: null }, { listDate: { lte: targetDate } }] },
            { OR: [{ delistDate: null }, { delistDate: { gt: targetDate } }] },
          ],
        },
        select: { tsCode: true, name: true },
      }),
      spec.universe.excludeSuspended
        ? this.prisma.daily.findMany({ where: { tradeDate: targetDate }, select: { tsCode: true } })
        : Promise.resolve([]),
    ])
    const activeDaily = new Set(dailyCodes.map((row) => row.tsCode))
    return new Set(
      stocks
        .filter((stock) => !spec.universe.excludeSt || !isSpecialTreatmentStockName(stock.name))
        .filter((stock) => !spec.universe.excludeBse || !stock.tsCode.endsWith('.BJ'))
        .filter((stock) => !spec.universe.excludeSuspended || activeDaily.has(stock.tsCode))
        .map((stock) => stock.tsCode),
    )
  }
}
