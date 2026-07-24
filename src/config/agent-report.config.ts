import { ConfigType, registerAs } from '@nestjs/config'

export const AGENT_REPORT_CONFIG_TOKEN = 'agentReport'

export interface AgentReportConfigEnvironment {
  NODE_ENV?: string
  AGENT_REPORT_STORAGE_DRIVER?: string
  AGENT_REPORT_STORAGE_LOCAL_PATH?: string
  AGENT_REPORT_CONFIRMATION_SECRET?: string
  AGENT_REPORT_CONFIRMATION_TTL_SECONDS?: string
  AGENT_REPORT_RECONCILE_INTERVAL_MS?: string
  AGENT_REPORT_RECONCILE_BATCH_SIZE?: string
}

export function buildAgentReportConfig(env: AgentReportConfigEnvironment) {
  const driver = (env.AGENT_REPORT_STORAGE_DRIVER ?? 'local').trim().toLowerCase()
  if (driver !== 'local' && driver !== 's3') {
    throw new Error('[AgentReport] AGENT_REPORT_STORAGE_DRIVER 仅支持 local 或 s3')
  }
  const configuredSecret = env.AGENT_REPORT_CONFIRMATION_SECRET?.trim()
  if (env.NODE_ENV === 'production' && (!configuredSecret || configuredSecret.length < 32)) {
    throw new Error('[AgentReport] 生产环境必须配置至少 32 字符的 AGENT_REPORT_CONFIRMATION_SECRET')
  }
  return {
    storageDriver: driver as 'local' | 's3',
    localStoragePath: (env.AGENT_REPORT_STORAGE_LOCAL_PATH ?? 'storage/agent-reports').trim(),
    confirmationSecret: configuredSecret || 'development-only-agent-report-confirmation-secret-change-me',
    confirmationTtlSeconds: parseInteger(
      env.AGENT_REPORT_CONFIRMATION_TTL_SECONDS,
      'AGENT_REPORT_CONFIRMATION_TTL_SECONDS',
      600,
      60,
      3_600,
    ),
    reconcileIntervalMs: parseInteger(
      env.AGENT_REPORT_RECONCILE_INTERVAL_MS,
      'AGENT_REPORT_RECONCILE_INTERVAL_MS',
      15_000,
      1_000,
      300_000,
    ),
    reconcileBatchSize: parseInteger(
      env.AGENT_REPORT_RECONCILE_BATCH_SIZE,
      'AGENT_REPORT_RECONCILE_BATCH_SIZE',
      50,
      1,
      500,
    ),
  }
}

export const AgentReportConfig = registerAs(AGENT_REPORT_CONFIG_TOKEN, () => buildAgentReportConfig(process.env))

export type IAgentReportConfig = ConfigType<typeof AgentReportConfig>

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
    throw new Error(`[AgentReport] ${name} 必须是 ${minimum}-${maximum} 的整数`)
  }
  return value
}
