import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import { PrismaService } from 'src/shared/prisma.service'
import { CacheService } from 'src/shared/cache.service'
import { ADMIN_WATCHLIST_UNLIMITED } from 'src/constant/user.constant'
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

    const quotes = await this.getLatestQuotes(stocks.map((s) => s.tsCode))
    return { stocks: stocks.map((s) => ({ ...s, quote: quotes.get(s.tsCode) ?? null })) }
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

    const result = await this.prisma.watchlistStock.createMany({
      data: dto.stocks.map((s) => ({
        watchlistId,
        tsCode: s.tsCode,
        notes: s.notes ?? null,
        tags: s.tags ?? [],
        targetPrice: s.targetPrice ?? null,
      })),
      skipDuplicates: true,
    })

    await this.invalidateWatchlistCache(userId, watchlistId)
    return { added: result.count, skipped: dto.stocks.length - result.count }
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
    return { watchlists }
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
          tradeDate: d
            ? `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
            : null,
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
