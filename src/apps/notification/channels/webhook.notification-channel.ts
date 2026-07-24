import { lookup } from 'node:dns/promises'
import { createHmac, randomUUID } from 'node:crypto'
import { Injectable, Inject } from '@nestjs/common'
import { AiNotificationChannelType } from '@prisma/client'
import { AgentNotificationConfig, type IAgentNotificationConfig } from 'src/config/agent-notification.config'
import { NotificationCryptoService } from '../notification-crypto.service'
import type {
  NotificationChannelAdapter,
  NotificationChannelRecord,
  NotificationChannelSendResult,
  NotificationDeliveryEnvelope,
} from './notification-channel.port'
import { NotificationDeliveryError } from './notification-channel.port'

export interface WebhookNotificationChannelConfig {
  webhookUrl: string
  secret: string
}

@Injectable()
export class WebhookNotificationChannel implements NotificationChannelAdapter {
  readonly type = AiNotificationChannelType.WEBHOOK

  constructor(
    private readonly crypto: NotificationCryptoService,
    @Inject(AgentNotificationConfig.KEY) private readonly config: IAgentNotificationConfig,
  ) {}

  async validateConfig(config: WebhookNotificationChannelConfig): Promise<void> {
    if (!isWebhookConfig(config)) throw new NotificationDeliveryError('PERMANENT', 'Webhook 配置格式非法')
    await assertSafeWebhookUrl(config.webhookUrl, this.config.webhookAllowedHosts)
  }

  async send(
    channel: NotificationChannelRecord,
    envelope: NotificationDeliveryEnvelope,
    idempotencyKey: string,
  ): Promise<NotificationChannelSendResult> {
    let config: WebhookNotificationChannelConfig
    try {
      if (!channel.encryptedConfig || channel.configKeyVersion === null) throw new Error('missing config')
      config = this.crypto.decrypt<WebhookNotificationChannelConfig>(channel.encryptedConfig, channel.configKeyVersion)
      await this.validateConfig(config)
    } catch (error) {
      if (error instanceof NotificationDeliveryError) throw error
      throw new NotificationDeliveryError('PERMANENT', 'Webhook 配置不可用')
    }

    const timestamp = new Date().toISOString()
    const nonce = randomUUID()
    const body = JSON.stringify({
      event: 'agent.research.completed',
      deliveryId: envelope.deliveryId,
      idempotencyKey,
      subject: envelope.subject,
      summary: envelope.summary,
      deepLink: envelope.deepLink,
      occurredAt: envelope.occurredAt,
    })
    const signature = createHmac('sha256', config.secret).update(`${timestamp}.${nonce}.${body}`, 'utf8').digest('hex')
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.config.deliveryTimeoutMs)
    timeout.unref?.()
    try {
      const response = await fetch(config.webhookUrl, {
        method: 'POST',
        redirect: 'error',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          'x-notification-signature': `v1=${signature}`,
          'x-notification-timestamp': timestamp,
          'x-notification-nonce': nonce,
          'x-notification-idempotency-key': idempotencyKey,
        },
        body,
      })
      if (response.status >= 200 && response.status < 300) {
        return { providerMessageId: response.headers.get('x-message-id'), httpStatus: response.status }
      }
      const classification =
        response.status === 408 || response.status === 429 || response.status >= 500 ? 'TRANSIENT' : 'PERMANENT'
      throw new NotificationDeliveryError(classification, `Webhook 返回 HTTP ${response.status}`, response.status)
    } catch (error) {
      if (error instanceof NotificationDeliveryError) throw error
      throw new NotificationDeliveryError('TRANSIENT', 'Webhook 请求失败')
    } finally {
      clearTimeout(timeout)
    }
  }
}

async function assertSafeWebhookUrl(value: string, allowedHosts: readonly string[]): Promise<void> {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new NotificationDeliveryError('PERMANENT', 'Webhook URL 非法')
  }
  if (
    url.protocol !== 'https:' ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.hash ||
    !isAllowedHostname(url.hostname, allowedHosts)
  ) {
    throw new NotificationDeliveryError('SECURITY', 'Webhook URL 不符合安全策略')
  }
  try {
    const addresses = await lookup(url.hostname, { all: true, verbatim: true })
    if (addresses.length === 0 || addresses.some((entry) => isPrivateIp(entry.address))) {
      throw new NotificationDeliveryError('SECURITY', 'Webhook 地址不符合安全策略')
    }
  } catch (error) {
    if (error instanceof NotificationDeliveryError) throw error
    throw new NotificationDeliveryError('PERMANENT', 'Webhook 域名无法解析')
  }
}

function isWebhookConfig(value: WebhookNotificationChannelConfig): boolean {
  return (
    typeof value?.webhookUrl === 'string' &&
    value.webhookUrl.length <= 2_048 &&
    typeof value.secret === 'string' &&
    value.secret.length >= 16 &&
    value.secret.length <= 512
  )
}

function isAllowedHostname(hostname: string, allowedHosts: readonly string[]): boolean {
  const normalized = hostname.toLowerCase()
  return allowedHosts.some((host) => normalized === host || normalized.endsWith(`.${host}`))
}

function isPrivateIp(address: string): boolean {
  const normalized = address.toLowerCase()
  if (normalized.includes(':')) {
    if (normalized.startsWith('::ffff:')) return isPrivateIp(normalized.slice('::ffff:'.length))
    return (
      normalized === '::1' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      normalized.startsWith('fe8') ||
      normalized.startsWith('fe9') ||
      normalized.startsWith('fea') ||
      normalized.startsWith('feb')
    )
  }
  const octets = normalized.split('.').map(Number)
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true
  const [first, second] = octets
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    first >= 224 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19))
  )
}
