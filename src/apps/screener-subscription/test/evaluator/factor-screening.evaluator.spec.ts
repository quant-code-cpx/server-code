import { PrismaService } from 'src/shared/prisma.service'
import { FactorScreeningEvaluator } from '../../evaluator/factor-screening.evaluator'
import { SubscriptionRuleType } from '../../rule/subscription-rule.types'

describe('FactorScreeningEvaluator', () => {
  it('只使用指定交易日因子快照，在规则 universe 内应用阈值与分位条件', async () => {
    const prisma = {
      stockBasic: {
        findMany: jest.fn().mockResolvedValue([
          { tsCode: '000001.SZ', name: '甲公司' },
          { tsCode: '000002.SZ', name: '乙公司' },
          { tsCode: '000003.BJ', name: '丙公司' },
          { tsCode: '000004.SZ', name: '*ST丁公司' },
        ]),
      },
      daily: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ tsCode: '000001.SZ' }, { tsCode: '000002.SZ' }, { tsCode: '000004.SZ' }]),
      },
      factorDefinition: { findMany: jest.fn().mockResolvedValue([{ name: 'pe_ttm', isEnabled: true }]) },
      factorSnapshot: {
        findMany: jest.fn().mockResolvedValue([
          { factorName: 'pe_ttm', tsCode: '000001.SZ', value: 8, percentile: 0.2, syncedAt: new Date('2026-07-24') },
          { factorName: 'pe_ttm', tsCode: '000002.SZ', value: 18, percentile: 0.8, syncedAt: new Date('2026-07-24') },
          { factorName: 'pe_ttm', tsCode: '000004.SZ', value: 100, percentile: 0.99, syncedAt: new Date('2026-07-24') },
        ]),
      },
    }
    const evaluator = new FactorScreeningEvaluator(prisma as unknown as PrismaService)
    const result = await evaluator.evaluate(
      {
        userId: 1,
        tradeDate: '20260724',
        previousSuccessfulTradeDate: null,
        ruleVersion: 1,
        preview: true,
      },
      {
        type: SubscriptionRuleType.FACTOR_SCREENING,
        version: 1,
        universe: { type: 'ALL_A', excludeSt: true, excludeSuspended: true, excludeBse: true },
        conditions: [{ factorId: 'pe_ttm', operator: 'TOP_PERCENT', value: 50 }],
      },
    )

    expect(result.universeCount).toBe(2)
    expect(result.matchedCodes).toEqual(['000002.SZ'])
    expect(result.dataVersions.FACTOR_SNAPSHOT).toContain('target:20260724')
  })
})
