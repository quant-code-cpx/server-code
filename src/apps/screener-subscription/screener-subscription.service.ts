import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { InjectQueue } from '@nestjs/bullmq'
import { Queue } from 'bullmq'
import { SubscriptionFrequency, SubscriptionStatus } from '@prisma/client'
import { PrismaService } from 'src/shared/prisma.service'
import { SCREENER_SUBSCRIPTION_QUEUE, ScreenerSubscriptionJobName } from 'src/constant/queue.constant'
import { CreateSubscriptionDto, SubscriptionLogsQueryDto, UpdateSubscriptionDto } from './dto/subscription.dto'
import {
  MAX_CONSECUTIVE_FAILS,
  MAX_SUBSCRIPTIONS_PER_USER,
  MANUAL_TRIGGER_COOLDOWN_MS,
} from './constants/subscription.constant'

@Injectable()
export class ScreenerSubscriptionService {
  private readonly logger = new Logger(ScreenerSubscriptionService.name)

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(SCREENER_SUBSCRIPTION_QUEUE) private readonly queue: Queue,
  ) {}

  async findAll(userId: number) {
    const subscriptions = await this.prisma.screenerSubscription.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    })
    return { subscriptions }
  }

  async create(userId: number, dto: CreateSubscriptionDto) {
    const count = await this.prisma.screenerSubscription.count({ where: { userId } })
    if (count >= MAX_SUBSCRIPTIONS_PER_USER) {
      throw new BadRequestException(`订阅数量已达上限（最多 ${MAX_SUBSCRIPTIONS_PER_USER} 个）`)
    }

    if (!dto.strategyId && !dto.filters) {
      throw new BadRequestException('strategyId 和 filters 必传其一')
    }

    let filters: Record<string, unknown>

    if (dto.strategyId) {
      const strategy = await this.prisma.screenerStrategy.findFirst({
        where: { id: dto.strategyId, userId },
      })
      if (!strategy) throw new NotFoundException(`选股策略 ${dto.strategyId} 不存在`)
      filters = strategy.filters as Record<string, unknown>
    } else {
      filters = dto.filters!
    }

    return this.prisma.screenerSubscription.create({
      data: {
        userId,
        name: dto.name,
        strategyId: dto.strategyId ?? null,
        filters: filters as Parameters<typeof this.prisma.screenerSubscription.create>[0]['data']['filters'],
        sortBy: dto.sortBy ?? null,
        sortOrder: dto.sortOrder ?? null,
        frequency: dto.frequency ?? SubscriptionFrequency.DAILY,
      },
    })
  }

  async update(userId: number, id: number, dto: UpdateSubscriptionDto) {
    const sub = await this.prisma.screenerSubscription.findFirst({ where: { id, userId } })
    if (!sub) throw new NotFoundException('订阅不存在')

    return this.prisma.screenerSubscription.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.frequency !== undefined && { frequency: dto.frequency }),
      },
    })
  }

  async remove(userId: number, id: number) {
    const sub = await this.prisma.screenerSubscription.findFirst({ where: { id, userId } })
    if (!sub) throw new NotFoundException('订阅不存在')

    await this.prisma.screenerSubscription.delete({ where: { id } })
    return { message: '删除成功' }
  }

  async pause(userId: number, id: number) {
    const sub = await this.prisma.screenerSubscription.findFirst({ where: { id, userId } })
    if (!sub) throw new NotFoundException('订阅不存在')

    await this.prisma.screenerSubscription.update({
      where: { id },
      data: { status: SubscriptionStatus.PAUSED },
    })
    return { message: '已暂停' }
  }

  async resume(userId: number, id: number) {
    const sub = await this.prisma.screenerSubscription.findFirst({ where: { id, userId } })
    if (!sub) throw new NotFoundException('订阅不存在')

    await this.prisma.screenerSubscription.update({
      where: { id },
      data: { status: SubscriptionStatus.ACTIVE, consecutiveFails: 0 },
    })
    return { message: '已恢复' }
  }

  async manualRun(userId: number, id: number) {
    const sub = await this.prisma.screenerSubscription.findFirst({ where: { id, userId } })
    if (!sub) throw new NotFoundException('订阅不存在')

    // 冷却检查：距上次执行至少 5 分钟
    if (sub.lastRunAt) {
      const elapsed = Date.now() - sub.lastRunAt.getTime()
      if (elapsed < MANUAL_TRIGGER_COOLDOWN_MS) {
        const waitSec = Math.ceil((MANUAL_TRIGGER_COOLDOWN_MS - elapsed) / 1000)
        throw new BadRequestException(`操作过频，请等待 ${waitSec} 秒后再试`)
      }
    }

    const tradeDate = this.getLatestTradeDateStr()
    const job = await this.queue.add(
      ScreenerSubscriptionJobName.EXECUTE_SUBSCRIPTION,
      { subscriptionId: id, tradeDate },
      { removeOnComplete: 50, removeOnFail: 20 },
    )
    return { jobId: job.id, message: '任务已加入队列' }
  }

  async getLogs(userId: number, id: number, query: SubscriptionLogsQueryDto) {
    const sub = await this.prisma.screenerSubscription.findFirst({ where: { id, userId } })
    if (!sub) throw new NotFoundException('订阅不存在')

    const page = query.page ?? 1
    const pageSize = query.pageSize ?? 20

    const [logs, total] = await Promise.all([
      this.prisma.screenerSubscriptionLog.findMany({
        where: { subscriptionId: id },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.screenerSubscriptionLog.count({ where: { subscriptionId: id } }),
    ])

    return { logs, total, page, pageSize }
  }

  getLatestTradeDateStr(): string {
    const now = new Date()
    const d = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate()
    return String(d)
  }
}
