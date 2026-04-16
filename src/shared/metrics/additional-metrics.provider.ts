import { makeGaugeProvider } from '@willsoto/nestjs-prometheus'
import { REDIS_MEMORY_USAGE, CACHE_HIT_RATIO, WS_ACTIVE_CONNECTIONS } from './additional-metrics.constants'

export const additionalMetricProviders = [
  makeGaugeProvider({
    name: REDIS_MEMORY_USAGE,
    help: 'Redis memory usage in bytes',
  }),
  makeGaugeProvider({
    name: CACHE_HIT_RATIO,
    help: 'Cache hit ratio percentage per namespace',
    labelNames: ['namespace'],
  }),
  makeGaugeProvider({
    name: WS_ACTIVE_CONNECTIONS,
    help: 'Number of active WebSocket connections',
  }),
]
