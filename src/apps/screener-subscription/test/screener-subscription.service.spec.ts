import { BadRequestException, NotFoundException } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { SubscriptionStatus } from '@prisma/client'
import { ScreenerSubscriptionService } from '../screener-subscription.service'
import { PrismaService } from 'src/shared/prisma.service'
import { SCREENER_SUBSCRIPTION_QUEUE } from 'src/constant/queue.constant'
import { createMockPrismaService } from 'test/helpers/prisma-mock'
import { getQueueToken } from '@nestjs/bullmq'
import { MANUAL_TRIGGER_COOLDOWN_MS } from '../constants/subscription.constant'

describe('ScreenerSubscriptionService', () => {
  let service: ScreenerSubscriptionService
  let prisma: ReturnType<typeof createMockPrismaService>
  let queue: { add: jest.Mock }

  beforeEach(async () => {
    prisma = createMockPrismaService()
    queue = { add: jest.fn().mockResolvedValue({ id: 'job-1' }) }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScreenerSubscriptionService,
        { provide: PrismaService, useValue: prisma },
        { provide: getQueueToken(SCREENER_SUBSCRIPTION_QUEUE), useValue: queue },
      ],
    }).compile()

    service = module.get(ScreenerSubscriptionService)
  })

  afterEach(() => jest.clearAllMocks())

  // ── findAll ───────────────────────────────────────────────────────────────

  it('findAll — 返回用户所有订阅（含策略信息）', async () => {
    const subscriptions = [
      { id: 1, strategyId: null },
      { id: 2, strategyId: null },
    ]
    prisma.screenerSubscription.findMany.mockResolvedValue(subscriptions as never)

    const result = await service.findAll(1)
    expect(result.subscriptions).toHaveLength(2)
    expect(result.subscriptions[0]).toMatchObject({ id: 1, strategyName: null, strategyStatus: null })
    expect(prisma.screenerSubscription.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 1 } }))
  })

  // ── create ────────────────────────────────────────────────────────────────

  it('create — 用 filters → 直接创建订阅', async () => {
    prisma.screenerSubscription.count.mockResolvedValue(0)
    const created = { id: 1, strategyId: null }
    prisma.screenerSubscription.create.mockResolvedValue(created as never)

    const result = await service.create(1, { name: '订阅1', filters: { minPe: 10 } })
    expect(result).toMatchObject({ id: 1, strategyName: null })
  })

  it('create — 用 strategyId → 取策略 filters', async () => {
    prisma.screenerSubscription.count.mockResolvedValue(0)
    prisma.screenerStrategy.findFirst.mockResolvedValue({ id: 5, filters: { minPe: 5 } } as never)
    prisma.screenerSubscription.create.mockResolvedValue({ id: 2 } as never)

    await service.create(1, { name: '订阅2', strategyId: 5 })
    expect(prisma.screenerStrategy.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 5, userId: 1 } }),
    )
    expect(prisma.screenerSubscription.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ filters: { minPe: 5 } }) }),
    )
  })

  it('create — strategyId 不存在 → NotFoundException', async () => {
    prisma.screenerSubscription.count.mockResolvedValue(0)
    prisma.screenerStrategy.findFirst.mockResolvedValue(null)

    await expect(service.create(1, { name: '订阅', strategyId: 99 })).rejects.toThrow(NotFoundException)
  })

  it('create — 超上限 → BadRequestException', async () => {
    prisma.screenerSubscription.count.mockResolvedValue(10)
    await expect(service.create(1, { name: 'x', filters: {} })).rejects.toThrow(BadRequestException)
  })

  it('create — strategyId 和 filters 均未提供 → BadRequestException', async () => {
    prisma.screenerSubscription.count.mockResolvedValue(0)
    await expect(service.create(1, { name: 'x' })).rejects.toThrow(BadRequestException)
  })

  // ── update ────────────────────────────────────────────────────────────────

  it('update — 存在 → 更新并返回（含策略信息）', async () => {
    prisma.screenerSubscription.findFirst.mockResolvedValue({ id: 1 } as never)
    const updated = { id: 1, name: '新名称', strategyId: null }
    prisma.screenerSubscription.update.mockResolvedValue(updated as never)

    const result = await service.update(1, 1, { name: '新名称' })
    expect(result).toMatchObject({ id: 1, name: '新名称' })
  })

  it('update — 不存在 → NotFoundException', async () => {
    prisma.screenerSubscription.findFirst.mockResolvedValue(null)
    await expect(service.update(1, 99, {})).rejects.toThrow(NotFoundException)
  })

  // ── remove ────────────────────────────────────────────────────────────────

  it('remove — 存在 → 删除并返回成功消息', async () => {
    prisma.screenerSubscription.findFirst.mockResolvedValue({ id: 1 } as never)
    prisma.screenerSubscription.delete.mockResolvedValue({} as never)

    const result = await service.remove(1, 1)
    expect(result.message).toBeDefined()
  })

  it('remove — 不存在 → NotFoundException', async () => {
    prisma.screenerSubscription.findFirst.mockResolvedValue(null)
    await expect(service.remove(1, 99)).rejects.toThrow(NotFoundException)
  })

  // ── pause / resume ────────────────────────────────────────────────────────

  it('pause — 存在 → 更新状态为 PAUSED 并返回订阅', async () => {
    const updated = { id: 1, status: SubscriptionStatus.PAUSED }
    prisma.screenerSubscription.findFirst.mockResolvedValue({ id: 1 } as never)
    prisma.screenerSubscription.update.mockResolvedValue(updated as never)

    const result = await service.pause(1, 1)
    expect(result).toMatchObject({ id: 1 })
    expect(prisma.screenerSubscription.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: SubscriptionStatus.PAUSED } }),
    )
  })

  it('pause — 不存在 → NotFoundException', async () => {
    prisma.screenerSubscription.findFirst.mockResolvedValue(null)
    await expect(service.pause(1, 99)).rejects.toThrow(NotFoundException)
  })

  it('resume — 存在 → 更新状态为 ACTIVE，consecutiveFails 清零并返回订阅', async () => {
    const updated = { id: 1, status: SubscriptionStatus.ACTIVE, consecutiveFails: 0 }
    prisma.screenerSubscription.findFirst.mockResolvedValue({ id: 1 } as never)
    prisma.screenerSubscription.update.mockResolvedValue(updated as never)

    const result = await service.resume(1, 1)
    expect(result).toMatchObject({ id: 1 })
    expect(prisma.screenerSubscription.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: SubscriptionStatus.ACTIVE, consecutiveFails: 0 },
      }),
    )
  })

  it('resume — 不存在 → NotFoundException', async () => {
    prisma.screenerSubscription.findFirst.mockResolvedValue(null)
    await expect(service.resume(1, 99)).rejects.toThrow(NotFoundException)
  })

  // ── manualRun ─────────────────────────────────────────────────────────────

  it('manualRun — 正常（未运行过）→ 加入队列并返回 jobId', async () => {
    prisma.screenerSubscription.findFirst.mockResolvedValue({ id: 1, lastRunAt: null } as never)

    const result = await service.manualRun(1, 1)
    expect(queue.add).toHaveBeenCalled()
    expect(result.jobId).toBe('job-1')
  })

  it('manualRun — 上次运行距今超过冷却时间 → 正常加入队列', async () => {
    const lastRunAt = new Date(Date.now() - MANUAL_TRIGGER_COOLDOWN_MS - 1000)
    prisma.screenerSubscription.findFirst.mockResolvedValue({ id: 1, lastRunAt } as never)

    const result = await service.manualRun(1, 1)
    expect(result.jobId).toBeDefined()
  })

  it('manualRun — 冷却期内 → HttpException (COOLDOWN)', async () => {
    const lastRunAt = new Date(Date.now() - 10_000) // 10s ago, < 5 min cooldown
    prisma.screenerSubscription.findFirst.mockResolvedValue({ id: 1, lastRunAt } as never)

    await expect(service.manualRun(1, 1)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'COOLDOWN' }),
    })
    expect(queue.add).not.toHaveBeenCalled()
  })

  it('manualRun — 不存在 → NotFoundException', async () => {
    prisma.screenerSubscription.findFirst.mockResolvedValue(null)
    await expect(service.manualRun(1, 99)).rejects.toThrow(NotFoundException)
  })

  // ── getLogs ───────────────────────────────────────────────────────────────

  it('getLogs — 返回分页日志（含股票元数据）', async () => {
    prisma.screenerSubscription.findFirst.mockResolvedValue({ id: 1 } as never)
    const logs = [
      { id: 1, newEntryCodes: [], exitCodes: [] },
      { id: 2, newEntryCodes: [], exitCodes: [] },
    ]
    prisma.screenerSubscriptionLog.findMany.mockResolvedValue(logs as never)
    prisma.screenerSubscriptionLog.count.mockResolvedValue(2)

    const result = await service.getLogs(1, 1, { page: 1, pageSize: 20 })
    expect(result.total).toBe(2)
    expect(result.page).toBe(1)
    expect(result.pageSize).toBe(20)
    expect(result.logs).toHaveLength(2)
    expect(result.logs[0]).toMatchObject({ id: 1, newEntries: [], exits: [] })
  })

  it('getLogs — 订阅不存在 → NotFoundException', async () => {
    prisma.screenerSubscription.findFirst.mockResolvedValue(null)
    await expect(service.getLogs(1, 99, {})).rejects.toThrow(NotFoundException)
  })
})
