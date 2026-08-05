import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PrismaClient, StockListStatus } from '@prisma/client'
import { StockChipRepository } from 'src/apps/stock-deep-research/chip/stock-chip.repository'
import { StockChipToolFacade } from 'src/apps/stock-deep-research/chip/stock-chip-tool.facade'
import { StockEventRepository } from 'src/apps/stock-deep-research/events/stock-event.repository'
import { StockEventToolFacade } from 'src/apps/stock-deep-research/events/stock-event-tool.facade'
import { StockMarginRepository } from 'src/apps/stock-deep-research/margin/stock-margin.repository'
import { StockMarginToolFacade } from 'src/apps/stock-deep-research/margin/stock-margin-tool.facade'
import { RelativeStrengthCalculationService } from 'src/apps/stock-deep-research/relative-strength/relative-strength-calculation.service'
import { RelativeStrengthRepository } from 'src/apps/stock-deep-research/relative-strength/relative-strength.repository'
import { RelativeStrengthToolFacade } from 'src/apps/stock-deep-research/relative-strength/relative-strength-tool.facade'
import { StockShareholderRepository } from 'src/apps/stock-deep-research/shareholders/stock-shareholder.repository'
import { StockShareholderToolFacade } from 'src/apps/stock-deep-research/shareholders/stock-shareholder-tool.facade'
import { StockDeepResearchToolError } from 'src/apps/stock-deep-research/stock-deep-research.types'
import type { PrismaService } from 'src/shared/prisma.service'

loadDatabaseUrl()
const prisma = new PrismaClient()
const shared = prisma as unknown as PrismaService
const tools = {
  chip: new StockChipToolFacade(new StockChipRepository(shared)),
  margin: new StockMarginToolFacade(new StockMarginRepository(shared)),
  relative: new RelativeStrengthToolFacade(
    new RelativeStrengthRepository(shared),
    new RelativeStrengthCalculationService(),
  ),
  events: new StockEventToolFacade(new StockEventRepository(shared)),
  shareholders: new StockShareholderToolFacade(new StockShareholderRepository(shared)),
}

const thresholds = { chip: 500, margin: 800, relative: 1_500, events: 800, shareholders: 800 } as const
type ToolName = keyof typeof tools

async function main(): Promise<void> {
  const stocks = await sampleStocks()
  if (stocks.length < 30) throw new Error(`真实库上市股票样本不足 30，只找到 ${stocks.length}`)
  const durations: Record<ToolName, number[]> = { chip: [], margin: [], relative: [], events: [], shareholders: [] }
  const statuses: Record<ToolName, Record<string, number>> = {
    chip: {},
    margin: {},
    relative: {},
    events: {},
    shareholders: {},
  }

  for (const tsCode of stocks) {
    await measure(
      'chip',
      tsCode,
      () =>
        tools.chip.getProfile({
          tsCode,
          sections: ['SUMMARY', 'DISTRIBUTION', 'HISTORY'],
          historyTradeDays: 500,
          maxPriceBuckets: 500,
        }),
      durations,
      statuses,
    )
    await measure(
      'margin',
      tsCode,
      () => tools.margin.getHistory({ tsCode, sections: ['SUMMARY', 'HISTORY'], lookbackTradeDays: 500 }),
      durations,
      statuses,
    )
    await measure(
      'relative',
      tsCode,
      () =>
        tools.relative.getRelativeStrength({
          tsCode,
          sections: ['SUMMARY', 'SERIES'],
          lookbackTradeDays: 1_250,
        }),
      durations,
      statuses,
    )
    await measure('events', tsCode, () => tools.events.getEvents({ tsCode }), durations, statuses)
    await measure('shareholders', tsCode, () => tools.shareholders.getProfile({ tsCode }), durations, statuses)
  }

  const performance = Object.fromEntries(
    (Object.keys(tools) as ToolName[]).map((name) => [
      name,
      {
        successfulSamples: durations[name].length,
        p50Ms: percentile(durations[name], 0.5),
        p95Ms: percentile(durations[name], 0.95),
        targetP95Ms: thresholds[name],
        statuses: statuses[name],
      },
    ]),
  )
  process.stdout.write(`${JSON.stringify({ sampleSize: stocks.length, stocks, performance }, null, 2)}\n`)

  for (const name of Object.keys(tools) as ToolName[]) {
    if (!durations[name].length) throw new Error(`${name} 在 30 股样本中没有成功响应`)
    if (percentile(durations[name], 0.95) > thresholds[name]) {
      throw new Error(`${name} P95 超过 ${thresholds[name]}ms`)
    }
  }
}

async function sampleStocks(): Promise<string[]> {
  const anchors = ['600519.SH', '600089.SH', '000001.SZ', '300750.SZ']
  const groups = await Promise.all(
    ['.SH', '.SZ', '.BJ'].map((suffix) =>
      prisma.stockBasic.findMany({
        where: { listStatus: StockListStatus.L, tsCode: { endsWith: suffix } },
        orderBy: { tsCode: 'asc' },
        take: suffix === '.BJ' ? 6 : suffix === '.SZ' ? 11 : 10,
        select: { tsCode: true },
      }),
    ),
  )
  return [
    ...new Set([
      ...anchors,
      ...groups[2].map((row) => row.tsCode),
      ...groups[0].map((row) => row.tsCode),
      ...groups[1].map((row) => row.tsCode),
    ]),
  ].slice(0, 30)
}

async function measure(
  name: ToolName,
  tsCode: string,
  operation: () => Promise<unknown>,
  durations: Record<ToolName, number[]>,
  statuses: Record<ToolName, Record<string, number>>,
): Promise<void> {
  const startedAt = performance.now()
  try {
    await operation()
    durations[name].push(performance.now() - startedAt)
    increment(statuses[name], 'OK')
  } catch (error) {
    const status = error instanceof StockDeepResearchToolError ? error.code : 'UNEXPECTED_ERROR'
    increment(statuses[name], status)
    if (status === 'UPSTREAM_FAILED' || status === 'UNEXPECTED_ERROR') throw error
  }
}

function increment(record: Record<string, number>, key: string): void {
  record[key] = (record[key] ?? 0) + 1
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
