import { TushareSyncRetryStatus, TushareSyncStatus, TushareSyncTask } from '@prisma/client'
import { TushareSyncTaskName } from 'src/constant/tushare.constant'
import { SyncRetryService } from '../sync-retry.service'

function retryItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    task: TushareSyncTask.DAILY,
    failedKey: '20240101',
    errorMessage: '历史失败',
    retryCount: 0,
    maxRetries: 3,
    nextRetryAt: new Date('2024-01-02T00:00:00.000Z'),
    status: TushareSyncRetryStatus.PENDING,
    createdAt: new Date('2024-01-02T00:00:00.000Z'),
    updatedAt: new Date('2024-01-02T00:00:00.000Z'),
    ...overrides,
  }
}

function createFixture(rowCount: number) {
  const item = retryItem()
  const execute = jest.fn(async () => undefined)
  const prisma = {
    tushareSyncRetryQueue: {
      findMany: jest.fn().mockResolvedValueOnce([item]).mockResolvedValueOnce([]),
      update: jest.fn(async () => item),
    },
    tushareSyncLog: {
      findFirst: jest.fn(async () => ({
        status: TushareSyncStatus.SUCCESS,
        payload: { rowCount },
        tradeDate: new Date('2024-01-01T00:00:00.000Z'),
      })),
    },
  }
  const registry = {
    getPlan: jest.fn(() => ({ execute })),
  }
  const dataQualityService = {
    checkTimeliness: jest.fn(),
    writeCheckResult: jest.fn(),
  }
  const autoRepairService = {
    taskToDataSet: jest.fn(() => null),
  }

  const service = new SyncRetryService(
    prisma as never,
    registry as never,
    dataQualityService as never,
    autoRepairService as never,
  )

  return { service, prisma, execute }
}

describe('SyncRetryService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('按失败 target 精确重试，不能被最新同步进度短路', async () => {
    const { service, execute } = createFixture(100)

    await service.processPendingRetries()

    expect(execute).toHaveBeenCalledWith({
      trigger: 'manual',
      mode: 'incremental',
      targetTradeDate: '20240101',
      retryExactTarget: true,
    })
  })

  it('真实落库行数大于 0 才标记 SUCCEEDED', async () => {
    const { service, prisma } = createFixture(100)

    await service.processPendingRetries()

    expect(prisma.tushareSyncRetryQueue.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { status: TushareSyncRetryStatus.SUCCEEDED },
    })
  })

  it('同步日志 rowCount=0 时保持待重试，不能假成功', async () => {
    const { service, prisma } = createFixture(0)

    await service.processPendingRetries()

    expect(prisma.tushareSyncRetryQueue.update).not.toHaveBeenCalledWith({
      where: { id: 1 },
      data: { status: TushareSyncRetryStatus.SUCCEEDED },
    })
    expect(prisma.tushareSyncRetryQueue.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 1 },
        data: expect.objectContaining({
          retryCount: 1,
          status: TushareSyncRetryStatus.PENDING,
        }),
      }),
    )
  })

  it('验证日志必须属于本次 attempt 和失败交易日', async () => {
    const { service, prisma } = createFixture(1)

    await service.processPendingRetries()

    expect(prisma.tushareSyncLog.findFirst).toHaveBeenCalledWith({
      where: {
        task: TushareSyncTask.DAILY,
        status: TushareSyncStatus.SUCCESS,
        startedAt: { gte: expect.any(Date) },
      },
      orderBy: { startedAt: 'desc' },
      select: { payload: true, tradeDate: true },
    })
  })

  it('新日志若明确属于其他交易日，仍不能标记重试成功', async () => {
    const { service, prisma } = createFixture(100)
    prisma.tushareSyncLog.findFirst.mockResolvedValue({
      status: TushareSyncStatus.SUCCESS,
      payload: { rowCount: 100 },
      tradeDate: new Date('2024-01-02T00:00:00.000Z'),
    })

    await service.processPendingRetries()

    expect(prisma.tushareSyncRetryQueue.update).not.toHaveBeenCalledWith({
      where: { id: 1 },
      data: { status: TushareSyncRetryStatus.SUCCEEDED },
    })
  })

  it('未知 task 不执行 plan，直接标记 EXHAUSTED', async () => {
    const { service, prisma, execute } = createFixture(1)
    prisma.tushareSyncRetryQueue.findMany.mockReset()
    prisma.tushareSyncRetryQueue.findMany
      .mockResolvedValueOnce([retryItem({ task: 'UNKNOWN_TASK' })])
      .mockResolvedValueOnce([])

    await service.processPendingRetries()

    expect(execute).not.toHaveBeenCalled()
    expect(prisma.tushareSyncRetryQueue.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { status: TushareSyncRetryStatus.EXHAUSTED },
    })
  })
})
