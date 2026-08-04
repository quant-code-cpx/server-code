import { PrismaService } from 'src/shared/prisma.service'
import { SignalEventEvaluator } from '../../evaluator/signal-event.evaluator'
import { SignalEventRuleSpec, SubscriptionRuleType } from '../../rule/subscription-rule.types'

describe('SignalEventEvaluator', () => {
  it('仅将同一交易日满足 minSatisfied 的物化技术事件作为命中', async () => {
    const events = [
      {
        tsCode: '000001.SZ',
        tradeDate: '20260724',
        metricId: 'signal.macd',
        eventType: 'GOLDEN_CROSS',
        semanticsVersion: 'macd.v1',
        strength: 1,
        evidence: { current: { macdDif: 1 } },
      },
      {
        tsCode: '000001.SZ',
        tradeDate: '20260724',
        metricId: 'signal.rsi6',
        eventType: 'OVERSOLD_ENTER',
        semanticsVersion: 'rsi6.v1',
        strength: 1,
        evidence: { current: { rsi6: 20 } },
      },
      {
        tsCode: '000002.SZ',
        tradeDate: '20260724',
        metricId: 'signal.macd',
        eventType: 'GOLDEN_CROSS',
        semanticsVersion: 'macd.v1',
        strength: 1,
        evidence: { current: { macdDif: 1 } },
      },
    ]
    const prisma = {
      stockBasic: {
        findMany: jest.fn().mockResolvedValue([
          { tsCode: '000001.SZ', name: '甲公司' },
          { tsCode: '000002.SZ', name: '乙公司' },
        ]),
      },
      daily: { findMany: jest.fn().mockResolvedValue([{ tsCode: '000001.SZ' }, { tsCode: '000002.SZ' }]) },
      technicalSignalEvent: { findMany: jest.fn().mockResolvedValue(events) },
    }
    const evaluator = new SignalEventEvaluator(prisma as unknown as PrismaService)
    const spec: SignalEventRuleSpec = {
      type: SubscriptionRuleType.SIGNAL_EVENT,
      version: 1,
      universe: { type: 'ALL_A' as const, excludeSt: true, excludeSuspended: true, excludeBse: true },
      conditions: [
        { metricId: 'signal.macd', eventType: 'GOLDEN_CROSS' as const },
        { metricId: 'signal.rsi6', eventType: 'OVERSOLD_ENTER' as const },
      ],
      minSatisfied: 2,
    }
    const context = {
      userId: 1,
      tradeDate: '20260724',
      previousSuccessfulTradeDate: null,
      ruleVersion: 1,
      preview: true,
      eventWindow: 'CURRENT_TRADE_DATE' as const,
    }

    const outcome = await evaluator.evaluate(context, spec)

    expect(outcome.matchedCodes).toEqual(['000001.SZ'])
    expect(outcome.eventHits).toEqual([{ tsCode: '000001.SZ', eventTradeDate: '20260724' }])
    expect(
      await evaluator.explain(context, spec, [{ tsCode: '000001.SZ', kind: 'EVENT', eventTradeDate: '20260724' }]),
    ).toMatchObject([{ reason: '股票满足技术事件订阅规则' }])
    expect(prisma.technicalSignalEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tradeDate: { gte: '20260724', lte: '20260724' } }) }),
    )
  })
})
