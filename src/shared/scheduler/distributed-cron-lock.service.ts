import { randomUUID } from 'node:crypto'
import { Inject, Injectable } from '@nestjs/common'
import type { RedisClientType } from 'redis'
import { CronLockConfig, type ICronLockConfig } from 'src/config/cron-lock.config'
import { ProcessRoleConfig, type IProcessRoleConfig } from 'src/config/process-role.config'
import { REDIS_CLIENT } from 'src/shared/redis.provider'
import { LoggerService } from 'src/shared/logger/logger.service'

const RENEW_IF_OWNER_SCRIPT = `
  if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('PEXPIRE', KEYS[1], ARGV[2])
  end
  return 0
`

const RELEASE_IF_OWNER_SCRIPT = `
  if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('DEL', KEYS[1])
  end
  return 0
`

export interface CronLease {
  key: string
  token: string
  ttlMs: number
}

export type CronLeaseRunResult = 'executed' | 'skipped'

@Injectable()
export class DistributedCronLockService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: RedisClientType,
    @Inject(CronLockConfig.KEY) private readonly config: ICronLockConfig,
    @Inject(ProcessRoleConfig.KEY) private readonly processRole: IProcessRoleConfig,
    private readonly logger: LoggerService,
  ) {}

  async runIfScheduler(
    name: string,
    task: () => Promise<void>,
    ttlMs = this.config.ttlMs,
  ): Promise<CronLeaseRunResult> {
    if (!this.processRole.schedulerEnabled) return 'skipped'
    return this.runWithLease(name, task, ttlMs)
  }

  isSchedulerProcess(): boolean {
    return this.processRole.schedulerEnabled
  }

  async acquire(name: string, ttlMs = this.config.ttlMs): Promise<CronLease | null> {
    const key = this.buildKey(name)
    const token = randomUUID()
    const acquired = await this.redis.set(key, token, { NX: true, PX: this.assertTtl(ttlMs) })
    return acquired === 'OK' ? { key, token, ttlMs } : null
  }

  async renew(lease: CronLease): Promise<boolean> {
    return this.evalOwnershipScript(RENEW_IF_OWNER_SCRIPT, lease, String(this.assertTtl(lease.ttlMs)))
  }

  async release(lease: CronLease): Promise<boolean> {
    return this.evalOwnershipScript(RELEASE_IF_OWNER_SCRIPT, lease)
  }

  async runWithLease(name: string, task: () => Promise<void>, ttlMs = this.config.ttlMs): Promise<CronLeaseRunResult> {
    const lease = await this.acquire(name, ttlMs)
    if (!lease) return 'skipped'

    let renewing = false
    const heartbeatMs = Math.max(1_000, Math.floor(lease.ttlMs / 3))
    const heartbeat = setInterval(() => {
      if (renewing) return
      renewing = true
      void this.renew(lease)
        .then((renewed) => {
          if (!renewed) {
            this.logger.warn({ operation: 'cronLease.lost', key: lease.key }, DistributedCronLockService.name)
          }
        })
        .catch((error: unknown) => {
          this.logger.error(
            { operation: 'cronLease.renew', key: lease.key, error: safeErrorMessage(error) },
            DistributedCronLockService.name,
          )
        })
        .finally(() => {
          renewing = false
        })
    }, heartbeatMs)
    heartbeat.unref()

    try {
      await task()
      return 'executed'
    } finally {
      clearInterval(heartbeat)
      try {
        await this.release(lease)
      } catch (error) {
        this.logger.error(
          { operation: 'cronLease.release', key: lease.key, error: safeErrorMessage(error) },
          DistributedCronLockService.name,
        )
      }
    }
  }

  private async evalOwnershipScript(script: string, lease: CronLease, ...args: string[]): Promise<boolean> {
    const result = await this.redis.eval(script, {
      keys: [lease.key],
      arguments: [lease.token, ...args],
    })
    return Number(result) === 1
  }

  private buildKey(name: string): string {
    const normalized = name.trim()
    if (!/^[A-Za-z0-9:_-]+$/.test(normalized)) {
      throw new Error('[CronLock] 任务名只能包含字母、数字、冒号、下划线和连字符')
    }
    return `${this.config.prefix}:${normalized}`
  }

  private assertTtl(ttlMs: number): number {
    if (!Number.isInteger(ttlMs) || ttlMs < 5_000 || ttlMs > 3_600_000) {
      throw new Error('[CronLock] lease TTL 必须是 5000-3600000 的整数')
    }
    return ttlMs
  }
}

function safeErrorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/[\r\n\t]+/g, ' ').slice(0, 1_000)
}
