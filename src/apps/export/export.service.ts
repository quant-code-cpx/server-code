import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common'
import { PrismaService } from 'src/shared/prisma.service'
import { StockListService } from 'src/apps/stock/stock-list.service'
import { FactorScreeningService } from 'src/apps/factor/services/factor-screening.service'
import { formatDateToCompactTradeDate, parseCompactTradeDateToUtcDate } from 'src/common/utils/trade-date.util'
import {
  DEFAULT_STOCK_LIST_COLUMNS,
  ExportAlertAnomaliesDto,
  ExportFactorScreeningDto,
  ExportStockListDto,
  StockListColumn,
} from './dto/export.dto'
import dayjs from 'dayjs'

@Injectable()
export class ExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stockListService: StockListService,
    private readonly factorScreeningService: FactorScreeningService,
  ) {}

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
  async exportPortfolioHoldings(portfolioId: string, userId: number): Promise<{ filename: string; csv: string }> {
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

  /**
   * 导出股票列表为 CSV。
   * 支持与 /api/stock/list 相同的筛选条件，可自定义导出列。
   */
  async exportStockList(dto: ExportStockListDto): Promise<{ filename: string; csv: string }> {
    const query = dto.filters ?? {}
    const selectedCols: StockListColumn[] =
      dto.columns && dto.columns.length > 0 ? dto.columns : DEFAULT_STOCK_LIST_COLUMNS

    const items = await this.stockListService.findAllForExport(
      query as Parameters<typeof this.stockListService.findAllForExport>[0],
    )

    // 列头中文映射
    const COL_LABEL: Record<StockListColumn, string> = {
      tsCode: '股票代码',
      symbol: '股票简码',
      name: '名称',
      fullname: '全名',
      exchange: '交易所',
      market: '板块',
      industry: '行业',
      area: '地域',
      listStatus: '上市状态',
      listDate: '上市日期',
      latestTradeDate: '最新交易日',
      peTtm: 'PE_TTM',
      pb: 'PB',
      dvTtm: '股息率TTM(%)',
      totalMv: '总市值(万)',
      circMv: '流通市值(万)',
      turnoverRate: '换手率(%)',
      pctChg: '涨跌幅(%)',
      amount: '成交额(千)',
      close: '收盘价',
      vol: '成交量',
    }

    const headerRow = Object.fromEntries(selectedCols.map((c) => [c, COL_LABEL[c]])) as Record<string, unknown>
    const dataRows = items.map((item) =>
      Object.fromEntries(
        selectedCols.map((col) => {
          const v = item[col as keyof typeof item]
          if (v instanceof Date) return [col, v.toISOString().slice(0, 10)]
          return [col, v]
        }),
      ),
    )

    // 用中文列名作为首行
    const csvRows = dataRows.map((row) => Object.fromEntries(selectedCols.map((c) => [COL_LABEL[c], row[c]])))
    const csv = this.generateCsv(
      selectedCols.map((c) => COL_LABEL[c]),
      csvRows,
    )

    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const scopePart = dto.scope ? `_${dto.scope.replace(/[^a-zA-Z0-9_\u4e00-\u9fff]/g, '_')}` : ''
    const filename = `stock_list${scopePart}_${dateStr}.csv`

    return { filename, csv }
  }

  /**
   * 导出指定交易日的异动监控记录为 CSV。
   * 不传 tradeDate 则取数据库中最新的交易日。
   */
  async exportAlertAnomalies(dto: ExportAlertAnomaliesDto): Promise<{ filename: string; csv: string }> {
    let tradeDate: Date | undefined
    if (dto.tradeDate) {
      tradeDate = parseCompactTradeDateToUtcDate(dto.tradeDate)
    } else {
      const latest = await this.prisma.marketAnomaly.findFirst({
        orderBy: { tradeDate: 'desc' },
        select: { tradeDate: true },
      })
      if (!latest) {
        return {
          filename: 'alert_anomalies_empty.csv',
          csv: 'tradeDate,tsCode,stockName,anomalyType,value,threshold,strength,scannedAt\r\n',
        }
      }
      tradeDate = latest.tradeDate
    }

    const rows = await this.prisma.marketAnomaly.findMany({
      where: { tradeDate },
      orderBy: [{ anomalyType: 'asc' }, { value: 'desc' }],
    })

    const columns = ['tradeDate', 'tsCode', 'stockName', 'anomalyType', 'value', 'threshold', 'strength', 'scannedAt']
    const columnLabels = ['交易日', '代码', '名称', '异动类型', '指标值', '触发阈值', '强度', '扫描时间']

    const dataRows = rows.map((r) => ({
      交易日: dayjs(r.tradeDate).format('YYYYMMDD'),
      代码: r.tsCode,
      名称: r.stockName ?? '',
      异动类型: r.anomalyType,
      指标值: r.value,
      触发阈值: r.threshold,
      强度: r.threshold > 0 ? (r.value / r.threshold).toFixed(4) : r.value.toString(),
      扫描时间: dayjs(r.scannedAt).format('YYYY-MM-DD HH:mm:ss'),
    }))

    const csv = this.generateCsv(columnLabels, dataRows)
    const tradeDateStr = dto.tradeDate ?? formatDateToCompactTradeDate(tradeDate) ?? 'unknown'
    const filename = `alert_anomalies_${tradeDateStr}.csv`

    return { filename, csv }
  }

  /** 导出多因子筛选结果。 */
  async exportFactorScreening(dto: ExportFactorScreeningDto): Promise<{ filename: string; csv: string }> {
    const factorNames = [...new Set([...dto.conditions.map((c) => c.factorName), ...(dto.sortBy ? [dto.sortBy] : [])])]
    const selectedColumns = dto.columns?.length ? dto.columns : ['tsCode', 'name', 'industry', ...factorNames]

    const first = await this.factorScreeningService.screening({ ...dto, page: 1, pageSize: 200 })
    const allItems = [...first.items]
    const pageCount = Math.ceil(first.total / 200)
    for (let page = 2; page <= pageCount; page++) {
      const next = await this.factorScreeningService.screening({ ...dto, page, pageSize: 200 })
      allItems.push(...next.items)
    }

    const labelMap: Record<string, string> = { tsCode: '代码', name: '名称', industry: '行业' }
    const headerLabels = selectedColumns.map((c) => labelMap[c] ?? c)
    const csvRows = allItems.map((item) => {
      const row: Record<string, unknown> = {}
      for (const col of selectedColumns) {
        const label = labelMap[col] ?? col
        row[label] = col in item ? item[col as keyof typeof item] : item.factors[col]
      }
      return row
    })

    const csv = this.generateCsv(headerLabels, csvRows)
    const filename = `factor_screening_${dto.tradeDate}_${first.requestHash.slice(0, 8)}.csv`
    return { filename, csv }
  }
}
