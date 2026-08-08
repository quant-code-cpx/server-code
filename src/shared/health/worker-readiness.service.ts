import { Inject, Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { RedisClientType } from 'redis'
import { PrismaService } from 'src/shared/prisma.service'
import { REDIS_CLIENT } from 'src/shared/redis.provider'
import { LoggerService } from 'src/shared/logger/logger.service'

const READY_PROCESS_ROLES = new Set(['worker', 'agent-worker', 'scheduler'])
const HEARTBEAT_INTERVAL_MS = 10_000

/**
 * Writes a freshness marker only while a non-HTTP process can still use both
 * PostgreSQL and Redis. Compose probes its mtime, so PID 1 alone cannot report
 * a wedged event loop or disconnected dependencies as healthy.
 */
@Injectable()
export class WorkerReadinessService implements OnModuleInit, OnApplicationShutdown {
  private readonly role = process.env.PROCESS_ROLE?.trim()
  private readonly filePath = this.role && isReadyProcessRole(this.role) ? resolveWorkerReadinessFile(this.role) : null
  private heartbeatTimer?: NodeJS.Timeout
  private refreshing = false
  private stopped = false

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: RedisClientType,
    private readonly logger: LoggerService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.filePath) return

    await this.refresh()
    this.heartbeatTimer = setInterval(() => void this.refresh(), HEARTBEAT_INTERVAL_MS)
    this.heartbeatTimer.unref()
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopped = true
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    if (this.filePath) await fs.rm(this.filePath, { force: true })
  }

  private async refresh(): Promise<void> {
    if (!this.filePath || this.refreshing || this.stopped) return
    this.refreshing = true

    try {
      const [, redisResponse] = await Promise.all([this.prisma.$queryRaw`SELECT 1`, this.redis.ping()])
      if (redisResponse !== 'PONG') throw new Error(`Unexpected Redis PING response: ${redisResponse}`)
      if (this.stopped) return

      await fs.mkdir(path.dirname(this.filePath), { recursive: true })
      const temporaryPath = `${this.filePath}.tmp`
      await fs.writeFile(temporaryPath, JSON.stringify({ role: this.role, updatedAt: new Date().toISOString() }))
      if (!this.stopped) await fs.rename(temporaryPath, this.filePath)
    } catch (error) {
      this.logger.error(
        { operation: 'workerReadiness.refreshFailed', processRole: this.role, error: (error as Error).message },
        (error as Error).stack,
        WorkerReadinessService.name,
      )
    } finally {
      this.refreshing = false
    }
  }
}

export function resolveWorkerReadinessFile(role: string, configuredTmpDirectory = process.env.APP_TMP_DIR): string {
  const temporaryDirectory = configuredTmpDirectory?.trim() || path.join(process.cwd(), 'tmp')
  return path.join(temporaryDirectory, `worker-readiness-${role}.json`)
}

function isReadyProcessRole(role: string): boolean {
  return READY_PROCESS_ROLES.has(role)
}
