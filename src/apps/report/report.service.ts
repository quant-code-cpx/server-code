import { Injectable, Logger } from '@nestjs/common'
import { Prisma, ReportFormat, ReportStatus, ReportType } from '@prisma/client'

import { BusinessException } from 'src/common/exceptions/business.exception'
import { PrismaService } from 'src/shared/prisma.service'
import {
  CreateBacktestReportDto,
  CreatePortfolioReportDto,
  CreateStockReportDto,
  CreateStrategyResearchReportDto,
  QueryReportsDto,
  ReportFormatEnum,
} from './dto/create-report.dto'
import { ReportDataCollectorService } from './services/report-data-collector.service'
import { ReportRendererService } from './services/report-renderer.service'

const TEMPLATE_MAP: Record<ReportType, string> = {
  [ReportType.BACKTEST]: 'backtest',
  [ReportType.STOCK]: 'stock',
  [ReportType.PORTFOLIO]: 'portfolio',
  [ReportType.STRATEGY_RESEARCH]: 'strategy-research',
}

@Injectable()
export class ReportService {
  private readonly logger = new Logger(ReportService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly dataCollector: ReportDataCollectorService,
    private readonly renderer: ReportRendererService,
  ) {}

  // ─── 创建回测报告 ─────────────────────────────────────────────────────────

  async createBacktestReport(dto: CreateBacktestReportDto, userId: number) {
    const run = await this.prisma.backtestRun.findFirst({
      where: { id: dto.runId, userId },
    })
    if (!run) throw new BusinessException('回测记录不存在或无权访问')

    const title = dto.title ?? `回测报告 - ${run.name ?? run.strategyType}`
    return this.generateReport({
      userId,
      type: ReportType.BACKTEST,
      title,
      params: { runId: dto.runId },
      format: this.toFormat(dto.format),
      collect: () => this.dataCollector.collectBacktestData(dto.runId),
    })
  }

  // ─── 创建个股报告 ─────────────────────────────────────────────────────────

  async createStockReport(dto: CreateStockReportDto, userId: number) {
    const stock = await this.prisma.stockBasic.findUnique({
      where: { tsCode: dto.tsCode },
    })
    if (!stock) throw new BusinessException('股票代码不存在')

    const title = dto.title ?? `个股报告 - ${stock.name}(${dto.tsCode})`
    return this.generateReport({
      userId,
      type: ReportType.STOCK,
      title,
      params: { tsCode: dto.tsCode },
      format: this.toFormat(dto.format),
      collect: () => this.dataCollector.collectStockData(dto.tsCode),
    })
  }

  // ─── 创建组合报告 ─────────────────────────────────────────────────────────

  async createPortfolioReport(dto: CreatePortfolioReportDto, userId: number) {
    const portfolio = await this.prisma.portfolio.findFirst({
      where: { id: dto.portfolioId, userId },
    })
    if (!portfolio) throw new BusinessException('组合不存在或无权访问')

    const title = dto.title ?? `组合报告 - ${portfolio.name}`
    return this.generateReport({
      userId,
      type: ReportType.PORTFOLIO,
      title,
      params: { portfolioId: dto.portfolioId },
      format: this.toFormat(dto.format),
      collect: () => this.dataCollector.collectPortfolioData(dto.portfolioId, userId),
    })
  }

  // ─── 查询报告列表 ─────────────────────────────────────────────────────────

  async queryReports(dto: QueryReportsDto, userId: number) {
    const where: Record<string, unknown> = { userId }
    if (dto.type) where.type = dto.type

    const [items, total] = await Promise.all([
      this.prisma.report.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: ((dto.page ?? 1) - 1) * (dto.pageSize ?? 20),
        take: dto.pageSize ?? 20,
        select: {
          id: true,
          type: true,
          title: true,
          format: true,
          status: true,
          fileSize: true,
          createdAt: true,
          completedAt: true,
        },
      }),
      this.prisma.report.count({ where }),
    ])

    return { items, total, page: dto.page ?? 1, pageSize: dto.pageSize ?? 20 }
  }

  // ─── 获取报告详情 ─────────────────────────────────────────────────────────

  async getReportDetail(reportId: string, userId: number) {
    const report = await this.prisma.report.findFirst({
      where: { id: reportId, userId },
    })
    if (!report) throw new BusinessException('报告不存在或无权访问')
    return report
  }

  // ─── 删除报告 ─────────────────────────────────────────────────────────────

  async deleteReport(reportId: string, userId: number) {
    const report = await this.prisma.report.findFirst({
      where: { id: reportId, userId },
    })
    if (!report) throw new BusinessException('报告不存在或无权访问')

    await this.prisma.report.delete({ where: { id: reportId } })
    // TODO: 如果有文件，异步清理磁盘
    return { deleted: true }
  }

  // ─── 核心生成流程 ─────────────────────────────────────────────────────────

  private async generateReport(opts: {
    userId: number
    type: ReportType
    title: string
    params: Record<string, unknown>
    format: ReportFormat
    collect: () => Promise<unknown>
  }) {
    // 1. 创建 pending 记录
    const report = await this.prisma.report.create({
      data: {
        userId: opts.userId,
        type: opts.type,
        title: opts.title,
        params: opts.params as Prisma.InputJsonValue,
        format: opts.format,
        status: ReportStatus.PENDING,
      },
    })

    try {
      // 2. 标记为生成中
      await this.prisma.report.update({
        where: { id: report.id },
        data: { status: ReportStatus.GENERATING },
      })

      // 3. 收集数据
      const data = (await opts.collect()) as Record<string, unknown>

      // 4. 根据格式渲染
      let filePath: string | null = null
      let fileSize: number | null = null

      if (opts.format === ReportFormat.HTML) {
        const templateName = TEMPLATE_MAP[opts.type]
        const result = await this.renderer.renderToHtmlFile(templateName, data, report.id)
        filePath = result.filePath ?? null
        fileSize = result.fileSize ?? null
      } else if (opts.format === ReportFormat.PDF) {
        const templateName = TEMPLATE_MAP[opts.type]
        const result = await this.renderer.renderToPdf(templateName, data, report.id)
        filePath = result.filePath ?? null
        fileSize = result.fileSize ?? null
      }

      // 5. 更新 completed
      return this.prisma.report.update({
        where: { id: report.id },
        data: {
          status: ReportStatus.COMPLETED,
          data: data as object as Prisma.InputJsonValue,
          filePath,
          fileSize,
          completedAt: new Date(),
        },
      })
    } catch (error) {
      this.logger.error(`报告生成失败 [${report.id}]`, error)
      await this.prisma.report.update({
        where: { id: report.id },
        data: {
          status: ReportStatus.FAILED,
          errorMessage: error instanceof Error ? error.message : String(error),
        },
      })
      throw new BusinessException('报告生成失败，请稍后重试')
    }
  }

  // ─── 创建策略研究报告 ──────────────────────────────────────────────────────

  async createStrategyResearchReport(dto: CreateStrategyResearchReportDto, userId: number) {
    const run = await this.prisma.backtestRun.findFirst({
      where: { id: dto.backtestRunId, userId },
    })
    if (!run) throw new BusinessException('回测记录不存在或无权访问')

    const title = dto.title ?? `策略研究报告 - ${run.name ?? run.strategyType}`
    return this.generateReport({
      userId,
      type: ReportType.STRATEGY_RESEARCH,
      title,
      params: { backtestRunId: dto.backtestRunId, strategyId: dto.strategyId, portfolioId: dto.portfolioId },
      format: this.toFormat(dto.format),
      collect: () =>
        this.dataCollector.collectStrategyResearchData(dto.backtestRunId, userId, {
          portfolioId: dto.portfolioId,
          sections: dto.sections,
        }),
    })
  }

  private toFormat(format?: ReportFormatEnum): ReportFormat {
    if (!format) return ReportFormat.JSON
    return ReportFormat[format]
  }
}
