import { ConfigType, registerAs } from '@nestjs/config'

export const AGENT_EXECUTION_CONFIG_TOKEN = 'agentExecution'

export interface AgentExecutionConfigEnvironment {
  AGENT_RUN_LEASE_MS?: string
  AGENT_LEASE_HEARTBEAT_MS?: string
  AGENT_EVENT_REPLAY_LIMIT?: string
  AGENT_RUN_FALLBACK_DURATION_MS?: string
  AGENT_RUN_NON_MODEL_RESERVE_MS?: string
  AGENT_RUN_MAX_DURATION_MS?: string
  AGENT_MAX_STEPS?: string
  AGENT_MAX_TOOL_CALLS?: string
  AGENT_MAX_PARALLEL_TOOLS?: string
  AGENT_RUN_MAX_CUMULATIVE_INPUT_TOKENS?: string
  /** @deprecated 仅用于旧部署平滑迁移。 */
  AGENT_MAX_INPUT_TOKENS?: string
  AGENT_MAX_COST_PER_RUN?: string
}

export function buildAgentExecutionConfig(env: AgentExecutionConfigEnvironment) {
  if (env.AGENT_RUN_MAX_CUMULATIVE_INPUT_TOKENS?.trim() && env.AGENT_MAX_INPUT_TOKENS?.trim()) {
    throw new Error(
      '[AgentExecution] AGENT_RUN_MAX_CUMULATIVE_INPUT_TOKENS 与已弃用的 AGENT_MAX_INPUT_TOKENS 不能同时配置',
    )
  }
  const leaseMs = parseInteger(env.AGENT_RUN_LEASE_MS, 'AGENT_RUN_LEASE_MS', 30_000, 1_000, 300_000)
  const leaseHeartbeatMs = parseInteger(
    env.AGENT_LEASE_HEARTBEAT_MS,
    'AGENT_LEASE_HEARTBEAT_MS',
    Math.max(250, Math.floor(leaseMs / 3)),
    250,
    299_999,
  )
  if (leaseHeartbeatMs >= leaseMs) {
    throw new Error('[AgentExecution] AGENT_LEASE_HEARTBEAT_MS 必须小于 AGENT_RUN_LEASE_MS')
  }
  const maxDurationMs = parseInteger(
    env.AGENT_RUN_MAX_DURATION_MS,
    'AGENT_RUN_MAX_DURATION_MS',
    10_800_000,
    10_000,
    86_400_000,
  )
  const fallbackDurationMs = parseInteger(
    env.AGENT_RUN_FALLBACK_DURATION_MS,
    'AGENT_RUN_FALLBACK_DURATION_MS',
    180_000,
    10_000,
    86_400_000,
  )
  const nonModelReserveMs = parseInteger(
    env.AGENT_RUN_NON_MODEL_RESERVE_MS,
    'AGENT_RUN_NON_MODEL_RESERVE_MS',
    60_000,
    0,
    86_400_000,
  )
  if (fallbackDurationMs > maxDurationMs) {
    throw new Error('[AgentExecution] AGENT_RUN_FALLBACK_DURATION_MS 不能大于 AGENT_RUN_MAX_DURATION_MS')
  }
  if (nonModelReserveMs > maxDurationMs) {
    throw new Error('[AgentExecution] AGENT_RUN_NON_MODEL_RESERVE_MS 不能大于 AGENT_RUN_MAX_DURATION_MS')
  }
  return {
    leaseMs,
    leaseHeartbeatMs,
    replayLimit: parseInteger(env.AGENT_EVENT_REPLAY_LIMIT, 'AGENT_EVENT_REPLAY_LIMIT', 100, 1, 1_000),
    fallbackDurationMs,
    nonModelReserveMs,
    maxDurationMs,
    maxSteps: parseInteger(env.AGENT_MAX_STEPS, 'AGENT_MAX_STEPS', 32, 8, 1_000),
    maxToolCalls: parseInteger(env.AGENT_MAX_TOOL_CALLS, 'AGENT_MAX_TOOL_CALLS', 20, 0, 1_000),
    maxParallelTools: parseInteger(env.AGENT_MAX_PARALLEL_TOOLS, 'AGENT_MAX_PARALLEL_TOOLS', 3, 1, 50),
    maxCumulativeInputTokens: parseOptionalInteger(
      env.AGENT_RUN_MAX_CUMULATIVE_INPUT_TOKENS ?? env.AGENT_MAX_INPUT_TOKENS,
      env.AGENT_RUN_MAX_CUMULATIVE_INPUT_TOKENS?.trim()
        ? 'AGENT_RUN_MAX_CUMULATIVE_INPUT_TOKENS'
        : 'AGENT_MAX_INPUT_TOKENS',
      1,
      100_000_000,
    ),
    inputTokenGuardrailSource: env.AGENT_RUN_MAX_CUMULATIVE_INPUT_TOKENS?.trim()
      ? ('ENV' as const)
      : env.AGENT_MAX_INPUT_TOKENS?.trim()
        ? ('LEGACY_ENV' as const)
        : ('DISABLED_BY_DEFAULT' as const),
    maxCostPerRun: parseNumber(env.AGENT_MAX_COST_PER_RUN, 'AGENT_MAX_COST_PER_RUN', 10, 0, 1_000_000),
  }
}

function parseOptionalInteger(raw: string | undefined, name: string, minimum: number, maximum: number): number | null {
  if (!raw?.trim()) return null
  const value = Number(raw)
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`[AgentExecution] ${name} 必须是 ${minimum}-${maximum} 的整数`)
  }
  return value
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

function parseNumber(
  raw: string | undefined,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (!raw?.trim()) return fallback
  const value = Number(raw)
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`[AgentExecution] ${name} 必须是 ${minimum}-${maximum} 的有限数值`)
  }
  return value
}
