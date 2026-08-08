import { NotFoundException } from '@nestjs/common'
import type { Queue } from 'bullmq'
import type { PrismaService } from 'src/shared/prisma.service'
import type { BacktestEngineService } from '../services/backtest-engine.service'
import { BacktestComparisonService } from '../services/backtest-comparison.service'
import type { BacktestReportService } from '../services/backtest-report.service'

function buildPrismaMock() {
  return {
    backtestComparisonGroup: {
      findUnique: jest.fn(),
    },
    backtestRun: {
      findMany: jest.fn(async () => []),
    },
    backtestDailyNav: {
      findMany: jest.fn(async () => []),
    },
  }
}

function createService(prisma = buildPrismaMock()) {
  return new BacktestComparisonService(
    prisma as unknown as PrismaService,
    {} as unknown as BacktestEngineService,
    {} as unknown as BacktestReportService,
    {} as unknown as Queue,
  )
}

describe('BacktestComparisonService owner guard', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('getComparisonDetail: 非本人 group → 404，不读取子 run 指标', async () => {
    const prisma = buildPrismaMock()
    prisma.backtestComparisonGroup.findUnique.mockResolvedValue({ id: 'grp-1', userId: 2, runIds: ['run-1'] })
    const svc = createService(prisma)

    await expect(svc.getComparisonDetail('grp-1', 1)).rejects.toThrow(NotFoundException)

    expect(prisma.backtestRun.findMany).not.toHaveBeenCalled()
  })

  it('getComparisonEquity: 非本人 group → 404，不读取子 run NAV', async () => {
    const prisma = buildPrismaMock()
    prisma.backtestComparisonGroup.findUnique.mockResolvedValue({ id: 'grp-1', userId: 2, runIds: ['run-1'] })
    const svc = createService(prisma)

    await expect(svc.getComparisonEquity('grp-1', 1)).rejects.toThrow(NotFoundException)

    expect(prisma.backtestRun.findMany).not.toHaveBeenCalled()
    expect(prisma.backtestDailyNav.findMany).not.toHaveBeenCalled()
  })
})
