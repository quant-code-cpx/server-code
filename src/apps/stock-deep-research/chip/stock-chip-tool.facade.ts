import { Injectable } from '@nestjs/common'
import { estimateChipDistribution } from 'src/apps/stock/utils/chip-estimation'
import type { OhlcvBar } from 'src/apps/stock/utils/technical-indicators'
import {
  assertStockExists,
  finiteOrNull,
  normalizeSections,
  normalizeTsCode,
  normalizeUnexpectedError,
  notReady,
  notRequested,
  ok,
  parseIsoDate,
  requireInteger,
  StockDeepResearchToolError,
  type SectionResult,
  type StockDeepResearchWarning,
  toIsoDate,
} from '../stock-deep-research.types'
import { StockChipRepository } from './stock-chip.repository'

export const STOCK_CHIP_SECTIONS = ['SUMMARY', 'DISTRIBUTION', 'HISTORY'] as const
export type StockChipSection = (typeof STOCK_CHIP_SECTIONS)[number]

export interface StockChipProfileInput {
  tsCode: string
  asOfDate?: string
  sections?: StockChipSection[]
  historyTradeDays?: number
  maxPriceBuckets?: number
  sourcePolicy?: 'STORED_ONLY' | 'ALLOW_LOCAL_ESTIMATE'
}

interface PriceBucket {
  price: number
  percent: number | null
}

@Injectable()
export class StockChipToolFacade {
  constructor(private readonly repository: StockChipRepository) {}

  async getProfile(input: StockChipProfileInput) {
    const tsCode = normalizeTsCode(input.tsCode)
    const asOf = parseIsoDate(input.asOfDate)
    const sections = normalizeSections(input.sections, STOCK_CHIP_SECTIONS, ['SUMMARY'])
    const historyTradeDays = input.historyTradeDays ?? 60
    const maxPriceBuckets = input.maxPriceBuckets ?? 200
    requireInteger(historyTradeDays, 'historyTradeDays', 1, 500)
    requireInteger(maxPriceBuckets, 'maxPriceBuckets', 20, 500)
    const sourcePolicy = input.sourcePolicy ?? 'STORED_ONLY'
    if (!['STORED_ONLY', 'ALLOW_LOCAL_ESTIMATE'].includes(sourcePolicy)) {
      throw new StockDeepResearchToolError('INVALID_ARGUMENT', 'sourcePolicy 仅支持 STORED_ONLY、ALLOW_LOCAL_ESTIMATE')
    }

    try {
      await assertStockExists((code) => this.repository.findStock(code), tsCode)
      const [coverage, latest] = await Promise.all([
        this.repository.findCoverageStart(tsCode),
        this.repository.findLatestPerformance(tsCode, asOf),
      ])
      if (!coverage) throw new StockDeepResearchToolError('DATA_NOT_READY', `${tsCode} 的筹码摘要尚未入库`, true)
      if (asOf && asOf < coverage.tradeDate) {
        throw new StockDeepResearchToolError('DATA_NOT_FOUND', '请求日期早于筹码数据覆盖起点')
      }
      if (!latest) throw new StockDeepResearchToolError('DATA_NOT_READY', `${tsCode} 在请求日期前无筹码数据`, true)

      const requested = new Set(sections)
      const warnings: StockDeepResearchWarning[] = []
      const close = requested.has('SUMMARY') ? await this.repository.findClose(tsCode, latest.tradeDate) : null
      const summary = requested.has('SUMMARY')
        ? ok({
            tradeDate: toIsoDate(latest.tradeDate),
            currentPrice: finiteOrNull(close?.close),
            cost5Pct: finiteOrNull(latest.cost5pct),
            cost15Pct: finiteOrNull(latest.cost15pct),
            medianCost: finiteOrNull(latest.cost50pct),
            cost85Pct: finiteOrNull(latest.cost85pct),
            cost95Pct: finiteOrNull(latest.cost95pct),
            weightedAverageCost: finiteOrNull(latest.weightAvg),
            winnerRate: finiteOrNull(latest.winnerRate),
            source: 'TUSHARE_CYQ_PERF' as const,
            isEstimated: false as const,
          })
        : notRequested()

      let distribution: SectionResult<unknown> = notRequested()
      if (requested.has('DISTRIBUTION')) {
        const stored = await this.repository.findDistribution(tsCode, latest.tradeDate)
        if (stored.length) {
          const all = stored.map((row) => ({ price: row.price, percent: finiteOrNull(row.percent) }))
          const buckets = mergePriceBuckets(all, maxPriceBuckets)
          distribution = ok({
            tradeDate: toIsoDate(latest.tradeDate),
            totalBuckets: all.length,
            returnedBuckets: buckets.length,
            sampling: buckets.length === all.length ? ('NONE' as const) : ('WEIGHTED_BUCKET_MERGE' as const),
            buckets,
            source: 'TUSHARE_CYQ_CHIPS' as const,
            isEstimated: false,
            algorithmVersion: null,
          })
        } else if (sourcePolicy === 'ALLOW_LOCAL_ESTIMATE') {
          const bars = await this.repository.findEstimationBars(tsCode, latest.tradeDate)
          const normalizedBars = toEstimationBars(bars.reverse())
          const currentPrice = normalizedBars.at(-1)?.close
          if (currentPrice && normalizedBars.length) {
            const estimated = estimateChipDistribution(normalizedBars, currentPrice)
            const all = estimated.distribution.map((item) => ({
              price: (item.priceLow + item.priceHigh) / 2,
              percent: finiteOrNull(item.percent),
            }))
            const buckets = mergePriceBuckets(all, maxPriceBuckets)
            distribution = ok({
              tradeDate: toIsoDate(latest.tradeDate),
              totalBuckets: all.length,
              returnedBuckets: buckets.length,
              sampling: buckets.length === all.length ? ('NONE' as const) : ('WEIGHTED_BUCKET_MERGE' as const),
              buckets,
              source: 'LOCAL_OHLCV_ESTIMATE' as const,
              isEstimated: true,
              algorithmVersion: 'chip-estimation.v1',
            })
            warnings.push({
              code: 'ESTIMATED_FROM_OHLCV',
              message: '该交易日无真实筹码分布，已按显式策略使用本地行情估算',
            })
          } else {
            distribution = notReady('筹码分布和可估算行情均未就绪')
          }
        } else {
          distribution = notReady('该筹码摘要交易日尚无真实价位分布')
        }
      }

      const history = requested.has('HISTORY')
        ? ok(
            (await this.repository.findPerformanceHistory(tsCode, latest.tradeDate, historyTradeDays))
              .reverse()
              .map((row) => ({
                tradeDate: toIsoDate(row.tradeDate),
                medianCost: finiteOrNull(row.cost50pct),
                weightedAverageCost: finiteOrNull(row.weightAvg),
                winnerRate: finiteOrNull(row.winnerRate),
              })),
          )
        : notRequested()

      const requestedResults = [summary, distribution, history].filter((_, index) =>
        requested.has(STOCK_CHIP_SECTIONS[index]),
      )
      if (!requestedResults.some((section) => section.status === 'OK')) {
        throw new StockDeepResearchToolError('DATA_NOT_READY', '请求的筹码分区均未就绪', true)
      }
      if (input.asOfDate && input.asOfDate !== toIsoDate(latest.tradeDate)) {
        warnings.push({
          code: 'LATEST_READY_TRADE_DATE_USED',
          message: `已使用最近可用筹码交易日 ${toIsoDate(latest.tradeDate)}`,
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
          },
          summary,
          distribution,
          history,
        },
        warnings,
      }
    } catch (error) {
      throw normalizeUnexpectedError(error, '筹码数据查询暂时失败')
    }
  }
}

function toEstimationBars(
  rows: Array<{
    tradeDate: Date
    open: number | null
    high: number | null
    low: number | null
    close: number | null
    preClose: number | null
    vol: number | null
    amount: number | null
  }>,
): OhlcvBar[] {
  return rows.flatMap((row) => {
    if ([row.open, row.high, row.low, row.close, row.preClose, row.vol, row.amount].some((value) => value === null))
      return []
    return [
      {
        tradeDate: toIsoDate(row.tradeDate).replaceAll('-', ''),
        open: row.open!,
        high: row.high!,
        low: row.low!,
        close: row.close!,
        preClose: row.preClose!,
        vol: row.vol!,
        amount: row.amount!,
      },
    ]
  })
}

export function mergePriceBuckets(buckets: readonly PriceBucket[], maximum: number): PriceBucket[] {
  if (buckets.length <= maximum) return buckets.map((bucket) => ({ ...bucket }))
  const output: PriceBucket[] = []
  for (let index = 0; index < maximum; index += 1) {
    const start = Math.floor((index * buckets.length) / maximum)
    const end = Math.floor(((index + 1) * buckets.length) / maximum)
    const group = buckets.slice(start, end)
    const nonNull = group.filter((item) => item.percent !== null)
    const percent = nonNull.length ? nonNull.reduce((sum, item) => sum + item.percent!, 0) : null
    const absoluteWeight = nonNull.reduce((sum, item) => sum + Math.abs(item.percent!), 0)
    const price =
      absoluteWeight > 0
        ? nonNull.reduce((sum, item) => sum + item.price * Math.abs(item.percent!), 0) / absoluteWeight
        : group.reduce((sum, item) => sum + item.price, 0) / group.length
    output.push({ price, percent })
  }
  return output
}
