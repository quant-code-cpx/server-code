import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common'
import { PrismaService } from 'src/shared/prisma.service'

@Injectable()
export class ExportService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 将列名和行数据转换为 CSV 字符串。
   * 处理 null 值、逗号和引号的转义。
   */
  generateCsv(columns: string[], rows: Record<string, unknown>[]): string {
    const escapeCsvField = (value: unknown): string => {
      if (value === null || value === undefined) return ''
      const str = String(value)
      if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
        return `"${str.replace(/"/g, '""')}"`
      }
      return str
    }

    const headerLine = columns.map(escapeCsvField).join(',')
    const dataLines = rows.map((row) => columns.map((col) => escapeCsvField(row[col])).join(','))

    return [headerLine, ...dataLines].join('\r\n')
  }

  /**
   * 导出回测交易明细为 CSV。
   * 验证回测运行属于当前用户。
   */
  async exportBacktestTrades(runId: string, userId: number): Promise<{ filename: string; csv: string }> {
    const run = await this.prisma.backtestRun.findUnique({
      where: { id: runId },
      select: { id: true, userId: true, name: true },
    })

    if (!run) {
      throw new NotFoundException('回测运行不存在')
    }
    if (run.userId !== userId) {
      throw new ForbiddenException('无权访问此回测运行')
    }

    const trades = await this.prisma.backtestTrade.findMany({
      where: { runId },
      orderBy: { tradeDate: 'asc' },
    })

    const columns = [
      'tradeDate',
      'tsCode',
      'side',
      'price',
      'quantity',
      'amount',
      'commission',
      'stampDuty',
      'slippageCost',
      'reason',
    ]

    const rows = trades.map((t) => ({
      tradeDate: t.tradeDate.toISOString().slice(0, 10),
      tsCode: t.tsCode,
      side: t.side,
      price: t.price?.toString() ?? null,
      quantity: t.quantity,
      amount: t.amount?.toString() ?? null,
      commission: t.commission?.toString() ?? null,
      stampDuty: t.stampDuty?.toString() ?? null,
      slippageCost: t.slippageCost?.toString() ?? null,
      reason: t.reason,
    }))

    const csv = this.generateCsv(columns, rows)
    const safeName = (run.name ?? 'backtest').replace(/[^a-zA-Z0-9_\u4e00-\u9fff-]/g, '_')
    const filename = `backtest_trades_${safeName}_${runId.slice(0, 8)}.csv`

    return { filename, csv }
  }

  /**
   * 导出因子快照数据为 CSV。
   * 因子定义为全局数据，仅做存在性检查。
   */
  async exportFactorValues(params: {
    factorId: string
    userId: number
    startDate?: string
    endDate?: string
  }): Promise<{ filename: string; csv: string }> {
    const factor = await this.prisma.factorDefinition.findUnique({
      where: { name: params.factorId },
      select: { name: true, label: true, isEnabled: true },
    })

    if (!factor) {
      throw new NotFoundException(`因子 "${params.factorId}" 不存在`)
    }
    if (!factor.isEnabled) {
      throw new NotFoundException(`因子 "${params.factorId}" 已禁用`)
    }

    const where: Record<string, unknown> = { factorName: factor.name }
    if (params.startDate || params.endDate) {
      const tradeDateFilter: Record<string, string> = {}
      if (params.startDate) tradeDateFilter.gte = params.startDate
      if (params.endDate) tradeDateFilter.lte = params.endDate
      where.tradeDate = tradeDateFilter
    }

    const snapshots = await this.prisma.factorSnapshot.findMany({
      where,
      orderBy: [{ tradeDate: 'asc' }, { tsCode: 'asc' }],
    })

    const columns = ['factorName', 'tradeDate', 'tsCode', 'value', 'percentile']

    const rows = snapshots.map((s) => ({
      factorName: s.factorName,
      tradeDate: s.tradeDate,
      tsCode: s.tsCode,
      value: s.value?.toString() ?? null,
      percentile: s.percentile?.toString() ?? null,
    }))

    const csv = this.generateCsv(columns, rows)
    const filename = `factor_values_${factor.name}.csv`

    return { filename, csv }
  }

  /**
   * 导出投资组合当前持仓为 CSV。
   * 验证投资组合属于当前用户。
   */
  async exportPortfolioHoldings(
    portfolioId: string,
    userId: number,
  ): Promise<{ filename: string; csv: string }> {
    const portfolio = await this.prisma.portfolio.findUnique({
      where: { id: portfolioId },
      select: { id: true, userId: true, name: true },
    })

    if (!portfolio) {
      throw new NotFoundException('投资组合不存在')
    }
    if (portfolio.userId !== userId) {
      throw new ForbiddenException('无权访问此投资组合')
    }

    const holdings = await this.prisma.portfolioHolding.findMany({
      where: { portfolioId },
      orderBy: { tsCode: 'asc' },
    })

    const columns = ['tsCode', 'stockName', 'quantity', 'avgCost']

    const rows = holdings.map((h) => ({
      tsCode: h.tsCode,
      stockName: h.stockName,
      quantity: h.quantity,
      avgCost: h.avgCost?.toString() ?? null,
    }))

    const csv = this.generateCsv(columns, rows)
    const safeName = (portfolio.name ?? 'portfolio').replace(/[^a-zA-Z0-9_\u4e00-\u9fff-]/g, '_')
    const filename = `portfolio_holdings_${safeName}.csv`

    return { filename, csv }
  }
}
