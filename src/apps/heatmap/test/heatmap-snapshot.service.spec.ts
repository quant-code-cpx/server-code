import { HeatmapSnapshotService } from '../heatmap-snapshot.service'

describe('HeatmapSnapshotService', () => {
  const prisma = {
    heatmapSnapshotStatus: {
      findUnique: jest.fn(),
    },
    heatmapSnapshot: {
      findMany: jest.fn(),
    },
    daily: {
      findFirst: jest.fn(),
    },
  }
  const heatmapService = {
    getHeatmap: jest.fn(),
  }

  beforeEach(() => jest.clearAllMocks())

  it('快照缺失时只读实时计算，不隐式触发聚合写入', async () => {
    prisma.heatmapSnapshotStatus.findUnique.mockResolvedValueOnce(null)
    heatmapService.getHeatmap.mockResolvedValueOnce([
      {
        tsCode: '000001.SZ',
        name: '平安银行',
        groupName: '银行',
        industry: '银行',
        pctChg: 1,
        totalMv: 100,
        amount: 10,
      },
    ])
    const service = new HeatmapSnapshotService(prisma as never, heatmapService as never)
    const aggregateSpy = jest.spyOn(service, 'aggregateSnapshot')

    const result = await service.queryHistory({ trade_date: '20260808', group_by: 'industry' })

    expect(result.isFromSnapshot).toBe(false)
    expect(result.stockCount).toBe(1)
    expect(heatmapService.getHeatmap).toHaveBeenCalledWith({
      trade_date: '20260808',
      group_by: 'industry',
      index_code: undefined,
    })
    expect(aggregateSpy).not.toHaveBeenCalled()
  })
})
