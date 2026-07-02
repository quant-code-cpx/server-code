import { SyncStatusOverviewService } from '../sync-status-overview.service'
import { PrismaService } from 'src/shared/prisma.service'
import { CacheService } from 'src/shared/cache.service'
import { SyncLogService } from '../sync-log.service'

function createService(prisma: { $queryRawUnsafe: jest.Mock }): SyncStatusOverviewService {
  const cache = {} as CacheService
  const syncLogService = {} as SyncLogService
  return new SyncStatusOverviewService(prisma as unknown as PrismaService, cache, syncLogService)
}

describe('SyncStatusOverviewService', () => {
  describe('countDistinctDates()', () => {
    it('用递归 CTE skip-scan 统计 distinct trade_date，避免 COUNT(DISTINCT) 全索引扫描', async () => {
      const prisma = {
        $queryRawUnsafe: jest.fn().mockResolvedValue([{ cnt: 8674n }]),
      }
      const service = createService(prisma)

      const result = await (
        service as unknown as { countDistinctDates(tableName: string): Promise<number> }
      ).countDistinctDates('stock_daily_prices')

      expect(result).toBe(8674)
      expect(prisma.$queryRawUnsafe).toHaveBeenCalledTimes(1)
      const sql = prisma.$queryRawUnsafe.mock.calls[0][0]
      expect(sql).toContain('WITH RECURSIVE tdates AS')
      expect(sql).toContain('SELECT MIN(trade_date) AS d FROM "stock_daily_prices"')
      expect(sql).toContain('WHERE trade_date > d')
      expect(sql).not.toContain('COUNT(DISTINCT trade_date)')
    })
  })
})
