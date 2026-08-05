import { Injectable } from '@nestjs/common'
import {
  assertStockExists,
  finiteOrNull,
  normalizeSections,
  normalizeTsCode,
  normalizeUnexpectedError,
  notRequested,
  ok,
  parseIsoDate,
  requireInteger,
  StockDeepResearchToolError,
  type StockDeepResearchWarning,
  toIsoDate,
} from '../stock-deep-research.types'
import { StockMarginRepository } from './stock-margin.repository'

export const STOCK_MARGIN_SECTIONS = ['SUMMARY', 'HISTORY'] as const
export type StockMarginSection = (typeof STOCK_MARGIN_SECTIONS)[number]

export interface StockMarginHistoryInput {
  tsCode: string
  asOfDate?: string
  sections?: StockMarginSection[]
  lookbackTradeDays?: number
}

@Injectable()
export class StockMarginToolFacade {
  constructor(private readonly repository: StockMarginRepository) {}

  async getHistory(input: StockMarginHistoryInput) {
    const tsCode = normalizeTsCode(input.tsCode)
    const asOf = parseIsoDate(input.asOfDate)
    const sections = normalizeSections(input.sections, STOCK_MARGIN_SECTIONS, ['SUMMARY'])
    const lookback = input.lookbackTradeDays ?? 60
    requireInteger(lookback, 'lookbackTradeDays', 1, 500)

    try {
      await assertStockExists((code) => this.repository.findStock(code), tsCode)
      const [coverage, latest, stockLatest] = await Promise.all([
        this.repository.findCoverageStart(tsCode),
        this.repository.findLatest(tsCode, asOf),
        this.repository.findStockPriceDataThrough(tsCode, asOf),
      ])
      if (!coverage || !latest) {
        throw new StockDeepResearchToolError('DATA_NOT_READY', `${tsCode} 在请求日期前无两融明细`, true)
      }
      if (asOf && asOf < coverage.tradeDate) {
        throw new StockDeepResearchToolError('DATA_NOT_FOUND', '请求日期早于两融数据覆盖起点')
      }

      const rows = (await this.repository.findHistory(tsCode, latest.tradeDate, Math.max(lookback, 20))).reverse()
      const requested = new Set(sections)
      const selectedRows = rows.slice(-lookback)
      const tradeDates = selectedRows.map((row) => row.tradeDate)
      const [priceRows, factors] = requested.has('HISTORY')
        ? await this.repository.findPriceRows(tsCode, tradeDates)
        : [[], []]
      const priceMap = new Map(priceRows.map((row) => [toIsoDate(row.tradeDate), row.close]))
      const factorMap = new Map(factors.map((row) => [toIsoDate(row.tradeDate), row.adjFactor]))
      const latestFactor = [...factors]
        .reverse()
        .map((row) => finiteOrNull(row.adjFactor))
        .find((value) => value !== null)
      const qfqClose = (date: Date): number | null => {
        const key = toIsoDate(date)
        const close = finiteOrNull(priceMap.get(key))
        const factor = finiteOrNull(factorMap.get(key))
        return close !== null && factor !== null && latestFactor ? (close * factor) / latestFactor : close
      }

      const summary = requested.has('SUMMARY') ? ok(buildSummary(rows)) : notRequested()
      const history = requested.has('HISTORY')
        ? ok(
            selectedRows.map((row) => ({
              tradeDate: toIsoDate(row.tradeDate),
              financingBalance: finiteOrNull(row.rzye),
              financingBuy: finiteOrNull(row.rzmre),
              financingRepay: finiteOrNull(row.rzche),
              financingNetBuy: resolveNetBuy(row.rzjmre, row.rzmre, row.rzche),
              lendingBalance: finiteOrNull(row.rqye),
              lendingSellVolume: finiteOrNull(row.rqmcl),
              lendingRepayVolume: finiteOrNull(row.rqchl),
              lendingRemainingVolume: finiteOrNull(row.rqyl),
              totalBalance: finiteOrNull(row.rzrqye),
              qfqClose: qfqClose(row.tradeDate),
            })),
          )
        : notRequested()
      const lagVsStockTradingDays =
        stockLatest && stockLatest.tradeDate > latest.tradeDate
          ? await this.repository.countStockTradingDaysAfter(tsCode, latest.tradeDate, stockLatest.tradeDate)
          : 0
      const warnings: StockDeepResearchWarning[] = []
      if (lagVsStockTradingDays > 0) {
        warnings.push({
          code: 'MARGIN_DATA_LAGS_MARKET',
          message: `两融数据落后个股行情 ${lagVsStockTradingDays} 个交易日`,
        })
      }
      if (input.asOfDate && input.asOfDate !== toIsoDate(latest.tradeDate)) {
        warnings.push({
          code: 'LATEST_READY_TRADE_DATE_USED',
          message: `已使用最近可用两融交易日 ${toIsoDate(latest.tradeDate)}`,
        })
      }
      return {
        data: {
          meta: {
            tsCode,
            requestedAsOfDate: input.asOfDate ?? null,
            dataThrough: toIsoDate(latest.tradeDate),
            coverageStart: toIsoDate(coverage.tradeDate),
            timezone: 'Asia/Shanghai' as const,
            marketPriceDataThrough: stockLatest ? toIsoDate(stockLatest.tradeDate) : null,
            lagVsStockTradingDays,
            algorithmVersion: 'margin-trend.v1' as const,
          },
          summary,
          history,
          units: {
            balances: 'CNY' as const,
            volumes: 'SHARE' as const,
            close: 'CNY_PER_SHARE' as const,
            changes: 'PERCENT' as const,
          },
        },
        warnings,
      }
    } catch (error) {
      throw normalizeUnexpectedError(error, '两融数据查询暂时失败')
    }
  }
}

type MarginRow = Awaited<ReturnType<StockMarginRepository['findHistory']>>[number]

export function buildSummary(rows: readonly MarginRow[]) {
  const latest = rows.at(-1)
  if (!latest) throw new StockDeepResearchToolError('DATA_NOT_READY', '两融明细为空', true)
  const last5 = rows.slice(-5)
  const last20 = rows.slice(-20)
  const change5 = balanceChange(rows, 5)
  const change20 = balanceChange(rows, 20)
  return {
    latestFinancingBalance: finiteOrNull(latest.rzye),
    latestSecuritiesLendingBalance: finiteOrNull(latest.rqye),
    latestTotalBalance: finiteOrNull(latest.rzrqye),
    financingNetBuy5d: sumObservedNetBuy(last5),
    financingNetBuy20d: sumObservedNetBuy(last20),
    financingBalanceChange5dPct: change5,
    financingBalanceChange20dPct: change20,
    trend:
      rows.length < 20 || change20 === null
        ? ('INSUFFICIENT_DATA' as const)
        : change20 >= 1
          ? ('UP' as const)
          : change20 <= -1
            ? ('DOWN' as const)
            : ('STABLE' as const),
  }
}

function resolveNetBuy(explicit: number | null, buy: number | null, repay: number | null): number | null {
  const value = finiteOrNull(explicit)
  if (value !== null) return value
  const normalizedBuy = finiteOrNull(buy)
  const normalizedRepay = finiteOrNull(repay)
  return normalizedBuy !== null && normalizedRepay !== null ? normalizedBuy - normalizedRepay : null
}

function sumObservedNetBuy(rows: readonly MarginRow[]): number | null {
  const values = rows.map((row) => resolveNetBuy(row.rzjmre, row.rzmre, row.rzche)).filter((value) => value !== null)
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null
}

function balanceChange(rows: readonly MarginRow[], observations: number): number | null {
  if (rows.length < observations) return null
  const selected = rows.slice(-observations)
  const first = finiteOrNull(selected[0].rzye)
  const last = finiteOrNull(selected.at(-1)?.rzye)
  if (first === null || last === null || first === 0) return null
  return (last / first - 1) * 100
}
