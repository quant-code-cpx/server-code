import { Global, Module } from '@nestjs/common'
import {
  PrometheusModule,
  makeCounterProvider,
  makeHistogramProvider,
  makeGaugeProvider,
  getToken,
} from '@willsoto/nestjs-prometheus'
import {
  HTTP_REQUEST_DURATION,
  HTTP_REQUEST_TOTAL,
  HTTP_REQUEST_ERRORS,
  BULLMQ_QUEUE_DEPTH,
  BULLMQ_ACTIVE_JOBS,
  BULLMQ_FAILED_JOBS,
  BULLMQ_DELAYED_JOBS,
  BULLMQ_STALLED_JOBS_TOTAL,
  BULLMQ_ENQUEUE_LAG,
  AGENT_RUN_RECOVERY_TOTAL,
  AGENT_SSE_ACTIVE_CONNECTIONS,
  AGENT_SSE_CONNECTIONS_TOTAL,
  AGENT_SSE_EVENTS_TOTAL,
  AGENT_SSE_BYTES_TOTAL,
  AGENT_SSE_DURATION,
  AGENT_SSE_REPLAY_LAG,
  AGENT_SSE_DISCONNECTS_TOTAL,
  PRISMA_QUERY_DURATION,
  PRISMA_QUERY_TOTAL,
  PRISMA_QUERY_DURATION_TOKEN,
  PRISMA_QUERY_TOTAL_TOKEN,
  TUSHARE_SYNC_DURATION,
  TUSHARE_SYNC_TOTAL,
  TUSHARE_SYNC_ROUND_DURATION,
  TUSHARE_SYNC_ROUND_TASKS,
  CACHE_OPERATIONS_TOTAL,
} from './metrics.constants'
import { REDIS_MEMORY_USAGE, CACHE_HIT_RATIO, WS_ACTIVE_CONNECTIONS } from './additional-metrics.constants'
import { additionalMetricProviders } from './additional-metrics.provider'
import { AdditionalMetricsCollector } from './additional-metrics.collector'
import { HttpMetricsInterceptor } from './http-metrics.interceptor'

@Global()
@Module({
  imports: [
    PrometheusModule.register({
      path: '/metrics',
      defaultMetrics: { enabled: true },
      defaultLabels: { app: 'quant-server' },
    }),
  ],
  providers: [
    // ── HTTP 指标 ──
    makeHistogramProvider({
      name: HTTP_REQUEST_DURATION,
      help: 'HTTP request duration in seconds',
      labelNames: ['method', 'route', 'status_code'],
      buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    }),
    makeCounterProvider({
      name: HTTP_REQUEST_TOTAL,
      help: 'Total number of HTTP requests',
      labelNames: ['method', 'route', 'status_code'],
    }),
    makeCounterProvider({
      name: HTTP_REQUEST_ERRORS,
      help: 'Total number of HTTP request errors (4xx/5xx)',
      labelNames: ['method', 'route', 'status_code'],
    }),

    // ── BullMQ 队列指标 ──
    makeGaugeProvider({
      name: BULLMQ_QUEUE_DEPTH,
      help: 'Number of waiting jobs in BullMQ queue',
      labelNames: ['queue'],
    }),
    makeGaugeProvider({
      name: BULLMQ_ACTIVE_JOBS,
      help: 'Number of active jobs in BullMQ queue',
      labelNames: ['queue'],
    }),
    makeGaugeProvider({
      name: BULLMQ_FAILED_JOBS,
      help: 'Number of failed jobs retained in BullMQ queue',
      labelNames: ['queue'],
    }),
    makeGaugeProvider({
      name: BULLMQ_DELAYED_JOBS,
      help: 'Number of delayed jobs in BullMQ queue',
      labelNames: ['queue'],
    }),
    makeCounterProvider({
      name: BULLMQ_STALLED_JOBS_TOTAL,
      help: 'Total number of stalled BullMQ jobs',
      labelNames: ['queue'],
    }),
    makeHistogramProvider({
      name: BULLMQ_ENQUEUE_LAG,
      help: 'Delay from durable job intent creation to BullMQ enqueue in seconds',
      labelNames: ['queue'],
      buckets: [0.01, 0.05, 0.1, 0.5, 1, 5, 10, 30, 60, 300],
    }),
    makeCounterProvider({
      name: AGENT_RUN_RECOVERY_TOTAL,
      help: 'Total number of Agent Run reconciliation outcomes',
      labelNames: ['result'],
    }),
    makeGaugeProvider({
      name: AGENT_SSE_ACTIVE_CONNECTIONS,
      help: 'Number of active Agent POST-SSE connections',
    }),
    makeCounterProvider({
      name: AGENT_SSE_CONNECTIONS_TOTAL,
      help: 'Total number of Agent POST-SSE connection attempts',
      labelNames: ['result'],
    }),
    makeCounterProvider({
      name: AGENT_SSE_EVENTS_TOTAL,
      help: 'Total number of Agent SSE events sent',
      labelNames: ['phase'],
    }),
    makeCounterProvider({
      name: AGENT_SSE_BYTES_TOTAL,
      help: 'Total number of Agent SSE bytes queued for clients',
    }),
    makeHistogramProvider({
      name: AGENT_SSE_DURATION,
      help: 'Agent POST-SSE connection duration in seconds',
      labelNames: ['reason'],
      buckets: [0.1, 0.5, 1, 5, 15, 30, 60, 180, 300, 900],
    }),
    makeHistogramProvider({
      name: AGENT_SSE_REPLAY_LAG,
      help: 'Number of committed Agent events behind at connection time',
      buckets: [0, 1, 2, 5, 10, 25, 50, 100, 250, 500, 1000],
    }),
    makeCounterProvider({
      name: AGENT_SSE_DISCONNECTS_TOTAL,
      help: 'Total number of Agent POST-SSE connection terminations',
      labelNames: ['reason'],
    }),

    // ── Prisma 查询指标 ──
    makeHistogramProvider({
      name: PRISMA_QUERY_DURATION,
      help: 'Prisma query duration in seconds',
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    }),
    makeCounterProvider({
      name: PRISMA_QUERY_TOTAL,
      help: 'Total number of Prisma queries',
    }),
    // PrismaService 通过字符串 token 注入上述指标（@Optional），此处桥接
    { provide: PRISMA_QUERY_DURATION_TOKEN, useExisting: getToken(PRISMA_QUERY_DURATION) },
    { provide: PRISMA_QUERY_TOTAL_TOKEN, useExisting: getToken(PRISMA_QUERY_TOTAL) },

    // ── Tushare 同步指标 ──
    makeHistogramProvider({
      name: TUSHARE_SYNC_DURATION,
      help: 'Tushare sync task duration in seconds',
      labelNames: ['task', 'category', 'trigger', 'status'],
      buckets: [1, 5, 10, 30, 60, 120, 300, 600, 1800],
    }),
    makeCounterProvider({
      name: TUSHARE_SYNC_TOTAL,
      help: 'Total number of Tushare sync task executions',
      labelNames: ['task', 'category', 'trigger', 'status'],
    }),
    makeGaugeProvider({
      name: TUSHARE_SYNC_ROUND_DURATION,
      help: 'Duration of the last full sync round in seconds',
      labelNames: ['trigger', 'mode'],
    }),
    makeGaugeProvider({
      name: TUSHARE_SYNC_ROUND_TASKS,
      help: 'Number of tasks executed/failed/skipped in the last sync round',
      labelNames: ['trigger', 'mode', 'status'],
    }),

    // ── 缓存操作指标 ──
    makeCounterProvider({
      name: CACHE_OPERATIONS_TOTAL,
      help: 'Total number of cache operations',
      labelNames: ['namespace', 'operation'],
    }),

    // ── Redis / Cache / WebSocket 附加指标 ──
    ...additionalMetricProviders,
    AdditionalMetricsCollector,

    // ── HttpMetricsInterceptor（需要 DI 注入指标，通过 app.get() 使用） ──
    HttpMetricsInterceptor,
  ],
  exports: [
    PrometheusModule,
    HttpMetricsInterceptor,
    AdditionalMetricsCollector,
    // 将所有指标 provider 导出，使非直接导入 MetricsModule 的模块（如 TushareModule、QueueModule）
    // 能通过 @Global() 全局解析到这些 token
    getToken(HTTP_REQUEST_DURATION),
    getToken(HTTP_REQUEST_TOTAL),
    getToken(HTTP_REQUEST_ERRORS),
    getToken(BULLMQ_QUEUE_DEPTH),
    getToken(BULLMQ_ACTIVE_JOBS),
    getToken(BULLMQ_FAILED_JOBS),
    getToken(BULLMQ_DELAYED_JOBS),
    getToken(BULLMQ_STALLED_JOBS_TOTAL),
    getToken(BULLMQ_ENQUEUE_LAG),
    getToken(AGENT_RUN_RECOVERY_TOTAL),
    getToken(AGENT_SSE_ACTIVE_CONNECTIONS),
    getToken(AGENT_SSE_CONNECTIONS_TOTAL),
    getToken(AGENT_SSE_EVENTS_TOTAL),
    getToken(AGENT_SSE_BYTES_TOTAL),
    getToken(AGENT_SSE_DURATION),
    getToken(AGENT_SSE_REPLAY_LAG),
    getToken(AGENT_SSE_DISCONNECTS_TOTAL),
    getToken(PRISMA_QUERY_DURATION),
    getToken(PRISMA_QUERY_TOTAL),
    PRISMA_QUERY_DURATION_TOKEN,
    PRISMA_QUERY_TOTAL_TOKEN,
    getToken(TUSHARE_SYNC_DURATION),
    getToken(TUSHARE_SYNC_TOTAL),
    getToken(TUSHARE_SYNC_ROUND_DURATION),
    getToken(TUSHARE_SYNC_ROUND_TASKS),
    getToken(CACHE_OPERATIONS_TOTAL),
    getToken(REDIS_MEMORY_USAGE),
    getToken(CACHE_HIT_RATIO),
    getToken(WS_ACTIVE_CONNECTIONS),
  ],
})
export class MetricsModule {}
