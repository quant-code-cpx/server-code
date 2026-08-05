import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PrismaClient } from '@prisma/client'
import { ConvertibleBondRepository } from 'src/apps/convertible-bond/convertible-bond.repository'
import { ConvertibleBondToolFacade } from 'src/apps/convertible-bond/convertible-bond-tool.facade'
import { EventStudyToolFacade } from 'src/apps/event-study/event-study-tool.facade'
import { EventStudyToolRepository } from 'src/apps/event-study/event-study-tool.repository'
import { EventType } from 'src/apps/event-study/event-type.registry'
import { EventStudyService } from 'src/apps/event-study/event-study.service'
import { OptionMarketRepository } from 'src/apps/option-market/option-market.repository'
import { OptionMarketToolFacade } from 'src/apps/option-market/option-market-tool.facade'
import type { PrismaService } from 'src/shared/prisma.service'

loadEnvironment()
const prisma = new PrismaClient()
const shared = prisma as unknown as PrismaService
const tools = {
  option: new OptionMarketToolFacade(new OptionMarketRepository(shared)),
  convertibleBond: new ConvertibleBondToolFacade(new ConvertibleBondRepository(shared)),
  eventStudy: new EventStudyToolFacade(new EventStudyService(shared), new EventStudyToolRepository(shared)),
}

const thresholds = { option: 1_000, convertibleBond: 1_000, eventStudy: 5_000 } as const
type Measurement = keyof typeof thresholds

async function main(): Promise<void> {
  const durations: Record<Measurement, number[]> = { option: [], convertibleBond: [], eventStudy: [] }
  const [optionCodes, bondCodes, optionDataThrough, bondDataThrough, benchmarkDataThrough] = await Promise.all([
    sampleOptionCodes(),
    sampleConvertibleBondCodes(),
    latestDate('opt_daily'),
    latestDate('convertible_bond_daily_prices'),
    latestBenchmarkDate(),
  ])
  if (optionCodes.length < 5) throw new Error(`期权真实样本不足：${optionCodes.length}`)
  if (bondCodes.length < 5) throw new Error(`可转债真实样本不足：${bondCodes.length}`)
  if (!optionDataThrough || !bondDataThrough || !benchmarkDataThrough) throw new Error('第四批真实库水位不完整')

  for (const optionCode of optionCodes) {
    const result = await measure('option', durations, () =>
      tools.option.getMarket({
        operation: 'HISTORY',
        optionCode,
        asOfDate: optionDataThrough,
        startDate: addDays(optionDataThrough, -180),
        endDate: optionDataThrough,
        maxSeriesPoints: 1_000,
      }),
    )
    if (result.data.operation !== 'HISTORY' || !result.data.points.length) {
      throw new Error(`期权 ${optionCode} 未返回真实历史`)
    }
  }

  let partialCoverageCount = 0
  for (const bondCode of bondCodes) {
    const result = await measure('convertibleBond', durations, () =>
      tools.convertibleBond.getMarket({
        operation: 'HISTORY',
        bondCode,
        asOfDate: bondDataThrough,
        startDate: addDays(bondDataThrough, -365),
        endDate: bondDataThrough,
        maxSeriesPoints: 1_000,
      }),
    )
    if (result.data.operation !== 'HISTORY' || !result.data.points.length) {
      throw new Error(`可转债 ${bondCode} 未返回真实历史`)
    }
    if (result.warnings.some((warning) => warning.code === 'PARTIAL_COVERAGE')) partialCoverageCount += 1
  }

  const eventEnd = addDays(benchmarkDataThrough, -45)
  const eventStart = addDays(eventEnd, -180)
  const eventSummaries: Array<{ eventType: EventType; sampleCount: number; excludedSampleCount: number }> = []
  for (const eventType of [EventType.FORECAST, EventType.REPURCHASE]) {
    const result = await measure('eventStudy', durations, () =>
      tools.eventStudy.run({
        eventType,
        startDate: eventStart,
        endDate: eventEnd,
        preTradeDays: 5,
        postTradeDays: 20,
        minSamples: 10,
        maxSamples: 100,
      }),
    )
    if (result.data.sampleCount < 10 || result.data.algorithmVersion !== 'event-study.market-adjusted.v1') {
      throw new Error(`${eventType} 事件研究验收失败`)
    }
    eventSummaries.push({
      eventType,
      sampleCount: result.data.sampleCount,
      excludedSampleCount: result.data.excludedSampleCount,
    })
  }

  const convertibleBondGate = await convertibleBondCoverageGate(bondDataThrough)
  const webGate = {
    provider: process.env.AGENT_SEARCH_PROVIDER ?? 'disabled',
    apiKeyConfigured: Boolean(process.env.AGENT_SEARCH_API_KEY?.trim()),
    urlTokenSecretConfigured: (process.env.AGENT_URL_TOKEN_SECRET?.length ?? 0) >= 32,
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
  process.stdout.write(
    `${JSON.stringify(
      {
        samples: { optionCodes, bondCodes, eventSummaries },
        waterlines: { optionDataThrough, bondDataThrough, benchmarkDataThrough },
        gates: {
          option: { enabled: true },
          eventStudy: { enabled: true },
          convertibleBond: { enabled: convertibleBondGate.coverageRatio >= 0.95, ...convertibleBondGate },
          web: {
            enabled: webGate.provider !== 'disabled' && webGate.apiKeyConfigured && webGate.urlTokenSecretConfigured,
            ...webGate,
          },
        },
        partialCoverageCount,
        performance,
      },
      null,
      2,
    )}\n`,
  )

  for (const name of Object.keys(thresholds) as Measurement[]) {
    const p95 = percentile(durations[name], 0.95)
    if (p95 === null || p95 > thresholds[name]) throw new Error(`${name} P95 ${p95}ms 超过 ${thresholds[name]}ms`)
  }
}

async function sampleOptionCodes(): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ tsCode: string }>>`
    SELECT DISTINCT od.ts_code AS "tsCode"
    FROM opt_daily od
    JOIN opt_basic ob ON ob.ts_code = od.ts_code
    WHERE od.trade_date = (SELECT MAX(trade_date) FROM opt_daily)
      AND od.close IS NOT NULL
    ORDER BY od.ts_code
    LIMIT 10
  `
  return rows.map((row) => row.tsCode)
}

async function sampleConvertibleBondCodes(): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ tsCode: string }>>`
    SELECT DISTINCT cbd.ts_code AS "tsCode"
    FROM convertible_bond_daily_prices cbd
    JOIN convertible_bond_basic cbb ON cbb.ts_code = cbd.ts_code
    WHERE cbd.trade_date = (SELECT MAX(trade_date) FROM convertible_bond_daily_prices)
      AND cbd.close IS NOT NULL
    ORDER BY cbd.ts_code
    LIMIT 10
  `
  return rows.map((row) => row.tsCode)
}

async function latestDate(table: 'opt_daily' | 'convertible_bond_daily_prices'): Promise<string | null> {
  const rows =
    table === 'opt_daily'
      ? await prisma.$queryRaw<Array<{ value: Date | null }>>`SELECT MAX(trade_date) AS value FROM opt_daily`
      : await prisma.$queryRaw<
          Array<{ value: Date | null }>
        >`SELECT MAX(trade_date) AS value FROM convertible_bond_daily_prices`
  return rows[0]?.value ? toIsoDate(rows[0].value) : null
}

async function latestBenchmarkDate(): Promise<string | null> {
  const row = await prisma.indexDaily.findFirst({
    where: { tsCode: '000300.SH', pctChg: { not: null } },
    orderBy: { tradeDate: 'desc' },
    select: { tradeDate: true },
  })
  return row ? toIsoDate(row.tradeDate) : null
}

async function convertibleBondCoverageGate(asOfDate: string) {
  const rows = await prisma.$queryRaw<Array<{ activeCount: bigint; coveredCount: bigint }>>`
    WITH active AS (
      SELECT ts_code, GREATEST(COALESCE(list_date, DATE '2018-01-01'), DATE '2018-01-01') AS expected_start
      FROM convertible_bond_basic
      WHERE (list_date IS NULL OR list_date <= ${new Date(`${asOfDate}T00:00:00.000Z`)}::date)
        AND (delist_date IS NULL OR delist_date >= ${new Date(`${asOfDate}T00:00:00.000Z`)}::date)
    ), bounds AS (
      SELECT ts_code, MIN(trade_date) AS coverage_start, MAX(trade_date) AS data_through
      FROM convertible_bond_daily_prices
      GROUP BY ts_code
    )
    SELECT COUNT(*) AS "activeCount",
           COUNT(*) FILTER (
             WHERE b.coverage_start <= a.expected_start + INTERVAL '10 days'
               AND b.data_through >= ${new Date(`${asOfDate}T00:00:00.000Z`)}::date
           ) AS "coveredCount"
    FROM active a
    LEFT JOIN bounds b USING (ts_code)
  `
  const activeCount = Number(rows[0]?.activeCount ?? 0)
  const coveredCount = Number(rows[0]?.coveredCount ?? 0)
  return { activeCount, coveredCount, coverageRatio: activeCount ? coveredCount / activeCount : 0 }
}

async function measure<T>(name: Measurement, durations: Record<Measurement, number[]>, operation: () => Promise<T>) {
  const startedAt = performance.now()
  const result = await operation()
  durations[name].push(performance.now() - startedAt)
  return result
}

function percentile(values: readonly number[], quantile: number): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((left, right) => left - right)
  return Math.round(sorted[Math.ceil(sorted.length * quantile) - 1] * 100) / 100
}

function addDays(isoDate: string, days: number): string {
  const value = new Date(`${isoDate}T00:00:00.000Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return toIsoDate(value)
}

function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10)
}

function loadEnvironment(): void {
  const envPath = resolve('.env')
  if (!existsSync(envPath)) return
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/)
    if (!match || process.env[match[1]] !== undefined) continue
    process.env[match[1]] = match[2].replace(/^"|"$/g, '').trim()
  }
}

main()
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
