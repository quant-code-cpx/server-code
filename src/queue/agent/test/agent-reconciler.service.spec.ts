import { buildAgentQueueConfig } from 'src/config/agent-queue.config'
import { AgentReconcilerService } from '../agent-reconciler.service'

describe('AgentReconcilerService', () => {
  it('先补发 outbox，再扫描 QUEUED/过期 lease Run；单次循环防重入', async () => {
    let releaseQuery: (rows: Array<{ id: string }>) => void
    const prisma = {
      $queryRaw: jest.fn(() => new Promise<Array<{ id: string }>>((resolve) => (releaseQuery = resolve))),
    }
    const queue = {
      publishDueOutbox: jest.fn().mockResolvedValue(1),
      enqueueRun: jest.fn().mockResolvedValueOnce({ state: 'enqueued' }).mockResolvedValueOnce({ state: 'existing' }),
    }
    const logger = { log: jest.fn(), warn: jest.fn() }
    const recoveries = { inc: jest.fn() }
    const service = new AgentReconcilerService(
      prisma as never,
      queue as never,
      buildAgentQueueConfig({}),
      logger as never,
      recoveries as never,
    )

    const first = service.requeueRecoverableRuns()
    await Promise.resolve()
    await expect(service.requeueRecoverableRuns()).resolves.toBe(0)
    releaseQuery!([{ id: 'run_1' }, { id: 'run_2' }])
    await expect(first).resolves.toBe(1)

    expect(queue.publishDueOutbox.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.$queryRaw.mock.invocationCallOrder[0],
    )
    expect(queue.enqueueRun).toHaveBeenNthCalledWith(1, 'run_1')
    expect(queue.enqueueRun).toHaveBeenNthCalledWith(2, 'run_2')
    expect(recoveries.inc).toHaveBeenCalledWith({ result: 'enqueued' })
    expect(recoveries.inc).toHaveBeenCalledWith({ result: 'existing' })
  })

  it('单个 Run 恢复失败不阻断后续 Run', async () => {
    const prisma = { $queryRaw: jest.fn().mockResolvedValue([{ id: 'bad' }, { id: 'good' }]) }
    const queue = {
      publishDueOutbox: jest.fn().mockResolvedValue(0),
      enqueueRun: jest.fn().mockRejectedValueOnce(new Error('redis')).mockResolvedValueOnce({ state: 'enqueued' }),
    }
    const logger = { log: jest.fn(), warn: jest.fn() }
    const service = new AgentReconcilerService(
      prisma as never,
      queue as never,
      buildAgentQueueConfig({}),
      logger as never,
    )

    await expect(service.requeueRecoverableRuns()).resolves.toBe(1)
    expect(queue.enqueueRun).toHaveBeenCalledTimes(2)
    expect(logger.warn).toHaveBeenCalled()
  })
})
