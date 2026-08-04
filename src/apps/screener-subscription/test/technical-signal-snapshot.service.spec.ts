import { TechnicalSignalSnapshotService } from '../technical-signal-snapshot.service'
import { createMockPrismaService } from 'test/helpers/prisma-mock'

describe('TechnicalSignalSnapshotService', () => {
  it('批量使用日线和复权因子生成日级快照，不调用逐股详情服务', async () => {
    const prisma = createMockPrismaService()
    const target = new Date('2026-07-24T00:00:00.000Z')
    prisma.stockBasic.findMany.mockResolvedValue([{ tsCode: '000001.SZ' }] as never)
    prisma.daily.findMany.mockResolvedValueOnce([{ tsCode: '000001.SZ' }] as never).mockResolvedValueOnce([
      {
        tsCode: '000001.SZ',
        tradeDate: new Date('2026-07-23T00:00:00.000Z'),
        open: 10,
        high: 11,
        low: 9.8,
        close: 10.5,
        vol: 1000,
        syncedAt: target,
      },
      {
        tsCode: '000001.SZ',
        tradeDate: target,
        open: 10.4,
        high: 11.2,
        low: 10.1,
        close: 11,
        vol: 1200,
        syncedAt: target,
      },
    ] as never)
    prisma.adjFactor.findMany.mockResolvedValue([
      { tsCode: '000001.SZ', tradeDate: new Date('2026-07-23T00:00:00.000Z'), adjFactor: 1, syncedAt: target },
      { tsCode: '000001.SZ', tradeDate: target, adjFactor: 1, syncedAt: target },
    ] as never)
    const service = new TechnicalSignalSnapshotService(prisma as never)

    const result = await service.buildForTradeDate('20260724')

    expect(result).toMatchObject({ tradeDate: '20260724', universeCount: 1, snapshotCount: 1, skippedCount: 0 })
    expect(prisma.technicalSignalDailySnapshot.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [expect.objectContaining({ tsCode: '000001.SZ', tradeDate: '20260724' })],
        skipDuplicates: true,
      }),
    )
  })
})
