import { StockEventToolFacade } from '../events/stock-event-tool.facade'

describe('StockEventToolFacade', () => {
  it('[PIT] asOf 时实际披露尚不可见时只返回已公告计划，并固定排序分页', async () => {
    const repository = {
      findStock: jest.fn().mockResolvedValue({ tsCode: '600000.SH' }),
      findForecasts: jest.fn().mockResolvedValue([]),
      findDisclosures: jest.fn().mockResolvedValue([
        {
          tsCode: '600000.SH',
          endDate: new Date('2026-06-30T00:00:00.000Z'),
          annDate: new Date('2026-07-01T00:00:00.000Z'),
          preDate: new Date('2026-08-20T00:00:00.000Z'),
          actualDate: new Date('2026-08-25T00:00:00.000Z'),
          modifyDate: null,
          syncedAt: new Date(),
        },
      ]),
      findDividends: jest.fn().mockResolvedValue([]),
      findRepurchases: jest.fn().mockResolvedValue([]),
      findShareFloats: jest.fn().mockResolvedValue([]),
      findSuspensions: jest.fn().mockResolvedValue([]),
      findTopList: jest.fn().mockResolvedValue([]),
      findBlockTrades: jest.fn().mockResolvedValue([]),
    }
    const facade = new StockEventToolFacade(repository as never)
    const result = await facade.getEvents({
      tsCode: '600000.SH',
      sections: ['DISCLOSURE'],
      startDate: '2026-08-01',
      endDate: '2026-08-31',
      asOfDate: '2026-08-10',
    })

    expect(result.data.items).toEqual([
      expect.objectContaining({
        eventDate: '2026-08-20',
        knownAt: '2026-07-01',
        status: 'PLANNED',
        pointInTimeVerified: true,
      }),
    ])
  })

  it('[VALIDATION] 拒绝超过 366 天和未知 section', async () => {
    const facade = new StockEventToolFacade({} as never)
    await expect(
      facade.getEvents({ tsCode: '600000.SH', startDate: '2025-01-01', endDate: '2026-08-01' }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    await expect(facade.getEvents({ tsCode: '600000.SH', sections: ['UNKNOWN' as never] })).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    })
  })
})
