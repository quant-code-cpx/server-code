// HTTP
export const HTTP_REQUEST_DURATION = 'http_request_duration_seconds'
export const HTTP_REQUEST_TOTAL = 'http_requests_total'
export const HTTP_REQUEST_ERRORS = 'http_request_errors_total'

// BullMQ
export const BULLMQ_QUEUE_DEPTH = 'bullmq_queue_depth'
export const BULLMQ_ACTIVE_JOBS = 'bullmq_active_jobs'
export const BULLMQ_FAILED_JOBS = 'bullmq_failed_jobs'
export const BULLMQ_DELAYED_JOBS = 'bullmq_delayed_jobs'
export const BULLMQ_STALLED_JOBS_TOTAL = 'bullmq_stalled_jobs_total'
export const BULLMQ_ENQUEUE_LAG = 'bullmq_enqueue_lag_seconds'
export const AGENT_RUN_RECOVERY_TOTAL = 'agent_run_recovery_total'
export const AGENT_SSE_ACTIVE_CONNECTIONS = 'agent_sse_active_connections'
export const AGENT_SSE_CONNECTIONS_TOTAL = 'agent_sse_connections_total'
export const AGENT_SSE_EVENTS_TOTAL = 'agent_sse_events_total'
export const AGENT_SSE_BYTES_TOTAL = 'agent_sse_bytes_total'
export const AGENT_SSE_DURATION = 'agent_sse_duration_seconds'
export const AGENT_SSE_REPLAY_LAG = 'agent_sse_replay_lag_events'
export const AGENT_SSE_DISCONNECTS_TOTAL = 'agent_sse_disconnects_total'

// Prisma
export const PRISMA_QUERY_DURATION = 'prisma_query_duration_seconds'
export const PRISMA_QUERY_TOTAL = 'prisma_queries_total'

// Prisma — DI token（供 PrismaService @Optional @Inject 使用）
export const PRISMA_QUERY_DURATION_TOKEN = 'PRISMA_QUERY_DURATION_HISTOGRAM'
export const PRISMA_QUERY_TOTAL_TOKEN = 'PRISMA_QUERY_TOTAL_COUNTER'

// Tushare Sync
export const TUSHARE_SYNC_DURATION = 'tushare_sync_duration_seconds'
export const TUSHARE_SYNC_TOTAL = 'tushare_sync_tasks_total'
export const TUSHARE_SYNC_ROUND_DURATION = 'tushare_sync_round_duration_seconds'
export const TUSHARE_SYNC_ROUND_TASKS = 'tushare_sync_round_tasks'

// Cache
export const CACHE_OPERATIONS_TOTAL = 'cache_operations_total'
