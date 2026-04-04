import { Inject, Injectable } from '@nestjs/common'
import { HealthCheckError, HealthIndicator, HealthIndicatorResult } from '@nestjs/terminus'
import type { RedisClientType } from 'redis'
import { REDIS_CLIENT } from '../redis.provider'

@Injectable()
export class RedisHealthIndicator extends HealthIndicator {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: RedisClientType) {
    super()
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      const pong = await this.redis.ping()
      if (pong !== 'PONG') {
        throw new Error(`Unexpected PING response: ${pong}`)
      }
      return this.getStatus(key, true)
    } catch (error) {
      throw new HealthCheckError(
        `${key} health check failed`,
        this.getStatus(key, false, { message: (error as Error).message }),
      )
    }
  }
}
