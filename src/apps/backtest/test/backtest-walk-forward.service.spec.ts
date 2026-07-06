import { NotFoundException } from '@nestjs/common'
import { BacktestWalkForwardService } from '../services/backtest-walk-forward.service'

function buildPrismaMock() {
  return {
    backtestWalkForwardRun: {
      count: jest.fn(async () => 0),
      findMany: jest.fn(async () => []),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    backtestDailyNav: {
      findMany: jest.fn(async () => []),
    },
  }
}

function buildQueueMock() {
  return {
    getJob: jest.fn(),
  }
}

function createService(prisma = buildPrismaMock(), queue = buildQueueMock()) {
  return new BacktestWalkForwardService(
    prisma as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    queue as any,
  )
}

describe('BacktestWalkForwardService owner guard', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('getWalkForwardRunDetail: 非本人 wfRun → 404', async () => {
    const prisma = buildPrismaMock()
    prisma.backtestWalkForwardRun.findUnique.mockResolvedValue({ id: 'wf-1', userId: 2, deletedAt: null, windows: [] })
    const svc = createService(prisma)

    await expect(svc.getWalkForwardRunDetail('wf-1', 1)).rejects.toThrow(NotFoundException)
  })

  it('getWalkForwardEquity: 非本人 wfRun → 404，不读取 OOS NAV', async () => {
    const prisma = buildPrismaMock()
    prisma.backtestWalkForwardRun.findUnique.mockResolvedValue({ id: 'wf-1', userId: 2, deletedAt: null, windows: [] })
    const svc = createService(prisma)

    await expect(svc.getWalkForwardEquity('wf-1', 1)).rejects.toThrow(NotFoundException)

    expect(prisma.backtestDailyNav.findMany).not.toHaveBeenCalled()
  })

  it('cancelWalkForwardRun: 非本人 wfRun → 404，不移除队列 job，不更新状态', async () => {
    const prisma = buildPrismaMock()
    const queue = buildQueueMock()
    prisma.backtestWalkForwardRun.findUnique.mockResolvedValue({
      id: 'wf-1',
      userId: 2,
      deletedAt: null,
      status: 'QUEUED',
      jobId: 'job-1',
    })
    const svc = createService(prisma, queue)

    await expect(svc.cancelWalkForwardRun('wf-1', 1)).rejects.toThrow(NotFoundException)

    expect(queue.getJob).not.toHaveBeenCalled()
    expect(prisma.backtestWalkForwardRun.update).not.toHaveBeenCalled()
  })

  it('listWalkForwardRuns: 过滤已软删除任务', async () => {
    const prisma = buildPrismaMock()
    const svc = createService(prisma)

    await svc.listWalkForwardRuns(1, 2, 10)

    const expectedWhere = { userId: 1, deletedAt: null }
    expect(prisma.backtestWalkForwardRun.count).toHaveBeenCalledWith({ where: expectedWhere })
    expect(prisma.backtestWalkForwardRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expectedWhere,
        skip: 10,
        take: 10,
      }),
    )
  })
})
