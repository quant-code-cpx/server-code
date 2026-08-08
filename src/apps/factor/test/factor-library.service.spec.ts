import { FactorLibraryService } from '../services/factor-library.service'

type FactorLibraryDependencies = ConstructorParameters<typeof FactorLibraryService>

function buildPrismaMock() {
  return {
    $queryRaw: jest.fn(),
  }
}

function createService(prisma = buildPrismaMock()) {
  return new FactorLibraryService(prisma as unknown as FactorLibraryDependencies[0])
}

describe('FactorLibraryService admin job batches', () => {
  it('F-BUG-09: preserves compact trade_date strings for job keys and job-detail requests', async () => {
    const prisma = buildPrismaMock()
    prisma.$queryRaw
      .mockResolvedValueOnce([
        {
          trade_date: '20260807',
          factor_count: BigInt(17),
          total_stocks: BigInt(1700),
          missing_stocks: BigInt(34),
          latest_synced_at: new Date('2026-08-08T01:00:00.000Z'),
        },
      ])
      .mockResolvedValueOnce([{ total: BigInt(1) }])
    const service = createService(prisma)

    const result = await service.listAdminJobs({ page: 1, pageSize: 20 })

    expect(result).toMatchObject({ total: 1, page: 1, pageSize: 20 })
    expect(result.items).toEqual([
      expect.objectContaining({
        jobId: '20260807',
        tradeDate: '20260807',
        factorCount: 17,
      }),
    ])
  })
})
