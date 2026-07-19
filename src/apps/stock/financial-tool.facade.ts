import { Inject, Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { AgentToolsConfig, type IAgentToolsConfig } from 'src/config/agent-tools.config'
import { PrismaService } from 'src/shared/prisma.service'

export const FINANCIAL_STATEMENT_TYPES = ['INCOME', 'BALANCE_SHEET', 'CASH_FLOW'] as const
export const FINANCIAL_INDICATOR_KEYS = [
  'eps',
  'diluted_eps',
  'total_revenue_per_share',
  'revenue_per_share',
  'gross_profit_margin',
  'net_profit_margin',
  'roe',
  'diluted_roe',
  'roa',
  'invested_capital_return',
  'debt_to_assets',
  'current_ratio',
  'quick_ratio',
  'cash_ratio',
  'fcff',
  'fcfe',
  'ebit',
  'ebitda',
  'net_debt',
  'operating_cashflow_to_net_profit',
  'operating_cashflow_to_revenue',
  'revenue_yoy',
  'net_profit_yoy',
  'operating_cashflow_yoy',
  'diluted_eps_yoy',
  'roe_yoy',
  'book_value_per_share_yoy',
  'assets_yoy',
  'equity_yoy',
  'total_revenue_yoy',
] as const

export type FinancialStatementType = (typeof FINANCIAL_STATEMENT_TYPES)[number]
export type FinancialIndicatorKey = (typeof FINANCIAL_INDICATOR_KEYS)[number]
export type FinancialPeriodType = 'QUARTERLY' | 'ANNUAL'
export type FinancialMetricUnit = 'CNY' | 'CNY_PER_SHARE' | 'PERCENT' | 'RATIO' | 'SHARE_10K'

export interface FinancialStatementsInput {
  tsCode: string
  statementTypes: FinancialStatementType[]
  periodType: FinancialPeriodType
  startReportPeriod?: string
  endReportPeriod?: string
  availableAt?: string
  limit: number
}

export interface FinancialIndicatorsInput {
  tsCode: string
  indicators: string[]
  startReportPeriod?: string
  endReportPeriod?: string
  availableAt?: string
  limit: number
}

export interface FinancialToolWarning {
  code: string
  message: string
  affectedFields?: string[]
}

export class FinancialToolInvalidArgumentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = FinancialToolInvalidArgumentError.name
  }
}

export class FinancialToolDataQualityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = FinancialToolDataQualityError.name
  }
}

interface StatementMetricDefinition {
  key: string
  prismaField: string
  sourceField: string
  unit: FinancialMetricUnit
  additive: boolean
}

interface IndicatorDefinition {
  prismaField: string
  sourceField: string
  unit: FinancialMetricUnit
}

interface CommonStatementRow {
  id: bigint
  annDate: Date | null
  fAnnDate: Date | null
  endDate: Date
  reportType: string | null
  updateFlag: string | null
  syncedAt: Date
  [key: string]: unknown
}

interface IndicatorRow {
  tsCode: string
  annDate: Date | null
  endDate: Date
  syncedAt: Date
  [key: string]: unknown
}

const INCOME_METRICS: readonly StatementMetricDefinition[] = [
  metric('totalRevenue', 'total_revenue', 'CNY'),
  metric('revenue', 'revenue', 'CNY'),
  metric('operateProfit', 'operate_profit', 'CNY'),
  metric('totalProfit', 'total_profit', 'CNY'),
  metric('nIncome', 'n_income', 'CNY'),
  metric('nIncomeAttrP', 'n_income_attr_p', 'CNY'),
  metric('sellExp', 'sell_exp', 'CNY'),
  metric('adminExp', 'admin_exp', 'CNY'),
  metric('finExp', 'fin_exp', 'CNY'),
  metric('rdExp', 'rd_exp', 'CNY'),
  metric('ebit', 'ebit', 'CNY'),
  metric('ebitda', 'ebitda', 'CNY'),
  metric('basicEps', 'basic_eps', 'CNY_PER_SHARE', false),
  metric('dilutedEps', 'diluted_eps', 'CNY_PER_SHARE', false),
]

const BALANCE_SHEET_METRICS: readonly StatementMetricDefinition[] = [
  metric('totalAssets', 'total_assets', 'CNY', false),
  metric('totalCurAssets', 'total_cur_assets', 'CNY', false),
  metric('totalNca', 'total_nca', 'CNY', false),
  metric('moneyCap', 'money_cap', 'CNY', false),
  metric('inventories', 'inventories', 'CNY', false),
  metric('accountsReceiv', 'accounts_receiv', 'CNY', false),
  metric('totalLiab', 'total_liab', 'CNY', false),
  metric('totalCurLiab', 'total_cur_liab', 'CNY', false),
  metric('totalNcl', 'total_ncl', 'CNY', false),
  metric('stBorr', 'st_borr', 'CNY', false),
  metric('ltBorr', 'lt_borr', 'CNY', false),
  metric('totalHldrEqyExcMinInt', 'total_hldr_eqy_exc_min_int', 'CNY', false),
  metric('totalHldrEqyIncMinInt', 'total_hldr_eqy_inc_min_int', 'CNY', false),
  metric('totalShare', 'total_share', 'SHARE_10K', false),
]

const CASH_FLOW_METRICS: readonly StatementMetricDefinition[] = [
  metric('nCashflowAct', 'n_cashflow_act', 'CNY'),
  metric('nCashflowInvAct', 'n_cashflow_inv_act', 'CNY'),
  metric('nCashFlowsFncAct', 'n_cash_flows_fnc_act', 'CNY'),
  metric('freeCashflow', 'free_cashflow', 'CNY'),
  metric('nIncrCashCashEqu', 'n_incr_cash_cash_equ', 'CNY'),
  metric('cFrSaleSg', 'c_fr_sale_sg', 'CNY'),
  metric('cPaidGoodsS', 'c_paid_goods_s', 'CNY'),
]

const INDICATOR_DEFINITIONS: Readonly<Record<FinancialIndicatorKey, IndicatorDefinition>> = {
  eps: indicator('eps', 'eps', 'CNY_PER_SHARE'),
  diluted_eps: indicator('dtEps', 'dt_eps', 'CNY_PER_SHARE'),
  total_revenue_per_share: indicator('totalRevenuePers', 'total_revenue_ps', 'CNY_PER_SHARE'),
  revenue_per_share: indicator('revenuePers', 'revenue_ps', 'CNY_PER_SHARE'),
  gross_profit_margin: indicator('grossprofit_margin', 'grossprofit_margin', 'PERCENT'),
  net_profit_margin: indicator('netprofit_margin', 'netprofit_margin', 'PERCENT'),
  roe: indicator('roe', 'roe', 'PERCENT'),
  diluted_roe: indicator('dtRoe', 'dt_roe', 'PERCENT'),
  roa: indicator('roa', 'roa', 'PERCENT'),
  invested_capital_return: indicator('roa2', 'roa2', 'PERCENT'),
  debt_to_assets: indicator('debtToAssets', 'debt_to_assets', 'PERCENT'),
  current_ratio: indicator('currentRatio', 'current_ratio', 'RATIO'),
  quick_ratio: indicator('quickRatio', 'quick_ratio', 'RATIO'),
  cash_ratio: indicator('cashRatio', 'cash_ratio', 'RATIO'),
  fcff: indicator('fcff', 'fcff', 'CNY'),
  fcfe: indicator('fcfe', 'fcfe', 'CNY'),
  ebit: indicator('ebit', 'ebit', 'CNY'),
  ebitda: indicator('ebitda', 'ebitda', 'CNY'),
  net_debt: indicator('netdebt', 'netdebt', 'CNY'),
  operating_cashflow_to_net_profit: indicator('ocfToNetprofit', 'ocf_to_netprofit', 'RATIO'),
  operating_cashflow_to_revenue: indicator('ocfToOr', 'ocf_to_or', 'RATIO'),
  revenue_yoy: indicator('revenueYoy', 'revenue_yoy', 'PERCENT'),
  net_profit_yoy: indicator('netprofitYoy', 'netprofit_yoy', 'PERCENT'),
  operating_cashflow_yoy: indicator('ocfYoy', 'ocf_yoy', 'PERCENT'),
  diluted_eps_yoy: indicator('dtEpsYoy', 'dt_eps_yoy', 'PERCENT'),
  roe_yoy: indicator('roeYoy', 'roe_yoy', 'PERCENT'),
  book_value_per_share_yoy: indicator('bpsYoy', 'bps_yoy', 'PERCENT'),
  assets_yoy: indicator('assetsYoy', 'assets_yoy', 'PERCENT'),
  equity_yoy: indicator('eqtYoy', 'eqt_yoy', 'PERCENT'),
  total_revenue_yoy: indicator('trYoy', 'tr_yoy', 'PERCENT'),
}

const COMMON_STATEMENT_SELECT = {
  id: true,
  annDate: true,
  fAnnDate: true,
  endDate: true,
  reportType: true,
  updateFlag: true,
  syncedAt: true,
}

const INCOME_SELECT = Object.freeze({
  ...COMMON_STATEMENT_SELECT,
  ...selectFields(INCOME_METRICS),
}) satisfies Prisma.IncomeSelect

const BALANCE_SHEET_SELECT = Object.freeze({
  ...COMMON_STATEMENT_SELECT,
  ...selectFields(BALANCE_SHEET_METRICS),
}) satisfies Prisma.BalanceSheetSelect

const CASH_FLOW_SELECT = Object.freeze({
  ...COMMON_STATEMENT_SELECT,
  ...selectFields(CASH_FLOW_METRICS),
}) satisfies Prisma.CashflowSelect

@Injectable()
export class FinancialToolFacade {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(AgentToolsConfig.KEY) private readonly config: IAgentToolsConfig,
  ) {}

  async getStatements(input: FinancialStatementsInput) {
    const statementTypes = normalizeStatementTypes(input.statementTypes)
    const maximum = Math.min(12, this.config.financialMaxPeriods)
    assertLimit(input.limit, maximum, '财务报表期数')
    const reportRange = parseOptionalRange(input.startReportPeriod, input.endReportPeriod, '报告期')
    const availableDate = input.availableAt ? parseAvailableDate(input.availableAt) : null
    const queryRange = {
      gte: reportRange.start ? startOfYear(reportRange.start) : undefined,
      lte: reportRange.end,
    }
    const take = Math.max(64, (input.limit + 4) * 8)

    const statements = await Promise.all(
      statementTypes.map(async (statementType) => {
        const rows = await this.loadStatementRows(statementType, input.tsCode, queryRange, availableDate, take)
        return this.buildStatementSection(statementType, rows, input, reportRange, availableDate)
      }),
    )

    const warnings = uniqueWarnings(statements.flatMap((statement) => statement.warnings))
    if (availableDate) {
      warnings.push({
        code: 'ANNOUNCEMENT_DATE_PRECISION',
        message: '财务公告只保存日历日，历史过滤精度为 Asia/Shanghai 日期而非盘中时刻',
      })
    }
    const periods = statements.flatMap((statement) => statement.periods)

    return {
      data: {
        tsCode: input.tsCode,
        periodType: input.periodType,
        requestedAvailableAt: input.availableAt ?? null,
        statements: statements.map(({ statementType, periods }) => ({ statementType, periods })),
      },
      warnings: uniqueWarnings(warnings),
      asOf:
        periods
          .map((period) => period.reportPeriod)
          .sort()
          .at(-1) ?? null,
      availableAsOf:
        periods
          .map((period) => period.availableAt)
          .filter((value): value is string => value !== null)
          .sort()
          .at(-1) ?? null,
      sourceModels: statementTypes.map(statementModel),
    }
  }

  async getIndicators(input: FinancialIndicatorsInput) {
    const indicatorKeys = normalizeIndicatorKeys(input.indicators)
    assertLimit(input.limit, this.config.financialMaxPeriods, '财务指标期数')
    const reportRange = parseOptionalRange(input.startReportPeriod, input.endReportPeriod, '报告期')
    const availableDate = input.availableAt ? parseAvailableDate(input.availableAt) : null
    const select: Record<string, boolean> = { tsCode: true, annDate: true, endDate: true, syncedAt: true }
    for (const key of indicatorKeys) select[INDICATOR_DEFINITIONS[key].prismaField] = true

    const rows = (await this.prisma.finaIndicator.findMany({
      where: {
        tsCode: input.tsCode,
        ...(reportRange.start || reportRange.end
          ? {
              endDate: {
                ...(reportRange.start ? { gte: reportRange.start } : {}),
                ...(reportRange.end ? { lte: reportRange.end } : {}),
              },
            }
          : {}),
        ...(availableDate ? { annDate: { not: null, lte: availableDate } } : {}),
      },
      orderBy: { endDate: 'desc' },
      take: input.limit + 1,
      select: select as Prisma.FinaIndicatorSelect,
    })) as unknown as IndicatorRow[]

    const visibleRows = rows
      .filter((row) => !availableDate || (!!row.annDate && row.annDate.getTime() <= availableDate.getTime()))
      .filter((row) => isCanonicalQuarter(row.endDate))
    const truncated = visibleRows.length > input.limit
    const selectedRows = visibleRows
      .slice(0, input.limit)
      .sort((left, right) => left.endDate.getTime() - right.endDate.getTime())
    const warnings: FinancialToolWarning[] = []

    if (availableDate) {
      warnings.push(
        {
          code: 'POINT_IN_TIME_REVISION_UNAVAILABLE',
          message: '财务指标表每个报告期只保留一行，无法恢复已被覆盖的历史修订版本',
        },
        {
          code: 'ANNOUNCEMENT_DATE_PRECISION',
          message: '财务公告只保存日历日，历史过滤精度为 Asia/Shanghai 日期而非盘中时刻',
        },
      )
    }

    const periods = selectedRows.map((row) => {
      if (row.annDate && row.annDate.getTime() < row.endDate.getTime()) {
        throw new FinancialToolDataQualityError(`财务指标公告日早于报告期：${formatDate(row.endDate)}`)
      }
      if (!row.annDate) {
        warnings.push({
          code: 'MISSING_ANNOUNCEMENT_DATE',
          message: '财务指标缺少公告日，只允许当前查询使用',
          affectedFields: [formatDate(row.endDate)],
        })
      }
      return {
        reportPeriod: formatDate(row.endDate),
        announcementDate: formatNullableDate(row.annDate),
        values: indicatorKeys.map((key) => {
          const definition = INDICATOR_DEFINITIONS[key]
          return {
            key,
            sourceField: definition.sourceField,
            value: nullableNumber(row[definition.prismaField]),
            unit: definition.unit,
          }
        }),
      }
    })

    return {
      data: {
        tsCode: input.tsCode,
        requestedAvailableAt: input.availableAt ?? null,
        indicators: indicatorKeys,
        periods,
      },
      warnings: uniqueWarnings(warnings),
      truncated,
      asOf: periods.at(-1)?.reportPeriod ?? null,
      availableAsOf:
        periods
          .map((period) => period.announcementDate)
          .filter((value): value is string => value !== null)
          .sort()
          .at(-1) ?? null,
      sourceModels: ['FinaIndicator'],
    }
  }

  private async loadStatementRows(
    statementType: FinancialStatementType,
    tsCode: string,
    reportRange: { gte?: Date; lte?: Date },
    availableDate: Date | null,
    take: number,
  ): Promise<CommonStatementRow[]> {
    const where = {
      tsCode,
      reportType: '1',
      ...(reportRange.gte || reportRange.lte
        ? {
            endDate: {
              ...(reportRange.gte ? { gte: reportRange.gte } : {}),
              ...(reportRange.lte ? { lte: reportRange.lte } : {}),
            },
          }
        : {}),
      ...(availableDate
        ? {
            OR: [{ fAnnDate: { lte: availableDate } }, { fAnnDate: null, annDate: { not: null, lte: availableDate } }],
          }
        : {}),
    }
    const orderBy = [
      { endDate: 'desc' as const },
      { updateFlag: 'desc' as const },
      { fAnnDate: 'desc' as const },
      { annDate: 'desc' as const },
      { syncedAt: 'desc' as const },
      { id: 'desc' as const },
    ]

    if (statementType === 'INCOME') {
      return (await this.prisma.income.findMany({
        where,
        orderBy,
        take,
        select: INCOME_SELECT,
      })) as CommonStatementRow[]
    }
    if (statementType === 'BALANCE_SHEET') {
      return (await this.prisma.balanceSheet.findMany({
        where,
        orderBy,
        take,
        select: BALANCE_SHEET_SELECT,
      })) as CommonStatementRow[]
    }
    return (await this.prisma.cashflow.findMany({
      where,
      orderBy,
      take,
      select: CASH_FLOW_SELECT,
    })) as CommonStatementRow[]
  }

  private buildStatementSection(
    statementType: FinancialStatementType,
    rows: CommonStatementRow[],
    input: FinancialStatementsInput,
    reportRange: { start?: Date; end?: Date },
    availableDate: Date | null,
  ) {
    const warnings: FinancialToolWarning[] = []
    const visibleRows = rows
      .filter(
        (row) =>
          !availableDate || (!!availabilityDate(row) && availabilityDate(row)!.getTime() <= availableDate.getTime()),
      )
      .filter((row) => isCanonicalQuarter(row.endDate))
    const grouped = new Map<string, CommonStatementRow[]>()
    for (const row of visibleRows) {
      const key = formatDate(row.endDate)
      grouped.set(key, [...(grouped.get(key) ?? []), row])
    }

    const selectedByPeriod = new Map<string, CommonStatementRow>()
    const revisionCounts = new Map<string, number>()
    for (const [period, candidates] of grouped) {
      const selected = [...candidates].sort(compareStatementRevisions)[0]
      if (!selected) continue
      selectedByPeriod.set(period, selected)
      revisionCounts.set(period, candidates.length)
    }

    const selectedRows = [...selectedByPeriod.values()]
      .filter((row) => matchesPeriodType(row.endDate, input.periodType))
      .filter((row) => !reportRange.start || row.endDate.getTime() >= reportRange.start.getTime())
      .filter((row) => !reportRange.end || row.endDate.getTime() <= reportRange.end.getTime())
      .sort((left, right) => right.endDate.getTime() - left.endDate.getTime())
      .slice(0, input.limit)
      .sort((left, right) => left.endDate.getTime() - right.endDate.getTime())

    const metrics = statementMetrics(statementType)
    const periods = selectedRows.map((row) => {
      const period = formatDate(row.endDate)
      const available = availabilityDate(row)
      if (available && available.getTime() < row.endDate.getTime()) {
        throw new FinancialToolDataQualityError(`${statementType} 公告日早于报告期：${period}`)
      }
      if (!available) {
        warnings.push({
          code: 'MISSING_ANNOUNCEMENT_DATE',
          message: `${statementType} 缺少公告日，只允许当前查询使用`,
          affectedFields: [period],
        })
      }
      const revisionCount = revisionCounts.get(period) ?? 1
      if (revisionCount > 1) {
        warnings.push({
          code: 'REVISION_SELECTED',
          message: `${statementType} 同报告期存在多个版本，已按 updateFlag/可得日/同步时间稳定选版`,
          affectedFields: [period],
        })
      }

      const previous = selectedByPeriod.get(previousQuarterPeriod(row.endDate)) ?? null
      const quarter = quarterNumber(row.endDate)
      let missingPrevious = false
      const values = metrics.map((definition) => {
        const reportedValue = nullableNumber(row[definition.prismaField])
        let singleQuarterValue: number | null = null
        let singleQuarterDerived = false
        if (statementType !== 'BALANCE_SHEET' && definition.additive) {
          if (quarter === 1) {
            singleQuarterValue = reportedValue
            singleQuarterDerived = reportedValue !== null
          } else {
            const previousValue = previous ? nullableNumber(previous[definition.prismaField]) : null
            if (reportedValue !== null && previousValue !== null) {
              singleQuarterValue = subtract(reportedValue, previousValue)
              singleQuarterDerived = true
            } else if (reportedValue !== null) {
              missingPrevious = true
            }
          }
        }
        return {
          key: definition.key,
          sourceField: definition.sourceField,
          unit: definition.unit,
          valueBasis: statementType === 'BALANCE_SHEET' ? ('POINT_IN_TIME' as const) : ('CUMULATIVE' as const),
          reportedValue,
          singleQuarterValue,
          singleQuarterDerived,
        }
      })
      if (missingPrevious) {
        warnings.push({
          code: 'SINGLE_QUARTER_UNAVAILABLE',
          message: `${statementType} 缺少同年上一季度累计值，部分单季派生值不可用`,
          affectedFields: [period],
        })
      }

      return {
        reportPeriod: period,
        announcementDate: formatNullableDate(row.annDate),
        availableAt: formatNullableDate(available),
        reportType: row.reportType,
        updateFlag: row.updateFlag,
        revisionCount,
        values,
      }
    })

    return { statementType, periods, warnings }
  }
}

function metric(
  prismaField: string,
  sourceField: string,
  unit: FinancialMetricUnit,
  additive = true,
): StatementMetricDefinition {
  return { key: sourceField, prismaField, sourceField, unit, additive }
}

function indicator(prismaField: string, sourceField: string, unit: FinancialMetricUnit): IndicatorDefinition {
  return { prismaField, sourceField, unit }
}

function selectFields(definitions: readonly StatementMetricDefinition[]): Record<string, true> {
  return Object.fromEntries(definitions.map((definition) => [definition.prismaField, true]))
}

function statementMetrics(statementType: FinancialStatementType): readonly StatementMetricDefinition[] {
  if (statementType === 'INCOME') return INCOME_METRICS
  if (statementType === 'BALANCE_SHEET') return BALANCE_SHEET_METRICS
  return CASH_FLOW_METRICS
}

function statementModel(statementType: FinancialStatementType): string {
  if (statementType === 'INCOME') return 'Income'
  if (statementType === 'BALANCE_SHEET') return 'BalanceSheet'
  return 'Cashflow'
}

function normalizeStatementTypes(values: FinancialStatementType[]): FinancialStatementType[] {
  if (!Array.isArray(values) || values.length < 1 || values.length > 3) {
    throw new FinancialToolInvalidArgumentError('statementTypes 必须包含 1-3 个报表类型')
  }
  const normalized = [...new Set(values)]
  if (normalized.length !== values.length || normalized.some((value) => !FINANCIAL_STATEMENT_TYPES.includes(value))) {
    throw new FinancialToolInvalidArgumentError('statementTypes 包含重复或未知报表类型')
  }
  return normalized
}

function normalizeIndicatorKeys(values: string[]): FinancialIndicatorKey[] {
  if (!Array.isArray(values) || values.length < 1 || values.length > 30) {
    throw new FinancialToolInvalidArgumentError('indicators 必须包含 1-30 个指标')
  }
  const normalized = [...new Set(values)]
  if (normalized.length !== values.length) throw new FinancialToolInvalidArgumentError('indicators 不能重复')
  for (const value of normalized) {
    if (!FINANCIAL_INDICATOR_KEYS.includes(value as FinancialIndicatorKey)) {
      throw new FinancialToolInvalidArgumentError(`未知财务指标：${value}`)
    }
  }
  return normalized as FinancialIndicatorKey[]
}

function assertLimit(value: number, maximum: number, label: string): void {
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new FinancialToolInvalidArgumentError(`${label}必须是 1-${maximum} 的整数`)
  }
}

function parseOptionalRange(startValue: string | undefined, endValue: string | undefined, label: string) {
  const start = startValue ? parseIsoDate(startValue, `${label}开始日期`) : undefined
  const end = endValue ? parseIsoDate(endValue, `${label}结束日期`) : undefined
  if (start && end && start.getTime() > end.getTime()) {
    throw new FinancialToolInvalidArgumentError(`${label}开始日期不能晚于结束日期`)
  }
  return { start, end }
}

function parseIsoDate(value: string, label: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new FinancialToolInvalidArgumentError(`${label}格式必须为 YYYY-MM-DD`)
  const parsed = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime()) || formatDate(parsed) !== value) {
    throw new FinancialToolInvalidArgumentError(`${label}不是有效日历日期`)
  }
  return parsed
}

function parseAvailableDate(value: string): Date {
  const instant = new Date(value)
  if (Number.isNaN(instant.getTime())) throw new FinancialToolInvalidArgumentError('availableAt 不是有效日期时间')
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant)
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ''
  return parseIsoDate(`${get('year')}-${get('month')}-${get('day')}`, 'availableAt')
}

function startOfYear(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
}

function availabilityDate(row: CommonStatementRow): Date | null {
  return row.fAnnDate ?? row.annDate
}

function compareStatementRevisions(left: CommonStatementRow, right: CommonStatementRow): number {
  const updateDifference = updateFlagRank(right.updateFlag) - updateFlagRank(left.updateFlag)
  if (updateDifference) return updateDifference
  const availableDifference = (availabilityDate(right)?.getTime() ?? 0) - (availabilityDate(left)?.getTime() ?? 0)
  if (availableDifference) return availableDifference
  const syncDifference = right.syncedAt.getTime() - left.syncedAt.getTime()
  if (syncDifference) return syncDifference
  return left.id === right.id ? 0 : left.id < right.id ? 1 : -1
}

function updateFlagRank(value: string | null): number {
  return value === '1' ? 2 : value === '0' ? 1 : 0
}

function matchesPeriodType(date: Date, periodType: FinancialPeriodType): boolean {
  return periodType === 'ANNUAL' ? date.getUTCMonth() === 11 && date.getUTCDate() === 31 : isCanonicalQuarter(date)
}

function isCanonicalQuarter(date: Date): boolean {
  const key = `${date.getUTCMonth() + 1}-${date.getUTCDate()}`
  return key === '3-31' || key === '6-30' || key === '9-30' || key === '12-31'
}

function quarterNumber(date: Date): number {
  return Math.floor(date.getUTCMonth() / 3) + 1
}

function previousQuarterPeriod(date: Date): string {
  const year = date.getUTCFullYear()
  const quarter = quarterNumber(date)
  if (quarter === 1) return `${year - 1}-12-31`
  if (quarter === 2) return `${year}-03-31`
  if (quarter === 3) return `${year}-06-30`
  return `${year}-09-30`
}

function nullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function subtract(current: number, previous: number): number {
  return Number((current - previous).toPrecision(15))
}

function formatNullableDate(value: Date | null): string | null {
  return value ? formatDate(value) : null
}

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10)
}

function uniqueWarnings(warnings: FinancialToolWarning[]): FinancialToolWarning[] {
  const seen = new Set<string>()
  return warnings.filter((warning) => {
    const key = `${warning.code}:${(warning.affectedFields ?? []).join(',')}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
