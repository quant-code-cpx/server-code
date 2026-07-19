import { Test } from '@nestjs/testing'
import { AgentToolsConfig } from 'src/config/agent-tools.config'
import { PrismaService } from 'src/shared/prisma.service'
import {
  FinancialToolDataQualityError,
  FinancialToolFacade,
  FinancialToolInvalidArgumentError,
} from '../financial-tool.facade'

const config = {
  enabledTools: [],
  maxCallsPerRun: 20,
  defaultTimeoutMs: 10_000,
  maxResultBytes: 256_000,
  maxConcurrentPerRun: 3,
  priceMaxBars: 5_000,
  marketCacheTtlSeconds: 300,
  financialMaxPeriods: 20,
  moneyflowMaxDays: 250,
}

function prismaMock() {
  return {
    income: { findMany: jest.fn() },
    balanceSheet: { findMany: jest.fn() },
    cashflow: { findMany: jest.fn() },
    finaIndicator: { findMany: jest.fn() },
  }
}

async function harness() {
  const prisma = prismaMock()
  const module = await Test.createTestingModule({
    providers: [
      FinancialToolFacade,
      { provide: PrismaService, useValue: prisma },
      { provide: AgentToolsConfig.KEY, useValue: config },
    ],
  }).compile()
  return { facade: module.get(FinancialToolFacade), prisma }
}

function statementRow(
  endDate: string,
  values: Record<string, unknown> = {},
  metadata: Partial<{
    id: bigint
    annDate: string | null
    fAnnDate: string | null
    updateFlag: string | null
    syncedAt: string
  }> = {},
) {
  const annDate = metadata.annDate === undefined ? nextMonth(endDate) : metadata.annDate
  const fAnnDate = metadata.fAnnDate === undefined ? annDate : metadata.fAnnDate
  return {
    id: metadata.id ?? 1n,
    annDate: annDate ? new Date(`${annDate}T00:00:00.000Z`) : null,
    fAnnDate: fAnnDate ? new Date(`${fAnnDate}T00:00:00.000Z`) : null,
    endDate: new Date(`${endDate}T00:00:00.000Z`),
    reportType: '1',
    updateFlag: metadata.updateFlag ?? '1',
    syncedAt: new Date(metadata.syncedAt ?? '2026-07-19T00:00:00.000Z'),
    ...values,
  }
}

function indicatorRow(endDate: string, annDate: string | null, values: Record<string, unknown>) {
  return {
    tsCode: '600519.SH',
    endDate: new Date(`${endDate}T00:00:00.000Z`),
    annDate: annDate ? new Date(`${annDate}T00:00:00.000Z`) : null,
    syncedAt: new Date('2026-07-19T00:00:00.000Z'),
    ...values,
  }
}

function nextMonth(endDate: string): string {
  const year = Number(endDate.slice(0, 4))
  const month = Number(endDate.slice(5, 7))
  if (month === 12) return `${year + 1}-04-30`
  if (month === 9) return `${year}-10-30`
  if (month === 6) return `${year}-08-30`
  return `${year}-04-30`
}

type StatementsResult = Awaited<ReturnType<FinancialToolFacade['getStatements']>>

function metricValue(
  result: StatementsResult,
  period: string,
  key: string,
  field: 'reportedValue' | 'singleQuarterValue',
) {
  const item = result.data.statements[0].periods.find((row) => row.reportPeriod === period)
  const value = item?.values.find((candidate) => candidate.key === key)
  if (!value) throw new Error(`missing metric ${period}:${key}`)
  return value[field]
}

describe('FinancialToolFacade', () => {
  it('[FMT-DATA-002] 四季度累计值独立推导为 100/160/190/250 单季值', async () => {
    const { facade, prisma } = await harness()
    prisma.income.findMany.mockResolvedValue([
      statementRow('2024-12-31', { totalRevenue: 700 }),
      statementRow('2024-09-30', { totalRevenue: 450 }),
      statementRow('2024-06-30', { totalRevenue: 260 }),
      statementRow('2024-03-31', { totalRevenue: 100 }),
    ])

    const result = await facade.getStatements({
      tsCode: '600519.SH',
      statementTypes: ['INCOME'],
      periodType: 'QUARTERLY',
      limit: 4,
    })

    expect(
      ['2024-03-31', '2024-06-30', '2024-09-30', '2024-12-31'].map((period) =>
        metricValue(result, period, 'total_revenue', 'singleQuarterValue'),
      ),
    ).toEqual([100, 160, 190, 250])
  })

  it('[FMT-EDGE-004] 缺上一季度或累计值 null 时单季值保持 null 并告警', async () => {
    const { facade, prisma } = await harness()
    prisma.income.findMany.mockResolvedValue([statementRow('2024-06-30', { totalRevenue: 260, nIncome: null })])

    const result = await facade.getStatements({
      tsCode: '600519.SH',
      statementTypes: ['INCOME'],
      periodType: 'QUARTERLY',
      limit: 1,
    })

    expect(metricValue(result, '2024-06-30', 'total_revenue', 'singleQuarterValue')).toBeNull()
    expect(metricValue(result, '2024-06-30', 'n_income', 'reportedValue')).toBeNull()
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'SINGLE_QUARTER_UNAVAILABLE' })]),
    )
  })

  it('[FMT-DATA-001] 同报告期优先 updateFlag=1，结果不受输入顺序影响', async () => {
    const { facade, prisma } = await harness()
    prisma.income.findMany.mockResolvedValue([
      statementRow('2024-03-31', { totalRevenue: 90 }, { id: 9n, updateFlag: '0' }),
      statementRow('2024-03-31', { totalRevenue: 100 }, { id: 1n, updateFlag: '1' }),
    ])

    const result = await facade.getStatements({
      tsCode: '600519.SH',
      statementTypes: ['INCOME'],
      periodType: 'QUARTERLY',
      limit: 1,
    })
    const period = result.data.statements[0].periods[0]

    expect(metricValue(result, '2024-03-31', 'total_revenue', 'reportedValue')).toBe(100)
    expect(period).toMatchObject({ updateFlag: '1', revisionCount: 2 })
    expect(result.warnings).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'REVISION_SELECTED' })]))
  })

  it('[FMT-EDGE-001] availableAt 排除未来修订，公告日当天按上海日历日可见', async () => {
    const { facade, prisma } = await harness()
    prisma.income.findMany.mockResolvedValue([
      statementRow(
        '2024-03-31',
        { totalRevenue: 120 },
        { id: 2n, fAnnDate: '2024-05-10', annDate: '2024-05-10', updateFlag: '1' },
      ),
      statementRow(
        '2024-03-31',
        { totalRevenue: 100 },
        { id: 1n, fAnnDate: '2024-04-20', annDate: '2024-04-20', updateFlag: '0' },
      ),
    ])

    const result = await facade.getStatements({
      tsCode: '600519.SH',
      statementTypes: ['INCOME'],
      periodType: 'QUARTERLY',
      availableAt: '2024-04-20T00:00:00+08:00',
      limit: 1,
    })

    expect(metricValue(result, '2024-03-31', 'total_revenue', 'reportedValue')).toBe(100)
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'ANNOUNCEMENT_DATE_PRECISION' })]),
    )
  })

  it('[FMT-EDGE-005] 年报过滤仅保留 12-31，资产负债表只返回 POINT_IN_TIME', async () => {
    const { facade, prisma } = await harness()
    prisma.balanceSheet.findMany.mockResolvedValue([
      statementRow('2024-12-31', { totalAssets: 5000 }),
      statementRow('2024-09-30', { totalAssets: 4500 }),
    ])

    const result = await facade.getStatements({
      tsCode: '600519.SH',
      statementTypes: ['BALANCE_SHEET'],
      periodType: 'ANNUAL',
      limit: 2,
    })
    const period = result.data.statements[0].periods[0]
    const totalAssets = period.values.find((value) => value.key === 'total_assets')

    expect(result.data.statements[0].periods.map((item) => item.reportPeriod)).toEqual(['2024-12-31'])
    expect(totalAssets).toMatchObject({
      reportedValue: 5000,
      valueBasis: 'POINT_IN_TIME',
      singleQuarterValue: null,
      singleQuarterDerived: false,
    })
  })

  it('[FMT-ERR-004] 公告可得日早于报告期时 fail-closed', async () => {
    const { facade, prisma } = await harness()
    prisma.income.findMany.mockResolvedValue([
      statementRow('2024-03-31', { totalRevenue: 100 }, { annDate: '2024-03-01', fAnnDate: '2024-03-01' }),
    ])

    await expect(
      facade.getStatements({
        tsCode: '600519.SH',
        statementTypes: ['INCOME'],
        periodType: 'QUARTERLY',
        limit: 1,
      }),
    ).rejects.toBeInstanceOf(FinancialToolDataQualityError)
  })

  it('[FMT-BIZ-003/DATA-005] 指标 allowlist 返回 canonical key、上游字段、值和单位，null 不转 0', async () => {
    const { facade, prisma } = await harness()
    prisma.finaIndicator.findMany.mockResolvedValue([
      indicatorRow('2024-03-31', '2024-04-30', { grossprofit_margin: 35, currentRatio: 1.5, fcff: null }),
    ])

    const result = await facade.getIndicators({
      tsCode: '600519.SH',
      indicators: ['gross_profit_margin', 'current_ratio', 'fcff'],
      limit: 1,
    })

    expect(result.data.periods[0].values).toEqual([
      { key: 'gross_profit_margin', sourceField: 'grossprofit_margin', value: 35, unit: 'PERCENT' },
      { key: 'current_ratio', sourceField: 'current_ratio', value: 1.5, unit: 'RATIO' },
      { key: 'fcff', sourceField: 'fcff', value: null, unit: 'CNY' },
    ])
  })

  it('[FMT-ERR-002] 未知指标在 Prisma 查询前拒绝', async () => {
    const { facade, prisma } = await harness()

    await expect(
      facade.getIndicators({ tsCode: '600519.SH', indicators: ['raw_sql'], limit: 1 }),
    ).rejects.toBeInstanceOf(FinancialToolInvalidArgumentError)
    expect(prisma.finaIndicator.findMany).not.toHaveBeenCalled()
  })

  it('[FMT-DATA-003] 历史指标排除未来公告并声明修订历史不可恢复', async () => {
    const { facade, prisma } = await harness()
    prisma.finaIndicator.findMany.mockResolvedValue([
      indicatorRow('2024-06-30', '2024-08-30', { roe: 12 }),
      indicatorRow('2024-03-31', '2024-04-30', { roe: 10 }),
    ])

    const result = await facade.getIndicators({
      tsCode: '600519.SH',
      indicators: ['roe'],
      availableAt: '2024-05-01T00:00:00+08:00',
      limit: 2,
    })

    expect(result.data.periods.map((period) => period.reportPeriod)).toEqual(['2024-03-31'])
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'POINT_IN_TIME_REVISION_UNAVAILABLE' })]),
    )
  })
})
