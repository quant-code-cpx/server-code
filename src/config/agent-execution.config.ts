import { ConfigType, registerAs } from '@nestjs/config'

export const AGENT_EXECUTION_CONFIG_TOKEN = 'agentExecution'

export interface AgentExecutionConfigEnvironment {
  AGENT_RUN_LEASE_MS?: string
  AGENT_EVENT_REPLAY_LIMIT?: string
  AGENT_RUN_MAX_DURATION_MS?: string
}

export function buildAgentExecutionConfig(env: AgentExecutionConfigEnvironment) {
  return {
    leaseMs: parseInteger(env.AGENT_RUN_LEASE_MS, 'AGENT_RUN_LEASE_MS', 30_000, 1_000, 300_000),
    replayLimit: parseInteger(env.AGENT_EVENT_REPLAY_LIMIT, 'AGENT_EVENT_REPLAY_LIMIT', 100, 1, 1_000),
    maxDurationMs: parseInteger(
      env.AGENT_RUN_MAX_DURATION_MS,
      'AGENT_RUN_MAX_DURATION_MS',
      180_000,
      10_000,
      86_400_000,
    ),
  }
}

export const AgentExecutionConfig = registerAs(AGENT_EXECUTION_CONFIG_TOKEN, () =>
  buildAgentExecutionConfig(process.env),
)

export type IAgentExecutionConfig = ConfigType<typeof AgentExecutionConfig>

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
    throw new Error(`[AgentExecution] ${name} 必须是 ${minimum}-${maximum} 的整数`)
  }
  return value
}
