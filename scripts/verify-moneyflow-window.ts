import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'
import { MoneyflowContentType, PrismaClient } from '@prisma/client'
import * as dayjs from 'dayjs'
const utc = require('dayjs/plugin/utc')
const timezone = require('dayjs/plugin/timezone')

dayjs.extend(utc)
dayjs.extend(timezone)

const prisma = new PrismaClient()
const RETAINED_TRADE_DAYS = 60
const STOCK_COVERAGE_TOLERANCE_RATIO = 0.9
const INDUSTRY_COUNT_TOLERANCE_RATIO = 0.8
const TUSHARE_SYNC_CUTOFF_HOUR = 18
const TUSHARE_SYNC_CUTOFF_MINUTE = 30

async function main() {
  ensureDatabaseUrl()

  const expectedDates = await getExpectedTradeDates()
  if (!expectedDates.length) {
    throw new Error('未找到可用于校验的开市交易日。')
  }

  const [stockByDate, dailyByDate, marketByDate, industryByCombo] = await Promise.all([
    prisma.moneyflowDc.groupBy({ by: ['tradeDate'], _count: { _all: true }, orderBy: { tradeDate: 'asc' } }),
    prisma.daily.groupBy({ by: ['tradeDate'], _count: { _all: true }, orderBy: { tradeDate: 'asc' } }),
    prisma.moneyflowMktDc.groupBy({ by: ['tradeDate'], _count: { _all: true }, orderBy: { tradeDate: 'asc' } }),
    prisma.moneyflowIndDc.groupBy({
      by: ['tradeDate', 'contentType'],
      _count: { _all: true },
      orderBy: [{ tradeDate: 'asc' }, { contentType: 'asc' }],
    }),
  ])

  const expectedSet = new Set(expectedDates)
  const stockCountMap = new Map(stockByDate.map((row) => [toDateKey(row.tradeDate), row._count._all]))
  const dailyCountMap = new Map(dailyByDate.map((row) => [toDateKey(row.tradeDate), row._count._all]))
  const marketCountMap = new Map(marketByDate.map((row) => [toDateKey(row.tradeDate), row._count._all]))
  const industryCountMap = new Map(
    industryByCombo.map((row) => [`${toDateKey(row.tradeDate)}|${row.contentType}`, row._count._all]),
  )

  const stockCoverage = expectedDates.map((date) => {
    const moneyflowCount = stockCountMap.get(date) ?? 0
    const dailyCount = dailyCountMap.get(date) ?? 0
    const coverageRatio = dailyCount > 0 ? moneyflowCount / dailyCount : null

    return {
      date,
      moneyflowCount,
      dailyCount,
      coverageRatio,
    }
  })

  const stockCoverageMedian = median(
    stockCoverage
      .map((row) => row.coverageRatio)
      .filter((value): value is number => value !== null && Number.isFinite(value)),
  )

  const stockWeakDates = stockCoverage.filter(
    (row) => row.coverageRatio !== null && row.coverageRatio < stockCoverageMedian * STOCK_COVERAGE_TOLERANCE_RATIO,
  )

  const contentTypes = [
    MoneyflowContentType.INDUSTRY,
    MoneyflowContentType.CONCEPT,
    MoneyflowContentType.REGION,
  ] as const

  const industryCountsByType = new Map<MoneyflowContentType, number[]>()
  for (const contentType of contentTypes) {
    industryCountsByType.set(
      contentType,
      expectedDates.map((date) => industryCountMap.get(`${date}|${contentType}`) ?? 0),
    )
  }

  const industryMedians = new Map<MoneyflowContentType, number>()
  for (const contentType of contentTypes) {
    industryMedians.set(contentType, median(industryCountsByType.get(contentType) ?? []))
  }

  const industryLowCountDates = expectedDates.flatMap((date) => {
    return contentTypes.flatMap((contentType) => {
      const count = industryCountMap.get(`${date}|${contentType}`) ?? 0
      const medianCount = industryMedians.get(contentType) ?? 0
      if (count === 0 || (medianCount > 0 && count < medianCount * INDUSTRY_COUNT_TOLERANCE_RATIO)) {
        return [
          {
            date,
            contentType,
            count,
            medianCount,
          },
        ]
      }

      return []
    })
  })

  const report = {
    expectedWindow: {
      tradeDateCount: expectedDates.length,
      startDate: expectedDates[0],
      endDate: expectedDates[expectedDates.length - 1],
    },
    stockMoneyflow: {
      missingDates: expectedDates.filter((date) => !stockCountMap.has(date)),
      extraDates: [...stockCountMap.keys()].filter((date) => !expectedSet.has(date)),
      coverageMedian: round(stockCoverageMedian),
      coverageMin: round(Math.min(...stockCoverage.map((row) => row.coverageRatio ?? 1))),
      coverageMax: round(Math.max(...stockCoverage.map((row) => row.coverageRatio ?? 1))),
      suspiciousDates: stockWeakDates.slice(0, 20).map((row) => ({
        date: row.date,
        moneyflowCount: row.moneyflowCount,
        dailyCount: row.dailyCount,
        coverageRatio: round(row.coverageRatio ?? 0),
      })),
    },
    marketMoneyflow: {
      missingDates: expectedDates.filter((date) => !marketCountMap.has(date)),
      extraDates: [...marketCountMap.keys()].filter((date) => !expectedSet.has(date)),
      rowsPerDateSet: [...new Set(expectedDates.map((date) => marketCountMap.get(date) ?? 0))],
    },
    industryMoneyflow: {
      missingDateTypePairs: expectedDates
        .flatMap((date) =>
          contentTypes.flatMap((contentType) =>
            industryCountMap.has(`${date}|${contentType}`) ? [] : [{ date, contentType }],
          ),
        )
        .slice(0, 20),
      missingDateTypePairTotal: expectedDates.flatMap((date) =>
        contentTypes.flatMap((contentType) => (industryCountMap.has(`${date}|${contentType}`) ? [] : [1])),
      ).length,
      suspiciousDateTypePairs: industryLowCountDates.slice(0, 20).map((row) => ({
        date: row.date,
        contentType: row.contentType,
        count: row.count,
        medianCount: row.medianCount,
      })),
      typeMedians: Object.fromEntries(
        contentTypes.map((contentType) => [contentType, industryMedians.get(contentType)]),
      ),
    },
  }

  const hardFailures: string[] = []
  if (report.expectedWindow.tradeDateCount !== RETAINED_TRADE_DAYS) {
    hardFailures.push(
      `最近窗口交易日数量异常：期望 ${RETAINED_TRADE_DAYS}，实际 ${report.expectedWindow.tradeDateCount}`,
    )
  }
  if (report.stockMoneyflow.missingDates.length || report.stockMoneyflow.extraDates.length) {
    hardFailures.push('个股资金流交易日窗口存在缺口或残留旧日期。')
  }
  if (report.marketMoneyflow.missingDates.length || report.marketMoneyflow.extraDates.length) {
    hardFailures.push('市场资金流交易日窗口存在缺口或残留旧日期。')
  }
  if (report.marketMoneyflow.rowsPerDateSet.some((count) => count !== 1)) {
    hardFailures.push('市场资金流并非每个交易日恰好 1 条记录。')
  }
  if (report.industryMoneyflow.missingDateTypePairTotal > 0) {
    hardFailures.push('板块资金流存在缺失的 tradeDate + contentType 组合。')
  }

  console.log(JSON.stringify({ hardFailures, report }, null, 2))

  if (hardFailures.length) {
    process.exitCode = 1
  }
}

function ensureDatabaseUrl() {
  if (process.env.DATABASE_URL) {
    return
  }

  const envPath = resolve(process.cwd(), '.env')
  if (!existsSync(envPath)) {
    throw new Error('未找到 .env，且当前环境没有 DATABASE_URL。')
  }

  const line = readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .find((item) => item.startsWith('DATABASE_URL='))

  if (!line) {
    throw new Error('`.env` 中未配置 DATABASE_URL。')
  }

  process.env.DATABASE_URL = line.slice('DATABASE_URL='.length).replace(/^"|"$/g, '')
}

async function getExpectedTradeDates() {
  const targetTradeDate = await resolveLatestCompletedTradeDate()
  if (!targetTradeDate) {
    return []
  }

  const rows = await prisma.tradeCal.findMany({
    where: {
      exchange: 'SSE',
      isOpen: '1',
      calDate: { lte: targetTradeDate },
    },
    orderBy: { calDate: 'desc' },
    take: RETAINED_TRADE_DAYS,
    select: { calDate: true },
  })

  return rows.map((row) => toDateKey(row.calDate)).reverse()
}

function toDateKey(value: Date) {
  return value.toISOString().slice(0, 10)
}

async function resolveLatestCompletedTradeDate() {
  const override = process.env.VERIFY_TARGET_TRADE_DATE?.trim()
  if (override) {
    return parseDateString(override)
  }

  const now = (dayjs as any)().tz(process.env.TUSHARE_SYNC_TIME_ZONE || 'Asia/Shanghai')
  const today = parseDateString(now.format('YYYYMMDD'))

  const todayCalendar = await prisma.tradeCal.findUnique({
    where: {
      exchange_calDate: {
        exchange: 'SSE',
        calDate: today,
      },
    },
  })

  if (todayCalendar?.isOpen === '1') {
    const passedCutoff =
      now.hour() > TUSHARE_SYNC_CUTOFF_HOUR ||
      (now.hour() === TUSHARE_SYNC_CUTOFF_HOUR && now.minute() >= TUSHARE_SYNC_CUTOFF_MINUTE)

    if (passedCutoff) {
      return today
    }

    return todayCalendar.pretradeDate ?? null
  }

  if (todayCalendar?.pretradeDate) {
    return todayCalendar.pretradeDate
  }

  const latestOpenDate = await prisma.tradeCal.findFirst({
    where: {
      exchange: 'SSE',
      isOpen: '1',
      calDate: { lte: today },
    },
    orderBy: { calDate: 'desc' },
    select: { calDate: true },
  })

  return latestOpenDate?.calDate ?? null
}

function parseDateString(value: string) {
  const normalized = value.replace(/-/g, '')
  const year = Number(normalized.slice(0, 4))
  const month = Number(normalized.slice(4, 6))
  const day = Number(normalized.slice(6, 8))

  return new Date(Date.UTC(year, month - 1, day))
}

function median(values: number[]) {
  if (!values.length) {
    return 0
  }

  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)

  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

function round(value: number) {
  return Number(value.toFixed(6))
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
