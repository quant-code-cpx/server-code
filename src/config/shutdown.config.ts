import { ConfigType, registerAs } from '@nestjs/config'

export const SHUTDOWN_CONFIG_TOKEN = 'shutdown'

export interface ShutdownConfigEnvironment {
  SHUTDOWN_GRACE_MS?: string
}

export function buildShutdownConfig(env: ShutdownConfigEnvironment) {
  return {
    graceMs: parseGraceMs(env.SHUTDOWN_GRACE_MS),
  }
}

export const ShutdownConfig = registerAs(SHUTDOWN_CONFIG_TOKEN, () => buildShutdownConfig(process.env))
export type IShutdownConfig = ConfigType<typeof ShutdownConfig>

function parseGraceMs(raw: string | undefined): number {
  if (!raw?.trim()) return 5_000
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 0 || value > 120_000) {
    throw new Error('[Shutdown] SHUTDOWN_GRACE_MS 必须是 0-120000 的整数')
  }
  return value
}
