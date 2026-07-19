import { SectorHistoryUnavailableError, SectorToolFacade } from '../sector-tool.facade'

describe('SectorToolFacade', () => {
  it('[SMT-EDGE-004] THS 概念缺历史有效期时 fail-closed', async () => {
    const facade = new SectorToolFacade({} as never)

    await expect(
      facade.membership({
        mode: 'MEMBERS_FOR_SECTOR',
        sectorCode: '885001.TI',
        sectorType: 'CONCEPT',
        effectiveDate: '2024-01-01',
        limit: 100,
      }),
    ).rejects.toBeInstanceOf(SectorHistoryUnavailableError)
  })

  it('[SMT-BIZ-005] 申万行业成员按 effectiveDate 有效期过滤并稳定映射', async () => {
    const prisma = {
      indexMemberAll: {
        findMany: jest.fn().mockResolvedValue([
          {
            tsCode: '600000.SH',
            name: '浦发银行',
            l1Code: '801780.SI',
            l1Name: '银行',
            l2Code: '851911.SI',
            l2Name: '国有大型银行',
            l3Code: '85191101.SI',
            l3Name: '银行三级',
            inDate: new Date('2020-01-01T00:00:00.000Z'),
            outDate: null,
          },
        ]),
      },
    }
    const facade = new SectorToolFacade(prisma as never)

    const value = await facade.membership({
      mode: 'MEMBERS_FOR_SECTOR',
      sectorCode: '801780.SI',
      sectorType: 'INDUSTRY',
      effectiveDate: '2024-06-30',
      limit: 100,
    })

    expect(prisma.indexMemberAll.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [{ l1Code: '801780.SI' }, { l2Code: '801780.SI' }, { l3Code: '801780.SI' }],
          inDate: { lte: new Date('2024-06-30T00:00:00.000Z') },
        }),
      }),
    )
    expect(value.data.items).toEqual([
      expect.objectContaining({
        tsCode: '600000.SH',
        sectorCode: '801780.SI',
        sectorName: '银行',
        sectorType: 'INDUSTRY',
        level: 'L1',
      }),
    ])
    expect(value.asOf).toBe('2024-06-30')
  })
})
