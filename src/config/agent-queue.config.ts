import { ConfigType, registerAs } from '@nestjs/config'

export const AGENT_QUEUE_CONFIG_TOKEN = 'agentQueue'

export interface AgentQueueConfigEnvironment {
  AGENT_QUEUE_REDIS_URL?: string
  AGENT_QUEUE_PREFIX?: string
  AGENT_WORKER_CONCURRENCY?: string
  AGENT_JOB_TIMEOUT_MS?: string
  AGENT_JOB_ATTEMPTS?: string
  AGENT_JOB_BACKOFF_MS?: string
  AGENT_RECONCILE_INTERVAL_MS?: string
  AGENT_RECONCILE_BATCH_SIZE?: string
}

export function buildAgentQueueConfig(env: AgentQueueConfigEnvironment) {
  const redisUrl = env.AGENT_QUEUE_REDIS_URL?.trim() || null
  if (redisUrl) validateRedisUrl(redisUrl)
  const prefix = env.AGENT_QUEUE_PREFIX?.trim() || 'quant:agent'
  if (prefix.length > 100) throw new Error('[AgentQueue] AGENT_QUEUE_PREFIX 最长 100 字符')

  return {
    redisUrl,
    prefix,
    workerConcurrency: parseInteger(env.AGENT_WORKER_CONCURRENCY, 'AGENT_WORKER_CONCURRENCY', 2, 1, 50),
    jobTimeoutMs: parseInteger(env.AGENT_JOB_TIMEOUT_MS, 'AGENT_JOB_TIMEOUT_MS', 180_000, 10_000, 86_400_000),
    jobAttempts: parseInteger(env.AGENT_JOB_ATTEMPTS, 'AGENT_JOB_ATTEMPTS', 5, 1, 20),
    jobBackoffMs: parseInteger(env.AGENT_JOB_BACKOFF_MS, 'AGENT_JOB_BACKOFF_MS', 2_000, 100, 300_000),
    reconcileIntervalMs: parseInteger(
      env.AGENT_RECONCILE_INTERVAL_MS,
      'AGENT_RECONCILE_INTERVAL_MS',
      10_000,
      1_000,
      300_000,
    ),
    reconcileBatchSize: parseInteger(env.AGENT_RECONCILE_BATCH_SIZE, 'AGENT_RECONCILE_BATCH_SIZE', 100, 1, 1_000),
  }
}

export const AgentQueueConfig = registerAs(AGENT_QUEUE_CONFIG_TOKEN, () => buildAgentQueueConfig(process.env))
export type IAgentQueueConfig = ConfigType<typeof AgentQueueConfig>

function validateRedisUrl(value: string): void {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('[AgentQueue] AGENT_QUEUE_REDIS_URL 格式非法')
  }
  if (!['redis:', 'rediss:'].includes(url.protocol) || !url.hostname) {
    throw new Error('[AgentQueue] AGENT_QUEUE_REDIS_URL 仅支持 redis:// 或 rediss://')
  }
}

function parseInteger(
  raw: string | undefined,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (!raw?.trim()) return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`[AgentQueue] ${name} 必须是 ${minimum}-${maximum} 的整数`)
  }
  return value
}
