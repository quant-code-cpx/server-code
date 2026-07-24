import { ConfigType, registerAs } from '@nestjs/config'

export const CRON_LOCK_CONFIG_TOKEN = 'cronLock'

export interface CronLockConfigEnvironment {
  CRON_LOCK_PREFIX?: string
  CRON_LOCK_TTL_MS?: string
}

export function buildCronLockConfig(env: CronLockConfigEnvironment) {
  const prefix = env.CRON_LOCK_PREFIX?.trim() || 'quant:cron-lock'
  if (!/^[A-Za-z0-9:_-]+$/.test(prefix)) {
    throw new Error('[CronLock] CRON_LOCK_PREFIX 只能包含字母、数字、冒号、下划线和连字符')
  }

  return {
    prefix,
    ttlMs: parseInteger(env.CRON_LOCK_TTL_MS, 'CRON_LOCK_TTL_MS', 300_000, 5_000, 3_600_000),
  }
}

export const CronLockConfig = registerAs(CRON_LOCK_CONFIG_TOKEN, () => buildCronLockConfig(process.env))
export type ICronLockConfig = ConfigType<typeof CronLockConfig>

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
    throw new Error(`[CronLock] ${name} 必须是 ${minimum}-${maximum} 的整数`)
  }
  return value
}
