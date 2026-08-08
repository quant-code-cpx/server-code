import { NewsCircuitBreakerService } from '../news-circuit-breaker.service'
import { NewsIngestionService } from '../news-ingestion.service'
import { NewsRepository } from '../news.repository'
import { NewsProviderError } from '../providers/news-provider.errors'
import { newsProviderBackoffStrategy } from 'src/queue/news/news.processor'

describe('News 重试与熔断契约', () => {
  it('NEWS-ERR-002/003: 固定 5s/30s/120s，并优先尊重有界 Retry-After', () => {
    expect(newsProviderBackoffStrategy(1, 'news-provider')).toBe(5_000)
    expect(newsProviderBackoffStrategy(2, 'news-provider')).toBe(30_000)
    expect(newsProviderBackoffStrategy(3, 'news-provider')).toBe(120_000)
    expect(
      newsProviderBackoffStrategy(
        1,
        'news-provider',
        new NewsProviderError('UPSTREAM_RATE_LIMITED', true, '受限', 45_000),
      ),
    ).toBe(45_000)
    expect(
      newsProviderBackoffStrategy(
        1,
        'news-provider',
        new NewsProviderError('UPSTREAM_RATE_LIMITED', true, '受限', 99_999_999),
      ),
    ).toBe(15 * 60_000)
  })

  it('NEWS-RACE-008: OPEN 到期只放一个 HALF_OPEN 探针', async () => {
    const state: Record<string, string> = { state: 'OPEN', openUntil: '0' }
    const redis = {
      hGetAll: jest.fn(async () => ({ ...state })),
      set: jest.fn(async () => 'OK'),
      hSet: jest.fn(async (_key: string, value: Record<string, string>) => Object.assign(state, value)),
    }
    const service = new NewsCircuitBreakerService(redis as never, {} as never)

    await expect(service.acquire('FAKE', 'fake.feed')).resolves.toBeUndefined()
    await expect(service.acquire('FAKE', 'fake.feed')).rejects.toEqual(
      expect.objectContaining({ code: 'UPSTREAM_UNAVAILABLE', retryable: true }),
    )
    expect(redis.set).toHaveBeenCalledTimes(1)
  })

  it('Redis 熔断成功回写失败不得覆盖已提交的 Run 或触发整批重试', async () => {
    const run = {
      id: 'run-redis-non-authoritative',
      commandId: 'command-1',
      status: 'QUEUED',
      operation: 'POLL_FEED',
      providerKey: 'AKSHARE',
      feedKey: 'akshare.eastmoney.global',
      partitionKey: 'default',
      command: { requestSpec: {} },
    }
    const repository = {
      getRun: jest.fn().mockResolvedValue(run),
      ensureCursor: jest.fn().mockResolvedValue({
        id: 'cursor-1',
        version: 0,
        providerCursor: null,
        watermarkAt: null,
      }),
      markRunRunning: jest.fn().mockResolvedValue(true),
      refreshCommandStatus: jest.fn().mockResolvedValue(undefined),
      commitBatch: jest.fn().mockResolvedValue(undefined),
      markRunFailed: jest.fn().mockResolvedValue(undefined),
    }
    const provider = {
      fetch: jest.fn().mockResolvedValue({
        schemaVersion: 1,
        providerKey: run.providerKey,
        feedKey: run.feedKey,
        partitionKey: run.partitionKey,
        retrievedAt: new Date('2026-08-06T04:00:00.000Z'),
        items: [],
        nextCursor: null,
        potentiallyTruncated: false,
        warnings: [],
      }),
    }
    const registry = {
      getCapability: jest.fn().mockReturnValue({ sourceType: 'MEDIA' }),
      getProvider: jest.fn().mockReturnValue(provider),
    }
    const circuit = {
      acquire: jest.fn().mockResolvedValue(undefined),
      recordSuccess: jest.fn().mockRejectedValue(new Error('Redis unavailable after DB commit')),
      recordFailure: jest.fn().mockResolvedValue(undefined),
    }
    const service = new NewsIngestionService(
      repository as never,
      registry as never,
      circuit as never,
      { excerptMaxChars: 1_000 } as never,
      { now: () => new Date('2026-08-06T04:00:00.000Z') },
    )

    let outcome = 'resolved'
    try {
      await service.executeRun(run.id)
    } catch (error) {
      outcome = `rejected: ${error instanceof Error ? error.message : String(error)}`
    }

    expect({
      outcome,
      fetchCalls: provider.fetch.mock.calls.length,
      commitCalls: repository.commitBatch.mock.calls.length,
      markRunFailedCalls: repository.markRunFailed.mock.calls.length,
      recordFailureCalls: circuit.recordFailure.mock.calls.length,
    }).toEqual({
      outcome: 'resolved',
      fetchCalls: 1,
      commitCalls: 1,
      markRunFailedCalls: 0,
      recordFailureCalls: 0,
    })
  })

  it('同一 Run 双 Worker 仅 claim 成功者执行 fetch 和事务提交', async () => {
    const run = {
      id: 'run-double-worker-claim',
      commandId: 'command-claim',
      status: 'QUEUED',
      operation: 'POLL_FEED',
      providerKey: 'AKSHARE',
      feedKey: 'akshare.eastmoney.global',
      partitionKey: 'default',
      command: { requestSpec: {} },
    }
    let releaseBothReads!: () => void
    const bothReads = new Promise<void>((resolve) => {
      releaseBothReads = resolve
    })
    let readCount = 0
    let runStatus = 'QUEUED'
    let successfulClaims = 0
    const repository = {
      getRun: jest.fn(async () => {
        readCount += 1
        if (readCount === 2) releaseBothReads()
        await bothReads
        return run
      }),
      ensureCursor: jest.fn().mockResolvedValue({
        id: 'cursor-claim',
        version: 0,
        providerCursor: null,
        watermarkAt: null,
      }),
      markRunRunning: jest.fn(async () => {
        if (runStatus !== 'QUEUED') return false
        runStatus = 'RUNNING'
        successfulClaims += 1
        return true
      }),
      refreshCommandStatus: jest.fn().mockResolvedValue(undefined),
      commitBatch: jest.fn(async () => {
        if (runStatus !== 'RUNNING') throw new Error('duplicate commit attempted after terminal state')
        runStatus = 'SUCCEEDED'
      }),
      markRunFailed: jest.fn(async () => {
        runStatus = 'FAILED'
      }),
    }
    const provider = {
      fetch: jest.fn().mockResolvedValue({
        schemaVersion: 1,
        providerKey: run.providerKey,
        feedKey: run.feedKey,
        partitionKey: run.partitionKey,
        retrievedAt: new Date('2026-08-06T04:00:00.000Z'),
        items: [],
        nextCursor: null,
        potentiallyTruncated: false,
        warnings: [],
      }),
    }
    const circuit = {
      acquire: jest.fn().mockResolvedValue(undefined),
      recordSuccess: jest.fn().mockResolvedValue(undefined),
      recordFailure: jest.fn().mockResolvedValue(undefined),
    }
    const service = new NewsIngestionService(
      repository as never,
      {
        getCapability: jest.fn().mockReturnValue({ sourceType: 'MEDIA' }),
        getProvider: jest.fn().mockReturnValue(provider),
      } as never,
      circuit as never,
      { excerptMaxChars: 1_000 } as never,
      { now: () => new Date('2026-08-06T04:00:00.000Z') },
    )
    const settle = async (execution: Promise<void>) => {
      try {
        await execution
        return 'resolved'
      } catch (error) {
        return `rejected: ${error instanceof Error ? error.message : String(error)}`
      }
    }

    const outcomes = await Promise.all([settle(service.executeRun(run.id)), settle(service.executeRun(run.id))])

    expect({
      outcomes: outcomes.sort(),
      successfulClaims,
      fetchCalls: provider.fetch.mock.calls.length,
      commitCalls: repository.commitBatch.mock.calls.length,
      markRunFailedCalls: repository.markRunFailed.mock.calls.length,
      finalRunStatus: runStatus,
    }).toEqual({
      outcomes: ['resolved', 'resolved'],
      successfulClaims: 1,
      fetchCalls: 1,
      commitCalls: 1,
      markRunFailedCalls: 0,
      finalRunStatus: 'SUCCEEDED',
    })
  })

  it('Command 终态刷新失败不得覆盖已提交 Run 或触发整批重试', async () => {
    const run = {
      id: 'run-command-refresh-after-commit',
      commandId: 'command-refresh',
      status: 'QUEUED',
      operation: 'POLL_FEED',
      providerKey: 'AKSHARE',
      feedKey: 'akshare.eastmoney.global',
      partitionKey: 'default',
      command: { requestSpec: {} },
    }
    let runStatus = 'QUEUED'
    const repository = {
      getRun: jest.fn().mockResolvedValue(run),
      markRunRunning: jest.fn(async () => {
        runStatus = 'RUNNING'
        return true
      }),
      refreshCommandStatus: jest
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('Command projection refresh unavailable after commit'))
        .mockResolvedValueOnce(undefined),
      ensureCursor: jest.fn().mockResolvedValue({
        id: 'cursor-command-refresh',
        version: 0,
        providerCursor: null,
        watermarkAt: null,
      }),
      commitBatch: jest.fn(async () => {
        runStatus = 'SUCCEEDED'
      }),
      markRunFailed: jest.fn(async () => {
        runStatus = 'FAILED'
      }),
    }
    const provider = {
      fetch: jest.fn().mockResolvedValue({
        schemaVersion: 1,
        providerKey: run.providerKey,
        feedKey: run.feedKey,
        partitionKey: run.partitionKey,
        retrievedAt: new Date('2026-08-06T04:00:00.000Z'),
        items: [],
        nextCursor: null,
        potentiallyTruncated: false,
        warnings: [],
      }),
    }
    const circuit = {
      acquire: jest.fn().mockResolvedValue(undefined),
      recordSuccess: jest.fn().mockResolvedValue(undefined),
      recordFailure: jest.fn().mockResolvedValue(undefined),
    }
    const service = new NewsIngestionService(
      repository as never,
      {
        getCapability: jest.fn().mockReturnValue({ sourceType: 'MEDIA' }),
        getProvider: jest.fn().mockReturnValue(provider),
      } as never,
      circuit as never,
      { excerptMaxChars: 1_000 } as never,
      { now: () => new Date('2026-08-06T04:00:00.000Z') },
    )

    let outcome = 'resolved'
    try {
      await service.executeRun(run.id)
    } catch (error) {
      outcome = `rejected: ${error instanceof Error ? error.message : String(error)}`
    }

    expect({
      outcome,
      fetchCalls: provider.fetch.mock.calls.length,
      commitCalls: repository.commitBatch.mock.calls.length,
      refreshCommandStatusCalls: repository.refreshCommandStatus.mock.calls.length,
      markRunFailedCalls: repository.markRunFailed.mock.calls.length,
      recordFailureCalls: circuit.recordFailure.mock.calls.length,
      finalRunStatus: runStatus,
    }).toEqual({
      outcome: 'resolved',
      fetchCalls: 1,
      commitCalls: 1,
      refreshCommandStatusCalls: 2,
      markRunFailedCalls: 0,
      recordFailureCalls: 0,
      finalRunStatus: 'SUCCEEDED',
    })
  })

  it('markRunFailed 仅允许 RUNNING 原子收敛一次，不得覆盖既有终态', async () => {
    const exercise = async (initialStatus: string, attempts: number) => {
      let status = initialStatus
      const matchesStatus = (condition: unknown) => {
        if (condition == null) return true
        if (typeof condition === 'string') return status === condition
        if (typeof condition !== 'object') return false
        const filter = condition as { equals?: string; in?: string[] }
        if (filter.equals) return status === filter.equals
        if (filter.in) return filter.in.includes(status)
        return true
      }
      const newsIngestionRun = {
        findUnique: jest.fn(async () => ({ id: 'run-failure-cas', status })),
        update: jest.fn(async ({ where, data }: { where: { status?: unknown }; data: { status: string } }) => {
          if (!matchesStatus(where.status)) throw Object.assign(new Error('record not found'), { code: 'P2025' })
          status = data.status
          return { id: 'run-failure-cas', status }
        }),
        updateMany: jest.fn(async ({ where, data }: { where: { status?: unknown }; data: { status: string } }) => {
          if (!matchesStatus(where.status)) return { count: 0 }
          status = data.status
          return { count: 1 }
        }),
      }
      const newsIngestionCursor = { upsert: jest.fn().mockResolvedValue({}) }
      const newsFeedHealth = { upsert: jest.fn().mockResolvedValue({}) }
      const prisma = {
        newsIngestionRun,
        newsIngestionCursor,
        newsFeedHealth,
        $transaction: jest.fn(),
      }
      prisma.$transaction.mockImplementation(async (argument: unknown) => {
        if (typeof argument === 'function') return (argument as (tx: typeof prisma) => unknown)(prisma)
        if (Array.isArray(argument)) return Promise.all(argument)
        return argument
      })
      const repository = new NewsRepository(prisma as never)
      const failure = {
        runId: 'run-failure-cas',
        providerKey: 'AKSHARE',
        feedKey: 'akshare.eastmoney.global',
        partitionKey: 'default',
        errorCode: 'UPSTREAM_UNAVAILABLE',
        errorMessage: '迟到的 Worker 失败',
      }

      for (let attempt = 0; attempt < attempts; attempt += 1) await repository.markRunFailed(failure)

      return {
        initialStatus,
        finalStatus: status,
        cursorFailureWrites: newsIngestionCursor.upsert.mock.calls.length,
        healthFailureWrites: newsFeedHealth.upsert.mock.calls.length,
      }
    }

    const [succeeded, partial, cancelled, running] = await Promise.all([
      exercise('SUCCEEDED', 1),
      exercise('PARTIAL', 1),
      exercise('CANCELLED', 1),
      exercise('RUNNING', 2),
    ])

    expect([succeeded, partial, cancelled, running]).toEqual([
      { initialStatus: 'SUCCEEDED', finalStatus: 'SUCCEEDED', cursorFailureWrites: 0, healthFailureWrites: 0 },
      { initialStatus: 'PARTIAL', finalStatus: 'PARTIAL', cursorFailureWrites: 0, healthFailureWrites: 0 },
      { initialStatus: 'CANCELLED', finalStatus: 'CANCELLED', cursorFailureWrites: 0, healthFailureWrites: 0 },
      { initialStatus: 'RUNNING', finalStatus: 'FAILED', cursorFailureWrites: 1, healthFailureWrites: 1 },
    ])
  })

  it('NEWS-SEC-INGESTION-ERROR-WRITE: markRunFailed 丢弃 raw 数据库错误并持久化稳定公开文案', async () => {
    const runUpdateMany = jest.fn().mockResolvedValue({ count: 1 })
    const healthUpsert = jest.fn().mockResolvedValue({})
    const tx = {
      newsIngestionRun: { updateMany: runUpdateMany },
      newsIngestionCursor: { upsert: jest.fn().mockResolvedValue({}) },
      newsFeedHealth: { upsert: healthUpsert },
    }
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    }
    const repository = new NewsRepository(prisma as never)
    const rawError = 'password=super-secret; relation "private_positions" does not exist at 10.0.0.9:5432'

    await repository.markRunFailed({
      runId: 'run-sensitive-error',
      providerKey: 'AKSHARE',
      feedKey: 'akshare.eastmoney.global',
      partitionKey: 'default',
      errorCode: 'INTERNAL_ERROR',
      errorMessage: rawError,
    })

    const persistedRunData = runUpdateMany.mock.calls[0]?.[0]?.data
    const persistedHealthData = healthUpsert.mock.calls[0]?.[0]?.create
    expect({ persistedRunData, persistedHealthData }).toEqual({
      persistedRunData: expect.objectContaining({
        errorCode: 'INTERNAL_ERROR',
        errorMessage: '新闻采集内部错误',
      }),
      persistedHealthData: expect.objectContaining({
        lastPublicErrorCode: 'INTERNAL_ERROR',
        lastPublicErrorMessage: '新闻采集内部错误',
      }),
    })
    expect(JSON.stringify({ persistedRunData, persistedHealthData })).not.toContain('super-secret')
    expect(JSON.stringify({ persistedRunData, persistedHealthData })).not.toContain('private_positions')
  })
})
