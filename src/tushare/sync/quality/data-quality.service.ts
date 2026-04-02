import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from 'src/shared/prisma.service'
import { SyncHelperService } from '../sync-helper.service'

export interface DataQualityReport {
  dataSet: string
  checkType: string
  status: 'pass' | 'warn' | 'fail'
  message: string
  details?: Record<string, unknown>
}

/**
 * DataQualityService — 数据质量检查服务
 *
 * 提供数据完整性、时效性检查，结果写入 DataQualityCheck 表。
 * 建议在盘后同步完成后（21:00）执行全部检查。
 */
@Injectable()
export class DataQualityService {
  private readonly logger = new Logger(DataQualityService.name)

  /** 数据集名称 → Prisma model 名 + tradeDate 字段名 的映射 */
  private readonly DATA_SET_CONFIG: Record<string, { modelName: string; tradeDateField: string }> = {
    daily: { modelName: 'daily', tradeDateField: 'tradeDate' },
    dailyBasic: { modelName: 'dailyBasic', tradeDateField: 'tradeDate' },
    adjFactor: { modelName: 'adjFactor', tradeDateField: 'tradeDate' },
    indexDaily: { modelName: 'indexDaily', tradeDateField: 'tradeDate' },
    stkLimit: { modelName: 'stkLimit', tradeDateField: 'tradeDate' },
    suspendD: { modelName: 'suspendD', tradeDateField: 'tradeDate' },
    topList: { modelName: 'topList', tradeDateField: 'tradeDate' },
    topInst: { modelName: 'topInst', tradeDateField: 'tradeDate' },
    blockTrade: { modelName: 'blockTrade', tradeDateField: 'tradeDate' },
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly helper: SyncHelperService,
  ) {}

  /**
   * 检查数据时效性：最新同步日期是否落后于最近完成交易日
   */
  async checkTimeliness(dataSet: string): Promise<DataQualityReport> {
    const config = this.DATA_SET_CONFIG[dataSet]
    if (!config) {
      return { dataSet, checkType: 'timeliness', status: 'warn', message: `未知数据集: ${dataSet}` }
    }

    const latestDate = await this.helper.getLatestDateString(config.modelName)
    const latestTradeDateStr = await this.helper.resolveLatestCompletedTradeDate()

    if (!latestDate) {
      return {
        dataSet,
        checkType: 'timeliness',
        status: 'warn',
        message: `${dataSet} 暂无数据`,
      }
    }

    if (!latestTradeDateStr) {
      return {
        dataSet,
        checkType: 'timeliness',
        status: 'warn',
        message: '无法获取最近交易日',
      }
    }

    const lagDays = this.helper.compareDateString(latestTradeDateStr, latestDate)

    if (lagDays === 0) {
      return {
        dataSet,
        checkType: 'timeliness',
        status: 'pass',
        message: `${dataSet} 数据已是最新（${latestDate}）`,
      }
    } else if (lagDays <= 3) {
      return {
        dataSet,
        checkType: 'timeliness',
        status: 'warn',
        message: `${dataSet} 落后 ${lagDays} 个交易日（本地最新: ${latestDate}，最近交易日: ${latestTradeDateStr}）`,
        details: { latestDate, latestTradeDateStr, lagDays },
      }
    } else {
      return {
        dataSet,
        checkType: 'timeliness',
        status: 'fail',
        message: `${dataSet} 严重滞后 ${lagDays} 个交易日（本地最新: ${latestDate}，最近交易日: ${latestTradeDateStr}）`,
        details: { latestDate, latestTradeDateStr, lagDays },
      }
    }
  }

  /**
   * 检查数据完整性：与交易日历对比，找出缺失日期
   */
  async checkCompleteness(dataSet: string, startDate: string, endDate: string): Promise<DataQualityReport> {
    const config = this.DATA_SET_CONFIG[dataSet]
    if (!config) {
      return { dataSet, checkType: 'completeness', status: 'warn', message: `未知数据集: ${dataSet}` }
    }

    const tradeDates = await this.helper.getOpenTradeDatesBetween(startDate, endDate)
    if (!tradeDates.length) {
      return {
        dataSet,
        checkType: 'completeness',
        status: 'pass',
        message: `${dataSet} 检查范围内无交易日`,
      }
    }

    const model = (this.prisma as any)[config.modelName]
    const existingRows = await model.findMany({
      select: { [config.tradeDateField]: true },
      where: {
        [config.tradeDateField]: { in: tradeDates },
      },
      distinct: [config.tradeDateField],
    })

    const existingDates = new Set<string>(existingRows.map((r: Record<string, string>) => r[config.tradeDateField]))
    const missingDates = tradeDates.filter((d) => !existingDates.has(d))

    if (missingDates.length === 0) {
      return {
        dataSet,
        checkType: 'completeness',
        status: 'pass',
        message: `${dataSet} ${startDate}~${endDate} 数据完整（${tradeDates.length} 个交易日）`,
      }
    }

    const missingRatio = missingDates.length / tradeDates.length
    return {
      dataSet,
      checkType: 'completeness',
      status: missingRatio > 0.1 ? 'fail' : 'warn',
      message: `${dataSet} 缺失 ${missingDates.length}/${tradeDates.length} 个交易日数据`,
      details: { missingDates: missingDates.slice(0, 50), totalMissing: missingDates.length },
    }
  }

  /**
   * 将检查结果写入 DataQualityCheck 表
   */
  async writeCheckResult(report: DataQualityReport): Promise<void> {
    await this.prisma.dataQualityCheck.create({
      data: {
        checkDate: new Date(),
        dataSet: report.dataSet,
        checkType: report.checkType,
        status: report.status,
        message: report.message,
        details: (report.details ?? null) as object | null,
      },
    })
  }

  /**
   * 运行所有数据集的时效性检查
   * 由编排器的 DATA_QUALITY_CHECK 计划触发
   */
  async runAllChecks(): Promise<void> {
    this.logger.log('[数据质量检查] 开始全量检查')

    const datasets = Object.keys(this.DATA_SET_CONFIG)
    const today = this.helper.getCurrentShanghaiDateString()
    const thirtyDaysAgo = this.helper.addDays(today, -30)

    let passCount = 0
    let warnCount = 0
    let failCount = 0

    for (const dataSet of datasets) {
      try {
        const timelinessReport = await this.checkTimeliness(dataSet)
        await this.writeCheckResult(timelinessReport)

        const completenessReport = await this.checkCompleteness(dataSet, thirtyDaysAgo, today)
        await this.writeCheckResult(completenessReport)

        const reports = [timelinessReport, completenessReport]
        for (const r of reports) {
          if (r.status === 'pass') passCount++
          else if (r.status === 'warn') warnCount++
          else failCount++
        }
      } catch (error) {
        this.logger.error(`[数据质量检查] ${dataSet} 检查失败: ${(error as Error).message}`)
      }
    }

    this.logger.log(
      `[数据质量检查] 完成：通过 ${passCount}，警告 ${warnCount}，失败 ${failCount}`,
    )
  }

  /**
   * 查询最近 N 天的质量检查结果
   */
  async getRecentChecks(days: number = 7) {
    const since = new Date()
    since.setDate(since.getDate() - days)
    return this.prisma.dataQualityCheck.findMany({
      where: { checkDate: { gte: since } },
      orderBy: { checkDate: 'desc' },
      take: 200,
    })
  }

  /**
   * 查询指定数据集的缺失日期（从最近一次 completeness fail/warn 记录中提取）
   */
  async getDataGaps(dataSet: string) {
    const latest = await this.prisma.dataQualityCheck.findFirst({
      where: {
        dataSet,
        checkType: 'completeness',
        status: { in: ['warn', 'fail'] },
      },
      orderBy: { checkDate: 'desc' },
    })
    if (!latest) return { dataSet, gaps: [] }
    const details = latest.details as Record<string, unknown> | null
    return { dataSet, gaps: (details?.missingDates as string[]) ?? [], total: details?.totalMissing ?? 0 }
  }

  /**
   * 查询数据校验异常日志
   */
  async getValidationLogs(opts: { task?: string; limit?: number }) {
    return this.prisma.dataValidationLog.findMany({
      where: opts.task ? { task: opts.task } : undefined,
      orderBy: { createdAt: 'desc' },
      take: opts.limit ?? 100,
    })
  }
}
