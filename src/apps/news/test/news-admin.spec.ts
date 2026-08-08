import { NewsIngestionOperation, NewsIngestionRunStatus } from '@prisma/client'
import { NewsAdminService } from '../news-admin.service'
import { commandRequestHash } from '../news.repository'

describe('News 管理命令契约', () => {
  const now = new Date('2026-08-06T04:00:00.000Z')
  const pollDto = {
    clientRequestId: '8b65bf12-6612-4e15-a8d8-68e70d97e743',
    operation: 'POLL_FEED' as const,
    providerKey: 'FAKE',
    feedKey: 'fake.feed',
  }

  it('NEWS-BIZ-012: 幂等重放始终返回原 Command/Run，FAILED 也不重复入队', async () => {
    const queue = { enqueueMany: jest.fn().mockResolvedValue(undefined) }
    const command = {
      id: 'c12345678901234567890',
      requestHash: commandRequestHash({
        operation: NewsIngestionOperation.POLL_FEED,
        providerKey: 'FAKE',
        feedKey: 'fake.feed',
      }),
      status: NewsIngestionRunStatus.PARTIAL,
      acceptedAt: now,
      runs: [
        { id: 'c22345678901234567890', status: NewsIngestionRunStatus.QUEUED },
        { id: 'c32345678901234567890', status: NewsIngestionRunStatus.FAILED },
        { id: 'c42345678901234567890', status: NewsIngestionRunStatus.SUCCEEDED },
      ],
    }
    const service = createService({
      prisma: { newsIngestionCommand: { findUnique: jest.fn().mockResolvedValue(command) } },
      queue,
    })

    const result = await service.run(7, pollDto)

    expect(result).toEqual({
      commandId: command.id,
      runIds: command.runs.map((run) => run.id),
      status: command.status,
      idempotentReplay: true,
      acceptedAt: now.toISOString(),
    })
    expect(queue.enqueueMany).not.toHaveBeenCalled()
  })

  it('NEWS-BIZ-012/EDGE-009: 20 股×31 日拆为 20 个独立 Run', async () => {
    const queue = { enqueueMany: jest.fn().mockResolvedValue(undefined) }
    const createdRuns: Array<Record<string, unknown>> = []
    const createdCommand = {
      id: 'c12345678901234567890',
      status: NewsIngestionRunStatus.QUEUED,
      acceptedAt: now,
    }
    const transaction = {
      newsIngestionCommand: {
        create: jest.fn().mockResolvedValue(createdCommand),
        findUniqueOrThrow: jest.fn(async () => ({
          ...createdCommand,
          runs: createdRuns.map((run, index) => ({
            id: `c${String(index + 2).padStart(21, '0')}`,
            status: run.status as NewsIngestionRunStatus,
          })),
        })),
      },
      newsIngestionRun: {
        createMany: jest.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => {
          createdRuns.push(...data)
          return { count: data.length }
        }),
      },
    }
    const prisma = {
      newsIngestionCommand: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(async (callback: (tx: typeof transaction) => unknown) => callback(transaction)),
    }
    const service = createService({ prisma, queue })
    const securityCodes = Array.from({ length: 20 }, (_, index) => `${String(index + 1).padStart(6, '0')}.SH`)

    const result = await service.run(7, {
      clientRequestId: pollDto.clientRequestId,
      operation: 'BACKFILL_SECURITY_NOTICES',
      securityCodes,
      beginDate: '2026-07-07',
      endDate: '2026-08-06',
    })

    expect(createdRuns).toHaveLength(20)
    expect(createdRuns.map((run) => run.partitionKey)).toEqual(securityCodes)
    expect(new Set(createdRuns.map((run) => run.idempotencyKey))).toHaveProperty('size', 20)
    expect(result.runIds).toHaveLength(20)
    expect(queue.enqueueMany).toHaveBeenCalledWith(result.runIds)
  })

  it('NEWS-SEC-API: 模块关闭时管理读端也返回 7014，且不读业务表', async () => {
    const findUnique = jest.fn()
    const service = createService({
      prisma: { newsIngestionCommand: { findUnique } },
      config: { enabled: false },
    })

    await expect(service.status('c12345678901234567890')).rejects.toEqual(
      expect.objectContaining({ definition: expect.objectContaining({ code: 7014 }) }),
    )
    expect(findUnique).not.toHaveBeenCalled()
  })

  it('NEWS-SEC-INGESTION-ERROR-READ: status 不得公开历史持久化的 raw HTTP 错误', async () => {
    const rawError = 'GET https://upstream.invalid/feed?api_key=secret-token failed: connect ECONNREFUSED 10.0.0.8:443'
    const command = {
      id: 'c12345678901234567890',
      clientRequestId: pollDto.clientRequestId,
      operation: NewsIngestionOperation.POLL_FEED,
      status: NewsIngestionRunStatus.FAILED,
      acceptedAt: now,
      startedAt: now,
      finishedAt: now,
      runs: [
        {
          id: 'c22345678901234567890',
          providerKey: 'FAKE',
          feedKey: 'fake.feed',
          partitionKey: 'default',
          status: NewsIngestionRunStatus.FAILED,
          fetchedCount: 0,
          insertedCount: 0,
          revisedCount: 0,
          duplicateCount: 0,
          quarantinedCount: 0,
          potentiallyTruncated: false,
          dataThroughBefore: null,
          dataThroughAfter: null,
          errorCode: 'UPSTREAM_UNAVAILABLE',
          errorMessage: rawError,
          createdAt: now,
          startedAt: now,
          finishedAt: now,
        },
      ],
    }
    const service = createService({
      prisma: { newsIngestionCommand: { findUnique: jest.fn().mockResolvedValue(command) } },
    })

    const result = await service.status(command.id)

    expect(result.runs[0]).toEqual(
      expect.objectContaining({
        errorCode: 'UPSTREAM_UNAVAILABLE',
        errorMessage: '新闻源暂时不可用',
      }),
    )
    expect(JSON.stringify(result)).not.toContain('secret-token')
    expect(JSON.stringify(result)).not.toContain('10.0.0.8')
  })
})

function createService(overrides: { prisma?: unknown; queue?: unknown; config?: unknown }): NewsAdminService {
  return new NewsAdminService(
    (overrides.prisma ?? {}) as never,
    (overrides.queue ?? { enqueueMany: jest.fn() }) as never,
    { getProvider: jest.fn().mockReturnValue({}) } as never,
    {} as never,
    {} as never,
    { refreshCommandStatus: jest.fn() } as never,
    (overrides.config ?? { enabled: true }) as never,
    { now: () => new Date('2026-08-06T04:00:00.000Z') },
  )
}
