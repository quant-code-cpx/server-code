import { Inject, Injectable } from '@nestjs/common'
import type { RedisClientType } from 'redis'
import { REDIS_CLIENT } from 'src/shared/redis.provider'
import { PrismaService } from 'src/shared/prisma.service'
import { NewsProviderError } from './providers/news-provider.errors'

export type NewsCircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN'

@Injectable()
export class NewsCircuitBreakerService {
  private readonly openMs = 5 * 60_000

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: RedisClientType,
    private readonly prisma: PrismaService,
  ) {}

  async acquire(providerKey: string, feedKey: string): Promise<void> {
    const key = this.stateKey(providerKey, feedKey)
    const state = await this.redis.hGetAll(key)
    const openUntil = Number(state.openUntil ?? 0)
    if (state.state === 'OPEN' && openUntil > Date.now()) {
      throw new NewsProviderError('UPSTREAM_UNAVAILABLE', true, 'Provider 熔断中', openUntil - Date.now())
    }
    if (state.state === 'HALF_OPEN') {
      throw new NewsProviderError('UPSTREAM_UNAVAILABLE', true, 'Provider 半开探针已占用', 30_000)
    }
    if (state.state === 'OPEN') {
      const acquired = await this.redis.set(this.probeKey(providerKey, feedKey), '1', { NX: true, PX: 30_000 })
      if (!acquired) throw new NewsProviderError('UPSTREAM_UNAVAILABLE', true, 'Provider 半开探针已占用', 30_000)
      await this.redis.hSet(key, { state: 'HALF_OPEN' })
    }
  }

  async recordSuccess(providerKey: string, feedKey: string): Promise<void> {
    await this.pushOutcome(providerKey, feedKey, '0')
    await this.redis.hSet(this.stateKey(providerKey, feedKey), { state: 'CLOSED', openUntil: '0' })
    await this.redis.del(this.probeKey(providerKey, feedKey))
    await this.persistState(providerKey, feedKey, 'CLOSED')
  }

  async recordFailure(providerKey: string, feedKey: string, directOpen = false): Promise<void> {
    await this.pushOutcome(providerKey, feedKey, '1')
    const outcomes = await this.redis.lRange(this.outcomeKey(providerKey, feedKey), 0, 19)
    const failures = outcomes.filter((value) => value === '1').length
    if (directOpen || (outcomes.length >= 10 && failures / outcomes.length >= 0.5)) {
      await this.redis.hSet(this.stateKey(providerKey, feedKey), {
        state: 'OPEN',
        openUntil: String(Date.now() + this.openMs),
      })
    }
    await this.redis.del(this.probeKey(providerKey, feedKey))
    await this.persistState(providerKey, feedKey, await this.readState(providerKey, feedKey))
  }

  async getState(providerKey: string, feedKey?: string): Promise<NewsCircuitState> {
    if (feedKey) return this.readState(providerKey, feedKey)
    const states = await Promise.all(
      (await this.redis.keys(`news:circuit:${providerKey}:*:state`)).map(async (key) => {
        const value = await this.redis.hGet(key, 'state')
        return value === 'OPEN' || value === 'HALF_OPEN' ? value : 'CLOSED'
      }),
    )
    return states.includes('OPEN') ? 'OPEN' : states.includes('HALF_OPEN') ? 'HALF_OPEN' : 'CLOSED'
  }

  private async readState(providerKey: string, feedKey: string): Promise<NewsCircuitState> {
    const state = await this.redis.hGet(this.stateKey(providerKey, feedKey), 'state')
    return state === 'OPEN' || state === 'HALF_OPEN' ? state : 'CLOSED'
  }

  private async pushOutcome(providerKey: string, feedKey: string, outcome: '0' | '1'): Promise<void> {
    const key = this.outcomeKey(providerKey, feedKey)
    await this.redis.lPush(key, outcome)
    await this.redis.lTrim(key, 0, 19)
    await this.redis.expire(key, 24 * 60 * 60)
  }

  private stateKey(providerKey: string, feedKey: string): string {
    return `news:circuit:${providerKey}:${feedKey}:state`
  }

  private outcomeKey(providerKey: string, feedKey: string): string {
    return `news:circuit:${providerKey}:${feedKey}:outcomes`
  }

  private probeKey(providerKey: string, feedKey: string): string {
    return `news:circuit:${providerKey}:${feedKey}:probe`
  }

  private async persistState(providerKey: string, feedKey: string, state: NewsCircuitState): Promise<void> {
    await this.prisma.newsFeedHealth.upsert({
      where: { providerKey_feedKey: { providerKey, feedKey } },
      create: { providerKey, feedKey, circuitState: state },
      update: { circuitState: state },
    })
  }
}
