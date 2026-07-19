import { Injectable } from '@nestjs/common'
import { Prisma, StockListStatus } from '@prisma/client'
import { CORE_INDEX_CODES, CORE_INDEX_NAME_MAP } from 'src/constant/tushare.constant'
import { MARKET_PRICE_DATA_CONTRACT_VERIFIED } from 'src/tushare/data-contract'
import { PrismaService } from 'src/shared/prisma.service'

export const STOCK_PRICE_FIELDS = [
  'open',
  'high',
  'low',
  'close',
  'preClose',
  'pctChange',
  'volume',
  'amount',
  'turnoverRate',
  'peTtm',
] as const

export const DEFAULT_STOCK_PRICE_FIELDS = [
  'open',
  'high',
  'low',
  'close',
  'preClose',
  'pctChange',
  'volume',
  'amount',
] as const

export type SecurityType = 'STOCK' | 'INDEX' | 'FUND' | 'OPTION'
export type StockPriceField = (typeof STOCK_PRICE_FIELDS)[number]
export type StockPriceFrequency = 'DAILY' | 'WEEKLY' | 'MONTHLY'
export type StockPriceAdjustment = 'NONE' | 'FORWARD' | 'BACKWARD'
export type StockOverviewSection = 'BASIC' | 'QUOTE' | 'VALUATION' | 'INDUSTRY' | 'SHARE_CAPITAL' | 'DATA_DATES'

export interface ResolveSecurityInput {
  query: string
  securityTypes?: SecurityType[]
  includeDelisted?: boolean
}

export interface StockPriceHistoryInput {
  tsCode: string
  startDate: string
  endDate: string
  frequency: StockPriceFrequency
  adjustment: StockPriceAdjustment
  fields?: StockPriceField[]
  limit: number
}

export interface StockOverviewInput {
  tsCodes: string[]
  asOfDate?: string
  sections?: StockOverviewSection[]
}

export class StockPriceDataQualityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = StockPriceDataQualityError.name
  }
}

interface PriceRow {
  tradeDate: Date
  open: number | null
  high: number | null
  low: number | null
  close: number | null
  preClose: number | null
  pctChange: number | null
  volume: number | null
  amount: number | null
  turnoverRate: number | null
  peTtm: number | null
  adjFactor: number | null
}

interface OverviewQuoteRow {
  tsCode: string
  tradeDate: Date
  open: number | null
  high: number | null
  low: number | null
  close: number | null
  preClose: number | null
  pctChg: number | null
  vol: number | null
  amount: number | null
}

interface OverviewValuationRow {
  tsCode: string
  tradeDate: Date
  turnoverRate: number | null
  pe: number | null
  peTtm: number | null
  pb: number | null
  psTtm: number | null
  dvTtm: number | null
  totalShare: number | null
  floatShare: number | null
  freeShare: number | null
  totalMv: number | null
  circMv: number | null
}

const PRICE_TABLES: Record<StockPriceFrequency, string> = {
  DAILY: 'stock_daily_prices',
  WEEKLY: 'stock_weekly_prices',
  MONTHLY: 'stock_monthly_prices',
}

const DEFAULT_OVERVIEW_SECTIONS: StockOverviewSection[] = [
  'BASIC',
  'QUOTE',
  'VALUATION',
  'INDUSTRY',
  'SHARE_CAPITAL',
  'DATA_DATES',
]

@Injectable()
export class StockToolFacade {
  constructor(private readonly prisma: PrismaService) {}

  async resolveSecurity(input: ResolveSecurityInput) {
    const query = input.query.trim()
    const normalized = query.toLocaleLowerCase('zh-CN')
    const types = input.securityTypes?.length
      ? [...new Set(input.securityTypes)]
      : (['STOCK', 'INDEX', 'FUND', 'OPTION'] as SecurityType[])
    const includeDelisted = input.includeDelisted ?? false
    const candidates: Array<{
      tsCode: string
      name: string | null
      securityType: SecurityType
      exchange: string | null
      listStatus: string | null
      listDate: string | null
      delistDate: string | null
      matchScore: number
    }> = []

    await Promise.all(
      types.map(async (securityType) => {
        if (securityType === 'STOCK') {
          const rows = await this.prisma.stockBasic.findMany({
            where: {
              AND: [
                {
                  OR: [
                    { tsCode: { contains: query, mode: 'insensitive' } },
                    { symbol: { contains: query, mode: 'insensitive' } },
                    { name: { contains: query, mode: 'insensitive' } },
                    { cnspell: { contains: query, mode: 'insensitive' } },
                  ],
                },
                ...(includeDelisted
                  ? []
                  : [{ OR: [{ listStatus: null }, { listStatus: { not: StockListStatus.D } }] }]),
              ],
            },
            select: {
              tsCode: true,
              symbol: true,
              name: true,
              exchange: true,
              listStatus: true,
              listDate: true,
              delistDate: true,
            },
            orderBy: { tsCode: 'asc' },
            take: 20,
          })
          candidates.push(
            ...rows.map((row) => ({
              tsCode: row.tsCode,
              name: row.name,
              securityType,
              exchange: row.exchange,
              listStatus: row.listStatus,
              listDate: toIsoDate(row.listDate),
              delistDate: toIsoDate(row.delistDate),
              matchScore: matchScore(normalized, row.tsCode, row.symbol, row.name),
            })),
          )
          return
        }

        if (securityType === 'INDEX') {
          candidates.push(
            ...CORE_INDEX_CODES.filter((tsCode) => {
              const name = CORE_INDEX_NAME_MAP[tsCode] ?? tsCode
              return tsCode.toLowerCase().includes(normalized) || name.toLocaleLowerCase('zh-CN').includes(normalized)
            }).map((tsCode) => ({
              tsCode,
              name: CORE_INDEX_NAME_MAP[tsCode] ?? tsCode,
              securityType,
              exchange: exchangeFromTsCode(tsCode),
              listStatus: 'L',
              listDate: null,
              delistDate: null,
              matchScore: matchScore(normalized, tsCode, null, CORE_INDEX_NAME_MAP[tsCode]),
            })),
          )
          return
        }

        if (securityType === 'FUND') {
          const today = startOfUtcDay(new Date())
          const rows = await this.prisma.fundBasic.findMany({
            where: {
              AND: [
                {
                  OR: [
                    { tsCode: { contains: query, mode: 'insensitive' } },
                    { name: { contains: query, mode: 'insensitive' } },
                  ],
                },
                ...(includeDelisted ? [] : [{ OR: [{ delistDate: null }, { delistDate: { gte: today } }] }]),
              ],
            },
            select: { tsCode: true, name: true, market: true, status: true, listDate: true, delistDate: true },
            orderBy: { tsCode: 'asc' },
            take: 20,
          })
          candidates.push(
            ...rows.map((row) => ({
              tsCode: row.tsCode,
              name: row.name,
              securityType,
              exchange: row.market ?? exchangeFromTsCode(row.tsCode),
              listStatus: row.status,
              listDate: toIsoDate(row.listDate),
              delistDate: toIsoDate(row.delistDate),
              matchScore: matchScore(normalized, row.tsCode, null, row.name),
            })),
          )
          return
        }

        const today = startOfUtcDay(new Date())
        const rows = await this.prisma.optBasic.findMany({
          where: {
            ...(includeDelisted ? {} : { OR: [{ delistDate: null }, { delistDate: { gte: today } }] }),
            AND: [
              {
                OR: [
                  { tsCode: { contains: query, mode: 'insensitive' } },
                  { optCode: { contains: query, mode: 'insensitive' } },
                  { name: { contains: query, mode: 'insensitive' } },
                ],
              },
            ],
          },
          select: { tsCode: true, optCode: true, name: true, exchange: true, listDate: true, delistDate: true },
          orderBy: { tsCode: 'asc' },
          take: 20,
        })
        candidates.push(
          ...rows.map((row) => ({
            tsCode: row.tsCode,
            name: row.name,
            securityType,
            exchange: row.exchange,
            listStatus: row.delistDate && row.delistDate < today ? 'D' : 'L',
            listDate: toIsoDate(row.listDate),
            delistDate: toIsoDate(row.delistDate),
            matchScore: matchScore(normalized, row.tsCode, row.optCode, row.name),
          })),
        )
      }),
    )

    const sorted = candidates
      .sort((left, right) => right.matchScore - left.matchScore || left.tsCode.localeCompare(right.tsCode))
      .slice(0, 20)
    return {
      query,
      candidates: sorted,
      ambiguous: sorted.length > 1 && sorted[0].matchScore - sorted[1].matchScore <= 0.05,
      sourceModels: sourceModelsForSecurityTypes(types),
    }
  }

  async getPriceHistory(input: StockPriceHistoryInput) {
    if (!MARKET_PRICE_DATA_CONTRACT_VERIFIED && input.adjustment === 'FORWARD') {
      throw new StockPriceDataQualityError('前复权数据合同尚未通过验证')
    }

    const startDate = parseIsoDate(input.startDate)
    const endDate = parseIsoDate(input.endDate)
    const tableName = Prisma.raw(PRICE_TABLES[input.frequency])
    const queryLimit = input.limit + 1
    const rows = await this.prisma.$queryRaw<PriceRow[]>`
      SELECT
        t.trade_date AS "tradeDate",
        t.open,
        t.high,
        t.low,
        t.close,
        t.pre_close AS "preClose",
        t.pct_chg AS "pctChange",
        t.vol AS "volume",
        t.amount,
        v.turnover_rate AS "turnoverRate",
        v.pe_ttm AS "peTtm",
        af.adj_factor AS "adjFactor"
      FROM ${tableName} t
      LEFT JOIN stock_daily_valuation_metrics v
        ON v.ts_code = t.ts_code AND v.trade_date = t.trade_date
      LEFT JOIN LATERAL (
        SELECT adj_factor
        FROM stock_adjustment_factors
        WHERE ts_code = t.ts_code AND trade_date <= t.trade_date
        ORDER BY trade_date DESC
        LIMIT 1
      ) af ON true
      WHERE t.ts_code = ${input.tsCode}
        AND t.trade_date >= ${startDate}
        AND t.trade_date <= ${endDate}
      ORDER BY t.trade_date DESC
      LIMIT ${queryLimit}
    `

    const truncated = rows.length > input.limit
    const selectedRows = rows.slice(0, input.limit).reverse()
    const fields = input.fields?.length ? input.fields : [...DEFAULT_STOCK_PRICE_FIELDS]
    const latestFactor =
      input.adjustment === 'NONE'
        ? null
        : await this.prisma.adjFactor.findFirst({
            where: { tsCode: input.tsCode, tradeDate: { lte: endDate }, adjFactor: { gt: 0 } },
            orderBy: { tradeDate: 'desc' },
            select: { adjFactor: true, tradeDate: true },
          })

    if (input.adjustment !== 'NONE' && (!latestFactor?.adjFactor || selectedRows.some((row) => !row.adjFactor))) {
      throw new StockPriceDataQualityError('查询区间缺少可用复权因子')
    }

    const bars = selectedRows.map((row) => {
      const multiplier = adjustmentMultiplier(input.adjustment, row.adjFactor, latestFactor?.adjFactor ?? null)
      const bar: Record<string, string | number | null> = { tradeDate: toIsoDate(row.tradeDate)! }
      for (const field of fields) {
        const value = row[field]
        bar[field] = isPriceField(field) ? roundPrice(value, multiplier) : toNullableNumber(value)
      }
      return bar
    })
    const lastBarDate = bars.at(-1)?.tradeDate

    return {
      data: {
        tsCode: input.tsCode,
        frequency: input.frequency,
        adjustment: input.adjustment,
        startDate: input.startDate,
        endDate: input.endDate,
        fields,
        units: {
          price: 'CNY',
          pctChange: 'PERCENT',
          volume: 'LOT',
          amount: 'CNY_THOUSAND',
          turnoverRate: 'PERCENT',
          peTtm: 'MULTIPLE',
        },
        bars,
      },
      truncated,
      asOf: typeof lastBarDate === 'string' ? lastBarDate : null,
      adjustmentFactorAsOf: toIsoDate(latestFactor?.tradeDate),
      sourceModels: [priceSourceModel(input.frequency), 'AdjFactor', 'DailyBasic'],
    }
  }

  async getOverview(input: StockOverviewInput) {
    const sections = input.sections?.length ? [...new Set(input.sections)] : DEFAULT_OVERVIEW_SECTIONS
    const asOfDate = input.asOfDate ? parseIsoDate(input.asOfDate) : undefined
    const codes = input.tsCodes
    const needsQuote = sections.includes('QUOTE') || sections.includes('DATA_DATES')
    const needsValuation =
      sections.includes('VALUATION') || sections.includes('SHARE_CAPITAL') || sections.includes('DATA_DATES')
    const needsIndustry = sections.includes('INDUSTRY')

    const quotePromise: Promise<OverviewQuoteRow[]> = needsQuote
      ? this.prisma.daily.findMany({
          where: { tsCode: { in: codes }, ...(asOfDate ? { tradeDate: { lte: asOfDate } } : {}) },
          orderBy: [{ tsCode: 'asc' }, { tradeDate: 'desc' }],
          distinct: ['tsCode'],
          select: {
            tsCode: true,
            tradeDate: true,
            open: true,
            high: true,
            low: true,
            close: true,
            preClose: true,
            pctChg: true,
            vol: true,
            amount: true,
          },
        })
      : Promise.resolve([])
    const valuationPromise: Promise<OverviewValuationRow[]> = needsValuation
      ? this.prisma.dailyBasic.findMany({
          where: { tsCode: { in: codes }, ...(asOfDate ? { tradeDate: { lte: asOfDate } } : {}) },
          orderBy: [{ tsCode: 'asc' }, { tradeDate: 'desc' }],
          distinct: ['tsCode'],
          select: {
            tsCode: true,
            tradeDate: true,
            turnoverRate: true,
            pe: true,
            peTtm: true,
            pb: true,
            psTtm: true,
            dvTtm: true,
            totalShare: true,
            floatShare: true,
            freeShare: true,
            totalMv: true,
            circMv: true,
          },
        })
      : Promise.resolve([])
    const [basics, quotes, valuations, industries] = await Promise.all([
      this.prisma.stockBasic.findMany({
        where: { tsCode: { in: codes } },
        select: {
          tsCode: true,
          symbol: true,
          name: true,
          exchange: true,
          market: true,
          area: true,
          industry: true,
          listStatus: true,
          listDate: true,
          delistDate: true,
        },
      }),
      quotePromise,
      valuationPromise,
      needsIndustry
        ? this.prisma.indexMemberAll.findMany({
            where: {
              tsCode: { in: codes },
              ...(asOfDate
                ? { inDate: { lte: asOfDate }, OR: [{ outDate: null }, { outDate: { gte: asOfDate } }] }
                : { isNew: 'Y' }),
            },
            orderBy: [{ tsCode: 'asc' }, { inDate: 'desc' }],
            select: {
              tsCode: true,
              l1Code: true,
              l1Name: true,
              l2Code: true,
              l2Name: true,
              l3Code: true,
              l3Name: true,
              inDate: true,
              outDate: true,
            },
          })
        : [],
    ])

    const basicMap = new Map(basics.map((row) => [row.tsCode, row]))
    const quoteMap = new Map(quotes.map((row) => [row.tsCode, row]))
    const valuationMap = new Map(valuations.map((row) => [row.tsCode, row]))
    const industryMap = new Map<string, (typeof industries)[number]>()
    for (const row of industries) if (!industryMap.has(row.tsCode)) industryMap.set(row.tsCode, row)

    const items = codes.map((tsCode) => {
      const basic = basicMap.get(tsCode)
      const quote = quoteMap.get(tsCode)
      const valuation = valuationMap.get(tsCode)
      const industry = industryMap.get(tsCode)
      return {
        tsCode,
        found: Boolean(basic),
        ...(sections.includes('BASIC')
          ? {
              basic: basic
                ? {
                    symbol: basic.symbol,
                    name: basic.name,
                    exchange: basic.exchange,
                    market: basic.market,
                    area: basic.area,
                    industry: basic.industry,
                    listStatus: basic.listStatus,
                    listDate: toIsoDate(basic.listDate),
                    delistDate: toIsoDate(basic.delistDate),
                  }
                : null,
            }
          : {}),
        ...(sections.includes('QUOTE')
          ? {
              quote: quote
                ? {
                    tradeDate: toIsoDate(quote.tradeDate),
                    open: quote.open,
                    high: quote.high,
                    low: quote.low,
                    close: quote.close,
                    preClose: quote.preClose,
                    pctChange: quote.pctChg,
                    volume: quote.vol,
                    amount: quote.amount,
                  }
                : null,
            }
          : {}),
        ...(sections.includes('VALUATION')
          ? {
              valuation: valuation
                ? {
                    tradeDate: toIsoDate(valuation.tradeDate),
                    turnoverRate: valuation.turnoverRate,
                    pe: valuation.pe,
                    peTtm: valuation.peTtm,
                    pb: valuation.pb,
                    psTtm: valuation.psTtm,
                    dividendYieldTtm: valuation.dvTtm,
                    totalMarketValue: valuation.totalMv,
                    circulatingMarketValue: valuation.circMv,
                  }
                : null,
            }
          : {}),
        ...(sections.includes('INDUSTRY')
          ? {
              industry: industry
                ? {
                    level1Code: industry.l1Code,
                    level1Name: industry.l1Name,
                    level2Code: industry.l2Code,
                    level2Name: industry.l2Name,
                    level3Code: industry.l3Code,
                    level3Name: industry.l3Name,
                    inDate: toIsoDate(industry.inDate),
                    outDate: toIsoDate(industry.outDate),
                  }
                : null,
            }
          : {}),
        ...(sections.includes('SHARE_CAPITAL')
          ? {
              shareCapital: valuation
                ? {
                    tradeDate: toIsoDate(valuation.tradeDate),
                    totalShares: valuation.totalShare,
                    floatShares: valuation.floatShare,
                    freeFloatShares: valuation.freeShare,
                  }
                : null,
            }
          : {}),
        ...(sections.includes('DATA_DATES')
          ? {
              dataDates: {
                quote: toIsoDate(quote?.tradeDate),
                valuation: toIsoDate(valuation?.tradeDate),
              },
            }
          : {}),
      }
    })
    const dataDates = [...quotes, ...valuations].map((row) => toIsoDate(row.tradeDate)).filter(isString)

    return {
      data: { requestedAsOfDate: input.asOfDate ?? null, sections, items },
      asOf: dataDates.sort().at(-1) ?? null,
      sourceModels: overviewSourceModels(sections),
    }
  }
}

function matchScore(query: string, tsCode: string, symbol?: string | null, name?: string | null): number {
  const values = [tsCode, symbol, name].filter(isString).map((value) => value.toLocaleLowerCase('zh-CN'))
  if (values.some((value) => value === query)) return 1
  if (values.some((value) => value.startsWith(query))) return 0.9
  if (values.some((value) => value.includes(query))) return 0.75
  return 0.5
}

function sourceModelsForSecurityTypes(types: SecurityType[]): string[] {
  const map: Record<SecurityType, string> = {
    STOCK: 'StockBasic',
    INDEX: 'IndexDaily',
    FUND: 'FundBasic',
    OPTION: 'OptBasic',
  }
  return types.map((type) => map[type])
}

function priceSourceModel(frequency: StockPriceFrequency): string {
  return frequency === 'DAILY' ? 'Daily' : frequency === 'WEEKLY' ? 'Weekly' : 'Monthly'
}

function overviewSourceModels(sections: StockOverviewSection[]): string[] {
  const models = new Set<string>(['StockBasic'])
  if (sections.includes('QUOTE') || sections.includes('DATA_DATES')) models.add('Daily')
  if (sections.some((section) => ['VALUATION', 'SHARE_CAPITAL', 'DATA_DATES'].includes(section))) {
    models.add('DailyBasic')
  }
  if (sections.includes('INDUSTRY')) models.add('IndexMemberAll')
  return [...models]
}

function adjustmentMultiplier(
  adjustment: StockPriceAdjustment,
  factor: number | null,
  latestFactor: number | null,
): number {
  if (adjustment === 'NONE') return 1
  if (!factor || factor <= 0 || !latestFactor || latestFactor <= 0) return 1
  return adjustment === 'FORWARD' ? factor / latestFactor : factor
}

function isPriceField(field: StockPriceField): boolean {
  return ['open', 'high', 'low', 'close', 'preClose'].includes(field)
}

function roundPrice(value: number | null, multiplier: number): number | null {
  return value == null ? null : Math.round(value * multiplier * 10_000) / 10_000
}

function toNullableNumber(value: number | Prisma.Decimal | null): number | null {
  return value == null ? null : Number(value)
}

function parseIsoDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`)
}

function toIsoDate(value: Date | string | null | undefined): string | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString().slice(0, 10)
}

function exchangeFromTsCode(tsCode: string): string | null {
  return tsCode.includes('.') ? (tsCode.split('.').at(-1) ?? null) : null
}

function startOfUtcDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()))
}

function isString(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.length > 0
}
