import { AiNotificationChannelStatus, AiNotificationChannelType, AiNotificationDeliveryStatus } from '@prisma/client'
import { buildAgentNotificationConfig } from 'src/config/agent-notification.config'
import { NotificationCryptoService } from '../notification-crypto.service'
import { NotificationDeliveryService } from '../notification-delivery.service'
import { NotificationDeliveryError, type NotificationChannelAdapter } from '../channels/notification-channel.port'

const keyV1 = Buffer.alloc(32, 1).toString('base64')
const keyV2 = Buffer.alloc(32, 2).toString('base64')

describe('Agent notification durable delivery', () => {
  it('NTF-DATA-001: 密文使用 key version；轮换后保留旧 key 仍可解密', () => {
    const legacyConfig = buildAgentNotificationConfig({
      NOTIFICATION_ENCRYPTION_KEYS: `1:${keyV1}`,
      NOTIFICATION_ENCRYPTION_ACTIVE_KEY_VERSION: '1',
    })
    const legacyCrypto = new NotificationCryptoService(legacyConfig as never)
    const encrypted = legacyCrypto.encrypt({
      webhookUrl: 'https://hooks.example.com/agent',
      secret: '0123456789abcdef',
    })

    const rotatedConfig = buildAgentNotificationConfig({
      NOTIFICATION_ENCRYPTION_KEYS: `1:${keyV1},2:${keyV2}`,
      NOTIFICATION_ENCRYPTION_ACTIVE_KEY_VERSION: '2',
    })
    const rotatedCrypto = new NotificationCryptoService(rotatedConfig as never)

    expect(rotatedCrypto.decrypt(encrypted.ciphertext, encrypted.keyVersion)).toEqual({
      webhookUrl: 'https://hooks.example.com/agent',
      secret: '0123456789abcdef',
    })
    expect(
      rotatedCrypto.encrypt({ webhookUrl: 'https://hooks.example.com/agent', secret: '0123456789abcdef' }).keyVersion,
    ).toBe(2)
  })

  it('NTF-DATA-001: completed Run 在事务中为每个已验证渠道写一个幂等 delivery intent', async () => {
    const { service, prisma } = harness()
    const tx = {
      aiTaskExecution: { findUnique: jest.fn().mockResolvedValue({ id: 'execution_1' }) },
      aiNotificationChannel: { findMany: jest.fn().mockResolvedValue([{ id: 'channel_app' }, { id: 'channel_hook' }]) },
      aiNotificationDelivery: { createMany: jest.fn().mockResolvedValue({ count: 2 }) },
    }

    await expect(
      service.enqueueForCompletedRun(tx as never, {
        run: { id: 'run_1', userId: 7, conversationId: 'conversation_1' } as never,
        completedAt: new Date('2026-07-22T10:30:00.000Z'),
      }),
    ).resolves.toBe(2)

    expect(tx.aiNotificationDelivery.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skipDuplicates: true,
        data: expect.arrayContaining([
          expect.objectContaining({ runId: 'run_1', executionId: 'execution_1', maxAttempts: 5 }),
        ]),
      }),
    )
    const input = tx.aiNotificationDelivery.createMany.mock.calls[0][0].data[0]
    expect(input.idempotencyKey).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.stringify(input.payload)).not.toContain('研究全文')
    expect(prisma.aiNotificationDelivery.updateMany).not.toHaveBeenCalled()
  })

  it('NTF-BIZ-001: 已 claim 的站内 delivery 成功后只标记 DELIVERED 并写 attempt', async () => {
    const adapter = {
      type: AiNotificationChannelType.IN_APP,
      send: jest.fn().mockResolvedValue({ providerMessageId: 'in-app:1', httpStatus: null }),
    }
    const { service, prisma } = harness([adapter])
    const delivery = makeClaimedDelivery({ type: AiNotificationChannelType.IN_APP })
    prisma.aiNotificationDelivery.updateMany.mockResolvedValue({ count: 1 })
    prisma.aiNotificationDelivery.findUniqueOrThrow.mockResolvedValue(delivery)

    await expect(service.process('delivery_1', 'worker_1')).resolves.toBe('DELIVERED')
    expect(adapter.send).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'channel_1', userId: 7 }),
      expect.objectContaining({ deliveryId: 'delivery_1', runId: 'run_1' }),
      delivery.idempotencyKey,
    )
    expect(prisma.aiNotificationDelivery.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: AiNotificationDeliveryStatus.DELIVERED }) }),
    )
    expect(prisma.aiNotificationDeliveryAttempt.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ attempt: 1, status: 'DELIVERED' }) }),
    )
  })

  it('NTF-ERR-001: provider 临时失败只排入 RETRY，不重跑 Run', async () => {
    const adapter = {
      type: AiNotificationChannelType.WEBHOOK,
      send: jest.fn().mockRejectedValue(new NotificationDeliveryError('TRANSIENT', 'Webhook 请求失败', 503)),
    }
    const { service, prisma } = harness([adapter])
    prisma.aiNotificationDelivery.updateMany.mockResolvedValue({ count: 1 })
    prisma.aiNotificationDelivery.findUniqueOrThrow.mockResolvedValue(
      makeClaimedDelivery({
        type: AiNotificationChannelType.WEBHOOK,
        verifiedAt: new Date(),
        encryptedConfig: '{}',
        configKeyVersion: 1,
      }),
    )

    await expect(service.process('delivery_1', 'worker_1')).resolves.toBe('RETRY')
    expect(prisma.aiNotificationDelivery.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: AiNotificationDeliveryStatus.RETRY, errorClass: 'TRANSIENT' }),
      }),
    )
  })

  it('NTF-RACE-001: 删除或未验证渠道被 worker claim 后抑制，不调用 provider', async () => {
    const adapter = { type: AiNotificationChannelType.WEBHOOK, send: jest.fn() }
    const { service, prisma } = harness([adapter])
    prisma.aiNotificationDelivery.updateMany.mockResolvedValue({ count: 1 })
    prisma.aiNotificationDelivery.findUniqueOrThrow.mockResolvedValue(
      makeClaimedDelivery({ type: AiNotificationChannelType.WEBHOOK, verifiedAt: null }),
    )

    await expect(service.process('delivery_1', 'worker_1')).resolves.toBe('SUPPRESSED')
    expect(adapter.send).not.toHaveBeenCalled()
    expect(prisma.aiNotificationDelivery.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: AiNotificationDeliveryStatus.SUPPRESSED }) }),
    )
  })
})

function harness(adapters: NotificationChannelAdapter[] = []) {
  const prisma = {
    aiNotificationDelivery: {
      updateMany: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    aiNotificationDeliveryAttempt: { create: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn(async (operations: Promise<unknown>[]) => Promise.all(operations)),
  }
  const config = buildAgentNotificationConfig({ NOTIFICATION_ENCRYPTION_KEYS: `1:${keyV1}` })
  const service = new NotificationDeliveryService(prisma as never, config as never, adapters, {
    warn: jest.fn(),
  } as never)
  return { service, prisma }
}

function makeClaimedDelivery(channelOverrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'delivery_1',
    userId: 7,
    channelId: 'channel_1',
    executionId: 'execution_1',
    runId: 'run_1',
    idempotencyKey: 'a'.repeat(64),
    payload: {
      version: 1,
      subject: 'Agent 研究已完成',
      summary: '研究结果已生成，请在系统内查看。',
      deepLink: '/agent?conversationId=conversation_1&runId=run_1',
      occurredAt: '2026-07-22T10:30:00.000Z',
    },
    status: AiNotificationDeliveryStatus.SENDING,
    attempt: 1,
    maxAttempts: 5,
    channel: {
      id: 'channel_1',
      userId: 7,
      type: AiNotificationChannelType.IN_APP,
      encryptedConfig: null,
      configKeyVersion: null,
      status: AiNotificationChannelStatus.ACTIVE,
      deletedAt: null,
      verifiedAt: new Date(),
      ...channelOverrides,
    },
  }
}
