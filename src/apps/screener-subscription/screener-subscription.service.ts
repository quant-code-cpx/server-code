import { BadRequestException, HttpException, HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { InjectQueue } from '@nestjs/bullmq'
import { Queue } from 'bullmq'
import { Prisma, SubscriptionFrequency, SubscriptionStatus } from '@prisma/client'
import { PrismaService } from 'src/shared/prisma.service'
import { SCREENER_SUBSCRIPTION_QUEUE, ScreenerSubscriptionJobName } from 'src/constant/queue.constant'
import {
  CreateSubscriptionDto,
  SubscriptionLogsQueryDto,
  UpdateSubscriptionDto,
  ValidateSubscriptionDto,
} from './dto/subscription.dto'
import { MAX_SUBSCRIPTIONS_PER_USER, MANUAL_TRIGGER_COOLDOWN_MS } from './constants/subscription.constant'
import { StockEntryItemDto } from './dto/subscription-response.dto'

interface TradeCalRow {
  cal_date: Date | string
}

interface RawStockMetaRow {
  tsCode: string
  name: string | null
  industry: string | null
  close: number | null
  pctChg: number | null
}

@Injectable()
export class ScreenerSubscriptionService {
  private readonly logger = new Logger(ScreenerSubscriptionService.name)

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(SCREENER_SUBSCRIPTION_QUEUE) private readonly queue: Queue,
  ) {}

  // ── Trade date ─────────────────────────────────────────────────────────────

  async getLatestTradeDateStr(): Promise<string> {
    const todayStr = this.todayStr()
    const rows = await this.prisma.$queryRaw<TradeCalRow[]>(Prisma.sql`
      SELECT cal_date
      FROM exchange_trade_calendars
      WHERE exchange = 'SSE' AND is_open = '1'
        AND cal_date <= ${todayStr}::date
      ORDER BY cal_date DESC
      LIMIT 1
    `)
    if (rows.length) {
      const r = rows[0].cal_date instanceof Date ? rows[0].cal_date : new Date(rows[0].cal_date as string)
      return `${r.getFullYear()}${String(r.getMonth() + 1).padStart(2, '0')}${String(r.getDate()).padStart(2, '0')}`
    }
    return todayStr
  }

  private todayStr(): string {
    const now = new Date()
    return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
  }

  // ── Strategy enrichment ────────────────────────────────────────────────────

  private async enrichWithStrategyInfo<T extends { strategyId?: number | null }>(
    subs: T[],
  ): Promise<(T & { strategyName: string | null; strategyStatus: string | null })[]> {
    const ids = [...new Set(subs.map((s) => s.strategyId).filter((id): id is number => id != null))]
    if (!ids.length) return subs.map((s) => ({ ...s, strategyName: null, strategyStatus: null }))

    const strategies = await this.prisma.screenerStrategy.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    })
    const strategyMap = new Map(strategies.map((s) => [s.id, s.name]))

    return subs.map((s) => ({
      ...s,
      strategyName: s.strategyId != null ? (strategyMap.get(s.strategyId) ?? null) : null,
      // strategy only has name; if not found in map the strategy was deleted
      strategyStatus: s.strategyId != null ? (strategyMap.has(s.strategyId) ? 'ACTIVE' : 'DELETED') : null,
    }))
  }

  // ── CRUD ────────────────────────────────────────────────────────────────────

  async findAll(userId: number) {
    const subscriptions = await this.prisma.screenerSubscription.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    })
    const enriched = await this.enrichWithStrategyInfo(subscriptions)
    return { subscriptions: enriched }
  }

  async detail(userId: number, id: number) {
    const sub = await this.prisma.screenerSubscription.findFirst({ where: { id, userId } })
    if (!sub) throw new NotFoundException('订阅不存在')
    const [enriched] = await this.enrichWithStrategyInfo([sub])
    return enriched
  }

  async create(userId: number, dto: CreateSubscriptionDto) {
    const count = await this.prisma.screenerSubscription.count({ where: { userId } })
    if (count >= MAX_SUBSCRIPTIONS_PER_USER) {
      throw new BadRequestException(`订阅数量已达上限（最多 ${MAX_SUBSCRIPTIONS_PER_USER} 个）`)
    }

    if (!dto.strategyId && !dto.filters) {
      throw new BadRequestException('strategyId 和 filters 必传其一')
    }

    let filters: Record<string, unknown>

    if (dto.strategyId) {
      const strategy = await this.prisma.screenerStrategy.findFirst({
        where: { id: dto.strategyId, userId },
      })
      if (!strategy) throw new NotFoundException(`选股策略 ${dto.strategyId} 不存在`)
      filters = strategy.filters as Record<string, unknown>
    } else {
      filters = dto.filters!
    }

    const created = await this.prisma.screenerSubscription.create({
      data: {
        userId,
        name: dto.name,
        strategyId: dto.strategyId ?? null,
        filters: filters as Parameters<typeof this.prisma.screenerSubscription.create>[0]['data']['filters'],
        sortBy: dto.sortBy ?? null,
        sortOrder: dto.sortOrder ?? null,
        frequency: dto.frequency ?? SubscriptionFrequency.DAILY,
      },
    })
    const [enriched] = await this.enrichWithStrategyInfo([created])
    return enriched
  }

  async update(userId: number, id: number, dto: UpdateSubscriptionDto) {
    const sub = await this.prisma.screenerSubscription.findFirst({ where: { id, userId } })
    if (!sub) throw new NotFoundException('订阅不存在')

    // If strategyId is being (re)set, resolve filters from strategy
    let resolvedFilters: Record<string, unknown> | undefined
    if (dto.strategyId !== undefined && dto.strategyId !== null) {
      const strategy = await this.prisma.screenerStrategy.findFirst({
        where: { id: dto.strategyId, userId },
      })
      if (!strategy) throw new NotFoundException(`选股策略 ${dto.strategyId} 不存在`)
      resolvedFilters = strategy.filters as Record<string, unknown>
    }

    const updated = await this.prisma.screenerSubscription.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.frequency !== undefined && { frequency: dto.frequency }),
        ...(dto.strategyId !== undefined && { strategyId: dto.strategyId }),
        ...(resolvedFilters !== undefined && {
          filters: resolvedFilters as Parameters<typeof this.prisma.screenerSubscription.update>[0]['data']['filters'],
        }),
        ...(dto.filters !== undefined &&
          dto.strategyId === undefined && {
            filters: dto.filters as Parameters<typeof this.prisma.screenerSubscription.update>[0]['data']['filters'],
          }),
        ...(dto.sortBy !== undefined && { sortBy: dto.sortBy }),
        ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
      },
    })
    const [enriched] = await this.enrichWithStrategyInfo([updated])
    return enriched
  }

  async remove(userId: number, id: number) {
    const sub = await this.prisma.screenerSubscription.findFirst({ where: { id, userId } })
    if (!sub) throw new NotFoundException('订阅不存在')

    await this.prisma.screenerSubscription.delete({ where: { id } })
    return { message: '删除成功' }
  }

  async pause(userId: number, id: number) {
    const sub = await this.prisma.screenerSubscription.findFirst({ where: { id, userId } })
    if (!sub) throw new NotFoundException('订阅不存在')

    const updated = await this.prisma.screenerSubscription.update({
      where: { id },
      data: { status: SubscriptionStatus.PAUSED },
    })
    const [enriched] = await this.enrichWithStrategyInfo([updated])
    return enriched
  }

  async resume(userId: number, id: number) {
    const sub = await this.prisma.screenerSubscription.findFirst({ where: { id, userId } })
    if (!sub) throw new NotFoundException('订阅不存在')

    const updated = await this.prisma.screenerSubscription.update({
      where: { id },
      data: { status: SubscriptionStatus.ACTIVE, consecutiveFails: 0 },
    })
    const [enriched] = await this.enrichWithStrategyInfo([updated])
    return enriched
  }

  async manualRun(userId: number, id: number) {
    const sub = await this.prisma.screenerSubscription.findFirst({ where: { id, userId } })
    if (!sub) throw new NotFoundException('订阅不存在')

    // 冷却检查：距上次执行至少 5 分钟
    if (sub.lastRunAt) {
      const elapsed = Date.now() - sub.lastRunAt.getTime()
      if (elapsed < MANUAL_TRIGGER_COOLDOWN_MS) {
        const remainingSeconds = Math.ceil((MANUAL_TRIGGER_COOLDOWN_MS - elapsed) / 1000)
        const nextAllowedRunAt = new Date(sub.lastRunAt.getTime() + MANUAL_TRIGGER_COOLDOWN_MS).toISOString()
        throw new HttpException(
          { code: 'COOLDOWN', message: '操作过频，请稍后再试', nextAllowedRunAt, remainingSeconds },
          HttpStatus.TOO_MANY_REQUESTS,
        )
      }
    }

    const tradeDate = await this.getLatestTradeDateStr()
    const job = await this.queue.add(
      ScreenerSubscriptionJobName.EXECUTE_SUBSCRIPTION,
      { subscriptionId: id, tradeDate },
      { removeOnComplete: 50, removeOnFail: 20 },
    )
    return { jobId: job.id, message: '任务已加入队列' }
  }

  async getLogs(userId: number, id: number, query: SubscriptionLogsQueryDto) {
    const sub = await this.prisma.screenerSubscription.findFirst({ where: { id, userId } })
    if (!sub) throw new NotFoundException('订阅不存在')

    const page = query.page ?? 1
    const pageSize = query.pageSize ?? 20

    const [logs, total] = await Promise.all([
      this.prisma.screenerSubscriptionLog.findMany({
        where: { subscriptionId: id },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.screenerSubscriptionLog.count({ where: { subscriptionId: id } }),
    ])

    // Enrich newEntryCodes / exitCodes with stock metadata
    const allCodes = [...new Set(logs.flatMap((l) => [...l.newEntryCodes, ...l.exitCodes]))]
    const metaMap = await this.fetchStockMeta(allCodes)

    const enrichedLogs = logs.map((log) => ({
      ...log,
      newEntries: log.newEntryCodes.map(
        (c) => metaMap.get(c) ?? { tsCode: c, name: null, industry: null, close: null, pctChg: null },
      ),
      exits: log.exitCodes.map(
        (c) => metaMap.get(c) ?? { tsCode: c, name: null, industry: null, close: null, pctChg: null },
      ),
    }))

    return { logs: enrichedLogs, total, page, pageSize }
  }

  async validate(userId: number, dto: ValidateSubscriptionDto) {
    const existing = await this.prisma.screenerSubscription.findMany({
      where: { userId, ...(dto.id !== undefined && { id: { not: dto.id } }) },
      select: { id: true, name: true, filters: true, strategyId: true },
    })

    const similarSubscriptions: Array<{ id: number; name: string; similarity: string }> = []

    for (const sub of existing) {
      // Check strategyId match
      if (dto.strategyId !== undefined && dto.strategyId !== null && sub.strategyId === dto.strategyId) {
        similarSubscriptions.push({ id: sub.id, name: sub.name, similarity: 'SAME_STRATEGY' })
        continue
      }
      // Check filters deep equality
      if (dto.filters && JSON.stringify(sub.filters) === JSON.stringify(dto.filters)) {
        similarSubscriptions.push({ id: sub.id, name: sub.name, similarity: 'SAME_FILTERS' })
      }
    }

    return { hasDuplicate: similarSubscriptions.length > 0, similarSubscriptions }
  }

  // ── Stock metadata helper ──────────────────────────────────────────────────

  private async fetchStockMeta(tsCodes: string[]): Promise<Map<string, StockEntryItemDto>> {
    if (!tsCodes.length) return new Map()
    try {
      const rows = await this.prisma.$queryRaw<RawStockMetaRow[]>(Prisma.sql`
        SELECT
          sb.ts_code   AS "tsCode",
          sb.name,
          sb.industry,
          d.close,
          d.pct_chg    AS "pctChg"
        FROM stock_basic_profiles sb
        LEFT JOIN LATERAL (
          SELECT close, pct_chg
          FROM stock_daily_prices
          WHERE ts_code = sb.ts_code
          ORDER BY trade_date DESC
          LIMIT 1
        ) d ON true
        WHERE sb.ts_code = ANY(${tsCodes})
      `)
      return new Map(
        rows.map((r) => [
          r.tsCode,
          { ...r, close: r.close != null ? Number(r.close) : null, pctChg: r.pctChg != null ? Number(r.pctChg) : null },
        ]),
      )
    } catch {
      this.logger.warn('fetchStockMeta failed, returning empty metadata')
      return new Map()
    }
  }
}
