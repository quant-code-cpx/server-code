import { ConfigType, registerAs } from '@nestjs/config'

export const AGENT_STREAM_CONFIG_TOKEN = 'agentStream'

export interface AgentStreamConfigEnvironment {
  AGENT_SSE_HEARTBEAT_MS?: string
  AGENT_SSE_IDLE_TIMEOUT_MS?: string
  AGENT_SSE_MAX_CONNECTIONS_PER_USER?: string
  AGENT_SSE_MAX_BUFFER_BYTES?: string
}

export function buildAgentStreamConfig(env: AgentStreamConfigEnvironment) {
  const heartbeatMs = parseInteger(env.AGENT_SSE_HEARTBEAT_MS, 'AGENT_SSE_HEARTBEAT_MS', 15_000, 1_000, 60_000)
  const idleTimeoutMs = parseInteger(
    env.AGENT_SSE_IDLE_TIMEOUT_MS,
    'AGENT_SSE_IDLE_TIMEOUT_MS',
    300_000,
    10_000,
    3_600_000,
  )
  if (idleTimeoutMs <= heartbeatMs) {
    throw new Error('[AgentStream] AGENT_SSE_IDLE_TIMEOUT_MS 必须大于 AGENT_SSE_HEARTBEAT_MS')
  }
  return {
    heartbeatMs,
    idleTimeoutMs,
    maxConnectionsPerUser: parseInteger(
      env.AGENT_SSE_MAX_CONNECTIONS_PER_USER,
      'AGENT_SSE_MAX_CONNECTIONS_PER_USER',
      3,
      1,
      20,
    ),
    maxBufferBytes: parseInteger(
      env.AGENT_SSE_MAX_BUFFER_BYTES,
      'AGENT_SSE_MAX_BUFFER_BYTES',
      1_048_576,
      16_384,
      16_777_216,
    ),
    pollIntervalMs: Math.min(250, Math.max(50, Math.floor(heartbeatMs / 10))),
  }
}

export const AgentStreamConfig = registerAs(AGENT_STREAM_CONFIG_TOKEN, () => buildAgentStreamConfig(process.env))

export type IAgentStreamConfig = ConfigType<typeof AgentStreamConfig>

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
    throw new Error(`[AgentStream] ${name} 必须是 ${minimum}-${maximum} 的整数`)
  }
  return value
}
