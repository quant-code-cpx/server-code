import { ConfigType, registerAs } from '@nestjs/config'

export const AGENT_API_CONFIG_TOKEN = 'agentApi'

export interface AgentApiConfigEnvironment {
  AGENT_MAX_ACTIVE_RUNS_PER_USER?: string
  AGENT_DEFAULT_DAILY_BUDGET?: string
}

export function buildAgentApiConfig(env: AgentApiConfigEnvironment, nodeEnv = 'development') {
  const requireExplicit = nodeEnv === 'production'
  return {
    maxActiveRunsPerUser: parseInteger(
      env.AGENT_MAX_ACTIVE_RUNS_PER_USER,
      'AGENT_MAX_ACTIVE_RUNS_PER_USER',
      3,
      1,
      100,
      requireExplicit,
    ),
    defaultDailyBudget: parseNumber(
      env.AGENT_DEFAULT_DAILY_BUDGET,
      'AGENT_DEFAULT_DAILY_BUDGET',
      20,
      0,
      1_000_000,
      requireExplicit,
    ),
  }
}

export const AgentApiConfig = registerAs(AGENT_API_CONFIG_TOKEN, () =>
  buildAgentApiConfig(process.env, process.env.NODE_ENV),
)

export type IAgentApiConfig = ConfigType<typeof AgentApiConfig>

function parseInteger(
  raw: string | undefined,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
  requireExplicit: boolean,
): number {
  if (!raw?.trim()) {
    if (requireExplicit) throw new Error(`[AgentApi] 生产环境必须显式配置 ${name}`)
    return fallback
  }
  const value = Number(raw)
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`[AgentApi] ${name} 必须是 ${minimum}-${maximum} 的整数`)
  }
  return value
}

function parseNumber(
  raw: string | undefined,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
  requireExplicit: boolean,
): number {
  if (!raw?.trim()) {
    if (requireExplicit) throw new Error(`[AgentApi] 生产环境必须显式配置 ${name}`)
    return fallback
  }
  const value = Number(raw)
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`[AgentApi] ${name} 必须是 ${minimum}-${maximum} 的有限数值`)
  }
  return value
}
