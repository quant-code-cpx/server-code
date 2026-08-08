import { BadRequestException, Injectable, NotFoundException, ForbiddenException } from '@nestjs/common'
import { Decimal } from '@prisma/client/runtime/library'
import { PrismaService } from 'src/shared/prisma.service'
import { CacheService } from 'src/shared/cache.service'
import { CACHE_KEY_PREFIX, CACHE_NAMESPACE } from 'src/constant/cache.constant'
import { getShanghaiCompactTradeDate, parseCompactTradeDateToUtcDate } from 'src/common/utils/trade-date.util'
import { CreatePortfolioDto } from './dto/create-portfolio.dto'
import { UpdatePortfolioDto } from './dto/update-portfolio.dto'
import { AddHoldingDto } from './dto/add-holding.dto'
import { UpdateHoldingDto } from './dto/update-holding.dto'
import { RemoveHoldingDto } from './dto/update-holding.dto'
import { PortfolioPnlHistoryDto } from './dto/portfolio-pnl.dto'
import { PortfolioTradeLogService } from './services/portfolio-trade-log.service'

// TTL 常量
const TTL_5MIN = 5 * 60
const TTL_1H = 60 * 60

@Injectable()
export class PortfolioService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: CacheService,
    private readonly tradeLogService: PortfolioTradeLogService,
  ) {}

  // ─── 组合 CRUD ────────────────────────────────────────────────────────────

  async create(userId: number, dto: CreatePortfolioDto) {
    return this.prisma.portfolio.create({
      data: {
        userId,
        name: dto.name,
        description: dto.description,
        initialCash: new Decimal(dto.initialCash),
      },
      select: { id: true, name: true, initialCash: true, description: true, createdAt: true },
    })
  }

  async list(userId: number) {
    const portfolios = await this.prisma.portfolio.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        description: true,
        initialCash: true,
        kind: true,
        isArchived: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { holdings: true } },
      },
    })
    return portfolios.map((p) => ({
      ...p,
      holdingCount: p._count.holdings,
      lastUpdated: p.updatedAt.toISOString(),
      _count: undefined,
    }))
  }

  async detail(portfolioId: string, userId: number) {
    const portfolio = await this.assertOwner(portfolioId, userId)
    const cacheKey = `${CACHE_KEY_PREFIX.PORTFOLIO_DETAIL}:${portfolioId}`
    return this.rememberCache(cacheKey, TTL_5MIN, () => this.buildDetail(portfolio))
  }

  async update(dto: UpdatePortfolioDto, userId: number) {
    await this.assertOwner(dto.id, userId)
    const updated = await this.prisma.portfolio.update({
      where: { id: dto.id },
      data: { name: dto.name, description: dto.description },
      select: { id: true, name: true, description: true, updatedAt: true },
    })
    return updated
  }

  async delete(portfolioId: string, userId: number) {
    await this.assertOwner(portfolioId, userId)
    await this.prisma.portfolio.delete({ where: { id: portfolioId } })
    await this.invalidatePortfolioCache(portfolioId)
    return { success: true }
  }

  // ─── 持仓管理 ─────────────────────────────────────────────────────────────

  async addHolding(dto: AddHoldingDto, userId: number) {
    const holding = await this.prisma.$transaction(async (tx) => {
      const replay = await tx.portfolioHoldingEvent.findUnique({
        where: { userId_idempotencyKey: { userId, idempotencyKey: dto.idempotencyKey } },
        select: { action: true, portfolioId: true, tsCode: true, metadata: true },
      })
      if (replay) return replayHolding(replay, 'ADD', dto.portfolioId, dto.tsCode)
      const portfolio = await tx.portfolio.findFirst({ where: { id: dto.portfolioId, userId }, select: { id: true } })
      if (!portfolio) throw new NotFoundException('组合不存在')
      const [stockBasic, existing] = await Promise.all([
        tx.stockBasic.findFirst({ where: { tsCode: dto.tsCode }, select: { name: true } }),
        tx.portfolioHolding.findUnique({
          where: { portfolioId_tsCode: { portfolioId: dto.portfolioId, tsCode: dto.tsCode } },
        }),
      ])
      const beforeQuantity = existing?.quantity ?? 0
      const beforeAvgCost = existing?.avgCost ?? null
      const newQty = beforeQuantity + dto.quantity
      const newAvgCost = existing
        ? existing.avgCost.mul(existing.quantity).plus(new Decimal(dto.avgCost).mul(dto.quantity)).div(newQty)
        : new Decimal(dto.avgCost)
      const saved = existing
        ? await tx.portfolioHolding.update({
            where: { id: existing.id },
            data: { quantity: newQty, avgCost: newAvgCost },
          })
        : await tx.portfolioHolding.create({
            data: {
              portfolioId: dto.portfolioId,
              tsCode: dto.tsCode,
              stockName: stockBasic?.name ?? dto.tsCode,
              quantity: dto.quantity,
              avgCost: newAvgCost,
            },
          })
      const result = serializeHolding(saved)
      await tx.portfolioHoldingEvent.create({
        data: {
          portfolioId: dto.portfolioId,
          userId,
          holdingId: saved.id,
          tsCode: dto.tsCode,
          action: 'ADD',
          quantityDelta: dto.quantity,
          price: new Decimal(dto.avgCost),
          beforeQuantity,
          afterQuantity: saved.quantity,
          beforeAvgCost,
          afterAvgCost: saved.avgCost,
          effectiveDate: mutationDate(dto.effectiveDate),
          idempotencyKey: dto.idempotencyKey,
          source: 'MANUAL',
          metadata: { result },
        },
      })
      await this.tradeLogService.log(
        {
          portfolioId: dto.portfolioId,
          userId,
          tsCode: dto.tsCode,
          stockName: saved.stockName,
          action: 'ADD',
          quantity: dto.quantity,
          price: dto.avgCost,
          reason: 'MANUAL',
          detail: { idempotencyKey: dto.idempotencyKey },
        },
        tx,
      )
      return saved
    })

    await this.invalidatePortfolioCache(dto.portfolioId)
    return holding
  }

  async updateHolding(dto: UpdateHoldingDto, userId: number) {
    const updated = await this.prisma.$transaction(async (tx) => {
      const replay = await tx.portfolioHoldingEvent.findUnique({
        where: { userId_idempotencyKey: { userId, idempotencyKey: dto.idempotencyKey } },
        select: { action: true, holdingId: true, portfolioId: true, tsCode: true, metadata: true },
      })
      if (replay) return replayHolding(replay, 'ADJUST', replay.portfolioId, replay.tsCode, dto.holdingId)
      const holding = await tx.portfolioHolding.findFirst({
        where: { id: dto.holdingId, portfolio: { userId } },
      })
      if (!holding) throw new NotFoundException('持仓不存在')
      const saved = await tx.portfolioHolding.update({
        where: { id: dto.holdingId },
        data: { quantity: dto.quantity, avgCost: new Decimal(dto.avgCost) },
      })
      const result = serializeHolding(saved)
      await tx.portfolioHoldingEvent.create({
        data: {
          portfolioId: holding.portfolioId,
          userId,
          holdingId: holding.id,
          tsCode: holding.tsCode,
          action: 'ADJUST',
          quantityDelta: dto.quantity - holding.quantity,
          price: new Decimal(dto.avgCost),
          beforeQuantity: holding.quantity,
          afterQuantity: dto.quantity,
          beforeAvgCost: holding.avgCost,
          afterAvgCost: new Decimal(dto.avgCost),
          effectiveDate: mutationDate(dto.effectiveDate),
          idempotencyKey: dto.idempotencyKey,
          source: 'MANUAL',
          metadata: { result },
        },
      })
      await this.tradeLogService.log(
        {
          portfolioId: holding.portfolioId,
          userId,
          tsCode: holding.tsCode,
          stockName: holding.stockName,
          action: 'ADJUST',
          quantity: Math.abs(dto.quantity - holding.quantity),
          price: dto.avgCost,
          reason: 'MANUAL',
          detail: { idempotencyKey: dto.idempotencyKey },
        },
        tx,
      )
      return saved
    })
    await this.invalidatePortfolioCache(updated.portfolioId)
    return updated
  }

  async removeHolding(dto: RemoveHoldingDto, userId: number) {
    const portfolioId = await this.prisma.$transaction(async (tx) => {
      const replay = await tx.portfolioHoldingEvent.findUnique({
        where: { userId_idempotencyKey: { userId, idempotencyKey: dto.idempotencyKey } },
        select: { action: true, holdingId: true, portfolioId: true },
      })
      if (replay) {
        if (replay.action !== 'REMOVE' || replay.holdingId !== dto.holdingId)
          throw new BadRequestException('幂等键已用于其他请求')
        return replay.portfolioId
      }
      const holding = await tx.portfolioHolding.findFirst({
        where: { id: dto.holdingId, portfolio: { userId } },
      })
      if (!holding) throw new NotFoundException('持仓不存在')
      await tx.portfolioHolding.delete({ where: { id: dto.holdingId } })
      await tx.portfolioHoldingEvent.create({
        data: {
          portfolioId: holding.portfolioId,
          userId,
          holdingId: holding.id,
          tsCode: holding.tsCode,
          action: 'REMOVE',
          quantityDelta: -holding.quantity,
          price: holding.avgCost,
          beforeQuantity: holding.quantity,
          afterQuantity: 0,
          beforeAvgCost: holding.avgCost,
          afterAvgCost: null,
          effectiveDate: mutationDate(dto.effectiveDate),
          idempotencyKey: dto.idempotencyKey,
          source: 'MANUAL',
          metadata: { result: { success: true } },
        },
      })
      await this.tradeLogService.log(
        {
          portfolioId: holding.portfolioId,
          userId,
          tsCode: holding.tsCode,
          stockName: holding.stockName,
          action: 'REMOVE',
          quantity: holding.quantity,
          reason: 'MANUAL',
          detail: { idempotencyKey: dto.idempotencyKey },
        },
        tx,
      )
      return holding.portfolioId
    })
    await this.invalidatePortfolioCache(portfolioId)
    return { success: true }
  }

  // ─── 盈亏分析 ─────────────────────────────────────────────────────────────

  async getPnlToday(portfolioId: string, userId: number) {
    await this.assertOwner(portfolioId, userId)
    const cacheKey = `${CACHE_KEY_PREFIX.PORTFOLIO_PNL_TODAY}:${portfolioId}`
    return this.rememberCache(cacheKey, TTL_5MIN, () => this.calcPnlToday(portfolioId))
  }

  async getPnlHistory(dto: PortfolioPnlHistoryDto, userId: number) {
    await this.assertOwner(dto.portfolioId, userId)
    const cacheKey = `${CACHE_KEY_PREFIX.PORTFOLIO_PNL_HIST}:${dto.portfolioId}:${dto.startDate}:${dto.endDate}`
    return this.rememberCache(cacheKey, TTL_1H, () => this.calcPnlHistory(dto.portfolioId, dto.startDate, dto.endDate))
  }

  // ─── 公共工具 ─────────────────────────────────────────────────────────────

  /** 验证 portfolioId 归属当前用户，不属于则抛出 403/404 */
  async assertOwner(portfolioId: string, userId: number) {
    const portfolio = await this.prisma.portfolio.findUnique({ where: { id: portfolioId } })
    if (!portfolio) throw new NotFoundException('组合不存在')
    if (portfolio.userId !== userId) throw new ForbiddenException('无权访问该组合')
    return portfolio
  }

  /** 查询最近可用交易日 */
  async getLatestTradeDate(): Promise<Date | null> {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const cal = await this.prisma.tradeCal.findFirst({
      where: { isOpen: '1', calDate: { lte: today } },
      orderBy: { calDate: 'desc' },
    })
    return cal?.calDate ?? null
  }

  // ─── 私有方法 ─────────────────────────────────────────────────────────────

  private async buildDetail(portfolio: {
    id: string
    initialCash: Decimal
    kind: string
    isArchived: boolean
    name: string
    description: string | null
    createdAt: Date
    updatedAt: Date
  }) {
    const latestDate = await this.getLatestTradeDate()

    const holdings = await this.prisma.portfolioHolding.findMany({
      where: { portfolioId: portfolio.id },
      orderBy: { createdAt: 'asc' },
    })

    if (!holdings.length) {
      return {
        portfolio: { ...portfolio, lastUpdated: portfolio.updatedAt.toISOString() },
        holdings: [],
        summary: {
          totalCost: 0,
          totalMarketValue: 0,
          totalUnrealizedPnl: 0,
          totalPnlPct: 0,
          cashBalance: Number(portfolio.initialCash),
          isTradingDay: !!latestDate,
          lastUpdated: portfolio.updatedAt.toISOString(),
        },
      }
    }

    const tsCodes = holdings.map((h) => h.tsCode)

    // 批量查最近一日的估值指标
    const valMap = new Map<string, { close: number | null; totalMv: number | null }>()
    if (latestDate) {
      const vals = await this.prisma.dailyBasic.findMany({
        where: { tsCode: { in: tsCodes }, tradeDate: latestDate },
        select: { tsCode: true, close: true, totalMv: true },
      })
      vals.forEach((v) => valMap.set(v.tsCode, { close: v.close, totalMv: v.totalMv }))
    }

    // 批量查行业
    const industryMap = new Map<string, string | null>()
    const stocks = await this.prisma.stockBasic.findMany({
      where: { tsCode: { in: tsCodes } },
      select: { tsCode: true, industry: true },
    })
    stocks.forEach((s) => industryMap.set(s.tsCode, s.industry))

    let totalCost = 0
    let totalMarketValue = 0
    // 仅累计有价格的持仓成本，用于 totalUnrealizedPnl 计算（避免缺价持仓导致 PnL 偏差）
    let totalCostWithPrice = 0

    const holdingDetails = holdings.map((h) => {
      const val = valMap.get(h.tsCode)
      const currentPrice = val?.close ? Number(val.close) : null
      const cost = Number(h.avgCost)
      const marketValue = currentPrice != null ? currentPrice * h.quantity : null
      const unrealizedPnl = marketValue != null ? marketValue - cost * h.quantity : null
      const pnlPct = unrealizedPnl != null ? unrealizedPnl / (cost * h.quantity) : null

      totalCost += cost * h.quantity
      if (marketValue != null) {
        totalMarketValue += marketValue
        totalCostWithPrice += cost * h.quantity
      }

      return {
        tsCode: h.tsCode,
        stockName: h.stockName,
        quantity: h.quantity,
        avgCost: cost,
        currentPrice,
        marketValue,
        unrealizedPnl,
        pnlPct,
        weight: null as number | null,
        industry: industryMap.get(h.tsCode) ?? null,
      }
    })

    // 计算权重
    if (totalMarketValue > 0) {
      holdingDetails.forEach((h) => {
        h.weight = h.marketValue != null ? h.marketValue / totalMarketValue : null
      })
    }

    // totalUnrealizedPnl 只对有价格的持仓求和，避免部分缺价导致 PnL 错误
    const totalUnrealizedPnl = totalMarketValue - totalCostWithPrice
    return {
      portfolio: { ...portfolio, lastUpdated: portfolio.updatedAt.toISOString() },
      holdings: holdingDetails,
      summary: {
        totalCost,
        totalMarketValue,
        totalUnrealizedPnl,
        totalPnlPct: totalCostWithPrice > 0 ? totalUnrealizedPnl / totalCostWithPrice : 0,
        cashBalance: Number(portfolio.initialCash) - totalCost,
        isTradingDay: !!latestDate,
        lastUpdated: portfolio.updatedAt.toISOString(),
      },
    }
  }

  private async calcPnlToday(portfolioId: string) {
    const latestDate = await this.getLatestTradeDate()
    if (!latestDate) return { tradeDate: null, todayPnl: 0, todayPnlPct: 0, byHolding: [] }

    const holdings = await this.prisma.portfolioHolding.findMany({
      where: { portfolioId },
    })
    if (!holdings.length) return { tradeDate: latestDate, todayPnl: 0, todayPnlPct: 0, byHolding: [] }

    const tsCodes = holdings.map((h) => h.tsCode)
    const dailyPrices = await this.prisma.daily.findMany({
      where: { tsCode: { in: tsCodes }, tradeDate: latestDate },
      select: { tsCode: true, close: true, pctChg: true },
    })
    const priceMap = new Map(dailyPrices.map((d) => [d.tsCode, d]))

    let totalPnl = 0
    let totalMv = 0

    const byHolding = holdings.map((h) => {
      const p = priceMap.get(h.tsCode)
      const close = p?.close ? Number(p.close) : null
      const pctChg = p?.pctChg ? Number(p.pctChg) : null
      const mv = close != null ? close * h.quantity : null
      // 今日盈亏 = 昨日市值 × 涨幅 = 今日市值 / (1 + pctChg/100) × pctChg/100
      // 保护除零：pctChg=-100 时分母为 0（退市当天）→ 返回 0
      let todayPnl: number | null = null
      if (mv != null && pctChg != null) {
        const denominator = 1 + pctChg / 100
        todayPnl = Math.abs(denominator) > 1e-8 ? (mv / denominator) * (pctChg / 100) : 0
      }
      if (mv != null) totalMv += mv
      if (todayPnl != null) totalPnl += todayPnl
      return { tsCode: h.tsCode, stockName: h.stockName, pctChg, todayPnl }
    })

    // 昨日总市值 = 今日总市值 - 今日总盈亏（todayPnl = yesterdayMV × rate）
    // 保护：如分母趋近零（接近 100% 单日涨幅，极罕见），返回 0
    const yesterdayTotalMv = totalMv - totalPnl
    const todayPnlPct = totalMv > 0 && Math.abs(yesterdayTotalMv) > 1e-8 ? totalPnl / yesterdayTotalMv : 0

    return {
      tradeDate: latestDate,
      todayPnl: totalPnl,
      todayPnlPct,
      byHolding,
    }
  }

  private async calcPnlHistory(portfolioId: string, startDate: string, endDate: string) {
    type HistRow = { trade_date: Date; market_value: unknown; cost_basis: unknown }
    const rows = await this.prisma.$queryRawUnsafe<HistRow[]>(
      `
      SELECT
        d.trade_date,
        SUM(h.quantity * d.close)           AS market_value,
        SUM(h.quantity * h."avgCost")       AS cost_basis
      FROM portfolio_holdings h
      JOIN stock_daily_prices d
        ON d.ts_code = h."tsCode"
        AND d.trade_date BETWEEN $2::date AND $3::date
      WHERE h."portfolioId" = $1
      GROUP BY d.trade_date
      ORDER BY d.trade_date
      `,
      portfolioId,
      startDate,
      endDate,
    )
    return rows.map((r) => {
      const mv = Number(r.market_value)
      const cb = Number(r.cost_basis)
      return {
        date: r.trade_date,
        marketValue: mv,
        costBasis: cb,
        nav: cb > 0 ? mv / cb : null,
      }
    })
  }

  private async invalidatePortfolioCache(portfolioId: string) {
    await this.cacheService.invalidateByPrefixes([
      `${CACHE_KEY_PREFIX.PORTFOLIO_DETAIL}:${portfolioId}`,
      `${CACHE_KEY_PREFIX.PORTFOLIO_PNL_TODAY}:${portfolioId}`,
      `${CACHE_KEY_PREFIX.PORTFOLIO_PNL_HIST}:${portfolioId}:`,
      `${CACHE_KEY_PREFIX.PORTFOLIO_RISK}:ind:${portfolioId}`,
      `${CACHE_KEY_PREFIX.PORTFOLIO_RISK}:pos:${portfolioId}`,
      `${CACHE_KEY_PREFIX.PORTFOLIO_RISK}:cap:${portfolioId}`,
      `${CACHE_KEY_PREFIX.PORTFOLIO_RISK}:beta:${portfolioId}`,
    ])
  }

  private rememberCache<T>(key: string, ttlSeconds: number, loader: () => Promise<T>) {
    return this.cacheService.rememberJson({
      namespace: CACHE_NAMESPACE.PORTFOLIO,
      key,
      ttlSeconds,
      loader,
    })
  }
}

interface HoldingResultShape {
  id: string
  portfolioId: string
  tsCode: string
  stockName: string
  quantity: number
  avgCost: Decimal
  createdAt: Date
  updatedAt: Date
}

function serializeHolding(holding: HoldingResultShape) {
  return {
    id: holding.id,
    portfolioId: holding.portfolioId,
    tsCode: holding.tsCode,
    stockName: holding.stockName,
    quantity: holding.quantity,
    avgCost: holding.avgCost.toString(),
    createdAt: holding.createdAt.toISOString(),
    updatedAt: holding.updatedAt.toISOString(),
  }
}

function replayHolding(
  replay: { action: string; portfolioId: string; tsCode: string; holdingId?: string | null; metadata: unknown },
  expectedAction: string,
  portfolioId: string,
  tsCode: string,
  holdingId?: string,
): HoldingResultShape {
  if (
    replay.action !== expectedAction ||
    replay.portfolioId !== portfolioId ||
    replay.tsCode !== tsCode ||
    (holdingId !== undefined && replay.holdingId !== holdingId)
  ) {
    throw new BadRequestException('幂等键已用于其他请求')
  }
  const result = asRecord(asRecord(replay.metadata).result)
  if (
    typeof result.id !== 'string' ||
    typeof result.portfolioId !== 'string' ||
    typeof result.tsCode !== 'string' ||
    typeof result.stockName !== 'string' ||
    !Number.isInteger(result.quantity) ||
    typeof result.avgCost !== 'string' ||
    typeof result.createdAt !== 'string' ||
    typeof result.updatedAt !== 'string'
  ) {
    throw new BadRequestException('幂等请求结果不可恢复')
  }
  return {
    id: result.id,
    portfolioId: result.portfolioId,
    tsCode: result.tsCode,
    stockName: result.stockName,
    quantity: result.quantity as number,
    avgCost: new Decimal(result.avgCost),
    createdAt: new Date(result.createdAt),
    updatedAt: new Date(result.updatedAt),
  }
}

function mutationDate(value?: string | null): Date {
  if (value === undefined || value === null) return parseCompactTradeDateToUtcDate(getShanghaiCompactTradeDate())

  const parsed = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new BadRequestException('effectiveDate 非法')
  }
  return parsed
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}
