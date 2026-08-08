/**
 * Migration for model-provider secrets encrypted with the former
 * ACCESS_TOKEN_SECRET fallback. This script never runs from application code.
 *
 * The production migration image runs this after `prisma migrate deploy` and
 * before the application is allowed to start. It is a no-op when no encrypted
 * model keys exist. When encrypted keys exist, it fails closed unless the
 * current independent key is set; legacy ciphertext additionally requires the
 * previous key for a one-time re-encryption:
 *   AGENT_MODEL_DB_ENCRYPTION_KEY=<new-independent-key>
 *   AGENT_MODEL_DB_ENCRYPTION_LEGACY_KEY=<previous-key>
 *   pnpm run migrate:agent-model-encryption-key
 *
 * It preflights every encrypted value first, then rewrites legacy values in
 * legacy providers, V2 connections, and published V2 snapshots. Values already
 * encrypted with the new key are skipped, so a retry is safe after interruption.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { Prisma, PrismaClient } from '@prisma/client'

interface SecretEnvelope {
  iv: string
  tag: string
  ciphertext: string
}

interface EncryptedRecord {
  id: string
  encryptedApiKey: string | null
}

interface SecretUpdate {
  id: string
  current: string
  next: string
}

interface SnapshotUpdate {
  id: string
  next: Prisma.InputJsonValue
}

function readKey(envName: string, required: boolean): { raw: string; derived: Buffer } | null {
  const raw = process.env[envName]?.trim()
  if (!raw) {
    if (!required) return null
    throw new Error(`[AgentModel] ${envName} 必须为至少 32 字符的独立随机密钥`)
  }
  if (raw.length < 32) {
    throw new Error(`[AgentModel] ${envName} 必须为至少 32 字符的独立随机密钥`)
  }
  return { raw, derived: createHash('sha256').update(raw, 'utf8').digest() }
}

function decrypt(ciphertext: string, key: Buffer): string {
  const envelope = JSON.parse(ciphertext) as SecretEnvelope
  if (!envelope.iv || !envelope.tag || !envelope.ciphertext) throw new Error('invalid secret envelope')
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'))
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]).toString('utf8')
}

function encrypt(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return JSON.stringify({
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  } satisfies SecretEnvelope)
}

function isDecryptable(ciphertext: string, key: Buffer): boolean {
  try {
    decrypt(ciphertext, key)
    return true
  } catch {
    return false
  }
}

function planSecretUpdates(
  rows: EncryptedRecord[],
  currentKey: Buffer,
  legacyKey: Buffer | null,
): { updates: SecretUpdate[]; alreadyMigrated: number } {
  const updates: SecretUpdate[] = []
  let alreadyMigrated = 0

  for (const row of rows) {
    if (!row.encryptedApiKey) continue
    if (isDecryptable(row.encryptedApiKey, currentKey)) {
      alreadyMigrated += 1
      continue
    }
    if (!legacyKey) {
      throw new Error(
        '[AgentModel] 发现旧加密 provider/connection key；请设置 AGENT_MODEL_DB_ENCRYPTION_LEGACY_KEY 后重试迁移',
      )
    }
    const plaintext = decrypt(row.encryptedApiKey, legacyKey)
    updates.push({ id: row.id, current: row.encryptedApiKey, next: encrypt(plaintext, currentKey) })
  }

  return { updates, alreadyMigrated }
}

function planSnapshotUpdates(
  rows: Array<{ id: string; snapshot: Prisma.JsonValue }>,
  currentKey: Buffer,
  legacyKey: Buffer | null,
): { updates: SnapshotUpdate[]; alreadyMigrated: number } {
  const updates: SnapshotUpdate[] = []
  let alreadyMigrated = 0

  for (const row of rows) {
    if (!Array.isArray(row.snapshot)) continue
    const next = JSON.parse(JSON.stringify(row.snapshot)) as Array<Record<string, unknown>>
    let changed = false

    for (const item of next) {
      const encryptedApiKey = item.encryptedApiKey
      if (typeof encryptedApiKey !== 'string' || encryptedApiKey.length === 0) continue
      if (isDecryptable(encryptedApiKey, currentKey)) {
        alreadyMigrated += 1
        continue
      }
      if (!legacyKey) {
        throw new Error('[AgentModel] 发现旧加密配置快照；请设置 AGENT_MODEL_DB_ENCRYPTION_LEGACY_KEY 后重试迁移')
      }
      item.encryptedApiKey = encrypt(decrypt(encryptedApiKey, legacyKey), currentKey)
      changed = true
    }

    if (changed) updates.push({ id: row.id, next: next as Prisma.InputJsonValue })
  }

  return { updates, alreadyMigrated }
}

function hasEncryptedSecrets(
  providers: EncryptedRecord[],
  connections: EncryptedRecord[],
  versions: Array<{ snapshot: Prisma.JsonValue }>,
): boolean {
  return (
    providers.some((row) => Boolean(row.encryptedApiKey)) ||
    connections.some((row) => Boolean(row.encryptedApiKey)) ||
    versions.some((row) =>
      Array.isArray(row.snapshot)
        ? row.snapshot.some((item) => {
            if (typeof item !== 'object' || item === null || !('encryptedApiKey' in item)) return false
            const encryptedApiKey = (item as Record<string, unknown>).encryptedApiKey
            return typeof encryptedApiKey === 'string' && encryptedApiKey.length > 0
          })
        : false,
    )
  )
}

async function assertAllDecryptable(
  prisma: PrismaClient,
  currentKey: Buffer,
): Promise<{ providers: number; connections: number; snapshots: number }> {
  const [providers, connections, versions] = await Promise.all([
    prisma.aiModelProvider.findMany({ select: { encryptedApiKey: true } }),
    prisma.aiModelConnection.findMany({ select: { encryptedApiKey: true } }),
    prisma.aiModelConfigVersion.findMany({ select: { snapshot: true } }),
  ])
  let snapshots = 0

  for (const value of [...providers, ...connections]) {
    if (value.encryptedApiKey && !isDecryptable(value.encryptedApiKey, currentKey)) {
      throw new Error('[AgentModel] 重加密后仍存在无法用当前密钥解密的 provider/connection key')
    }
  }
  for (const version of versions) {
    if (!Array.isArray(version.snapshot)) continue
    for (const item of version.snapshot) {
      if (typeof item !== 'object' || item === null || !('encryptedApiKey' in item)) continue
      const encryptedApiKey = (item as Record<string, unknown>).encryptedApiKey
      if (typeof encryptedApiKey === 'string' && encryptedApiKey.length > 0) {
        snapshots += 1
        if (!isDecryptable(encryptedApiKey, currentKey)) {
          throw new Error('[AgentModel] 重加密后仍存在无法用当前密钥解密的配置快照')
        }
      }
    }
  }
  return {
    providers: providers.filter((row) => Boolean(row.encryptedApiKey)).length,
    connections: connections.filter((row) => Boolean(row.encryptedApiKey)).length,
    snapshots,
  }
}

async function main(): Promise<void> {
  const prisma = new PrismaClient()
  try {
    const [providers, connections, versions] = await Promise.all([
      prisma.aiModelProvider.findMany({ select: { id: true, encryptedApiKey: true } }),
      prisma.aiModelConnection.findMany({ select: { id: true, encryptedApiKey: true } }),
      prisma.aiModelConfigVersion.findMany({ select: { id: true, snapshot: true } }),
    ])
    if (!hasEncryptedSecrets(providers, connections, versions)) {
      console.info('[AgentModel] encryption migration skipped: no encrypted model keys')
      return
    }

    const current = readKey('AGENT_MODEL_DB_ENCRYPTION_KEY', true)
    const legacy = readKey('AGENT_MODEL_DB_ENCRYPTION_LEGACY_KEY', false)
    if (!current) throw new Error('[AgentModel] 当前加密密钥不可用')
    if (legacy && current.raw === legacy.raw) {
      throw new Error('[AgentModel] 新旧加密密钥不能相同')
    }
    const providerPlan = planSecretUpdates(providers, current.derived, legacy?.derived ?? null)
    const connectionPlan = planSecretUpdates(connections, current.derived, legacy?.derived ?? null)
    const snapshotPlan = planSnapshotUpdates(versions, current.derived, legacy?.derived ?? null)

    // All decryptions complete before the first write: wrong legacy key fails closed.
    for (const update of providerPlan.updates) {
      const result = await prisma.aiModelProvider.updateMany({
        where: { id: update.id, encryptedApiKey: update.current },
        data: { encryptedApiKey: update.next },
      })
      if (result.count !== 1) throw new Error('[AgentModel] legacy provider changed during re-encryption')
    }
    for (const update of connectionPlan.updates) {
      const result = await prisma.aiModelConnection.updateMany({
        where: { id: update.id, encryptedApiKey: update.current },
        data: { encryptedApiKey: update.next },
      })
      if (result.count !== 1) throw new Error('[AgentModel] model connection changed during re-encryption')
    }
    for (const update of snapshotPlan.updates) {
      await prisma.aiModelConfigVersion.update({ where: { id: update.id }, data: { snapshot: update.next } })
    }

    const migrated = providerPlan.updates.length + connectionPlan.updates.length + snapshotPlan.updates.length
    const alreadyMigrated = providerPlan.alreadyMigrated + connectionPlan.alreadyMigrated + snapshotPlan.alreadyMigrated
    const verified = await assertAllDecryptable(prisma, current.derived)
    console.info(
      `[AgentModel] encryption migration complete: migrated=${migrated}, alreadyCurrent=${alreadyMigrated}, ` +
        `verifiedProviders=${verified.providers}, verifiedConnections=${verified.connections}, verifiedSnapshots=${verified.snapshots}`,
    )
  } finally {
    await prisma.$disconnect()
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
