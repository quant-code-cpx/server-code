import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PrismaClient } from '@prisma/client'
import { FactorAnalysisToolFacade } from 'src/apps/factor/factor-analysis-tool.facade'
import { FactorAnalysisService } from 'src/apps/factor/services/factor-analysis.service'
import { FactorComputeService } from 'src/apps/factor/services/factor-compute.service'
import { FactorExpressionService } from 'src/apps/factor/services/factor-expression.service'
import { FundResearchRepository } from 'src/apps/fund/fund-research.repository'
import { FundResearchToolFacade } from 'src/apps/fund/fund-research-tool.facade'
import { IndustryRotationResearchRepository } from 'src/apps/industry-rotation/industry-rotation-research.repository'
import { IndustryRotationToolFacade } from 'src/apps/industry-rotation/industry-rotation-tool.facade'
import { IndexResearchRepository } from 'src/apps/index/index-research.repository'
import { IndexResearchToolFacade } from 'src/apps/index/index-research-tool.facade'
import { MacroResearchRepository } from 'src/apps/macro-research/macro-research.repository'
import { MacroResearchToolFacade } from 'src/apps/macro-research/macro-research-tool.facade'
import type { PrismaService } from 'src/shared/prisma.service'

loadDatabaseUrl()
const prisma = new PrismaClient()
const shared = prisma as unknown as PrismaService
const factorCompute = new FactorComputeService(shared, new FactorExpressionService())
const passthroughCache = { rememberJson: <T>({ loader }: { loader: () => Promise<T> }) => loader() }
const tools = {
  index: new IndexResearchToolFacade(new IndexResearchRepository(shared)),
  fund: new FundResearchToolFacade(new FundResearchRepository(shared)),
  industry: new IndustryRotationToolFacade(new IndustryRotationResearchRepository(shared)),
  factorValues: new FactorAnalysisToolFacade(
    shared,
    factorCompute,
    new FactorAnalysisService(shared, factorCompute, passthroughCache as never),
  ),
  macro: new MacroResearchToolFacade(new MacroResearchRepository(shared)),
}

const thresholds = {
  index: 1_000,
  fund: 1_500,
  industry: 2_000,
  factorValues: 1_000,
  factorHighCost: 5_000,
  macro: 300,
} as const
type Measurement = keyof typeof thresholds

async function main(): Promise<void> {
  const [indexCodes, fundCodes, factorNames] = await Promise.all([
    sampleIndexCodes(),
    sampleFundCodes(),
    sampleFactorNames(),
  ])
  if (!indexCodes.length || !fundCodes.length || !factorNames.length) throw new Error('真实库缺少第三批验收样本')
  const durations = Object.fromEntries(Object.keys(thresholds).map((name) => [name, []])) as Record<
    Measurement,
    number[]
  >

  for (const indexCode of indexCodes) {
    await measure('index', durations, () =>
      tools.index.getMarketData({
        indexCode,
        sections: ['BASIC', 'QUOTE', 'HISTORY', 'VALUATION', 'CONSTITUENTS'],
        frequency: 'D',
        constituentLimit: 500,
      }),
    )
  }
  for (const fundCode of fundCodes) {
    await measure('fund', durations, () =>
      tools.fund.getResearch({
        fundCode,
        sections: ['BASIC', 'NAV', 'PRICE', 'SHARE', 'HOLDINGS', 'ETF_FLOW'],
        holdingPeriods: 4,
        maxSeriesPoints: 1_000,
      }),
    )
  }
  for (let index = 0; index < 5; index += 1) {
    await measure('industry', durations, () =>
      tools.industry.getRotation({
        sections: ['RETURN', 'MOMENTUM', 'FLOW', 'VALUATION', 'HEATMAP', 'DETAIL'],
        periods: [5, 20, 60],
        topN: 50,
        heatmapTradeDays: 60,
      }),
    )
  }
  for (const factorName of factorNames) {
    await measure('factorValues', durations, () =>
      tools.factorValues.analyze({
        analysis: 'VALUES',
        factorNames: [factorName],
        universe: 'ALL',
        page: 1,
        pageSize: 200,
      }),
    )
  }
  const primaryFactor = factorNames.includes('pe_ttm') ? 'pe_ttm' : factorNames[0]
  const secondaryFactor = factorNames.includes('pb') ? 'pb' : factorNames.find((name) => name !== primaryFactor)
  const highCostChecks = [
    () =>
      tools.factorValues.analyze({
        analysis: 'IC',
        factorNames: [primaryFactor],
        universe: 'HS300',
        startDate: '2026-06-01',
        endDate: '2026-07-24',
        forwardDays: 5,
      }),
    () =>
      tools.factorValues.analyze({
        analysis: 'QUANTILE',
        factorNames: [primaryFactor],
        universe: 'HS300',
        startDate: '2026-07-01',
        endDate: '2026-07-24',
        quantiles: 5,
        rebalanceDays: 5,
      }),
    () =>
      tools.factorValues.analyze({
        analysis: 'DECAY',
        factorNames: [primaryFactor],
        universe: 'HS300',
        startDate: '2026-07-01',
        endDate: '2026-07-24',
        decayPeriods: [1, 5, 10],
      }),
    () =>
      tools.factorValues.analyze({ analysis: 'DISTRIBUTION', factorNames: [primaryFactor], universe: 'ALL', bins: 50 }),
    ...(secondaryFactor
      ? [
          () =>
            tools.factorValues.analyze({
              analysis: 'CORRELATION',
              factorNames: [primaryFactor, secondaryFactor],
              universe: 'ALL',
            }),
        ]
      : []),
  ]
  for (const check of highCostChecks) {
    await measure('factorHighCost', durations, check)
  }
  for (let index = 0; index < 10; index += 1) {
    await measure('macro', durations, () =>
      tools.macro.getSnapshot({
        series: ['CPI', 'PPI', 'GDP', 'SHIBOR'],
        sections: ['LATEST', 'HISTORY'],
        historyLimit: 500,
      }),
    )
  }

  const performance = Object.fromEntries(
    (Object.keys(thresholds) as Measurement[]).map((name) => [
      name,
      {
        samples: durations[name].length,
        p50Ms: percentile(durations[name], 0.5),
        p95Ms: percentile(durations[name], 0.95),
        targetP95Ms: thresholds[name],
      },
    ]),
  )
  process.stdout.write(`${JSON.stringify({ samples: { indexCodes, fundCodes, factorNames }, performance }, null, 2)}\n`)

  for (const name of Object.keys(thresholds) as Measurement[]) {
    const p95 = percentile(durations[name], 0.95)
    if (p95 === null || p95 > thresholds[name]) throw new Error(`${name} P95 ${p95}ms 超过 ${thresholds[name]}ms`)
  }
}

async function sampleIndexCodes(): Promise<string[]> {
  const rows = await prisma.indexDaily.findMany({
    orderBy: { tsCode: 'asc' },
    distinct: ['tsCode'],
    select: { tsCode: true },
    take: 10,
  })
  return rows.map((row) => row.tsCode).filter((code) => /^\d{6}\.(SH|SZ)$/.test(code))
}

async function sampleFundCodes(): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ ts_code: string }>>`
    SELECT fb.ts_code
    FROM fund_basic fb
    WHERE EXISTS (SELECT 1 FROM fund_daily price WHERE price.ts_code = fb.ts_code)
      AND EXISTS (SELECT 1 FROM fund_nav nav WHERE nav.ts_code = fb.ts_code)
      AND EXISTS (SELECT 1 FROM fund_share share WHERE share.ts_code = fb.ts_code)
    ORDER BY fb.ts_code
    LIMIT 10
  `
  return rows.map((row) => row.ts_code)
}

async function sampleFactorNames(): Promise<string[]> {
  const anchors = await prisma.factorSnapshot.findMany({
    where: { factorName: { in: ['pe_ttm', 'pb'] } },
    distinct: ['factorName'],
    select: { factorName: true },
  })
  const rows = await prisma.factorSnapshot.groupBy({ by: ['factorName'], orderBy: { factorName: 'asc' }, take: 10 })
  return [...new Set([...anchors.map((row) => row.factorName), ...rows.map((row) => row.factorName)])].slice(0, 10)
}

async function measure(name: Measurement, durations: Record<Measurement, number[]>, operation: () => Promise<unknown>) {
  const startedAt = performance.now()
  await operation()
  durations[name].push(performance.now() - startedAt)
}

function percentile(values: readonly number[], quantile: number): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((left, right) => left - right)
  return Math.round(sorted[Math.ceil(sorted.length * quantile) - 1] * 100) / 100
}

function loadDatabaseUrl(): void {
  if (process.env.DATABASE_URL) return
  const envPath = resolve('.env')
  if (!existsSync(envPath)) throw new Error('缺少 DATABASE_URL，且未找到 .env')
  const match = readFileSync(envPath, 'utf8').match(/^DATABASE_URL=(?:"([^"]+)"|([^#\r\n]+))/m)
  const value = match?.[1] ?? match?.[2]?.trim()
  if (!value) throw new Error('.env 中缺少 DATABASE_URL')
  process.env.DATABASE_URL = value
}

main()
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
