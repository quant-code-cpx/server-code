import { ValuationToolFacade, ValuationToolInvalidArgumentError } from '../valuation-tool.facade'

describe('ValuationToolFacade', () => {
  it('查询不晚于 asOf 的 DailyBasic 并计算有效样本分位', async () => {
    const rows = Array.from({ length: 60 }, (_, index) => ({
      tradeDate: new Date(Date.UTC(2024, 0, index + 1)),
      peTtm: index + 1,
      pb: null,
      psTtm: null,
      dvTtm: null,
    }))
    const prisma = { dailyBasic: { findMany: jest.fn().mockResolvedValue(rows) } }
    const facade = new ValuationToolFacade(prisma as never)

    const result = await facade.percentile({
      tsCode: '600519.SH',
      metric: 'PE_TTM',
      startDate: '2024-01-01',
      endDate: '2024-12-31',
      asOfDate: '2024-06-30',
      percentileMethod: 'WEAK',
      excludeNonPositive: true,
      winsorize: 'NONE',
      minimumSamples: 60,
    })

    expect(prisma.dailyBasic.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tsCode: '600519.SH', tradeDate: expect.any(Object) }),
      }),
    )
    expect(result.data).toMatchObject({ metric: 'PE_TTM', currentValue: 60, percentile: 1, sampleCount: 60 })
    expect(result.asOf).toBe('2024-02-29')
  })

  it('超过十年窗口在访问 DB 前拒绝', async () => {
    const prisma = { dailyBasic: { findMany: jest.fn() } }
    const facade = new ValuationToolFacade(prisma as never)
    await expect(
      facade.percentile({
        tsCode: '600519.SH',
        metric: 'PB',
        startDate: '2013-12-31',
        endDate: '2024-01-01',
        percentileMethod: 'MEAN',
        excludeNonPositive: true,
        winsorize: 'NONE',
        minimumSamples: 60,
      }),
    ).rejects.toBeInstanceOf(ValuationToolInvalidArgumentError)
    expect(prisma.dailyBasic.findMany).not.toHaveBeenCalled()
  })
})
