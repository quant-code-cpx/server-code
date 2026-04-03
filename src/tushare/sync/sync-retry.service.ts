import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { TushareSyncRetryStatus, TushareSyncTask } from '@prisma/client'
import { TushareSyncTaskName } from 'src/constant/tushare.constant'
import { PrismaService } from 'src/shared/prisma.service'
import { TushareSyncRegistryService } from './sync-registry.service'

/** 最大同时处理的重试任务数（防止一次扫描大量重试任务造成 DB 和 Tushare 压力） */
const MAX_RETRY_BATCH = 10

/**
 * SyncRetryService — 失败分片自动重试消费者
 *
 * 每 5 分钟扫描一次 TushareSyncRetryQueue 中满足条件的 PENDING 记录，
 * 逐条执行对应 plan 的单分片同步，指数退避后续重试时间。
 */
@Injectable()
export class SyncRetryService {
  private readonly logger = new Logger(SyncRetryService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: TushareSyncRegistryService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async processPendingRetries() {
    const pendingItems = await this.prisma.tushareSyncRetryQueue.findMany({
      where: {
        status: TushareSyncRetryStatus.PENDING,
        nextRetryAt: { lte: new Date() },
      },
      orderBy: { nextRetryAt: 'asc' },
      take: MAX_RETRY_BATCH,
    })

    if (pendingItems.length === 0) return

    this.logger.log(`[重试队列] 发现 ${pendingItems.length} 条待重试记录`)

    for (const item of pendingItems) {
      // 标记为重试中
      await this.prisma.tushareSyncRetryQueue.update({
        where: { id: item.id },
        data: { status: TushareSyncRetryStatus.RETRYING },
      })

      const taskName = Object.entries(TushareSyncTask).find(([, v]) => v === item.task)?.[0] as
        | TushareSyncTaskName
        | undefined

      if (!taskName) {
        this.logger.warn(`[重试队列] 未找到 task 映射: ${item.task}`)
        await this.prisma.tushareSyncRetryQueue.update({
          where: { id: item.id },
          data: { status: TushareSyncRetryStatus.EXHAUSTED },
        })
        continue
      }

      const plan = this.registry.getPlan(taskName)
      if (!plan) {
        this.logger.warn(`[重试队列] 未找到 plan: ${taskName}`)
        await this.prisma.tushareSyncRetryQueue.update({
          where: { id: item.id },
          data: { status: TushareSyncRetryStatus.EXHAUSTED },
        })
        continue
      }

      try {
        this.logger.log(`[重试队列] 重试 ${taskName} / key=${item.failedKey ?? 'n/a'} (第 ${item.retryCount + 1} 次)`)

        // 执行 plan（以 manual + incremental 模式，传入分片键作为目标交易日）
        await plan.execute({
          trigger: 'manual',
          mode: 'incremental',
          targetTradeDate: item.failedKey ?? undefined,
        })

        await this.prisma.tushareSyncRetryQueue.update({
          where: { id: item.id },
          data: { status: TushareSyncRetryStatus.SUCCEEDED },
        })
        this.logger.log(`[重试队列] ${taskName} / key=${item.failedKey ?? 'n/a'} 重试成功`)
      } catch (error) {
        const msg = (error as Error).message
        this.logger.error(`[重试队列] ${taskName} / key=${item.failedKey ?? 'n/a'} 重试失败: ${msg}`)

        const newRetryCount = item.retryCount + 1
        const isExhausted = newRetryCount >= item.maxRetries
        const RETRY_DELAYS_MS = [5 * 60 * 1000, 30 * 60 * 1000, 2 * 60 * 60 * 1000]
        const delayMs = RETRY_DELAYS_MS[Math.min(newRetryCount, RETRY_DELAYS_MS.length - 1)]

        await this.prisma.tushareSyncRetryQueue.update({
          where: { id: item.id },
          data: {
            retryCount: newRetryCount,
            errorMessage: msg,
            status: isExhausted ? TushareSyncRetryStatus.EXHAUSTED : TushareSyncRetryStatus.PENDING,
            nextRetryAt: isExhausted ? item.nextRetryAt : new Date(Date.now() + delayMs),
          },
        })

        if (isExhausted) {
          this.logger.error(`[重试队列] ${taskName} / key=${item.failedKey ?? 'n/a'} 已耗尽重试次数，标记为 EXHAUSTED`)
        }
      }
    }
  }
}
