import { Injectable } from '@nestjs/common'
import { PrismaService } from 'src/shared/prisma.service'

export interface WatchlistToolInput {
  watchlistId?: number
  includeLatestQuote?: boolean
  limit: number
}

export class WatchlistToolNotFoundError extends Error {
  constructor() {
    super('自选组不存在')
    this.name = WatchlistToolNotFoundError.name
  }
}

interface WatchlistQuoteRow {
  tsCode: string
  tradeDate: Date
  close: number | null
  pctChange: number | null
  volume: number | null
  amount: number | null
}

@Injectable()
export class WatchlistToolFacade {
  constructor(private readonly prisma: PrismaService) {}

  async read(userId: number, input: WatchlistToolInput) {
    const groups = await this.prisma.watchlist.findMany({
      where: { userId, ...(input.watchlistId ? { id: input.watchlistId } : {}) },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }, { id: 'asc' }],
      select: {
        id: true,
        name: true,
        description: true,
        isDefault: true,
        sortOrder: true,
        stocks: {
          orderBy: [{ sortOrder: 'asc' }, { addedAt: 'desc' }, { id: 'asc' }],
          select: {
            id: true,
            tsCode: true,
            notes: true,
            tags: true,
            targetPrice: true,
            sortOrder: true,
            addedAt: true,
          },
        },
      },
    })

    if (input.watchlistId && groups.length === 0) throw new WatchlistToolNotFoundError()

    const allMembers = groups.flatMap((group) => group.stocks.map((stock) => ({ groupId: group.id, stock })))
    const truncated = allMembers.length > input.limit
    const selectedMembers = allMembers.slice(0, input.limit)
    const selectedIds = new Set(selectedMembers.map(({ stock }) => stock.id))
    const selectedTsCodes = [...new Set(selectedMembers.map(({ stock }) => stock.tsCode))]
    const basicsPromise: Promise<Array<{ tsCode: string; name: string | null }>> = selectedTsCodes.length
      ? this.prisma.stockBasic.findMany({
          where: { tsCode: { in: selectedTsCodes } },
          select: { tsCode: true, name: true },
        })
      : Promise.resolve([])
    const [quoteMap, basics] = await Promise.all([
      input.includeLatestQuote ? this.getLatestQuotes(selectedTsCodes) : new Map<string, WatchlistQuoteRow>(),
      basicsPromise,
    ])
    const nameMap = new Map(basics.map((basic) => [basic.tsCode, basic.name]))

    const dataGroups = groups.map((group) => ({
      id: group.id,
      name: group.name,
      description: group.description,
      isDefault: group.isDefault,
      sortOrder: group.sortOrder,
      totalMembers: group.stocks.length,
      members: group.stocks
        .filter((stock) => selectedIds.has(stock.id))
        .map((stock) => {
          const quote = quoteMap.get(stock.tsCode)
          return {
            id: stock.id,
            tsCode: stock.tsCode,
            name: nameMap.get(stock.tsCode) ?? null,
            notes: stock.notes,
            tags: stock.tags,
            targetPrice: stock.targetPrice == null ? null : Number(stock.targetPrice),
            sortOrder: stock.sortOrder,
            addedAt: stock.addedAt.toISOString(),
            ...(input.includeLatestQuote
              ? {
                  latestQuote: quote
                    ? {
                        tradeDate: toIsoDate(quote.tradeDate),
                        close: quote.close,
                        pctChange: quote.pctChange,
                        volume: quote.volume,
                        amount: quote.amount,
                      }
                    : null,
                }
              : {}),
          }
        }),
    }))
    const quoteDates = [...quoteMap.values()].map((quote) => toIsoDate(quote.tradeDate)).sort()

    return {
      data: {
        requestedWatchlistId: input.watchlistId ?? null,
        includeLatestQuote: input.includeLatestQuote ?? false,
        groups: dataGroups,
      },
      truncated,
      asOf: quoteDates.at(-1) ?? null,
      sourceModels: input.includeLatestQuote
        ? ['Watchlist', 'WatchlistStock', 'StockBasic', 'Daily']
        : ['Watchlist', 'WatchlistStock', 'StockBasic'],
    }
  }

  private async getLatestQuotes(tsCodes: string[]): Promise<Map<string, WatchlistQuoteRow>> {
    if (!tsCodes.length) return new Map()
    const rows = await this.prisma.$queryRaw<WatchlistQuoteRow[]>`
      SELECT
        d.ts_code AS "tsCode",
        d.trade_date AS "tradeDate",
        d.close,
        d.pct_chg AS "pctChange",
        d.vol AS "volume",
        d.amount
      FROM unnest(${tsCodes}::text[]) AS input(ts_code)
      JOIN LATERAL (
        SELECT ts_code, trade_date, close, pct_chg, vol, amount
        FROM stock_daily_prices
        WHERE ts_code = input.ts_code
        ORDER BY trade_date DESC
        LIMIT 1
      ) d ON true
    `
    return new Map(rows.map((row) => [row.tsCode, row]))
  }
}

function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10)
}
