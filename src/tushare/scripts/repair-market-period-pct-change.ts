import { Prisma, PrismaClient } from '@prisma/client'

type RepairFrequency = 'weekly' | 'monthly'

interface PriceRow {
  tsCode: string
  tradeDate: Date
  pctChg: number
  close: number | null
  preClose: number | null
}

interface RepairCursor {
  tsCode: string
  tradeDate: Date
}

interface RepairOptions {
  frequencies: RepairFrequency[]
  dryRun: boolean
  batchSize: number
  maxBatches: number
  afterId?: string
}

const prisma = new PrismaClient()
const TABLE_BY_FREQUENCY: Record<RepairFrequency, string> = {
  weekly: 'stock_weekly_prices',
  monthly: 'stock_monthly_prices',
}
const WRITE_CONFIRMATION = 'market-period-v1'
const PCT_TOLERANCE = 0.05
// 每个候选更新使用 4 个绑定参数；PostgreSQL prepared statement 上限为 32767。
const MAX_BATCH_SIZE = 8000

export function shouldScalePctChange(row: Pick<PriceRow, 'pctChg' | 'close' | 'preClose'>): boolean {
  if (row.close == null || row.preClose == null || row.preClose <= 0) return false

  const expectedPct = ((row.close - row.preClose) / row.preClose) * 100
  const currentError = Math.abs(row.pctChg - expectedPct)
  const scaledError = Math.abs(row.pctChg * 100 - expectedPct)

  return currentError > PCT_TOLERANCE && scaledError <= PCT_TOLERANCE
}

export function formatCheckpoint(row: Pick<PriceRow, 'tsCode' | 'tradeDate'>): string {
  return `${row.tsCode}@${row.tradeDate.toISOString().slice(0, 10)}`
}

function parseCheckpoint(value: string): RepairCursor {
  const match = /^([^@]+)@(\d{4}-\d{2}-\d{2})$/.exec(value)
  if (!match) {
    throw new Error('--after-id 格式必须为 TS_CODE@YYYY-MM-DD，例如 000001.SZ@2024-01-31')
  }

  return { tsCode: match[1], tradeDate: new Date(`${match[2]}T00:00:00.000Z`) }
}

function readOption(args: string[], name: string): string | undefined {
  const inline = args.find((arg) => arg.startsWith(`${name}=`))
  if (inline) return inline.slice(name.length + 1)
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

function parsePositiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (value == null) return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} 必须为正整数`)
  }
  return parsed
}

function parseOptions(args: string[]): RepairOptions {
  const frequency = readOption(args, '--frequency') ?? 'all'
  if (!['weekly', 'monthly', 'all'].includes(frequency)) {
    throw new Error('--frequency 仅支持 weekly、monthly、all')
  }

  const afterId = readOption(args, '--after-id')
  if (afterId && frequency === 'all') {
    throw new Error('使用 --after-id 时必须明确指定 --frequency weekly 或 monthly')
  }

  const batchSize = parsePositiveInteger(readOption(args, '--batch-size'), 500, '--batch-size')
  if (batchSize > MAX_BATCH_SIZE) {
    throw new Error(`--batch-size 不能超过 ${MAX_BATCH_SIZE}，避免超过 PostgreSQL 绑定参数上限`)
  }

  return {
    frequencies: frequency === 'all' ? ['weekly', 'monthly'] : [frequency as RepairFrequency],
    dryRun: args.includes('--dry-run'),
    batchSize,
    maxBatches: parsePositiveInteger(readOption(args, '--max-batches'), 10, '--max-batches'),
    afterId,
  }
}

async function readBatch(
  frequency: RepairFrequency,
  cursor: RepairCursor | undefined,
  batchSize: number,
): Promise<PriceRow[]> {
  const cursorFilter = cursor
    ? Prisma.sql`AND ("ts_code", "trade_date") > (${cursor.tsCode}, ${cursor.tradeDate})`
    : Prisma.empty

  return prisma.$queryRaw<PriceRow[]>(Prisma.sql`
    SELECT
      "ts_code" AS "tsCode",
      "trade_date" AS "tradeDate",
      "pct_chg" AS "pctChg",
      "close",
      "pre_close" AS "preClose"
    FROM ${Prisma.raw(TABLE_BY_FREQUENCY[frequency])}
    WHERE "pct_chg" IS NOT NULL
      ${cursorFilter}
    ORDER BY "ts_code", "trade_date"
    LIMIT ${batchSize}
  `)
}

async function updateBatch(frequency: RepairFrequency, rows: PriceRow[]): Promise<number> {
  const candidates = rows.filter(shouldScalePctChange)
  if (candidates.length === 0) return 0

  const patches = candidates.map(
    (row) =>
      Prisma.sql`(
      ${row.tsCode}::text,
      ${row.tradeDate}::date,
      ${row.pctChg}::double precision,
      ${row.pctChg * 100}::double precision
    )`,
  )
  return prisma.$executeRaw(Prisma.sql`
    UPDATE ${Prisma.raw(TABLE_BY_FREQUENCY[frequency])} AS target
    SET
      "pct_chg" = patch.new_pct_chg,
      "synced_at" = CURRENT_TIMESTAMP
    FROM (VALUES ${Prisma.join(patches)}) AS patch("ts_code", "trade_date", "old_pct_chg", "new_pct_chg")
    WHERE target."ts_code" = patch."ts_code"
      AND target."trade_date" = patch."trade_date"
      AND target."pct_chg" = patch."old_pct_chg"
  `)
}

async function repairFrequency(frequency: RepairFrequency, options: RepairOptions): Promise<void> {
  let cursor = options.afterId ? parseCheckpoint(options.afterId) : undefined
  let scanned = 0
  let candidates = 0
  let updated = 0

  for (let batch = 1; batch <= options.maxBatches; batch += 1) {
    const rows = await readBatch(frequency, cursor, options.batchSize)
    if (rows.length === 0) break

    const repairRows = rows.filter(shouldScalePctChange)
    const batchUpdated = options.dryRun || repairRows.length === 0 ? 0 : await updateBatch(frequency, rows)
    const lastRow = rows[rows.length - 1]
    cursor = { tsCode: lastRow.tsCode, tradeDate: lastRow.tradeDate }
    scanned += rows.length
    candidates += repairRows.length
    updated += batchUpdated

    process.stdout.write(
      `${JSON.stringify({
        frequency,
        dryRun: options.dryRun,
        batch,
        scanned: rows.length,
        candidates: repairRows.length,
        updated: batchUpdated,
        nextAfterId: formatCheckpoint(lastRow),
      })}\n`,
    )

    if (rows.length < options.batchSize) break
  }

  process.stdout.write(`${JSON.stringify({ frequency, dryRun: options.dryRun, scanned, candidates, updated })}\n`)
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2))
  if (!options.dryRun && process.env.DATA_REPAIR_CONFIRMATION !== WRITE_CONFIRMATION) {
    throw new Error(`写模式需要 DATA_REPAIR_CONFIRMATION=${WRITE_CONFIRMATION}`)
  }

  for (const frequency of options.frequencies) {
    await repairFrequency(frequency, options)
  }
}

if (require.main === module) {
  void main()
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
      process.exitCode = 1
    })
    .finally(async () => {
      await prisma.$disconnect()
    })
}
