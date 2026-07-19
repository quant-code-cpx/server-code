import { ConfigType, registerAs } from '@nestjs/config'
import { AGENT_TOOL_KEYS, type AgentToolKey, isAgentToolKey } from 'src/apps/agent/contracts'

export const AGENT_TOOLS_CONFIG_TOKEN = 'agentTools'

export interface AgentToolsConfigEnvironment {
  AGENT_TOOLS_ENABLED?: string
  AGENT_TOOL_MAX_CALLS_PER_RUN?: string
  AGENT_TOOL_DEFAULT_TIMEOUT_MS?: string
  AGENT_TOOL_MAX_RESULT_BYTES?: string
  AGENT_TOOL_MAX_CONCURRENT_PER_RUN?: string
  AGENT_TOOL_PRICE_MAX_BARS?: string
  AGENT_TOOL_MARKET_CACHE_TTL_SECONDS?: string
}

export function buildAgentToolsConfig(env: AgentToolsConfigEnvironment) {
  return {
    enabledTools: parseToolAllowlist(env.AGENT_TOOLS_ENABLED),
    maxCallsPerRun: parseInteger(env.AGENT_TOOL_MAX_CALLS_PER_RUN, 'AGENT_TOOL_MAX_CALLS_PER_RUN', 20, 1, 1_000),
    defaultTimeoutMs: parseInteger(
      env.AGENT_TOOL_DEFAULT_TIMEOUT_MS,
      'AGENT_TOOL_DEFAULT_TIMEOUT_MS',
      10_000,
      100,
      120_000,
    ),
    maxResultBytes: parseInteger(
      env.AGENT_TOOL_MAX_RESULT_BYTES,
      'AGENT_TOOL_MAX_RESULT_BYTES',
      256_000,
      1_024,
      2_000_000,
    ),
    maxConcurrentPerRun: parseInteger(
      env.AGENT_TOOL_MAX_CONCURRENT_PER_RUN,
      'AGENT_TOOL_MAX_CONCURRENT_PER_RUN',
      3,
      1,
      50,
    ),
    priceMaxBars: parseInteger(env.AGENT_TOOL_PRICE_MAX_BARS, 'AGENT_TOOL_PRICE_MAX_BARS', 5_000, 1, 5_000),
    marketCacheTtlSeconds: parseInteger(
      env.AGENT_TOOL_MARKET_CACHE_TTL_SECONDS,
      'AGENT_TOOL_MARKET_CACHE_TTL_SECONDS',
      300,
      1,
      86_400,
    ),
  }
}

export const AgentToolsConfig = registerAs(AGENT_TOOLS_CONFIG_TOKEN, () => buildAgentToolsConfig(process.env))

export type IAgentToolsConfig = ConfigType<typeof AgentToolsConfig>

function parseToolAllowlist(raw: string | undefined): AgentToolKey[] {
  if (!raw?.trim()) return []
  const values = [
    ...new Set(
      raw
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ]
  for (const value of values) {
    if (!isAgentToolKey(value)) {
      throw new Error(`[AgentTools] AGENT_TOOLS_ENABLED 包含未知 Tool：${value}`)
    }
  }
  return AGENT_TOOL_KEYS.filter((key) => values.includes(key))
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
    throw new Error(`[AgentTools] ${name} 必须是 ${minimum}-${maximum} 的整数`)
  }
  return value
}
