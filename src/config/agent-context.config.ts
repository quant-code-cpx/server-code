import { ConfigType, registerAs } from '@nestjs/config'

export const AGENT_CONTEXT_CONFIG_TOKEN = 'agentContext'

export interface AgentContextConfigEnvironment {
  AGENT_PAGE_CONTEXT_MAX_BYTES?: string
  AGENT_SUMMARY_ENABLED?: string
  AGENT_CONTEXT_SAFETY_RATIO?: string
  AGENT_CONTEXT_COMPACTION_TRIGGER_RATIO?: string
  AGENT_CONTEXT_COMPACTION_TARGET_RATIO?: string
  AGENT_CONTEXT_OUTPUT_RESERVE_RATIO?: string
  AGENT_SUMMARY_OUTPUT_RESERVE_RATIO?: string
  AGENT_SUMMARY_RUN_INPUT_RATIO?: string
  AGENT_CONTEXT_QUERY_PAGE_SIZE?: string
}

export function buildAgentContextConfig(env: AgentContextConfigEnvironment) {
  const compactionTriggerRatio = parseRatio(
    env.AGENT_CONTEXT_COMPACTION_TRIGGER_RATIO,
    'AGENT_CONTEXT_COMPACTION_TRIGGER_RATIO',
    0.75,
    0.5,
    0.95,
  )
  const compactionTargetRatio = parseRatio(
    env.AGENT_CONTEXT_COMPACTION_TARGET_RATIO,
    'AGENT_CONTEXT_COMPACTION_TARGET_RATIO',
    0.5,
    0.2,
    0.9,
  )
  if (compactionTargetRatio >= compactionTriggerRatio) {
    throw new Error('[AgentContext] AGENT_CONTEXT_COMPACTION_TARGET_RATIO 必须小于触发比例')
  }
  return {
    maxPageContextBytes: parseInteger(
      env.AGENT_PAGE_CONTEXT_MAX_BYTES,
      'AGENT_PAGE_CONTEXT_MAX_BYTES',
      20_000,
      256,
      1_000_000,
    ),
    summaryEnabled: env.AGENT_SUMMARY_ENABLED !== 'false',
    safetyRatio: parseRatio(env.AGENT_CONTEXT_SAFETY_RATIO, 'AGENT_CONTEXT_SAFETY_RATIO', 0.08, 0.01, 0.3),
    compactionTriggerRatio,
    compactionTargetRatio,
    outputReserveRatio: parseRatio(
      env.AGENT_CONTEXT_OUTPUT_RESERVE_RATIO,
      'AGENT_CONTEXT_OUTPUT_RESERVE_RATIO',
      0.15,
      0.01,
      0.4,
    ),
    summaryOutputReserveRatio: parseRatio(
      env.AGENT_SUMMARY_OUTPUT_RESERVE_RATIO,
      'AGENT_SUMMARY_OUTPUT_RESERVE_RATIO',
      0.05,
      0.01,
      0.3,
    ),
    summaryRunInputRatio: parseRatio(
      env.AGENT_SUMMARY_RUN_INPUT_RATIO,
      'AGENT_SUMMARY_RUN_INPUT_RATIO',
      0.25,
      0.05,
      0.5,
    ),
    queryPageSize: parseInteger(env.AGENT_CONTEXT_QUERY_PAGE_SIZE, 'AGENT_CONTEXT_QUERY_PAGE_SIZE', 100, 10, 1_000),
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

function parseRatio(raw: string | undefined, name: string, fallback: number, minimum: number, maximum: number): number {
  if (!raw?.trim()) return fallback
  const value = Number(raw)
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`[AgentContext] ${name} 必须是 ${minimum}-${maximum} 的有限小数`)
  }
  return value
}
