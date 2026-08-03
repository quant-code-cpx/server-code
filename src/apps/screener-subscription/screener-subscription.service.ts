import { BadRequestException, HttpException, HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { InjectQueue } from '@nestjs/bullmq'
import { Queue } from 'bullmq'
import { Prisma, SubscriptionFrequency, SubscriptionRunStatus, SubscriptionStatus } from '@prisma/client'
import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'
import { PrismaService } from 'src/shared/prisma.service'
import { SCREENER_SUBSCRIPTION_QUEUE, ScreenerSubscriptionJobName } from 'src/constant/queue.constant'
import {
  CreateSubscriptionDto,
  SubscriptionLogsQueryDto,
  UpdateSubscriptionDto,
  ValidateSubscriptionDto,
} from './dto/subscription.dto'
import {
  buildSubscriptionQueueJobId,
  MANUAL_TRIGGER_COOLDOWN_MS,
  MAX_CONSECUTIVE_FAILS,
  MAX_SUBSCRIPTIONS_PER_USER,
} from './constants/subscription.constant'
import { StockEntryItemDto } from './dto/subscription-response.dto'
import {
  DEFAULT_STOCK_SCREENING_TRIGGER_SPEC,
  RuleFingerprintService,
  RuleNormalizerService,
  stableRuleStringify,
} from './rule'

dayjs.extend(utc)
dayjs.extend(timezone)

interface TradeCalRow {
  cal_date: Date | string
}

type NextTradeCalRow = TradeCalRow

interface RawStockMetaRow {
  tsCode: string
  name: string | null
  industry: string | null
  close: number | null
  pctChg: number | null
}

const DATA_NOT_READY_RECOVERY_BATCH_SIZE = 500

@Injectable()
export class ScreenerSubscriptionService {
  private readonly logger = new Logger(ScreenerSubscriptionService.name)

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(SCREENER_SUBSCRIPTION_QUEUE) private readonly queue: Queue,
    private readonly ruleNormalizer: RuleNormalizerService,
    private readonly ruleFingerprint: RuleFingerprintService,
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
      return this.formatTradeDate(rows[0].cal_date)
    }
    return todayStr
  }

  /** 当前上海自然日；订阅调度与交易日 SQL 不依赖部署机时区。 */
  private todayStr(): string {
    return dayjs().tz('Asia/Shanghai').format('YYYYMMDD')
  }

  private formatTradeDate(value: Date | string): string {
    return dayjs(value).tz('Asia/Shanghai').format('YYYYMMDD')
  }

  /**
   * 仅在当天是交易日时调度；周/月频由“下一个开市日”判定，避免自然日周一/月初误跑。
   */
  async getDispatchFrequencies(): Promise<{ tradeDate: string; frequencies: SubscriptionFrequency[] } | null> {
    const tradeDate = this.todayStr()
    const todayRows = await this.prisma.$queryRaw<TradeCalRow[]>(Prisma.sql`
      SELECT cal_date
      FROM exchange_trade_calendars
      WHERE exchange = 'SSE' AND is_open = '1'
        AND cal_date = ${tradeDate}::date
      LIMIT 1
    `)
    if (!todayRows.length) return null

    const nextRows = await this.prisma.$queryRaw<NextTradeCalRow[]>(Prisma.sql`
      SELECT cal_date
      FROM exchange_trade_calendars
      WHERE exchange = 'SSE' AND is_open = '1'
        AND cal_date > ${tradeDate}::date
      ORDER BY cal_date ASC
      LIMIT 1
    `)

    const frequencies: SubscriptionFrequency[] = [SubscriptionFrequency.DAILY]
    if (!nextRows[0]) {
      // 日历未来水位不完整时无法可靠判断周/月最后交易日；宁可只执行日频，
      // 也不能把普通日误投递成周频/月频。
      this.logger.warn(`Trade calendar has no next open date after ${tradeDate}; skip weekly/monthly dispatch`)
      return { tradeDate, frequencies }
    }

    const nextTradeDate = this.formatTradeDate(nextRows[0].cal_date)
    if (this.isNextWeekOrLater(tradeDate, nextTradeDate)) {
      frequencies.push(SubscriptionFrequency.WEEKLY)
    }
    if (tradeDate.slice(0, 6) !== nextTradeDate.slice(0, 6)) {
      frequencies.push(SubscriptionFrequency.MONTHLY)
    }
    return { tradeDate, frequencies }
  }

  private isNextWeekOrLater(tradeDate: string, nextTradeDate: string): boolean {
    const current = dayjs.tz(tradeDate, 'YYYYMMDD', 'Asia/Shanghai').startOf('week')
    const next = dayjs.tz(nextTradeDate, 'YYYYMMDD', 'Asia/Shanghai').startOf('week')
    return next.valueOf() > current.valueOf()
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

    const ruleMetadata = this.createLegacyRuleMetadata(filters)
    const created = await this.prisma.screenerSubscription.create({
      data: {
        userId,
        name: dto.name,
        strategyId: dto.strategyId ?? null,
        filters: filters as Parameters<typeof this.prisma.screenerSubscription.create>[0]['data']['filters'],
        ruleSpec: ruleMetadata.ruleSpec as unknown as Prisma.InputJsonObject,
        triggerSpec: ruleMetadata.triggerSpec as Prisma.InputJsonObject,
        ruleFingerprint: ruleMetadata.fingerprint,
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

    const suppliedFilters =
      resolvedFilters ??
      (dto.filters !== undefined && (dto.strategyId === undefined || dto.strategyId === null) ? dto.filters : undefined)
    const filtersChanged = suppliedFilters !== undefined && !this.areSameRuleFilters(sub.filters, suppliedFilters)
    const ruleMetadata = filtersChanged ? this.createLegacyRuleMetadata(suppliedFilters!) : null

    const updated = await this.prisma.screenerSubscription.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.frequency !== undefined && { frequency: dto.frequency }),
        ...(dto.strategyId !== undefined && { strategyId: dto.strategyId }),
        ...(suppliedFilters !== undefined && {
          filters: suppliedFilters as Parameters<typeof this.prisma.screenerSubscription.update>[0]['data']['filters'],
        }),
        ...(filtersChanged && {
          ruleVersion: { increment: 1 },
          ruleSpec: ruleMetadata!.ruleSpec as unknown as Prisma.InputJsonObject,
          ruleFingerprint: ruleMetadata!.fingerprint,
          lastRunAt: null,
          lastEvaluatedTradeDate: null,
          lastClaimedTradeDate: null,
          lastRunResult: Prisma.DbNull,
          lastMatchCodes: [],
        }),
        ...(dto.sortBy !== undefined && { sortBy: dto.sortBy }),
        ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
      },
    })
    const [enriched] = await this.enrichWithStrategyInfo([updated])
    return enriched
  }

  private createLegacyRuleMetadata(filters: Record<string, unknown>) {
    const ruleSpec = this.ruleNormalizer.normalizeLegacyStockScreeningRule(filters)
    return {
      ruleSpec,
      triggerSpec: { ...DEFAULT_STOCK_SCREENING_TRIGGER_SPEC },
      fingerprint: this.ruleFingerprint.create(ruleSpec).fingerprint,
    }
  }

  private areSameRuleFilters(current: unknown, next: unknown): boolean {
    try {
      return stableRuleStringify(current) === stableRuleStringify(next)
    } catch {
      // 旧 JSON 结构异常时宁可重置基线，也不能让新旧规则混合比较。
      return false
    }
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
      { subscriptionId: id, tradeDate, ruleVersion: sub.ruleVersion },
      {
        jobId: buildSubscriptionQueueJobId(id, tradeDate, sub.ruleVersion),
        attempts: MAX_CONSECUTIVE_FAILS + 1,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: 50,
        removeOnFail: true,
      },
    )
    return { jobId: job.id, message: '任务已加入队列' }
  }

  /**
   * 数据同步迟到的 run 由 scheduler 重新投递同一 runKey。只选择仍是当前规则版本、
   * 仍启用的订阅；过期规则不会无限重试。处理器会用 recovery 标记避免旧 run 覆写新基线。
   */
  async retryDataNotReadyRuns(): Promise<number> {
    const skippedRuns = await this.prisma.screenerSubscriptionLog.findMany({
      where: {
        status: SubscriptionRunStatus.SKIPPED_DATA_NOT_READY,
        subscription: { status: SubscriptionStatus.ACTIVE },
      },
      select: {
        subscriptionId: true,
        tradeDate: true,
        ruleVersion: true,
        subscription: { select: { ruleVersion: true } },
      },
      orderBy: [{ tradeDate: 'asc' }, { id: 'asc' }],
      take: DATA_NOT_READY_RECOVERY_BATCH_SIZE,
    })
    const recoverableRuns = skippedRuns.filter((run) => run.ruleVersion === run.subscription.ruleVersion)
    if (!recoverableRuns.length) return 0

    await this.queue.addBulk(
      recoverableRuns.map((run) => ({
        name: ScreenerSubscriptionJobName.EXECUTE_SUBSCRIPTION,
        data: {
          subscriptionId: run.subscriptionId,
          tradeDate: run.tradeDate,
          ruleVersion: run.ruleVersion,
          recovery: true,
        },
        opts: {
          jobId: buildSubscriptionQueueJobId(run.subscriptionId, run.tradeDate, run.ruleVersion),
          attempts: MAX_CONSECUTIVE_FAILS + 1,
          backoff: { type: 'exponential', delay: 30_000 },
          priority: 1,
          removeOnComplete: 50,
          removeOnFail: true,
        },
      })),
    )
    this.logger.log(`Requeued ${recoverableRuns.length} data-not-ready subscription runs`)
    return recoverableRuns.length
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
