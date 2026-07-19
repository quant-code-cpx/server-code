import { PortfolioToolFacade, PortfolioToolNotFoundError } from '../portfolio-tool.facade'

describe('PortfolioToolFacade', () => {
  it('所有权查询把不存在与跨租户统一为 not found，且不执行风险计算', async () => {
    const prisma = { portfolio: { findFirst: jest.fn().mockResolvedValue(null) } }
    const risk = { getRiskSnapshot: jest.fn() }
    const facade = new PortfolioToolFacade(prisma as never, risk as never)

    await expect(
      facade.risk(1, { portfolioId: 'portfolio_b', asOfDate: '2024-06-30', sections: ['BETA'] }),
    ).rejects.toBeInstanceOf(PortfolioToolNotFoundError)
    expect(prisma.portfolio.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'portfolio_b', userId: 1 } }),
    )
    expect(risk.getRiskSnapshot).not.toHaveBeenCalled()
  })

  it('按请求 section 输出持仓并把子维度失败标为 partial', async () => {
    const prisma = {
      portfolio: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'portfolio_1', name: '核心组合', kind: 'PAPER', isArchived: false }),
      },
      portfolioHolding: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ tsCode: '600519.SH', stockName: '贵州茅台', quantity: 100, avgCost: 1000 }]),
      },
      riskViolationLog: { findMany: jest.fn().mockResolvedValue([]) },
    }
    const risk = {
      getRiskSnapshot: jest.fn().mockResolvedValue({
        industry: null,
        position: {
          tradeDate: '20240628',
          positions: [{ tsCode: '600519.SH', stockName: '贵州茅台', marketValue: 150000, weight: 1 }],
          concentration: { hhi: 1, top1Weight: 1, top3Weight: 1, top5Weight: 1 },
        },
        marketCap: null,
        beta: null,
        errors: { beta: 'database detail must not leak' },
      }),
    }
    const facade = new PortfolioToolFacade(prisma as never, risk as never)

    const result = await facade.risk(1, {
      portfolioId: 'portfolio_1',
      asOfDate: '2024-06-30',
      sections: ['HOLDINGS', 'CONCENTRATION', 'BETA'],
    })

    expect(result.data.dataAsOf).toBe('2024-06-28')
    expect(result.data.holdings).toEqual([
      expect.objectContaining({ tsCode: '600519.SH', quantity: 100, avgCost: 1000, marketValue: 150000, weight: 1 }),
    ])
    expect(result.data.partial).toBe(true)
    expect(result.data.componentErrors).toEqual([{ section: 'BETA', code: 'COMPONENT_FAILED' }])
    expect(JSON.stringify(result.data)).not.toContain('database detail')
  })
})
