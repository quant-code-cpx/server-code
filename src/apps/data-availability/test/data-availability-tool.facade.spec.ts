import { DataAvailabilityToolFacade } from '../data-availability-tool.facade'

function snapshot(dataset: string, overrides: Record<string, unknown> = {}) {
  return {
    dataset,
    coverageStart: '2020-01-02',
    dataThrough: '2026-08-04',
    rowCount: null,
    lastSyncedAt: '2026-08-04T12:00:00.000Z',
    syncStatus: 'SUCCESS',
    qualityStatus: 'PASS',
    ...overrides,
  }
}

describe('DataAvailabilityToolFacade', () => {
  it('[BIZ] 独立推导 READY、DEGRADED、EMPTY、FAILED 四态，并保留真实水位线', async () => {
    const repository = {
      loadRecentOpenDates: jest
        .fn()
        .mockResolvedValue(['2026-08-05', '2026-08-04', '2026-08-03', '2026-08-02', '2026-08-01']),
      load: jest.fn(async (dataset: string) => {
        if (dataset === 'STOCK_DAILY') return snapshot(dataset)
        if (dataset === 'STOCK_TECHNICAL_FACTOR') {
          return snapshot(dataset, { dataThrough: '2026-08-01', qualityStatus: 'WARN' })
        }
        if (dataset === 'CYQ_PERF') return snapshot(dataset, { coverageStart: null, dataThrough: null })
        return snapshot(dataset, { syncStatus: 'FAILED' })
      }),
    }
    const facade = new DataAvailabilityToolFacade(repository as never)

    const result = await facade.getAvailability({
      datasets: ['STOCK_DAILY', 'STOCK_TECHNICAL_FACTOR', 'CYQ_PERF', 'MARGIN_DETAIL'],
    })

    expect(result.data.items.map((item) => [item.dataset, item.status])).toEqual([
      ['STOCK_DAILY', 'READY'],
      ['STOCK_TECHNICAL_FACTOR', 'DEGRADED'],
      ['CYQ_PERF', 'EMPTY'],
      ['MARGIN_DETAIL', 'FAILED'],
    ])
    expect(result.data.items[1]).toMatchObject({ dataThrough: '2026-08-01', lagTradingDays: 4 })
    expect(result.data.items.every((item) => item.rowCount === null)).toBe(true)
  })

  it('[BIZ] SECURITY scope 返回证券行数，质量 UNKNOWN 不抹掉 READY 水位线', async () => {
    const repository = {
      loadRecentOpenDates: jest.fn().mockResolvedValue(['2026-08-04']),
      load: jest.fn().mockResolvedValue(
        snapshot('STOCK_TECHNICAL_FACTOR', {
          rowCount: 500,
          qualityStatus: 'UNKNOWN',
        }),
      ),
    }
    const facade = new DataAvailabilityToolFacade(repository as never)

    const result = await facade.getAvailability({
      datasets: ['STOCK_TECHNICAL_FACTOR'],
      tsCode: '600089.SH',
    })

    expect(repository.load).toHaveBeenCalledWith('STOCK_TECHNICAL_FACTOR', '600089.SH')
    expect(result.data.items[0]).toMatchObject({ status: 'READY', rowCount: 500, qualityStatus: 'UNKNOWN' })
    expect(result.data.items[0].notes).toContain('尚无数据质量检查记录，水位线仍按真实库存返回')
  })

  it('[ERR] 不支持 SECURITY scope 的市场数据集在 Repository 前被拒绝', async () => {
    const repository = { loadRecentOpenDates: jest.fn(), load: jest.fn() }
    const facade = new DataAvailabilityToolFacade(repository as never)

    await expect(facade.getAvailability({ datasets: ['MARKET_MONEYFLOW'], tsCode: '600089.SH' })).rejects.toMatchObject(
      { code: 'INVALID_ARGUMENT' },
    )
    expect(repository.load).not.toHaveBeenCalled()
  })

  it('[SEC] 未知 dataset 不会进入固定 resolver', async () => {
    const repository = { loadRecentOpenDates: jest.fn(), load: jest.fn() }
    const facade = new DataAvailabilityToolFacade(repository as never)

    await expect(facade.getAvailability({ datasets: ['DROP_TABLE'] })).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    })
    expect(repository.load).not.toHaveBeenCalled()
  })
})
