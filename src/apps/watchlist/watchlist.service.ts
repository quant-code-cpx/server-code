import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import { PrismaService } from 'src/shared/prisma.service'
import { CacheService } from 'src/shared/cache.service'
import { ADMIN_WATCHLIST_UNLIMITED } from 'src/constant/user.constant'
import { diffCompactTradeDateFromShanghaiToday, formatDateToCompactTradeDate } from 'src/common/utils/trade-date.util'
import {
  AddWatchlistStockDto,
  BatchAddStocksDto,
  BatchRemoveStocksDto,
  CreateWatchlistDto,
  ReorderWatchlistsDto,
  UpdateWatchlistDto,
  UpdateWatchlistStockDto,
} from './dto/watchlist.dto'
import {
  MAX_STOCKS_PER_WATCHLIST,
  WATCHLIST_CACHE_TTL,
  WATCHLIST_QUOTE_CACHE_TTL,
} from './constants/watchlist.constant'

export interface StockQuote {
  close: number | null
  pctChg: number | null
  vol: number | null
  amount: number | null
  pe: number | null
  pb: number | null
  totalMv: number | null
  tradeDate: string | null
}

@Injectable()
export class WatchlistService {
  private readonly logger = new Logger(WatchlistService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: CacheService,
  ) {}

  // ── 自选组 CRUD ──────────────────────────────────────────────────────────

  async getWatchlists(userId: number) {
    return this.prisma.watchlist.findMany({
      where: { userId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      include: { _count: { select: { stocks: true } } },
    })
  }

  async createWatchlist(userId: number, dto: CreateWatchlistDto) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } })
    const count = await this.prisma.watchlist.count({ where: { userId } })
    if (user.watchlistLimit !== ADMIN_WATCHLIST_UNLIMITED && count >= user.watchlistLimit) {
      throw new BadRequestException(`自选组数量已达上限（最多 ${user.watchlistLimit} 个）`)
    }

    if (dto.isDefault) {
      await this.prisma.watchlist.updateMany({ where: { userId, isDefault: true }, data: { isDefault: false } })
    }

    try {
      const watchlist = await this.prisma.watchlist.create({
        data: { userId, name: dto.name, description: dto.description ?? null, isDefault: dto.isDefault ?? false },
      })
      await this.invalidateUserCache(userId)
      return watchlist
    } catch (e: unknown) {
      if ((e as Prisma.PrismaClientKnownRequestError).code === 'P2002') throw new ConflictException('同名自选组已存在')
      throw e
    }
  }

  async updateWatchlist(userId: number, id: number, dto: UpdateWatchlistDto) {
    const existing = await this.prisma.watchlist.findFirst({ where: { id, userId } })
    if (!existing) throw new NotFoundException('自选组不存在')

    if (dto.isDefault === true) {
      await this.prisma.watchlist.updateMany({
        where: { userId, isDefault: true, id: { not: id } },
        data: { isDefault: false },
      })
    }

    try {
      const updated = await this.prisma.watchlist.update({
        where: { id },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.description !== undefined && { description: dto.description }),
          ...(dto.isDefault !== undefined && { isDefault: dto.isDefault }),
          ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
        },
      })
      await this.invalidateUserCache(userId)
      return updated
    } catch (e: unknown) {
      if ((e as Prisma.PrismaClientKnownRequestError).code === 'P2002') throw new ConflictException('同名自选组已存在')
      throw e
    }
  }

  async deleteWatchlist(userId: number, id: number) {
    const existing = await this.prisma.watchlist.findFirst({ where: { id, userId } })
    if (!existing) throw new NotFoundException('自选组不存在')

    await this.prisma.watchlist.delete({ where: { id } })
    await this.invalidateUserCache(userId)
    return { message: '删除成功' }
  }

  async reorderWatchlists(userId: number, dto: ReorderWatchlistsDto) {
    await this.prisma.$transaction(
      dto.items.map((item) =>
        this.prisma.watchlist.updateMany({
          where: { id: item.id, userId },
          data: { sortOrder: item.sortOrder },
        }),
      ),
    )
    await this.invalidateUserCache(userId)
    return { message: '排序已更新' }
  }

  // ── 自选股成员管理 ────────────────────────────────────────────────────────

  async getStocks(userId: number, watchlistId: number) {
    const watchlist = await this.prisma.watchlist.findFirst({ where: { id: watchlistId, userId } })
    if (!watchlist) throw new NotFoundException('自选组不存在')

    const stocks = await this.prisma.watchlistStock.findMany({
      where: { watchlistId },
      orderBy: [{ sortOrder: 'asc' }, { addedAt: 'desc' }],
    })

    if (stocks.length === 0) return { stocks: [] }

    const tsCodes = stocks.map((s) => s.tsCode)
    const [quotes, basics] = await Promise.all([
      this.getLatestQuotes(tsCodes),
      this.prisma.stockBasic.findMany({
        where: { tsCode: { in: tsCodes } },
        select: { tsCode: true, name: true, industry: true, area: true },
      }),
    ])

    const basicMap = new Map(basics.map((b) => [b.tsCode, b]))
    return {
      stocks: stocks.map((s) => {
        const basic = basicMap.get(s.tsCode)
        const quote = quotes.get(s.tsCode) ?? null
        const daysAgo = diffCompactTradeDateFromShanghaiToday(quote?.tradeDate)
        const quoteStatus = quote?.tradeDate ? (daysAgo != null && daysAgo <= 5 ? 'LIVE' : 'STALE') : 'MISSING'
        return {
          ...s,
          stockName: basic?.name ?? null,
          industry: basic?.industry ?? null,
          area: basic?.area ?? null,
          quote: quote ? { ...quote, quoteStatus } : null,
        }
      }),
    }
  }

  async addStock(userId: number, watchlistId: number, dto: AddWatchlistStockDto) {
    const watchlist = await this.prisma.watchlist.findFirst({ where: { id: watchlistId, userId } })
    if (!watchlist) throw new NotFoundException('自选组不存在')

    const count = await this.prisma.watchlistStock.count({ where: { watchlistId } })
    if (count >= MAX_STOCKS_PER_WATCHLIST) {
      throw new BadRequestException(`每个自选组最多 ${MAX_STOCKS_PER_WATCHLIST} 只股票`)
    }

    const stockExists = await this.prisma.stockBasic.findFirst({ where: { tsCode: dto.tsCode } })
    if (!stockExists) throw new NotFoundException(`股票代码 ${dto.tsCode} 不存在`)

    try {
      const stock = await this.prisma.watchlistStock.create({
        data: {
          watchlistId,
          tsCode: dto.tsCode,
          notes: dto.notes ?? null,
          tags: dto.tags ?? [],
          targetPrice: dto.targetPrice ?? null,
        },
      })
      await this.invalidateWatchlistCache(userId, watchlistId)
      return stock
    } catch (e: unknown) {
      if ((e as Prisma.PrismaClientKnownRequestError).code === 'P2002')
        throw new ConflictException('该股票已在自选组中')
      throw e
    }
  }

  async batchAddStocks(userId: number, watchlistId: number, dto: BatchAddStocksDto) {
    const watchlist = await this.prisma.watchlist.findFirst({ where: { id: watchlistId, userId } })
    if (!watchlist) throw new NotFoundException('自选组不存在')

    const currentCount = await this.prisma.watchlistStock.count({ where: { watchlistId } })
    if (currentCount + dto.stocks.length > MAX_STOCKS_PER_WATCHLIST) {
      throw new BadRequestException(
        `超出上限：当前 ${currentCount} 只，本次添加 ${dto.stocks.length} 只，上限 ${MAX_STOCKS_PER_WATCHLIST}`,
      )
    }

    // 查询已存在的代码，便于返回 skippedCodes
    const incomingCodes = dto.stocks.map((s) => s.tsCode)
    const seenIncoming = new Set<string>()
    const duplicatedIncoming = new Set<string>()
    for (const code of incomingCodes) {
      if (seenIncoming.has(code)) duplicatedIncoming.add(code)
      seenIncoming.add(code)
    }
    const existing = await this.prisma.watchlistStock.findMany({
      where: { watchlistId, tsCode: { in: incomingCodes } },
      select: { tsCode: true },
    })
    const existingSet = new Set(existing.map((e) => e.tsCode))
    const createSeen = new Set<string>()
    const createStocks = dto.stocks.filter((s) => {
      if (existingSet.has(s.tsCode)) return false
      if (createSeen.has(s.tsCode)) return false
      createSeen.add(s.tsCode)
      return true
    })
    const skippedCodes = [...new Set(incomingCodes.filter((c) => existingSet.has(c) || duplicatedIncoming.has(c)))]

    const result = await this.prisma.watchlistStock.createMany({
      data: createStocks.map((s) => ({
        watchlistId,
        tsCode: s.tsCode,
        notes: s.notes ?? null,
        tags: s.tags ?? [],
        targetPrice: s.targetPrice ?? null,
      })),
      skipDuplicates: true,
    })

    await this.invalidateWatchlistCache(userId, watchlistId)
    return { added: result.count, skipped: incomingCodes.length - result.count, skippedCodes }
  }

  async updateStock(userId: number, watchlistId: number, stockId: number, dto: UpdateWatchlistStockDto) {
    const watchlist = await this.prisma.watchlist.findFirst({ where: { id: watchlistId, userId } })
    if (!watchlist) throw new NotFoundException('自选组不存在')

    const stock = await this.prisma.watchlistStock.findFirst({ where: { id: stockId, watchlistId } })
    if (!stock) throw new NotFoundException('股票记录不存在')

    const updated = await this.prisma.watchlistStock.update({
      where: { id: stockId },
      data: {
        ...(dto.notes !== undefined && { notes: dto.notes }),
        ...(dto.tags !== undefined && { tags: dto.tags }),
        ...(dto.targetPrice !== undefined && { targetPrice: dto.targetPrice }),
      },
    })
    await this.invalidateWatchlistCache(userId, watchlistId)
    return updated
  }

  async removeStock(userId: number, watchlistId: number, stockId: number) {
    const watchlist = await this.prisma.watchlist.findFirst({ where: { id: watchlistId, userId } })
    if (!watchlist) throw new NotFoundException('自选组不存在')

    const stock = await this.prisma.watchlistStock.findFirst({ where: { id: stockId, watchlistId } })
    if (!stock) throw new NotFoundException('股票记录不存在')

    await this.prisma.watchlistStock.delete({ where: { id: stockId } })
    await this.invalidateWatchlistCache(userId, watchlistId)
    return { message: '移除成功' }
  }

  async batchRemoveStocks(userId: number, watchlistId: number, dto: BatchRemoveStocksDto) {
    const watchlist = await this.prisma.watchlist.findFirst({ where: { id: watchlistId, userId } })
    if (!watchlist) throw new NotFoundException('自选组不存在')

    const result = await this.prisma.watchlistStock.deleteMany({
      where: { id: { in: dto.stockIds }, watchlistId },
    })
    await this.invalidateWatchlistCache(userId, watchlistId)
    return { removed: result.count }
  }

  async reorderStocks(userId: number, watchlistId: number, dto: ReorderWatchlistsDto) {
    const watchlist = await this.prisma.watchlist.findFirst({ where: { id: watchlistId, userId } })
    if (!watchlist) throw new NotFoundException('自选组不存在')

    await this.prisma.$transaction(
      dto.items.map((item) =>
        this.prisma.watchlistStock.updateMany({
          where: { id: item.id, watchlistId },
          data: { sortOrder: item.sortOrder },
        }),
      ),
    )
    await this.invalidateWatchlistCache(userId, watchlistId)
    return { message: '排序已更新' }
  }

  // ── 行情汇总 ──────────────────────────────────────────────────────────────

  async getWatchlistSummary(userId: number, watchlistId: number) {
    const { stocks } = await this.getStocks(userId, watchlistId)
    if (!stocks.length) return { stockCount: 0, upCount: 0, downCount: 0, flatCount: 0, avgPctChg: 0, totalMv: 0 }

    const quotes = stocks.map((s) => s.quote).filter(Boolean) as StockQuote[]
    const pctChgs = quotes.map((q) => q.pctChg ?? 0)
    return {
      stockCount: stocks.length,
      upCount: pctChgs.filter((v) => v > 0).length,
      downCount: pctChgs.filter((v) => v < 0).length,
      flatCount: pctChgs.filter((v) => v === 0).length,
      avgPctChg: quotes.length ? pctChgs.reduce((s, v) => s + v, 0) / quotes.length : 0,
      totalMv: quotes.reduce((s, q) => s + (q.totalMv ?? 0), 0),
    }
  }

  async getOverview(userId: number) {
    const watchlists = await this.prisma.watchlist.findMany({
      where: { userId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      include: { _count: { select: { stocks: true } } },
    })

    if (watchlists.length === 0) return { watchlists: [] }

    // Gather all tsCodes across all watchlists
    const allStockRows = await this.prisma.watchlistStock.findMany({
      where: { watchlistId: { in: watchlists.map((w) => w.id) } },
      select: { watchlistId: true, tsCode: true },
    })

    const allTsCodes = [...new Set(allStockRows.map((r) => r.tsCode))]
    const quotes = allTsCodes.length > 0 ? await this.getLatestQuotes(allTsCodes) : new Map<string, StockQuote>()

    // Build per-watchlist summary
    const stocksByWatchlist = new Map<number, string[]>()
    for (const row of allStockRows) {
      const list = stocksByWatchlist.get(row.watchlistId) ?? []
      list.push(row.tsCode)
      stocksByWatchlist.set(row.watchlistId, list)
    }

    const enriched = watchlists.map((w) => {
      const tsCodes = stocksByWatchlist.get(w.id) ?? []
      const stockCount = tsCodes.length

      let upCount = 0
      let downCount = 0
      let flatCount = 0
      let staleCount = 0
      let totalMv = 0
      let pctChgSum = 0
      let pctChgCount = 0
      let latestTradeDate: string | null = null

      for (const tsCode of tsCodes) {
        const q = quotes.get(tsCode)
        if (!q || !q.tradeDate) {
          staleCount++
          continue
        }

        const daysAgo = diffCompactTradeDateFromShanghaiToday(q.tradeDate)
        if (daysAgo != null && daysAgo > 5) {
          staleCount++
        }

        if (!latestTradeDate || q.tradeDate > latestTradeDate) latestTradeDate = q.tradeDate

        if (q.pctChg != null) {
          pctChgSum += q.pctChg
          pctChgCount++
          if (q.pctChg > 0) upCount++
          else if (q.pctChg < 0) downCount++
          else flatCount++
        }
        if (q.totalMv != null) totalMv += q.totalMv
      }

      return {
        id: w.id,
        name: w.name,
        description: w.description,
        isDefault: w.isDefault,
        sortOrder: w.sortOrder,
        stockCount,
        summary: {
          stockCount,
          upCount,
          downCount,
          flatCount,
          avgPctChg: pctChgCount > 0 ? Math.round((pctChgSum / pctChgCount) * 100) / 100 : null,
          totalMv: totalMv > 0 ? totalMv : null,
          latestTradeDate,
          staleCount,
        },
      }
    })

    return { watchlists: enriched }
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private async getLatestQuotes(tsCodes: string[]): Promise<Map<string, StockQuote>> {
    const map = new Map<string, StockQuote>()
    if (!tsCodes.length) return map

    try {
      interface QuoteRow {
        ts_code: string
        close: number | null
        pct_chg: number | null
        vol: number | null
        amount: number | null
        pe_ttm: number | null
        pb: number | null
        total_mv: number | null
        trade_date: Date | null
      }

      const rows = await this.prisma.$queryRaw<QuoteRow[]>`
        SELECT
          d.ts_code,
          d.close::float,
          d.pct_chg::float,
          d.vol::float,
          d.amount::float,
          v.pe_ttm::float,
          v.pb::float,
          v.total_mv::float,
          d.trade_date
        FROM stock_daily_prices d
        LEFT JOIN stock_daily_valuation_metrics v
          ON v.ts_code = d.ts_code AND v.trade_date = d.trade_date
        WHERE d.ts_code = ANY(${tsCodes})
          AND d.trade_date = (
            SELECT MAX(d2.trade_date) FROM stock_daily_prices d2 WHERE d2.ts_code = d.ts_code
          )
      `

      for (const r of rows) {
        const d = r.trade_date instanceof Date ? r.trade_date : r.trade_date ? new Date(r.trade_date) : null
        map.set(r.ts_code, {
          close: r.close,
          pctChg: r.pct_chg,
          vol: r.vol,
          amount: r.amount,
          pe: r.pe_ttm,
          pb: r.pb,
          totalMv: r.total_mv,
          tradeDate: formatDateToCompactTradeDate(d),
        })
      }
    } catch (err) {
      this.logger.warn(`行情聚合查询失败: ${(err as Error).message}`)
    }

    return map
  }

  private async invalidateUserCache(userId: number) {
    await this.cacheService.invalidateByPrefixes([`watchlist:list:${userId}`, `watchlist:overview:${userId}`])
  }

  private async invalidateWatchlistCache(userId: number, watchlistId: number) {
    await this.cacheService.invalidateByPrefixes([
      `watchlist:list:${userId}`,
      `watchlist:stocks:${watchlistId}`,
      `watchlist:summary:${watchlistId}`,
    ])
  }
}
