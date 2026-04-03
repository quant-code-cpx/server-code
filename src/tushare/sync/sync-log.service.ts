import { Injectable } from '@nestjs/common'
import { TushareSyncStatus, TushareSyncTask } from '@prisma/client'
import { TushareSyncTaskName } from 'src/constant/tushare.constant'
import { PrismaService } from 'src/shared/prisma.service'

@Injectable()
export class SyncLogService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 分页查询同步日志，支持按任务、状态、时间范围过滤。
   */
  async queryLogs(input: {
    task?: TushareSyncTaskName
    status?: TushareSyncStatus
    startDate?: string
    endDate?: string
    page?: number
    pageSize?: number
  }) {
    const page = input.page ?? 1
    const pageSize = input.pageSize ?? 20
    const skip = (page - 1) * pageSize

    const where: Record<string, unknown> = {}

    if (input.task) {
      where['task'] = TushareSyncTask[input.task]
    }
    if (input.status) {
      where['status'] = input.status
    }
    if (input.startDate || input.endDate) {
      where['startedAt'] = {
        ...(input.startDate ? { gte: new Date(input.startDate) } : {}),
        ...(input.endDate ? { lte: new Date(input.endDate) } : {}),
      }
    }

    const [total, items] = await Promise.all([
      this.prisma.tushareSyncLog.count({ where }),
      this.prisma.tushareSyncLog.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        skip,
        take: pageSize,
        select: {
          id: true,
          task: true,
          status: true,
          tradeDate: true,
          message: true,
          payload: true,
          startedAt: true,
          finishedAt: true,
        },
      }),
    ])

    return { total, page, pageSize, items }
  }

  /**
   * 各任务最后一次同步状态汇总：最后同步时间、状态、行数、连续失败次数。
   */
  async summarizeLogs(): Promise<
    Array<{
      task: string
      lastSyncAt: Date | null
      lastStatus: string | null
      lastRowCount: number | null
      consecutiveFailures: number
    }>
  > {
    const allTasks = Object.values(TushareSyncTaskName)

    const results = await Promise.all(
      allTasks.map(async (taskName) => {
        const task = TushareSyncTask[taskName]

        // 最后一次记录（无论成功与否）
        const lastLog = await this.prisma.tushareSyncLog.findFirst({
          where: { task },
          orderBy: { startedAt: 'desc' },
          select: { status: true, startedAt: true, payload: true },
        })

        if (!lastLog) {
          return { task: taskName, lastSyncAt: null, lastStatus: null, lastRowCount: null, consecutiveFailures: 0 }
        }

        // 统计连续失败次数（从最新往前取最多 10 条，找连续 FAILED 的数量）
        const recentLogs = await this.prisma.tushareSyncLog.findMany({
          where: { task },
          orderBy: { startedAt: 'desc' },
          take: 10,
          select: { status: true },
        })
        let consecutiveFailures = 0
        for (const log of recentLogs) {
          if (log.status === TushareSyncStatus.FAILED) consecutiveFailures++
          else break
        }

        const payload = lastLog.payload as Record<string, unknown> | null
        const lastRowCount = typeof payload?.rowCount === 'number' ? payload.rowCount : null

        return {
          task: taskName,
          lastSyncAt: lastLog.startedAt,
          lastStatus: lastLog.status as string,
          lastRowCount,
          consecutiveFailures,
        }
      }),
    )

    return results
  }
}
