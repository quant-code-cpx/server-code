import { Logger } from '@nestjs/common'
import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Job } from 'bullmq'
import { SubscriptionFrequency, SubscriptionStatus } from '@prisma/client'
import { PrismaService } from 'src/shared/prisma.service'
import { StockService } from 'src/apps/stock/stock.service'
import { EventsGateway } from 'src/websocket/events.gateway'
import { SCREENER_SUBSCRIPTION_QUEUE, ScreenerSubscriptionJobName } from 'src/constant/queue.constant'
import { MAX_CONSECUTIVE_FAILS } from './constants/subscription.constant'

interface BatchExecuteData {
  frequency: SubscriptionFrequency
  tradeDate: string
}

interface ExecuteSingleData {
  subscriptionId: number
  tradeDate: string
}

@Processor(SCREENER_SUBSCRIPTION_QUEUE)
export class ScreenerSubscriptionProcessor extends WorkerHost {
  private readonly logger = new Logger(ScreenerSubscriptionProcessor.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly stockService: StockService,
    private readonly eventsGateway: EventsGateway,
  ) {
    super()
  }

  async process(job: Job): Promise<void> {
    switch (job.name) {
      case ScreenerSubscriptionJobName.BATCH_EXECUTE:
        return this.batchExecute(job.data as BatchExecuteData)
      case ScreenerSubscriptionJobName.EXECUTE_SUBSCRIPTION:
        return this.executeSingle(job.data as ExecuteSingleData)
      default:
        this.logger.warn(`Unknown job name: ${job.name}`)
    }
  }

  private async batchExecute(data: BatchExecuteData): Promise<void> {
    const subscriptions = await this.prisma.screenerSubscription.findMany({
      where: { status: SubscriptionStatus.ACTIVE, frequency: data.frequency },
    })
    this.logger.log(`Batch executing ${subscriptions.length} ${data.frequency} subscriptions`)

    for (const sub of subscriptions) {
      try {
        await this.executeSingle({ subscriptionId: sub.id, tradeDate: data.tradeDate })
      } catch (err) {
        this.logger.error(`Subscription ${sub.id} execution failed: ${(err as Error).message}`)
      }
    }
  }

  private async executeSingle(data: ExecuteSingleData): Promise<void> {
    const sub = await this.prisma.screenerSubscription.findUnique({ where: { id: data.subscriptionId } })
    if (!sub || sub.status !== SubscriptionStatus.ACTIVE) return

    const start = Date.now()

    try {
      // 执行选股器
      const result = await this.stockService.screener({
        ...(sub.filters as Record<string, unknown>),
        sortBy: sub.sortBy ?? undefined,
        sortOrder: (sub.sortOrder as 'asc' | 'desc') ?? undefined,
        page: 1,
        pageSize: 500,
      } as Parameters<typeof this.stockService.screener>[0])

      const currentCodes: string[] = (result as { list?: Array<{ tsCode: string }> }).list?.map((s) => s.tsCode) ?? []
      const previousCodesSet = new Set(sub.lastMatchCodes)

      const newEntryCodes = currentCodes.filter((c) => !previousCodesSet.has(c))
      const exitCodes = sub.lastMatchCodes.filter((c) => !currentCodes.includes(c))

      await this.prisma.screenerSubscription.update({
        where: { id: sub.id },
        data: {
          lastRunAt: new Date(),
          lastRunResult: { tradeDate: data.tradeDate, matchCount: currentCodes.length, newEntryCount: newEntryCodes.length, exitCount: exitCodes.length },
          lastMatchCodes: currentCodes,
          consecutiveFails: 0,
        },
      })

      await this.prisma.screenerSubscriptionLog.create({
        data: {
          subscriptionId: sub.id,
          tradeDate: data.tradeDate,
          matchCount: currentCodes.length,
          newEntryCount: newEntryCodes.length,
          exitCount: exitCodes.length,
          newEntryCodes,
          exitCodes,
          executionMs: Date.now() - start,
        },
      })

      if (newEntryCodes.length > 0) {
        this.eventsGateway.emitToUser(sub.userId, 'screener_subscription_alert', {
          subscriptionId: sub.id,
          subscriptionName: sub.name,
          tradeDate: data.tradeDate,
          newEntryCodes,
          exitCodes,
          totalMatch: currentCodes.length,
        })
      }
    } catch (err) {
      const newFails = sub.consecutiveFails + 1
      await this.prisma.screenerSubscription.update({
        where: { id: sub.id },
        data: {
          consecutiveFails: newFails,
          ...(newFails >= MAX_CONSECUTIVE_FAILS && { status: SubscriptionStatus.ERROR }),
        },
      })

      await this.prisma.screenerSubscriptionLog.create({
        data: {
          subscriptionId: sub.id,
          tradeDate: data.tradeDate,
          matchCount: 0,
          newEntryCount: 0,
          exitCount: 0,
          executionMs: Date.now() - start,
          success: false,
          errorMessage: (err as Error).message,
        },
      })
    }
  }
}
