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
    const queryTasks = allTasks.filter((taskName) => Boolean(TushareSyncTask[taskName as keyof typeof TushareSyncTask]))

    if (queryTasks.length === 0) {
      return allTasks.map((task) => ({
        task,
        lastSyncAt: null,
        lastStatus: null,
        lastRowCount: null,
        consecutiveFailures: 0,
      }))
    }

    const rows = await this.prisma.$queryRaw<
      Array<{
        task: string
        last_sync_at: Date | null
        last_status: string | null
        payload: Record<string, unknown> | null
        consecutive_failures: number | bigint | string | null
      }>
    >`
      WITH requested(task) AS (
        SELECT unnest(${queryTasks}::"TushareSyncTask"[])
      )
      SELECT
        requested.task::text AS task,
        last_log.started_at AS last_sync_at,
        last_log.status::text AS last_status,
        last_log.payload,
        COALESCE(failures.consecutive_failures, 0) AS consecutive_failures
      FROM requested
      LEFT JOIN LATERAL (
        SELECT status, started_at, payload
        FROM tushare_sync_logs
        WHERE task = requested.task
        ORDER BY started_at DESC
        LIMIT 1
      ) last_log ON true
      LEFT JOIN LATERAL (
        WITH recent AS (
          SELECT status::text, row_number() OVER (ORDER BY started_at DESC) AS rn
          FROM (
            SELECT status, started_at
            FROM tushare_sync_logs
            WHERE task = requested.task
            ORDER BY started_at DESC
            LIMIT 10
          ) latest
        ),
        first_non_failed AS (
          SELECT COALESCE(MIN(rn), 11) AS rn
          FROM recent
          WHERE status <> ${TushareSyncStatus.FAILED}
        )
        SELECT COUNT(*)::int AS consecutive_failures
        FROM recent, first_non_failed
        WHERE recent.status = ${TushareSyncStatus.FAILED}
          AND recent.rn < first_non_failed.rn
      ) failures ON true
    `

    const rowMap = new Map(rows.map((row) => [row.task, row]))
    return allTasks.map((task) => {
      const row = rowMap.get(task)
      const payload = row?.payload ?? null
      const lastRowCount = typeof payload?.rowCount === 'number' ? payload.rowCount : null
      return {
        task,
        lastSyncAt: row?.last_sync_at ?? null,
        lastStatus: row?.last_status ?? null,
        lastRowCount,
        consecutiveFailures: Number(row?.consecutive_failures ?? 0),
      }
    })
  }
}
