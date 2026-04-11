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

    // ── HttpMetricsInterceptor（需要 DI 注入指标，通过 app.get() 使用） ──
    HttpMetricsInterceptor,
  ],
  exports: [
    PrometheusModule,
    HttpMetricsInterceptor,
    // 将所有指标 provider 导出，使非直接导入 MetricsModule 的模块（如 TushareModule、QueueModule）
    // 能通过 @Global() 全局解析到这些 token
    getToken(HTTP_REQUEST_DURATION),
    getToken(HTTP_REQUEST_TOTAL),
    getToken(HTTP_REQUEST_ERRORS),
    getToken(BULLMQ_QUEUE_DEPTH),
    getToken(BULLMQ_ACTIVE_JOBS),
    getToken(PRISMA_QUERY_DURATION),
    getToken(PRISMA_QUERY_TOTAL),
    PRISMA_QUERY_DURATION_TOKEN,
    PRISMA_QUERY_TOTAL_TOKEN,
    getToken(TUSHARE_SYNC_DURATION),
    getToken(TUSHARE_SYNC_TOTAL),
    getToken(TUSHARE_SYNC_ROUND_DURATION),
    getToken(TUSHARE_SYNC_ROUND_TASKS),
    getToken(CACHE_OPERATIONS_TOTAL),
  ],
})
export class MetricsModule {}
