import { TushareSyncTaskName } from 'src/constant/tushare.constant'
import { SyncLogService } from '../sync-log.service'

function buildPrismaMock() {
  return {
    $queryRaw: jest.fn(async () => []),
    tushareSyncLog: {
      count: jest.fn(async () => 0),
      findMany: jest.fn(async () => []),
    },
  }
}

describe('SyncLogService', () => {
  describe('summarizeLogs()', () => {
    it('用单条 raw SQL 汇总所有任务，并保留无日志任务为空状态', async () => {
      const prisma = buildPrismaMock()
      const startedAt = new Date('2024-01-05T10:00:00.000Z')
      prisma.$queryRaw.mockResolvedValueOnce([
        {
          task: TushareSyncTaskName.DAILY,
          last_sync_at: startedAt,
          last_status: 'FAILED',
          payload: { rowCount: 123 },
          consecutive_failures: 2,
        },
      ])
      const service = new SyncLogService(prisma as any)

      const result = await service.summarizeLogs()

      const daily = result.find((item) => item.task === TushareSyncTaskName.DAILY)
      expect(daily).toEqual({
        task: TushareSyncTaskName.DAILY,
        lastSyncAt: startedAt,
        lastStatus: 'FAILED',
        lastRowCount: 123,
        consecutiveFailures: 2,
      })
      const unsupported = result.find((item) => item.task === TushareSyncTaskName.VALUATION_MEDIAN)
      expect(unsupported).toMatchObject({ lastSyncAt: null, lastStatus: null, consecutiveFailures: 0 })
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1)
      expect(prisma.tushareSyncLog.findMany).not.toHaveBeenCalled()
    })
  })
})
