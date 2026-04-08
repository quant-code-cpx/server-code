import { Injectable, Logger } from '@nestjs/common'
import { TushareSyncRetryStatus, TushareSyncTask } from '@prisma/client'
import { PrismaService } from 'src/shared/prisma.service'
import { SyncHelperService } from '../sync-helper.service'
import { DataQualityReport } from './data-quality.service'

export interface RepairTask {
  /** 对应 DataQualityCheck 的检查项标识（如 'daily'） */
  dataSet: string
  /** 补数类型 */
  repairType: 'resync-dates' | 'no-action'
  /** 需要重同步的日期列表（仅 resync-dates） */
  missingDates?: string[]
  /** 关联的质量检查报告 */
  sourceReport: DataQualityReport
}

export interface RepairSummary {
  totalChecked: number
  repairTasks: number
  executed: number
  tasks: RepairTask[]
}

/**
 * AutoRepairService — 自动补数服务
 *
 * 根据数据质量检查结果，自动将缺失日期入队 TushareSyncRetryQueue，
 * 复用现有重试基础设施完成补数闭环。
 *
 * 安全策略：
 *   - 仅处理 completeness fail（非 warn / timeliness）
 *   - 缺失超过 30 天不自动补数（需人工介入）
 *   - 入队前检查重复，避免重复入队
 *   - 财务类数据不支持按日期补数，跳过
 */
@Injectable()
export class AutoRepairService {
  private readonly logger = new Logger(AutoRepairService.name)

  /** 质量检查 dataSet 名 → TushareSyncTask 枚举（仅支持按日期补数的数据集） */
  private readonly DATASET_TO_TASK: Record<string, TushareSyncTask> = {
    daily: TushareSyncTask.DAILY,
    dailyBasic: TushareSyncTask.DAILY_BASIC,
    adjFactor: TushareSyncTask.ADJ_FACTOR,
    indexDaily: TushareSyncTask.INDEX_DAILY,
    marginDetail: TushareSyncTask.MARGIN_DETAIL,
    moneyflow: TushareSyncTask.MONEYFLOW_DC,
    moneyflowIndDc: TushareSyncTask.MONEYFLOW_IND_DC,
    moneyflowMktDc: TushareSyncTask.MONEYFLOW_MKT_DC,
    moneyflowHsgt: TushareSyncTask.MONEYFLOW_HSGT,
    weekly: TushareSyncTask.WEEKLY,
    monthly: TushareSyncTask.MONTHLY,
    stkLimit: TushareSyncTask.STK_LIMIT,
  }

  private readonly ALERT_THRESHOLDS = {
    /** completeness fail 数据集超过此数量 → 错误级日志 */
    maxFailDataSets: 5,
    /** 跨表对账 fail 数量阈值 */
    maxCrossTableFails: 3,
    /** 自动补数入队超过此数量 → 警告级日志（可能大面积数据丢失） */
    maxRepairTasks: 20,
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly helper: SyncHelperService,
  ) {}

  /**
   * 根据质量检查结果，生成并执行补数计划。
   * 仅处理 checkType='completeness' 且 status='fail' 的报告。
   */
  async analyzeAndRepair(reports: DataQualityReport[]): Promise<RepairSummary> {
    const tasks = this.buildRepairTasks(reports)
    const executed = await this.executeRepairTasks(tasks)
    this.emitAlerts(reports, { totalChecked: reports.length, repairTasks: tasks.length, executed, tasks })
    return { totalChecked: reports.length, repairTasks: tasks.length, executed, tasks }
  }

  // ── 私有: 构建补数任务 ──────────────────────────────────────────────────────

  private buildRepairTasks(reports: DataQualityReport[]): RepairTask[] {
    const tasks: RepairTask[] = []

    for (const report of reports) {
      if (report.checkType !== 'completeness' || report.status !== 'fail') continue

      const missingDates = (report.details as Record<string, unknown> | undefined)?.missingDates as string[] | undefined
      const totalMissing = (report.details as Record<string, unknown> | undefined)?.totalMissing as number | undefined

      if (!missingDates || missingDates.length === 0) continue

      // 安全阈值：缺失超过 30 天不自动补数
      if (totalMissing && totalMissing > 30) {
        this.logger.warn(`[自动补数] ${report.dataSet} 缺失 ${totalMissing} 天，超出安全阈值（30天），跳过自动补数`)
        tasks.push({ dataSet: report.dataSet, repairType: 'no-action', sourceReport: report })
        continue
      }

      // 检查该数据集是否有对应的同步任务
      if (!this.DATASET_TO_TASK[report.dataSet]) {
        this.logger.warn(`[自动补数] ${report.dataSet} 无对应同步任务（可能为财务类数据），跳过自动补数`)
        tasks.push({ dataSet: report.dataSet, repairType: 'no-action', sourceReport: report })
        continue
      }

      tasks.push({
        dataSet: report.dataSet,
        repairType: 'resync-dates',
        missingDates,
        sourceReport: report,
      })
    }

    return tasks
  }

  // ── 私有: 执行补数任务（入 RetryQueue）────────────────────────────────────

  private async executeRepairTasks(tasks: RepairTask[]): Promise<number> {
    let executedCount = 0

    for (const task of tasks) {
      if (task.repairType !== 'resync-dates' || !task.missingDates?.length) continue

      const syncTask = this.DATASET_TO_TASK[task.dataSet]
      if (!syncTask) continue

      for (const date of task.missingDates) {
        // 去重：检查是否已有相同 task + failedKey 的 PENDING 记录
        const existing = await this.prisma.tushareSyncRetryQueue.findFirst({
          where: {
            task: syncTask,
            failedKey: date,
            status: TushareSyncRetryStatus.PENDING,
          },
        })

        if (existing) {
          this.logger.debug(`[自动补数] ${syncTask}@${date} 已在重试队列中，跳过`)
          continue
        }

        await this.prisma.tushareSyncRetryQueue.create({
          data: {
            task: syncTask,
            failedKey: date,
            errorMessage: `[auto-repair] missing date ${date}`,
            retryCount: 0,
            maxRetries: 3,
            nextRetryAt: new Date(), // 立即可被 SyncRetryService 拾取
            status: TushareSyncRetryStatus.PENDING,
          },
        })

        executedCount++
      }

      this.logger.log(
        `[自动补数] ${task.dataSet}: ${task.missingDates.length} 个缺失日期已入队（实际新增 ${executedCount} 条）`,
      )
    }

    return executedCount
  }

  // ── 私有: 告警阈值检查 ──────────────────────────────────────────────────────

  private emitAlerts(reports: DataQualityReport[], repairSummary: RepairSummary): void {
    const failCount = reports.filter((r) => r.status === 'fail').length
    const crossFails = reports.filter((r) => r.checkType === 'cross-table' && r.status === 'fail').length

    if (failCount > this.ALERT_THRESHOLDS.maxFailDataSets) {
      this.logger.error(
        `[数据质量告警] ${failCount} 个数据集质量检查失败，超出阈值 ${this.ALERT_THRESHOLDS.maxFailDataSets}`,
      )
    }

    if (crossFails > this.ALERT_THRESHOLDS.maxCrossTableFails) {
      this.logger.error(
        `[数据质量告警] ${crossFails} 项跨表对账失败，超出阈值 ${this.ALERT_THRESHOLDS.maxCrossTableFails}`,
      )
    }

    if (repairSummary.executed > this.ALERT_THRESHOLDS.maxRepairTasks) {
      this.logger.warn(
        `[数据质量告警] 自动补数入队 ${repairSummary.executed} 个任务，超出安全阈值 ${this.ALERT_THRESHOLDS.maxRepairTasks}，可能存在大面积数据丢失`,
      )
    }
  }

  /**
   * 将 TushareSyncTask 逆映射到 DataQualityService 使用的 dataSet 名
   * （供 SyncRetryService post-repair hook 使用）
   */
  taskToDataSet(task: string): string | null {
    for (const [dataSet, syncTask] of Object.entries(this.DATASET_TO_TASK)) {
      if (syncTask === task) return dataSet
    }
    return null
  }
}
