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
  describe('fetchDateDistinctStats()', () => {
    it('批量读取 pg_stats 的 trade_date distinct 估算，避免逐表 recursive skip-scan', async () => {
      const prisma = {
        $queryRawUnsafe: jest.fn().mockResolvedValue([{ table_name: 'stock_daily_prices', distinct_dates: 8674 }]),
      }
      const service = createService(prisma)

      const result = await (
        service as unknown as { fetchDateDistinctStats(): Promise<Map<string, number>> }
      ).fetchDateDistinctStats()

      expect(result.get('stock_daily_prices')).toBe(8674)
      expect(prisma.$queryRawUnsafe).toHaveBeenCalledTimes(1)
      const sql = prisma.$queryRawUnsafe.mock.calls[0][0]
      expect(sql).toContain('FROM pg_stats s')
      expect(sql).toContain('s.attname = \'trade_date\'')
      expect(sql).toContain('s.n_distinct')
      expect(sql).not.toContain('WITH RECURSIVE tdates AS')
      expect(sql).not.toContain('COUNT(DISTINCT trade_date)')
    })
  })
})
