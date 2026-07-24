import { ConfigType, registerAs } from '@nestjs/config'

export const AGENT_NOTIFICATION_CONFIG_TOKEN = 'agentNotification'

export interface AgentNotificationConfigEnvironment {
  NOTIFICATION_ENCRYPTION_KEY?: string
  NOTIFICATION_ENCRYPTION_KEYS?: string
  NOTIFICATION_ENCRYPTION_ACTIVE_KEY_VERSION?: string
  NOTIFICATION_WEBHOOK_ALLOWED_HOSTS?: string
  NOTIFICATION_DELIVERY_TIMEOUT_MS?: string
  NOTIFICATION_DELIVERY_MAX_ATTEMPTS?: string
  NOTIFICATION_DELIVERY_BACKOFF_MS?: string
  NOTIFICATION_DELIVERY_LEASE_MS?: string
  NOTIFICATION_DELIVERY_RECONCILE_INTERVAL_MS?: string
  NOTIFICATION_DELIVERY_RECONCILE_BATCH_SIZE?: string
  NOTIFICATION_WORKER_CONCURRENCY?: string
}

export function buildAgentNotificationConfig(env: AgentNotificationConfigEnvironment) {
  const encryptionKeys = parseEncryptionKeys(env)
  const requestedVersion = parseOptionalInteger(
    env.NOTIFICATION_ENCRYPTION_ACTIVE_KEY_VERSION,
    'NOTIFICATION_ENCRYPTION_ACTIVE_KEY_VERSION',
    1,
    65_535,
  )
  const activeEncryptionKeyVersion =
    encryptionKeys.size === 0 ? null : (requestedVersion ?? [...encryptionKeys.keys()][0])
  if (activeEncryptionKeyVersion !== null && !encryptionKeys.has(activeEncryptionKeyVersion)) {
    throw new Error('[AgentNotification] active encryption key version 不存在')
  }

  return {
    encryptionKeys,
    activeEncryptionKeyVersion,
    webhookAllowedHosts: parseAllowedHosts(env.NOTIFICATION_WEBHOOK_ALLOWED_HOSTS),
    deliveryTimeoutMs: parseInteger(
      env.NOTIFICATION_DELIVERY_TIMEOUT_MS,
      'NOTIFICATION_DELIVERY_TIMEOUT_MS',
      10_000,
      1_000,
      120_000,
    ),
    deliveryMaxAttempts: parseInteger(
      env.NOTIFICATION_DELIVERY_MAX_ATTEMPTS,
      'NOTIFICATION_DELIVERY_MAX_ATTEMPTS',
      5,
      1,
      20,
    ),
    deliveryBackoffMs: parseInteger(
      env.NOTIFICATION_DELIVERY_BACKOFF_MS,
      'NOTIFICATION_DELIVERY_BACKOFF_MS',
      2_000,
      100,
      300_000,
    ),
    deliveryLeaseMs: parseInteger(
      env.NOTIFICATION_DELIVERY_LEASE_MS,
      'NOTIFICATION_DELIVERY_LEASE_MS',
      120_000,
      5_000,
      900_000,
    ),
    reconcileIntervalMs: parseInteger(
      env.NOTIFICATION_DELIVERY_RECONCILE_INTERVAL_MS,
      'NOTIFICATION_DELIVERY_RECONCILE_INTERVAL_MS',
      5_000,
      1_000,
      300_000,
    ),
    reconcileBatchSize: parseInteger(
      env.NOTIFICATION_DELIVERY_RECONCILE_BATCH_SIZE,
      'NOTIFICATION_DELIVERY_RECONCILE_BATCH_SIZE',
      100,
      1,
      1_000,
    ),
    workerConcurrency: parseInteger(env.NOTIFICATION_WORKER_CONCURRENCY, 'NOTIFICATION_WORKER_CONCURRENCY', 2, 1, 50),
  }
}

export const AgentNotificationConfig = registerAs(AGENT_NOTIFICATION_CONFIG_TOKEN, () =>
  buildAgentNotificationConfig(process.env),
)
export type IAgentNotificationConfig = ConfigType<typeof AgentNotificationConfig>

function parseEncryptionKeys(env: AgentNotificationConfigEnvironment): ReadonlyMap<number, Buffer> {
  const raw = env.NOTIFICATION_ENCRYPTION_KEYS?.trim()
  const entries = raw
    ? raw
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean)
    : env.NOTIFICATION_ENCRYPTION_KEY?.trim()
      ? [`1:${env.NOTIFICATION_ENCRYPTION_KEY.trim()}`]
      : []
  const keys = new Map<number, Buffer>()
  for (const entry of entries) {
    const separator = entry.indexOf(':')
    if (separator <= 0 || separator === entry.length - 1) {
      throw new Error('[AgentNotification] NOTIFICATION_ENCRYPTION_KEYS 格式应为 version:base64Key')
    }
    const version = parseInteger(entry.slice(0, separator), 'NOTIFICATION_ENCRYPTION_KEYS version', 1, 1, 65_535)
    const encoded = entry.slice(separator + 1)
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
      throw new Error('[AgentNotification] encryption key 必须是 base64')
    }
    const key = Buffer.from(encoded, 'base64')
    if (key.length !== 32) throw new Error('[AgentNotification] encryption key 必须解码为 32 bytes')
    if (keys.has(version)) throw new Error('[AgentNotification] encryption key version 重复')
    keys.set(version, key)
  }
  return keys
}

function parseAllowedHosts(raw: string | undefined): readonly string[] {
  if (!raw?.trim()) return []
  const hosts = raw
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
  for (const host of hosts) {
    try {
      const parsed = new URL(`https://${host}`)
      if (parsed.hostname !== host || parsed.port || parsed.username || parsed.password) throw new Error('invalid')
    } catch {
      throw new Error('[AgentNotification] NOTIFICATION_WEBHOOK_ALLOWED_HOSTS 含非法域名')
    }
  }
  return Object.freeze([...new Set(hosts)])
}

function parseOptionalInteger(raw: string | undefined, name: string, minimum: number, maximum: number): number | null {
  if (!raw?.trim()) return null
  return parseInteger(raw, name, minimum, minimum, maximum)
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
    throw new Error(`[AgentNotification] ${name} 必须是 ${minimum}-${maximum} 的整数`)
  }
  return value
}
