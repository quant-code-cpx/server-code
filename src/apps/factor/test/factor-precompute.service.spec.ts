import { FactorPrecomputeService } from '../services/factor-precompute.service'

type FactorServiceDependencies = ConstructorParameters<typeof FactorPrecomputeService>

function buildPrismaMock() {
  return {
    $queryRaw: jest.fn(),
  }
}

function createService(prisma = buildPrismaMock()) {
  return new FactorPrecomputeService(
    prisma as unknown as FactorServiceDependencies[0],
    {} as FactorServiceDependencies[1],
    {} as FactorServiceDependencies[2],
    { isSchedulerProcess: jest.fn(() => false) } as unknown as FactorServiceDependencies[3],
  )
}

describe('FactorPrecomputeService admin status contract', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('F-BUG-06: staleDays counts only effective SSE trading days and never reclassifies old data as missing', async () => {
    const prisma = buildPrismaMock()
    prisma.$queryRaw
      .mockResolvedValueOnce([
        { factor_name: 'factor_old', latest_date: '20260731', total_dates: BigInt(120) },
        { factor_name: 'factor_fresh', latest_date: '20260807', total_dates: BigInt(121) },
      ])
      .mockResolvedValueOnce([{ overall_latest: '20260807', overall_total_dates: BigInt(121) }])
      .mockResolvedValueOnce([{ cal_date: new Date(2026, 7, 7) }])
      .mockResolvedValueOnce([
        { cal_date: new Date(2026, 6, 31) },
        { cal_date: new Date(2026, 7, 3) },
        { cal_date: new Date(2026, 7, 4) },
        { cal_date: new Date(2026, 7, 5) },
        { cal_date: new Date(2026, 7, 6) },
        { cal_date: new Date(2026, 7, 7) },
      ])
    const service = createService(prisma)

    const result = await service.getPrecomputeStatus()

    expect(result.latestTradeDate).toBe('20260807')
    expect(result.byFactor).toEqual([
      expect.objectContaining({ factorName: 'factor_old', staleDays: 5 }),
      expect.objectContaining({ factorName: 'factor_fresh', staleDays: 0 }),
    ])
  })

  it('F-BUG-07: exposes the most recent effective trade date even when snapshots are stale', async () => {
    const prisma = buildPrismaMock()
    prisma.$queryRaw
      .mockResolvedValueOnce([{ factor_name: 'factor_a', latest_date: '20260731', total_dates: BigInt(100) }])
      .mockResolvedValueOnce([{ overall_latest: '20260731', overall_total_dates: BigInt(100) }])
      .mockResolvedValueOnce([{ cal_date: new Date(2026, 7, 7) }])
      .mockResolvedValueOnce([
        { cal_date: new Date(2026, 6, 31) },
        { cal_date: new Date(2026, 7, 3) },
        { cal_date: new Date(2026, 7, 4) },
        { cal_date: new Date(2026, 7, 5) },
        { cal_date: new Date(2026, 7, 6) },
        { cal_date: new Date(2026, 7, 7) },
      ])
    const service = createService(prisma)

    const result = await service.getPrecomputeStatus()

    expect(result.latestDate).toBe('20260731')
    expect(result.latestTradeDate).toBe('20260807')
  })
})
