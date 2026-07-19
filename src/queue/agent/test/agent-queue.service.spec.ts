/* eslint-disable @typescript-eslint/no-explicit-any */
import { AiAgentRunStatus, AiJobOutboxStatus } from '@prisma/client'
import { buildAgentQueueConfig } from 'src/config/agent-queue.config'
import { AgentQueueRunNotRecoverableError, AgentQueueService } from '../agent-queue.service'
import { AGENT_RUN_JOB_NAME } from '../agent.queue.constants'

function harness() {
  const now = new Date()
  const queue = { getJob: jest.fn(), add: jest.fn().mockResolvedValue({ id: 'run_1' }) }
  const prisma = {
    aiAgentRun: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'run_1',
        status: AiAgentRunStatus.QUEUED,
        attempt: 0,
        maxAttempts: 3,
        deadlineAt: new Date(Date.now() + 60_000),
      }),
    },
    aiJobOutbox: {
      upsert: jest.fn().mockResolvedValue({
        id: 1n,
        aggregateId: 'run_1',
        kind: 'AGENT_RUN_EXECUTION',
        status: AiJobOutboxStatus.PENDING,
        attempt: 0,
        payloadHash: 'a'.repeat(64),
        createdAt: now,
      }),
      update: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
    },
  }
  const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() }
  const lag = { observe: jest.fn() }
  const service = new AgentQueueService(
    queue as never,
    prisma as never,
    buildAgentQueueConfig({}),
    logger as never,
    lag as never,
  )
  return { service, queue, prisma, logger, lag }
}

describe('AgentQueueService', () => {
  it('jobId=runId，payload 无正文；成功后 outbox=PUBLISHED', async () => {
    const h = harness()
    h.prisma.aiJobOutbox.upsert.mockImplementation(async ({ create }: any) => ({
      id: 1n,
      attempt: 0,
      createdAt: new Date(),
      ...create,
    }))
    h.queue.getJob.mockResolvedValue(null)

    await expect(h.service.enqueueRun('run_1')).resolves.toEqual({
      runId: 'run_1',
      jobId: 'run_1',
      state: 'enqueued',
    })
    expect(h.queue.add).toHaveBeenCalledWith(
      AGENT_RUN_JOB_NAME,
      { schemaVersion: 1, runId: 'run_1' },
      { jobId: 'run_1' },
    )
    expect(h.prisma.aiJobOutbox.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: AiJobOutboxStatus.PUBLISHED }) }),
    )
  })

  it('重复 enqueue 命中 waiting job，不重复 add', async () => {
    const h = harness()
    h.prisma.aiJobOutbox.upsert.mockImplementation(async ({ create }: any) => ({
      id: 1n,
      attempt: 1,
      createdAt: new Date(),
      ...create,
    }))
    h.queue.getJob.mockResolvedValue({ getState: jest.fn().mockResolvedValue('waiting') })

    await expect(h.service.enqueueRun('run_1')).resolves.toMatchObject({ state: 'existing' })
    expect(h.queue.add).not.toHaveBeenCalled()
  })

  it('failed/completed 保留 job 会先移除，再从 checkpoint 重新投递', async () => {
    const h = harness()
    const remove = jest.fn().mockResolvedValue(undefined)
    h.prisma.aiJobOutbox.upsert.mockImplementation(async ({ create }: any) => ({
      id: 1n,
      attempt: 1,
      createdAt: new Date(),
      ...create,
    }))
    h.queue.getJob.mockResolvedValue({ id: 'run_1', getState: jest.fn().mockResolvedValue('failed'), remove })

    await h.service.enqueueRun('run_1')
    expect(remove).toHaveBeenCalled()
    expect(h.queue.add).toHaveBeenCalledTimes(1)
  })

  it('Redis enqueue 失败写 RETRY + backoff，异常继续冒泡', async () => {
    const h = harness()
    h.prisma.aiJobOutbox.upsert.mockImplementation(async ({ create }: any) => ({
      id: 1n,
      attempt: 0,
      createdAt: new Date(),
      ...create,
    }))
    h.queue.getJob.mockResolvedValue(null)
    h.queue.add.mockRejectedValue(new Error('redis down'))

    await expect(h.service.enqueueRun('run_1')).rejects.toThrow('redis down')
    expect(h.prisma.aiJobOutbox.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: AiJobOutboxStatus.RETRY, publishedAt: null, lastError: 'redis down' }),
      }),
    )
  })

  it('终态、deadline 过期或 maxAttempts 耗尽标记 DEAD，不投递', async () => {
    const h = harness()
    h.prisma.aiAgentRun.findUnique.mockResolvedValue({
      id: 'run_1',
      status: AiAgentRunStatus.COMPLETED,
      attempt: 1,
      maxAttempts: 3,
      deadlineAt: new Date(Date.now() + 60_000),
    })
    h.prisma.aiJobOutbox.upsert.mockImplementation(async ({ create }: any) => ({
      id: 1n,
      attempt: 1,
      createdAt: new Date(),
      ...create,
    }))

    await expect(h.service.enqueueRun('run_1')).rejects.toBeInstanceOf(AgentQueueRunNotRecoverableError)
    expect(h.queue.add).not.toHaveBeenCalled()
    expect(h.prisma.aiJobOutbox.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: AiJobOutboxStatus.DEAD }) }),
    )
  })

  it('取消 waiting job 可移除；active job 只靠 DB + AbortSignal 协作取消', async () => {
    const h = harness()
    const waitingRemove = jest.fn().mockResolvedValue(undefined)
    h.queue.getJob.mockResolvedValueOnce({ getState: jest.fn().mockResolvedValue('waiting'), remove: waitingRemove })
    await expect(h.service.removeWaitingRun('run_1')).resolves.toBe(true)
    expect(waitingRemove).toHaveBeenCalled()

    h.queue.getJob.mockResolvedValueOnce({ getState: jest.fn().mockResolvedValue('active'), remove: jest.fn() })
    await expect(h.service.removeWaitingRun('run_1')).resolves.toBe(false)
  })
})
