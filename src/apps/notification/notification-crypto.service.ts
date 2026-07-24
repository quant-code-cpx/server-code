import { Inject, Injectable } from '@nestjs/common'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { AgentHttpException } from 'src/apps/agent/api/agent-http.exception'
import { AgentNotificationConfig, type IAgentNotificationConfig } from 'src/config/agent-notification.config'

interface EncryptionEnvelope {
  version: number
  iv: string
  tag: string
  ciphertext: string
}

export interface EncryptedNotificationConfig {
  ciphertext: string
  keyVersion: number
  fingerprint: string
}

@Injectable()
export class NotificationCryptoService {
  constructor(@Inject(AgentNotificationConfig.KEY) private readonly config: IAgentNotificationConfig) {}

  encrypt(value: object): EncryptedNotificationConfig {
    const version = this.config.activeEncryptionKeyVersion
    if (version === null) {
      throw AgentHttpException.fromKey('AI_NOTIFICATION_CHANNEL_INVALID', '外部通知渠道未配置加密密钥')
    }
    const key = this.config.encryptionKeys.get(version)
    if (!key) throw AgentHttpException.fromKey('AI_NOTIFICATION_CHANNEL_INVALID', '外部通知渠道加密密钥不可用')

    const plaintext = JSON.stringify(value)
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    const envelope: EncryptionEnvelope = {
      version,
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    }
    return {
      ciphertext: JSON.stringify(envelope),
      keyVersion: version,
      fingerprint: createHash('sha256').update(plaintext, 'utf8').digest('hex'),
    }
  }

  decrypt<T extends object>(ciphertext: string, keyVersion: number | null): T {
    const envelope = parseEnvelope(ciphertext, keyVersion)
    const key = this.config.encryptionKeys.get(envelope.version)
    if (!key) throw new Error('Notification encryption key 不可用')
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'))
      decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'))
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
        decipher.final(),
      ]).toString('utf8')
      const value = JSON.parse(plaintext) as unknown
      if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('invalid')
      return value as T
    } catch {
      throw new Error('Notification encrypted config 无法解密')
    }
  }
}

function parseEnvelope(ciphertext: string, keyVersion: number | null): EncryptionEnvelope {
  try {
    const parsed = JSON.parse(ciphertext) as Partial<EncryptionEnvelope>
    if (
      !Number.isInteger(parsed.version) ||
      parsed.version !== keyVersion ||
      !isBase64(parsed.iv) ||
      !isBase64(parsed.tag) ||
      !isBase64(parsed.ciphertext)
    ) {
      throw new Error('invalid')
    }
    return parsed as EncryptionEnvelope
  } catch {
    throw new Error('Notification encrypted config 格式非法')
  }
}

function isBase64(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(value)
}
