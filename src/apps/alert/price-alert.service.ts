import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { NotificationType, PriceAlertRule, PriceAlertRuleStatus, PriceAlertRuleType, Prisma } from '@prisma/client'
import dayjs from 'dayjs'
import { randomUUID } from 'crypto'
import { formatDateToCompactTradeDate } from 'src/common/utils/trade-date.util'
import { PrismaService } from 'src/shared/prisma.service'
import { DistributedCronLockService } from 'src/shared/scheduler/distributed-cron-lock.service'
import { EventsGateway } from 'src/websocket/events.gateway'
import { NotificationService } from 'src/apps/notification/notification.service'
import { AlertCalendarService } from './alert-calendar.service'
import { CalendarEventType } from './dto/calendar-query.dto'
import {
  CreatePriceAlertRuleDto,
  ListPriceAlertHistoryDto,
  ListPriceAlertRulesDto,
  UpdatePriceAlertRuleDto,
} from './dto/price-alert-rule.dto'

interface PriceAlertPayload {
  ruleId: number
  tsCode: string
  stockName: string | null
  ruleType: PriceAlertRuleType
  threshold: number | null
  tradeDate: string
  actualValue: number
  memo: string | null
  source?: { type: string; id: number | string; name: string } | null
  eventDate?: string
  eventType?: CalendarEventType
  eventTitle?: string
}

interface ExpandedEntry {
  rule: PriceAlertRule
  tsCode: string
  stockName: string | null
  source?: { type: string; id: number | string; name: string } | null
}

interface PendingPriceAlertTrigger {
  rule: PriceAlertRule
  history: Prisma.PriceAlertTriggerHistoryUncheckedCreateInput
  payload: PriceAlertPayload
}

const EVENT_RULE_TO_CALENDAR_TYPE: Partial<Record<PriceAlertRuleType, CalendarEventType | 'ANY'>> = {
  [PriceAlertRuleType.EVENT_DISCLOSURE]: CalendarEventType.DISCLOSURE,
  [PriceAlertRuleType.EVENT_FLOAT]: CalendarEventType.FLOAT,
  [PriceAlertRuleType.EVENT_DIVIDEND]: CalendarEventType.DIVIDEND,
  [PriceAlertRuleType.EVENT_FORECAST]: CalendarEventType.FORECAST,
  [PriceAlertRuleType.EVENT_IPO]: CalendarEventType.IPO,
  [PriceAlertRuleType.EVENT_CONVERTIBLE]: CalendarEventType.CONVERTIBLE,
  [PriceAlertRuleType.EVENT_SHAREHOLDER]: CalendarEventType.SHAREHOLDER,
  [PriceAlertRuleType.EVENT_ANY]: 'ANY',
}

const EVENT_RULE_TYPES = Object.keys(EVENT_RULE_TO_CALENDAR_TYPE) as PriceAlertRuleType[]
const EVENT_TRIGGER_WINDOWS = new Set([0, 1, 3, 7])

function isEventRuleType(ruleType: PriceAlertRuleType): boolean {
  return EVENT_RULE_TO_CALENDAR_TYPE[ruleType] !== undefined
}

@Injectable()
export class PriceAlertService {
  private readonly logger = new Logger(PriceAlertService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventsGateway: EventsGateway,
    private readonly notificationService: NotificationService,
    private readonly cronLock: DistributedCronLockService,
    private readonly calendarService: AlertCalendarService,
  ) {}

  // ── 规则 CRUD ──────────────────────────────────────────────────────────────

  async createRule(userId: number, dto: CreatePriceAlertRuleDto) {
    if (!dto.tsCode && !dto.watchlistId && !dto.portfolioId) {
      throw new BadRequestException('至少需要指定 tsCode、watchlistId 或 portfolioId 其中之一')
    }
    if (isEventRuleType(dto.ruleType) && !EVENT_TRIGGER_WINDOWS.has(dto.threshold ?? Number.NaN)) {
      throw new BadRequestException('事件提醒时机仅支持事件当日或提前 1/3/7 天')
    }

    let stockName: string | null = null
    let sourceName: string | null = null

    if (dto.tsCode) {
      const stock = await this.prisma.stockBasic.findUnique({
        where: { tsCode: dto.tsCode },
        select: { name: true },
      })
      stockName = stock?.name ?? null
    }

    if (dto.watchlistId) {
      const watchlist = await this.prisma.watchlist.findFirst({
        where: { id: dto.watchlistId, userId },
        select: { name: true },
      })
      if (!watchlist) throw new NotFoundException('自选股组不存在或无权访问')
      sourceName = watchlist.name
    }

    if (dto.portfolioId) {
      const portfolio = await this.prisma.portfolio.findFirst({
        where: { id: dto.portfolioId, userId },
        select: { name: true },
      })
      if (!portfolio) throw new NotFoundException('投资组合不存在或无权访问')
      sourceName = (sourceName ? `${sourceName} / ` : '') + portfolio.name
    }

    if (isEventRuleType(dto.ruleType)) {
      const existing = await this.prisma.priceAlertRule.findFirst({
        where: {
          userId,
          tsCode: dto.tsCode ?? null,
          watchlistId: dto.watchlistId ?? null,
          portfolioId: dto.portfolioId ?? null,
          ruleType: dto.ruleType,
          threshold: dto.threshold ?? null,
          status: PriceAlertRuleStatus.ACTIVE,
        },
      })
      if (existing) return existing
    }

    return this.prisma.priceAlertRule.create({
      data: {
        userId,
        tsCode: dto.tsCode ?? null,
        stockName,
        watchlistId: dto.watchlistId ?? null,
        portfolioId: dto.portfolioId ?? null,
        sourceName,
        ruleType: dto.ruleType,
        threshold: dto.threshold ?? null,
        memo: dto.memo ?? null,
      },
    })
  }

  async listRules(userId: number, dto: ListPriceAlertRulesDto = {}) {
    const page = dto.page ?? 1
    const pageSize = dto.pageSize ?? 20
    const sortBy = dto.sortBy ?? 'createdAt'
    const sortOrder = (dto.sortOrder ?? 'desc') as 'asc' | 'desc'

    const where: Prisma.PriceAlertRuleWhereInput = {
      userId,
      status: dto.status ?? { not: PriceAlertRuleStatus.DELETED },
    }
    if (dto.ruleTypes?.length) where.ruleType = { in: dto.ruleTypes }
    if (dto.sourceType === 'SINGLE_STOCK') where.tsCode = { not: null }
    if (dto.sourceType === 'WATCHLIST') where.watchlistId = { not: null }
    if (dto.sourceType === 'PORTFOLIO') where.portfolioId = { not: null }
    if (dto.triggeredFrom || dto.triggeredTo) {
      where.lastTriggeredAt = {
        ...(dto.triggeredFrom ? { gte: new Date(dto.triggeredFrom) } : {}),
        ...(dto.triggeredTo ? { lte: new Date(dto.triggeredTo) } : {}),
      }
    }
    if (dto.keyword) {
      where.OR = [
        { tsCode: { contains: dto.keyword, mode: 'insensitive' } },
        { stockName: { contains: dto.keyword, mode: 'insensitive' } },
        { memo: { contains: dto.keyword, mode: 'insensitive' } },
      ]
    }

    const validSortBy = ['createdAt', 'lastTriggeredAt', 'triggerCount'].includes(sortBy) ? sortBy : 'createdAt'
    const [total, items] = await Promise.all([
      this.prisma.priceAlertRule.count({ where }),
      this.prisma.priceAlertRule.findMany({
        where,
        orderBy: { [validSortBy]: sortOrder },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ])

    return { total, page, pageSize, items }
  }

  async listHistory(userId: number, dto: ListPriceAlertHistoryDto) {
    const page = dto.page ?? 1
    const pageSize = dto.pageSize ?? 20

    type WhereType = { userId: number; ruleId?: number; triggeredAt?: { gte?: Date; lte?: Date } }
    const where: WhereType = { userId }
    if (dto.ruleId) where.ruleId = dto.ruleId
    if (dto.triggeredFrom || dto.triggeredTo) {
      where.triggeredAt = {
        ...(dto.triggeredFrom ? { gte: new Date(dto.triggeredFrom) } : {}),
        ...(dto.triggeredTo ? { lte: new Date(dto.triggeredTo) } : {}),
      }
    }

    const [total, items] = await Promise.all([
      this.prisma.priceAlertTriggerHistory.count({ where }),
      this.prisma.priceAlertTriggerHistory.findMany({
        where,
        orderBy: { [dto.sortBy ?? 'triggeredAt']: dto.sortOrder ?? 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ])

    return { total, page, pageSize, items }
  }

  async scanStatus(userId: number) {
    const [lastTrigger, ruleStats, latestDaily] = await Promise.all([
      this.prisma.priceAlertTriggerHistory.findFirst({
        where: { userId },
        orderBy: { triggeredAt: 'desc' },
        select: { triggeredAt: true, tradeDate: true, scanBatchId: true },
      }),
      this.prisma.priceAlertRule.groupBy({
        by: ['status'],
        where: { userId, status: { not: PriceAlertRuleStatus.DELETED } },
        _count: { _all: true },
      }),
      this.prisma.daily.findFirst({ orderBy: { tradeDate: 'desc' }, select: { tradeDate: true } }),
    ])

    const statsMap = Object.fromEntries(ruleStats.map((r) => [r.status, r._count._all]))
    return {
      lastScanAt: lastTrigger?.triggeredAt?.toISOString() ?? null,
      lastTradeDate: lastTrigger?.tradeDate ?? null,
      lastScanBatchId: lastTrigger?.scanBatchId ?? null,
      activeRules: statsMap[PriceAlertRuleStatus.ACTIVE] ?? 0,
      pausedRules: statsMap[PriceAlertRuleStatus.PAUSED] ?? 0,
      latestMarketTradeDate: formatDateToCompactTradeDate(latestDaily?.tradeDate),
      coverage: {
        hasMarketData: Boolean(latestDaily),
        hasTriggeredHistory: Boolean(lastTrigger),
      },
      lastFailure: null,
    }
  }

  async updateRule(userId: number, id: number, dto: UpdatePriceAlertRuleDto) {
    const rule = await this.findOwnedRule(userId, id)
    return this.prisma.priceAlertRule.update({
      where: { id: rule.id },
      data: {
        ...(dto.tsCode !== undefined ? { tsCode: dto.tsCode } : {}),
        ...(dto.ruleType !== undefined ? { ruleType: dto.ruleType } : {}),
        ...(dto.threshold !== undefined ? { threshold: dto.threshold } : {}),
        ...(dto.memo !== undefined ? { memo: dto.memo } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
      },
    })
  }

  async deleteRule(userId: number, id: number) {
    const rule = await this.findOwnedRule(userId, id)
    await this.prisma.priceAlertRule.update({
      where: { id: rule.id },
      data: { status: PriceAlertRuleStatus.DELETED },
    })
    return { message: '规则已删除' }
  }

  private async findOwnedRule(userId: number, id: number) {
    const rule = await this.prisma.priceAlertRule.findFirst({
      where: { id, status: { not: PriceAlertRuleStatus.DELETED } },
    })
    if (!rule) throw new NotFoundException('规则不存在')
    if (rule.userId !== userId) throw new ForbiddenException('无权操作此规则')
    return rule
  }

  // ── 盘后扫描 ───────────────────────────────────────────────────────────────

  /**
   * 每日 19:00（上海时间，工作日）盘后扫描价格预警规则。
   * 在 Tushare 数据同步（18:30 触发）完成后执行。
   */
  @Cron('0 0 19 * * 1-5', { timeZone: 'Asia/Shanghai' })
  async dailyScan() {
    await this.cronLock.runIfScheduler('price-alert:daily', async () => {
      this.logger.log('定时任务：开始盘后价格预警扫描')
      try {
        await this.runScan()
      } catch (err) {
        this.logger.error('价格预警扫描异常', (err as Error).stack)
      }
    })
  }

  @Cron('0 0 8 * * *', { timeZone: 'Asia/Shanghai' })
  async dailyEventScan() {
    await this.cronLock.runIfScheduler('event-alert:daily', async () => {
      this.logger.log('定时任务：开始事件提醒扫描')
      try {
        await this.runEventScan()
      } catch (err) {
        this.logger.error('事件提醒扫描异常', (err as Error).stack)
      }
    })
  }

  async runEventScan(referenceDate = dayjs().format('YYYYMMDD')): Promise<{ triggered: number }> {
    const rules = await this.prisma.priceAlertRule.findMany({
      where: { status: PriceAlertRuleStatus.ACTIVE, ruleType: { in: EVENT_RULE_TYPES } },
    })
    const entries = await this.expandRulesToEntries(rules)
    const triggeredRuleIds = await this.scanEventEntries(entries, referenceDate)
    return { triggered: triggeredRuleIds.size }
  }

  async runScan(referenceDate = dayjs().format('YYYYMMDD')): Promise<{ triggered: number }> {
    const rules = await this.prisma.priceAlertRule.findMany({
      where: { status: PriceAlertRuleStatus.ACTIVE },
    })

    if (rules.length === 0) {
      this.logger.log('价格预警：没有活跃规则，跳过扫描')
      return { triggered: 0 }
    }

    // 展开关联规则为 (rule, tsCode) 扁平列表
    const entries = await this.expandRulesToEntries(rules)
    if (entries.length === 0) {
      this.logger.log('价格预警：展开后无有效股票目标，跳过扫描')
      return { triggered: 0 }
    }

    const eventEntries = entries.filter((entry) => isEventRuleType(entry.rule.ruleType))
    const eventTriggeredRuleIds = await this.scanEventEntries(eventEntries, referenceDate)
    const priceEntries = entries.filter((entry) => !isEventRuleType(entry.rule.ruleType))
    if (priceEntries.length === 0) {
      return { triggered: eventTriggeredRuleIds.size }
    }

    // 获取所有涉及股票的最新一日行情
    const tsCodes = [...new Set(priceEntries.map((e) => e.tsCode))]

    // 获取最新交易日
    const latestDaily = await this.prisma.daily.findFirst({
      orderBy: { tradeDate: 'desc' },
      select: { tradeDate: true },
    })
    if (!latestDaily) {
      this.logger.warn('价格预警：数据库中没有日行情数据，跳过扫描')
      return { triggered: eventTriggeredRuleIds.size }
    }

    const latestTradeDate = latestDaily.tradeDate
    const tradeDateStr = formatDateToCompactTradeDate(latestTradeDate) ?? ''

    // 批量加载当日行情
    const dailyRows = await this.prisma.daily.findMany({
      where: { tsCode: { in: tsCodes }, tradeDate: latestTradeDate },
      select: { tsCode: true, close: true, pctChg: true },
    })
    const dailyMap = new Map(dailyRows.map((r) => [r.tsCode, r]))

    // 批量加载当日涨跌停价（tradeDateStr 是字符串格式）
    const limitTsCodes = priceEntries
      .filter(
        (e) => e.rule.ruleType === PriceAlertRuleType.LIMIT_UP || e.rule.ruleType === PriceAlertRuleType.LIMIT_DOWN,
      )
      .map((e) => e.tsCode)

    const limitMap = new Map<string, { upLimit: number | null; downLimit: number | null }>()
    if (limitTsCodes.length > 0) {
      const limitRows = await this.prisma.stkLimit.findMany({
        where: { tsCode: { in: limitTsCodes }, tradeDate: tradeDateStr },
        select: { tsCode: true, upLimit: true, downLimit: true },
      })
      for (const row of limitRows) {
        limitMap.set(row.tsCode, {
          upLimit: row.upLimit != null ? Number(row.upLimit) : null,
          downLimit: row.downLimit != null ? Number(row.downLimit) : null,
        })
      }
    }

    const scanBatchId = randomUUID()
    const pendingByRule = new Map<number, Map<string, PendingPriceAlertTrigger>>()

    for (const { rule, tsCode, stockName, source } of priceEntries) {
      const daily = dailyMap.get(tsCode)
      if (!daily) continue

      const close = daily.close
      const pctChg = daily.pctChg
      let actualValue: number | null = null
      let triggered = false

      switch (rule.ruleType) {
        case PriceAlertRuleType.PCT_CHANGE_UP:
          if (pctChg != null && rule.threshold != null && pctChg >= rule.threshold) {
            triggered = true
            actualValue = pctChg
          }
          break
        case PriceAlertRuleType.PCT_CHANGE_DOWN:
          if (pctChg != null && rule.threshold != null && pctChg <= -rule.threshold) {
            triggered = true
            actualValue = pctChg
          }
          break
        case PriceAlertRuleType.PRICE_ABOVE:
          if (close != null && rule.threshold != null && close >= rule.threshold) {
            triggered = true
            actualValue = close
          }
          break
        case PriceAlertRuleType.PRICE_BELOW:
          if (close != null && rule.threshold != null && close <= rule.threshold) {
            triggered = true
            actualValue = close
          }
          break
        case PriceAlertRuleType.LIMIT_UP: {
          const limits = limitMap.get(tsCode)
          if (close != null && limits?.upLimit != null && close >= limits.upLimit) {
            triggered = true
            actualValue = close
          }
          break
        }
        case PriceAlertRuleType.LIMIT_DOWN: {
          const limits = limitMap.get(tsCode)
          if (close != null && limits?.downLimit != null && close <= limits.downLimit) {
            triggered = true
            actualValue = close
          }
          break
        }
      }

      if (triggered && actualValue != null) {
        const closeNum = close != null ? Number(close) : null
        const pctChgNum = pctChg != null ? Number(pctChg) : null
        const payload: PriceAlertPayload = {
          ruleId: rule.id,
          tsCode,
          stockName: stockName ?? null,
          ruleType: rule.ruleType,
          threshold: rule.threshold,
          tradeDate: tradeDateStr,
          actualValue,
          memo: rule.memo,
          source: source ?? null,
        }
        const ruleTriggers = pendingByRule.get(rule.id) ?? new Map<string, PendingPriceAlertTrigger>()
        if (!ruleTriggers.has(tsCode)) {
          ruleTriggers.set(tsCode, {
            rule,
            history: {
              ruleId: rule.id,
              userId: rule.userId,
              tsCode,
              stockName: stockName ?? null,
              ruleType: rule.ruleType,
              threshold: rule.threshold,
              actualValue,
              closePrice: closeNum,
              pctChg: pctChgNum,
              tradeDate: tradeDateStr,
              sourceType: source?.type ?? null,
              sourceName: source?.name ?? null,
              scanBatchId,
            },
            payload,
          })
          pendingByRule.set(rule.id, ruleTriggers)
        }
      }
    }

    const triggeredRuleIds = new Set<number>()
    const persistedTriggers: PendingPriceAlertTrigger[] = []

    for (const [ruleId, ruleTriggerMap] of pendingByRule) {
      const candidates = [...ruleTriggerMap.values()]
      const newlyPersisted = await this.prisma.$transaction(async (tx) => {
        const insertResult = await tx.priceAlertTriggerHistory.createMany({
          data: candidates.map((candidate) => candidate.history),
          skipDuplicates: true,
        })
        if (insertResult.count === 0) return []

        const createdRows = await tx.priceAlertTriggerHistory.findMany({
          where: { ruleId, tradeDate: tradeDateStr, scanBatchId },
          select: { tsCode: true },
        })
        const createdTsCodes = new Set(createdRows.map((row) => row.tsCode))
        const created = candidates.filter((candidate) => createdTsCodes.has(candidate.history.tsCode))

        if (created.length > 0) {
          await tx.priceAlertRule.update({
            where: { id: ruleId },
            data: { lastTriggeredAt: new Date(), triggerCount: { increment: 1 } },
          })
        }

        return created
      })

      if (newlyPersisted.length > 0) {
        triggeredRuleIds.add(ruleId)
        persistedTriggers.push(...newlyPersisted)
      }
    }

    for (const { rule, payload } of persistedTriggers) {
      this.eventsGateway.emitToUser(rule.userId, 'price-alert', payload)
      void this.notificationService.create({
        userId: rule.userId,
        type: NotificationType.PRICE_ALERT,
        title: `价格预警触发：${payload.stockName ?? payload.tsCode}`,
        body: `${payload.stockName ?? payload.tsCode} ${rule.ruleType} 条件已触发，当前值 ${payload.actualValue}`,
        data: payload as unknown as Record<string, unknown>,
      })
    }

    const allTriggeredRuleIds = new Set([...eventTriggeredRuleIds, ...triggeredRuleIds])
    this.logger.log(`预警扫描完成：共展开 ${entries.length} 条目标，触发 ${allTriggeredRuleIds.size} 条规则`)
    return { triggered: allTriggeredRuleIds.size }
  }

  private async scanEventEntries(entries: ExpandedEntry[], referenceDate: string): Promise<Set<number>> {
    if (entries.length === 0) return new Set()
    if (!/^\d{8}$/.test(referenceDate)) throw new BadRequestException('事件扫描日期格式应为 YYYYMMDD')

    const entriesByWindow = new Map<number, ExpandedEntry[]>()
    for (const entry of entries) {
      const triggerWindow = entry.rule.threshold
      if (triggerWindow == null || !EVENT_TRIGGER_WINDOWS.has(triggerWindow)) continue
      const group = entriesByWindow.get(triggerWindow) ?? []
      group.push(entry)
      entriesByWindow.set(triggerWindow, group)
    }

    const pendingByRule = new Map<number, Map<string, PendingPriceAlertTrigger>>()
    const scanBatchId = randomUUID()

    for (const [triggerWindow, windowEntries] of entriesByWindow) {
      const targetDate = dayjs(referenceDate, 'YYYYMMDD').add(triggerWindow, 'day').format('YYYYMMDD')
      const requestedTypes = new Set<CalendarEventType>()
      for (const entry of windowEntries) {
        const calendarType = EVENT_RULE_TO_CALENDAR_TYPE[entry.rule.ruleType]
        if (calendarType === 'ANY') {
          Object.values(CalendarEventType).forEach((type) => requestedTypes.add(type))
        } else if (calendarType) {
          requestedTypes.add(calendarType)
        }
      }

      const calendar = await this.calendarService.getCalendar({
        startDate: targetDate,
        endDate: targetDate,
        types: [...requestedTypes],
      })
      const eventsByCode = new Map<string, typeof calendar.events>()
      for (const event of calendar.events) {
        const codeEvents = eventsByCode.get(event.tsCode) ?? []
        codeEvents.push(event)
        eventsByCode.set(event.tsCode, codeEvents)
      }

      for (const { rule, tsCode, stockName, source } of windowEntries) {
        const expectedType = EVENT_RULE_TO_CALENDAR_TYPE[rule.ruleType]
        const event = (eventsByCode.get(tsCode) ?? []).find(
          (candidate) => expectedType === 'ANY' || candidate.type === expectedType,
        )
        if (!event) continue

        const payload: PriceAlertPayload = {
          ruleId: rule.id,
          tsCode,
          stockName: stockName ?? event.stockName,
          ruleType: rule.ruleType,
          threshold: rule.threshold,
          tradeDate: referenceDate,
          actualValue: triggerWindow,
          memo: rule.memo,
          source: source ?? null,
          eventDate: event.date,
          eventType: event.type,
          eventTitle: event.title,
        }
        const ruleTriggers = pendingByRule.get(rule.id) ?? new Map<string, PendingPriceAlertTrigger>()
        if (!ruleTriggers.has(tsCode)) {
          ruleTriggers.set(tsCode, {
            rule,
            history: {
              ruleId: rule.id,
              userId: rule.userId,
              tsCode,
              stockName: stockName ?? event.stockName,
              ruleType: rule.ruleType,
              threshold: rule.threshold,
              actualValue: triggerWindow,
              closePrice: null,
              pctChg: null,
              tradeDate: referenceDate,
              sourceType: source?.type ?? null,
              sourceName: source?.name ?? null,
              scanBatchId,
            },
            payload,
          })
          pendingByRule.set(rule.id, ruleTriggers)
        }
      }
    }

    const triggeredRuleIds = new Set<number>()
    const persistedTriggers: PendingPriceAlertTrigger[] = []
    for (const [ruleId, ruleTriggerMap] of pendingByRule) {
      const candidates = [...ruleTriggerMap.values()]
      const newlyPersisted = await this.prisma.$transaction(async (tx) => {
        const insertResult = await tx.priceAlertTriggerHistory.createMany({
          data: candidates.map((candidate) => candidate.history),
          skipDuplicates: true,
        })
        if (insertResult.count === 0) return []

        const createdRows = await tx.priceAlertTriggerHistory.findMany({
          where: { ruleId, tradeDate: referenceDate, scanBatchId },
          select: { tsCode: true },
        })
        const createdTsCodes = new Set(createdRows.map((row) => row.tsCode))
        const created = candidates.filter((candidate) => createdTsCodes.has(candidate.history.tsCode))
        if (created.length > 0) {
          await tx.priceAlertRule.update({
            where: { id: ruleId },
            data: { lastTriggeredAt: new Date(), triggerCount: { increment: 1 } },
          })
        }
        return created
      })

      if (newlyPersisted.length > 0) {
        triggeredRuleIds.add(ruleId)
        persistedTriggers.push(...newlyPersisted)
      }
    }

    for (const { rule, payload } of persistedTriggers) {
      this.eventsGateway.emitToUser(rule.userId, 'price-alert', payload)
      void this.notificationService.create({
        userId: rule.userId,
        type: NotificationType.PRICE_ALERT,
        title: `事件提醒：${payload.stockName ?? payload.tsCode}`,
        body: `${payload.eventDate} ${payload.eventTitle ?? payload.eventType ?? '事件'} 即将发生`,
        data: payload as unknown as Record<string, unknown>,
      })
    }

    return triggeredRuleIds
  }

  /** 将活跃规则展开为 (rule, tsCode) 扁平列表，含关联自选股组 / 组合 */
  private async expandRulesToEntries(rules: PriceAlertRule[]): Promise<ExpandedEntry[]> {
    const entries: ExpandedEntry[] = []

    const watchlistIds = [...new Set(rules.flatMap((r) => (r.watchlistId ? [r.watchlistId] : [])))]
    const portfolioIds = [...new Set(rules.flatMap((r) => (r.portfolioId ? [r.portfolioId] : [])))]

    const watchlistStockMap = new Map<number, Array<{ tsCode: string }>>()
    if (watchlistIds.length > 0) {
      const rows = await this.prisma.watchlistStock.findMany({
        where: { watchlistId: { in: watchlistIds } },
        select: { watchlistId: true, tsCode: true },
      })
      for (const row of rows) {
        const list = watchlistStockMap.get(row.watchlistId) ?? []
        list.push({ tsCode: row.tsCode })
        watchlistStockMap.set(row.watchlistId, list)
      }
    }

    const portfolioHoldingMap = new Map<string, Array<{ tsCode: string; stockName: string }>>()
    if (portfolioIds.length > 0) {
      const rows = await this.prisma.portfolioHolding.findMany({
        where: { portfolioId: { in: portfolioIds } },
        select: { portfolioId: true, tsCode: true, stockName: true },
      })
      for (const row of rows) {
        const list = portfolioHoldingMap.get(row.portfolioId) ?? []
        list.push({ tsCode: row.tsCode, stockName: row.stockName })
        portfolioHoldingMap.set(row.portfolioId, list)
      }
    }

    for (const rule of rules) {
      if (rule.tsCode) {
        entries.push({ rule, tsCode: rule.tsCode, stockName: rule.stockName })
      }
      if (rule.watchlistId) {
        const stocks = watchlistStockMap.get(rule.watchlistId) ?? []
        for (const s of stocks) {
          entries.push({
            rule,
            tsCode: s.tsCode,
            stockName: null,
            source: { type: 'WATCHLIST', id: rule.watchlistId, name: rule.sourceName ?? String(rule.watchlistId) },
          })
        }
      }
      if (rule.portfolioId) {
        const holdings = portfolioHoldingMap.get(rule.portfolioId) ?? []
        for (const h of holdings) {
          entries.push({
            rule,
            tsCode: h.tsCode,
            stockName: h.stockName,
            source: { type: 'PORTFOLIO', id: rule.portfolioId, name: rule.sourceName ?? rule.portfolioId },
          })
        }
      }
    }

    return entries
  }
}
