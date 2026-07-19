import { WatchlistToolFacade, WatchlistToolNotFoundError } from '../watchlist-tool.facade'

function stock(id: number, tsCode: string) {
  return {
    id,
    tsCode,
    notes: null,
    tags: [],
    targetPrice: null,
    sortOrder: id,
    addedAt: new Date(`2024-01-0${id}T00:00:00.000Z`),
  }
}

describe('WatchlistToolFacade', () => {
  it('[SMT-BIZ-006/EDGE-005] owner 条件固定，limit 按组顺序跨组累计', async () => {
    const prisma = {
      watchlist: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 10,
            name: '核心',
            description: null,
            isDefault: true,
            sortOrder: 0,
            stocks: [stock(1, '600000.SH'), stock(2, '600001.SH')],
          },
          {
            id: 20,
            name: '观察',
            description: null,
            isDefault: false,
            sortOrder: 1,
            stocks: [stock(3, '000001.SZ'), stock(4, '000002.SZ')],
          },
        ]),
      },
      stockBasic: {
        findMany: jest.fn().mockResolvedValue([
          { tsCode: '600000.SH', name: '浦发银行' },
          { tsCode: '600001.SH', name: '测试股票' },
          { tsCode: '000001.SZ', name: '平安银行' },
        ]),
      },
    }
    const facade = new WatchlistToolFacade(prisma as never)

    const value = await facade.read(7, { includeLatestQuote: false, limit: 3 })

    expect(prisma.watchlist.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 7 } }))
    expect(value.data.groups.map((group) => group.members.map((member) => member.tsCode))).toEqual([
      ['600000.SH', '600001.SH'],
      ['000001.SZ'],
    ])
    expect(value.data.groups[0].members[0].name).toBe('浦发银行')
    expect(value.truncated).toBe(true)
  })

  it('[SMT-SEC-002] 他人或不存在 watchlistId 返回同一 not-found 语义', async () => {
    const prisma = { watchlist: { findMany: jest.fn().mockResolvedValue([]) } }
    const facade = new WatchlistToolFacade(prisma as never)

    await expect(facade.read(7, { watchlistId: 999, limit: 100 })).rejects.toBeInstanceOf(WatchlistToolNotFoundError)
    expect(prisma.watchlist.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 7, id: 999 } }))
  })

  it('[SMT-BIZ-006] includeLatestQuote 返回名称、真实行情日期和 null 保真', async () => {
    const prisma = {
      watchlist: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 10,
            name: '核心',
            description: null,
            isDefault: true,
            sortOrder: 0,
            stocks: [stock(1, '600000.SH')],
          },
        ]),
      },
      stockBasic: { findMany: jest.fn().mockResolvedValue([{ tsCode: '600000.SH', name: '浦发银行' }]) },
      $queryRaw: jest.fn().mockResolvedValue([
        {
          tsCode: '600000.SH',
          tradeDate: new Date('2024-07-02T00:00:00.000Z'),
          close: 8.5,
          pctChange: null,
          volume: 100,
          amount: 200,
        },
      ]),
    }
    const facade = new WatchlistToolFacade(prisma as never)

    const value = await facade.read(7, { includeLatestQuote: true, limit: 100 })

    expect(value.data.groups[0].members[0]).toMatchObject({
      name: '浦发银行',
      latestQuote: { tradeDate: '2024-07-02', close: 8.5, pctChange: null },
    })
    expect(value.asOf).toBe('2024-07-02')
    expect(value.sourceModels).toContain('StockBasic')
  })
})
