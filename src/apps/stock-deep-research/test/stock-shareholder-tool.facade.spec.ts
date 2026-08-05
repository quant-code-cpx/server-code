import { StockShareholderToolFacade } from '../shareholders/stock-shareholder-tool.facade'

describe('StockShareholderToolFacade', () => {
  it('[PIT] 质押无公告日时强制未验证并返回 warning', async () => {
    const repository = {
      findStock: jest.fn().mockResolvedValue({ tsCode: '600000.SH' }),
      findHolderCounts: jest.fn().mockResolvedValue([]),
      findTop10: jest.fn().mockResolvedValue([]),
      findTop10Float: jest.fn().mockResolvedValue([]),
      findTrades: jest.fn().mockResolvedValue([]),
      findPledges: jest.fn().mockResolvedValue([
        {
          tsCode: '600000.SH',
          endDate: new Date('2026-07-31T00:00:00.000Z'),
          pledgeCount: 3,
          unrestPledge: 100,
          restPledge: 20,
          totalShare: 1_000,
          pledgeRatio: 12,
          syncedAt: new Date(),
        },
      ]),
    }
    const result = await new StockShareholderToolFacade(repository as never).getProfile({
      tsCode: '600000.SH',
      asOfDate: '2026-08-05',
      sections: ['PLEDGE'],
    })

    expect(result.data.pledge).toMatchObject({
      status: 'OK',
      data: [expect.objectContaining({ announcedAt: null, pointInTimeVerified: false, pledgedShares: 120 })],
    })
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'ANNOUNCEMENT_DATE_UNAVAILABLE' }))
  })

  it('[FAILURE] 数据库错误不能伪装成空数据', async () => {
    const repository = { findStock: jest.fn().mockRejectedValue(new Error('database unavailable')) }
    await expect(
      new StockShareholderToolFacade(repository as never).getProfile({ tsCode: '600000.SH' }),
    ).rejects.toMatchObject({ code: 'UPSTREAM_FAILED', retryable: true })
  })
})
