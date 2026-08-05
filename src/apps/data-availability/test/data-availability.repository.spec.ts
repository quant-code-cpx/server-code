import { DataAvailabilityRepository } from '../data-availability.repository'

describe('DataAvailabilityRepository', () => {
  afterEach(() => {
    jest.useRealTimers()
  })

  it('[BIZ] 滞后交易日只读取上海时区今天及以前的开市日，排除未来交易日历', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-05T01:00:00.000Z'))
    const findMany = jest
      .fn()
      .mockResolvedValue([
        { calDate: new Date('2026-08-05T00:00:00.000Z') },
        { calDate: new Date('2026-08-04T00:00:00.000Z') },
      ])
    const repository = new DataAvailabilityRepository({ tradeCal: { findMany } } as never)

    await expect(repository.loadRecentOpenDates()).resolves.toEqual(['2026-08-05', '2026-08-04'])
    expect(findMany).toHaveBeenCalledWith({
      where: {
        exchange: 'SSE',
        isOpen: '1',
        calDate: { lte: new Date('2026-08-05T00:00:00.000Z') },
      },
      orderBy: { calDate: 'desc' },
      take: 1_000,
      select: { calDate: true },
    })
  })
})
