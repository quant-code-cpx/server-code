import { calculateAlignedBeta, PortfolioRiskService } from '../portfolio-risk.service'

describe('PortfolioRiskService beta alignment', () => {
  it('仅使用股票与基准共有交易日，不能按数组位置错配停牌日', () => {
    const result = calculateAlignedBeta(
      [
        { tradeDate: '20240104', value: 999 },
        { tradeDate: '20240103', value: 3 },
        { tradeDate: '20240102', value: 2 },
        { tradeDate: '20240101', value: 1 },
      ],
      new Map([
        ['20240103', 4],
        ['20240102', 2],
        ['20240101', 1],
        ['20231229', -999],
      ]),
      3,
    )

    // 共有日股票 [3,2,1]、基准 [4,2,1]
    // population covariance = 1，benchmark variance = 14/9，beta = 9/14
    expect(result.dataPoints).toBe(3)
    expect(result.beta).toBeCloseTo(9 / 14, 4)
  })

  it('共有交易日不足或基准零方差时返回 null', () => {
    expect(calculateAlignedBeta([{ tradeDate: '20240101', value: 1 }], new Map([['20240101', 1]]), 2)).toEqual({
      beta: null,
      dataPoints: 1,
    })
    expect(
      calculateAlignedBeta(
        [
          { tradeDate: '20240101', value: 1 },
          { tradeDate: '20240102', value: 2 },
        ],
        new Map([
          ['20240101', 1],
          ['20240102', 1],
        ]),
        2,
      ),
    ).toEqual({ beta: null, dataPoints: 2 })
    expect(
      calculateAlignedBeta(
        [
          { tradeDate: '20240101', value: 1 },
          { tradeDate: '20240102', value: Number.NaN },
        ],
        new Map([
          ['20240101', 1],
          ['20240102', 2],
        ]),
        2,
      ),
    ).toEqual({ beta: null, dataPoints: 1 })
  })
})

describe('PortfolioRiskService data as-of', () => {
  it('使用数据库真实最新估值日，不把尚未入库的交易日标为 dataAsOf', async () => {
    const prisma = {
      dailyBasic: {
        findFirst: jest.fn().mockResolvedValue({ tradeDate: new Date('2024-06-28T00:00:00.000Z') }),
      },
      $queryRawUnsafe: jest.fn().mockResolvedValue([]),
    }
    const cache = {
      rememberJson: jest.fn(async ({ loader }: { loader: () => Promise<unknown> }) => loader()),
    }
    const portfolio = { assertOwner: jest.fn().mockResolvedValue({ id: 'portfolio_1', userId: 1 }) }
    const service = new PortfolioRiskService(prisma as never, cache as never, portfolio as never)

    const result = await service.getPositionConcentration('portfolio_1', 1, '2024-06-30')

    expect(result.tradeDate).toBe('20240628')
    expect(prisma.dailyBasic.findFirst).toHaveBeenCalledWith({
      where: { tradeDate: { lte: new Date('2024-06-30T00:00:00.000Z') } },
      orderBy: { tradeDate: 'desc' },
      select: { tradeDate: true },
    })
    expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith(expect.any(String), 'portfolio_1', '20240628')
  })
})
