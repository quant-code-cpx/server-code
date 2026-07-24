import { ConfigType, registerAs } from '@nestjs/config'

export const AGENT_SCHEDULER_CONFIG_TOKEN = 'agentScheduler'

export interface AgentSchedulerConfigEnvironment {
  SCHEDULER_ENABLED?: string
  AGENT_SCHEDULER_POLL_MS?: string
  AGENT_SCHEDULER_LEASE_MS?: string
  AGENT_SCHEDULER_BATCH_SIZE?: string
  AGENT_SCHEDULER_MAX_TASKS_PER_USER?: string
}

export function buildAgentSchedulerConfig(env: AgentSchedulerConfigEnvironment) {
  return {
    enabled: env.SCHEDULER_ENABLED === 'true',
    pollMs: parseInteger(env.AGENT_SCHEDULER_POLL_MS, 'AGENT_SCHEDULER_POLL_MS', 60_000, 1_000, 3_600_000),
    leaseMs: parseInteger(env.AGENT_SCHEDULER_LEASE_MS, 'AGENT_SCHEDULER_LEASE_MS', 120_000, 5_000, 3_600_000),
    batchSize: parseInteger(env.AGENT_SCHEDULER_BATCH_SIZE, 'AGENT_SCHEDULER_BATCH_SIZE', 100, 1, 1_000),
    maxTasksPerUser: parseInteger(
      env.AGENT_SCHEDULER_MAX_TASKS_PER_USER,
      'AGENT_SCHEDULER_MAX_TASKS_PER_USER',
      50,
      1,
      1_000,
    ),
  }
}

export const AgentSchedulerConfig = registerAs(AGENT_SCHEDULER_CONFIG_TOKEN, () =>
  buildAgentSchedulerConfig(process.env),
)

export type IAgentSchedulerConfig = ConfigType<typeof AgentSchedulerConfig>

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
    throw new Error(`[AgentScheduler] ${name} 必须是 ${minimum}-${maximum} 的整数`)
  }
  return value
}
