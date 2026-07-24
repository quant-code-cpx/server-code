import { ConfigType, registerAs } from '@nestjs/config'

export const AGENT_CONTEXT_CONFIG_TOKEN = 'agentContext'

export interface AgentContextConfigEnvironment {
  AGENT_CONTEXT_MAX_TOKENS?: string
  AGENT_RECENT_MESSAGE_COUNT?: string
  AGENT_PAGE_CONTEXT_MAX_BYTES?: string
  AGENT_SUMMARY_ENABLED?: string
  AGENT_SUMMARY_MIN_MESSAGE_COUNT?: string
  AGENT_SUMMARY_TRIGGER_TOKENS?: string
  AGENT_SUMMARY_MAX_SOURCE_TOKENS?: string
  AGENT_SUMMARY_MAX_MESSAGE_COUNT?: string
  AGENT_SUMMARY_MAX_OUTPUT_TOKENS?: string
}

export function buildAgentContextConfig(env: AgentContextConfigEnvironment) {
  const summaryMinMessageCount = parseInteger(
    env.AGENT_SUMMARY_MIN_MESSAGE_COUNT,
    'AGENT_SUMMARY_MIN_MESSAGE_COUNT',
    8,
    2,
    100,
  )
  const summaryTriggerTokens = parseInteger(
    env.AGENT_SUMMARY_TRIGGER_TOKENS,
    'AGENT_SUMMARY_TRIGGER_TOKENS',
    2_048,
    128,
    1_000_000,
  )
  const summaryMaxSourceTokens = parseInteger(
    env.AGENT_SUMMARY_MAX_SOURCE_TOKENS,
    'AGENT_SUMMARY_MAX_SOURCE_TOKENS',
    8_192,
    128,
    1_000_000,
  )
  const summaryMaxMessageCount = parseInteger(
    env.AGENT_SUMMARY_MAX_MESSAGE_COUNT,
    'AGENT_SUMMARY_MAX_MESSAGE_COUNT',
    500,
    2,
    5_000,
  )
  if (summaryMaxSourceTokens < summaryTriggerTokens) {
    throw new Error('[AgentContext] AGENT_SUMMARY_MAX_SOURCE_TOKENS 不能小于 AGENT_SUMMARY_TRIGGER_TOKENS')
  }
  if (summaryMaxMessageCount < summaryMinMessageCount) {
    throw new Error('[AgentContext] AGENT_SUMMARY_MAX_MESSAGE_COUNT 不能小于 AGENT_SUMMARY_MIN_MESSAGE_COUNT')
  }
  return {
    maxTokens: parseInteger(env.AGENT_CONTEXT_MAX_TOKENS, 'AGENT_CONTEXT_MAX_TOKENS', 16_384, 128, 1_000_000),
    recentMessageCount: parseInteger(env.AGENT_RECENT_MESSAGE_COUNT, 'AGENT_RECENT_MESSAGE_COUNT', 20, 1, 100),
    maxPageContextBytes: parseInteger(
      env.AGENT_PAGE_CONTEXT_MAX_BYTES,
      'AGENT_PAGE_CONTEXT_MAX_BYTES',
      20_000,
      256,
      1_000_000,
    ),
    summaryEnabled: env.AGENT_SUMMARY_ENABLED !== 'false',
    summaryMinMessageCount,
    summaryTriggerTokens,
    summaryMaxSourceTokens,
    summaryMaxMessageCount,
    summaryMaxOutputTokens: parseInteger(
      env.AGENT_SUMMARY_MAX_OUTPUT_TOKENS,
      'AGENT_SUMMARY_MAX_OUTPUT_TOKENS',
      1_024,
      128,
      8_192,
    ),
  }
}

export const AgentContextConfig = registerAs(AGENT_CONTEXT_CONFIG_TOKEN, () => buildAgentContextConfig(process.env))

export type IAgentContextConfig = ConfigType<typeof AgentContextConfig>

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
    throw new Error(`[AgentContext] ${name} 必须是 ${minimum}-${maximum} 的整数`)
  }
  return value
}
