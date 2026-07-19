import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { Prisma, TushareSyncRetryStatus, TushareSyncStatus, TushareSyncTask } from '@prisma/client'
import { TushareSyncTaskName } from 'src/constant/tushare.constant'
import { PrismaService } from 'src/shared/prisma.service'
import { TushareSyncRegistryService } from './sync-registry.service'
import { DataQualityService } from './quality/data-quality.service'
import { AutoRepairService } from './quality/auto-repair.service'
import { buildProcessRoleConfig } from 'src/config/process-role.config'

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
  private readonly agentWorkerProcess = buildProcessRoleConfig(process.env).role === 'agent-worker'

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: TushareSyncRegistryService,
    private readonly dataQualityService: DataQualityService,
    private readonly autoRepairService: AutoRepairService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async processPendingRetries() {
    if (this.agentWorkerProcess) return
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
        const attemptStartedAt = new Date()

        // 精确执行失败分片，禁止被任务最新进度或历史成功日志短路。
        await plan.execute({
          trigger: 'manual',
          mode: 'incremental',
          targetTradeDate: item.failedKey ?? undefined,
          retryExactTarget: true,
        })

        const persistedRows = await this.verifyPersistedRows(taskName, item.failedKey, attemptStartedAt)
        if (persistedRows <= 0) {
          throw new Error(`重试未验证真实落库: task=${taskName}, key=${item.failedKey ?? 'n/a'}, rows=${persistedRows}`)
        }

        await this.prisma.tushareSyncRetryQueue.update({
          where: { id: item.id },
          data: { status: TushareSyncRetryStatus.SUCCEEDED },
        })
        this.logger.log(
          `[重试队列] ${taskName} / key=${item.failedKey ?? 'n/a'} 重试成功，验证落库 ${persistedRows} 行`,
        )
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

    // ─── post-repair hook：对成功的 auto-repair 任务触发单项复查 ─────────────
    const repairedDataSets = new Set<string>()
    const processedIds = pendingItems.map((i) => i.id)
    const succeededAutoRepair = await this.prisma.tushareSyncRetryQueue.findMany({
      where: {
        id: { in: processedIds },
        status: TushareSyncRetryStatus.SUCCEEDED,
        errorMessage: { startsWith: '[auto-repair]' },
      },
      select: { task: true },
    })
    for (const item of succeededAutoRepair) {
      const dataSet = this.autoRepairService.taskToDataSet(item.task)
      if (dataSet) repairedDataSets.add(dataSet)
    }

    if (repairedDataSets.size > 0) {
      this.logger.log(`[补数复查] 触发 ${repairedDataSets.size} 个数据集的质量复查`)
      for (const dataSet of repairedDataSets) {
        void this.dataQualityService
          .checkTimeliness(dataSet)
          .then((report) => this.dataQualityService.writeCheckResult(report))
          .catch((e) => this.logger.error(`[补数复查] ${dataSet} timeliness 检查失败: ${(e as Error).message}`))
      }
    }
  }

  private async verifyPersistedRows(
    taskName: TushareSyncTaskName,
    failedKey: string | null,
    attemptStartedAt: Date,
  ): Promise<number> {
    const expectedTradeDate = failedKey && /^\d{8}$/.test(failedKey) ? this.parseTradeDate(failedKey) : undefined
    const log = await this.prisma.tushareSyncLog.findFirst({
      where: {
        task: TushareSyncTask[taskName],
        status: TushareSyncStatus.SUCCESS,
        startedAt: { gte: attemptStartedAt },
      },
      orderBy: { startedAt: 'desc' },
      select: { payload: true, tradeDate: true },
    })

    if (expectedTradeDate && log?.tradeDate && log.tradeDate.getTime() !== expectedTradeDate.getTime()) return 0
    return this.readRowCount(log?.payload)
  }

  private readRowCount(payload: Prisma.JsonValue | null | undefined): number {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return 0
    const value = payload['rowCount']
    return typeof value === 'number' && Number.isFinite(value) ? value : 0
  }

  private parseTradeDate(value: string): Date {
    const year = Number(value.slice(0, 4))
    const month = Number(value.slice(4, 6))
    const day = Number(value.slice(6, 8))
    return new Date(Date.UTC(year, month - 1, day))
  }
}
