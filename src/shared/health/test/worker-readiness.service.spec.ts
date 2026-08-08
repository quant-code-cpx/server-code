import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { LoggerService } from '../../logger/logger.service'
import { PrismaService } from '../../prisma.service'
import { WorkerReadinessService, resolveWorkerReadinessFile } from '../worker-readiness.service'

describe('WorkerReadinessService', () => {
  const envKeys = ['PROCESS_ROLE', 'APP_TMP_DIR'] as const
  const originalEnv = new Map(envKeys.map((key) => [key, process.env[key]]))
  let root: string

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
    for (const key of envKeys) {
      const value = originalEnv.get(key)
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  it('[BIZ] worker only writes heartbeat after PostgreSQL and Redis checks succeed', async () => {
    root = await mkdtemp(path.join(tmpdir(), 'quant-worker-readiness-'))
    process.env.PROCESS_ROLE = 'worker'
    process.env.APP_TMP_DIR = root
    const prisma = { $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]) }
    const redis = { ping: jest.fn().mockResolvedValue('PONG') }
    const logger = { error: jest.fn() }
    const service = new WorkerReadinessService(
      prisma as unknown as PrismaService,
      redis as never,
      logger as unknown as LoggerService,
    )

    await service.onModuleInit()

    const filePath = resolveWorkerReadinessFile('worker')
    await expect(readFile(filePath, 'utf8')).resolves.toContain('"role":"worker"')
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1)
    expect(redis.ping).toHaveBeenCalledTimes(1)

    await service.onApplicationShutdown()
  })

  it('[ERR] Redis 未就绪时不写 heartbeat，Docker probe 将保持 unhealthy', async () => {
    root = await mkdtemp(path.join(tmpdir(), 'quant-worker-readiness-'))
    process.env.PROCESS_ROLE = 'agent-worker'
    process.env.APP_TMP_DIR = root
    const prisma = { $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]) }
    const redis = { ping: jest.fn().mockResolvedValue('LOADING') }
    const logger = { error: jest.fn() }
    const service = new WorkerReadinessService(
      prisma as unknown as PrismaService,
      redis as never,
      logger as unknown as LoggerService,
    )

    await service.onModuleInit()

    await expect(readFile(resolveWorkerReadinessFile('agent-worker'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'workerReadiness.refreshFailed', processRole: 'agent-worker' }),
      expect.any(String),
      WorkerReadinessService.name,
    )

    await service.onApplicationShutdown()
  })

  it('[EDGE] API process does not create a worker heartbeat', async () => {
    root = await mkdtemp(path.join(tmpdir(), 'quant-worker-readiness-'))
    process.env.PROCESS_ROLE = 'api'
    process.env.APP_TMP_DIR = root
    const prisma = { $queryRaw: jest.fn() }
    const redis = { ping: jest.fn() }
    const logger = { error: jest.fn() }
    const service = new WorkerReadinessService(
      prisma as unknown as PrismaService,
      redis as never,
      logger as unknown as LoggerService,
    )

    await service.onModuleInit()

    expect(prisma.$queryRaw).not.toHaveBeenCalled()
    expect(redis.ping).not.toHaveBeenCalled()
    await service.onApplicationShutdown()
  })
})
