import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { EventSignalRule, EventSignalRuleStatus } from '@prisma/client'
import { formatDateToCompactTradeDate, parseCompactTradeDateToUtcDate } from 'src/common/utils/trade-date.util'
import { PrismaService } from 'src/shared/prisma.service'
import { EventsGateway } from 'src/websocket/events.gateway'
import { EVENT_TYPE_CONFIGS, EventType } from './event-type.registry'
import { EventStudyService } from './event-study.service'
import { CreateSignalRuleDto } from './dto/create-signal-rule.dto'
import { UpdateSignalRuleDto } from './dto/update-signal-rule.dto'

@Injectable()
export class EventSignalService {
  private readonly logger = new Logger(EventSignalService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventsGateway: EventsGateway,
    private readonly eventStudyService: EventStudyService,
  ) {}

  // ── 规则 CRUD ──────────────────────────────────────────────────────────────

  async createRule(userId: number, dto: CreateSignalRuleDto): Promise<EventSignalRule> {
    return this.prisma.eventSignalRule.create({
      data: {
        userId,
        name: dto.name,
        description: dto.description,
        eventType: dto.eventType,
        conditions: (dto.conditions ?? {}) as object,
        signalType: dto.signalType ?? 'WATCH',
      },
    })
  }

  async listRules(userId: number, page = 1, pageSize = 20) {
    const skip = (page - 1) * pageSize
    const [items, total] = await Promise.all([
      this.prisma.eventSignalRule.findMany({
        where: { userId, status: { not: EventSignalRuleStatus.DELETED } },
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.eventSignalRule.count({
        where: { userId, status: { not: EventSignalRuleStatus.DELETED } },
      }),
    ])
    return { items, total, page, pageSize }
  }

  async updateRule(userId: number, ruleId: number, dto: UpdateSignalRuleDto) {
    const existing = await this.prisma.eventSignalRule.findFirst({
      where: { id: ruleId, userId },
    })
    if (!existing) throw new NotFoundException('规则不存在或无权限操作')

    return this.prisma.eventSignalRule.update({
      where: { id: ruleId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.conditions !== undefined && { conditions: dto.conditions as object }),
        ...(dto.signalType !== undefined && { signalType: dto.signalType }),
        ...(dto.status !== undefined && { status: dto.status }),
      },
    })
  }

  async deleteRule(userId: number, ruleId: number) {
    const existing = await this.prisma.eventSignalRule.findFirst({
      where: { id: ruleId, userId },
    })
    if (!existing) throw new NotFoundException('规则不存在或无权限操作')

    return this.prisma.eventSignalRule.update({
      where: { id: ruleId },
      data: { status: EventSignalRuleStatus.DELETED },
    })
  }

  async querySignals(userId: number, dto: { page?: number; pageSize?: number; tsCode?: string }) {
    const page = dto.page ?? 1
    const pageSize = dto.pageSize ?? 50
    const skip = (page - 1) * pageSize

    // Collect rule IDs belonging to this user
    const userRuleIds = await this.prisma.eventSignalRule
      .findMany({ where: { userId }, select: { id: true } })
      .then((rows) => rows.map((r) => r.id))

    if (userRuleIds.length === 0) return { items: [], total: 0, page, pageSize }

    const where = {
      ruleId: { in: userRuleIds },
      ...(dto.tsCode ? { tsCode: dto.tsCode } : {}),
    }

    const [items, total] = await Promise.all([
      this.prisma.eventSignal.findMany({
        where,
        include: { rule: { select: { name: true, eventType: true } } },
        orderBy: { triggeredAt: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.eventSignal.count({ where }),
    ])

    return { items, total, page, pageSize }
  }

  async previewRule(
    userId: number,
    dto: {
      ruleId?: number
      eventType?: EventType
      conditions?: Record<string, unknown>
      startDate?: string
      endDate?: string
      pageSize?: number
    },
  ) {
    let eventType = dto.eventType
    let conditions = dto.conditions ?? {}

    if (dto.ruleId) {
      const rule = await this.prisma.eventSignalRule.findFirst({ where: { id: dto.ruleId, userId } })
      if (!rule) throw new NotFoundException('规则不存在或无权限操作')
      eventType = rule.eventType as EventType
      conditions = (rule.conditions as Record<string, unknown>) ?? {}
    }

    if (!eventType) throw new NotFoundException('缺少事件类型')

    const queried = await this.eventStudyService.queryEvents({
      eventType,
      startDate: dto.startDate,
      endDate: dto.endDate,
      page: 1,
      pageSize: Math.min(dto.pageSize ?? 200, 500),
    })
    const matched = (queried.items as Record<string, unknown>[]).filter((event) =>
      this.matchConditions(event, conditions),
    )
    const dateField = this.eventStudyService.getEventDateField(eventType)
    const distribution = matched.reduce<Record<string, number>>((acc, event) => {
      const date = this.eventStudyService.formatEventDateValue(event[dateField]) ?? 'unknown'
      acc[date] = (acc[date] ?? 0) + 1
      return acc
    }, {})

    return {
      eventType,
      ruleId: dto.ruleId ?? null,
      total: queried.total,
      matchCount: matched.length,
      distribution,
      samples: matched.slice(0, 20),
    }
  }

  // ── 信号扫描 ───────────────────────────────────────────────────────────────

  /**
   * 扫描指定日期新增的事件，对所有 ACTIVE 规则进行匹配并生成信号。
   * 若不传 targetDate，默认使用今日（YYYYMMDD 格式）。
   */
  async scanAndGenerate(targetDate?: string): Promise<{ signalsGenerated: number }> {
    const dateStr = targetDate ?? formatDateToCompactTradeDate(new Date())!
    this.logger.log(`开始事件信号扫描，目标日期：${dateStr}`)

    const rules = await this.prisma.eventSignalRule.findMany({
      where: { status: EventSignalRuleStatus.ACTIVE },
    })

    if (rules.length === 0) {
      this.logger.log('无 ACTIVE 规则，跳过扫描')
      return { signalsGenerated: 0 }
    }

    // Group rules by eventType
    const rulesByType = new Map<string, EventSignalRule[]>()
    for (const rule of rules) {
      const list = rulesByType.get(rule.eventType) ?? []
      list.push(rule)
      rulesByType.set(rule.eventType, list)
    }

    let signalsGenerated = 0
    const eventDateParsed = parseCompactTradeDateToUtcDate(dateStr)

    for (const [eventTypeStr, typeRules] of rulesByType) {
      if (!Object.values(EventType).includes(eventTypeStr as EventType)) continue

      const events = await this.queryDateEvents(eventTypeStr as EventType, eventDateParsed)

      for (const event of events) {
        for (const rule of typeRules) {
          if (this.matchConditions(event, rule.conditions as Record<string, unknown>)) {
            await this.prisma.eventSignal.create({
              data: {
                ruleId: rule.id,
                tsCode: event['tsCode'] as string,
                stockName: (event['name'] as string | undefined) ?? null,
                eventDate: eventDateParsed,
                signalType: rule.signalType,
                eventDetail: event as object,
              },
            })
            signalsGenerated++

            // WebSocket 推送给规则所属用户
            this.eventsGateway.emitToUser(rule.userId, 'event-signal', {
              ruleId: rule.id,
              ruleName: rule.name,
              tsCode: event['tsCode'],
              stockName: event['name'],
              signalType: rule.signalType,
              eventDate: dateStr,
            })
          }
        }
      }
    }

    this.logger.log(`事件信号扫描完成，生成 ${signalsGenerated} 条信号`)
    return { signalsGenerated }
  }

  // ── Private ────────────────────────────────────────────────────────────────

  /**
   * 查询指定日期的事件，返回含业务字段的 Record 数组，
   * 字段名与各 Prisma Model 的 camelCase 字段一致，供 matchConditions 使用。
   */
  private async queryDateEvents(eventType: EventType, date: Date): Promise<Record<string, unknown>[]> {
    const nextDay = new Date(date)
    nextDay.setUTCDate(nextDay.getUTCDate() + 1)

    switch (eventType) {
      case EventType.FORECAST: {
        const rows = await this.prisma.forecast.findMany({
          where: { annDate: { gte: date, lt: nextDay } },
        })
        return rows.map((r) => ({ ...(r as object), name: undefined }))
      }
      case EventType.DIVIDEND_EX: {
        const rows = await this.prisma.dividend.findMany({
          where: { exDate: { gte: date, lt: nextDay }, divProc: '实施' },
        })
        return rows.map((r) => ({ ...(r as object), name: undefined }))
      }
      case EventType.HOLDER_INCREASE: {
        const rows = await this.prisma.stkHolderTrade.findMany({
          where: { annDate: { gte: date, lt: nextDay }, inDe: 'IN' },
        })
        return rows.map((r) => ({ ...(r as object), name: undefined }))
      }
      case EventType.HOLDER_DECREASE: {
        const rows = await this.prisma.stkHolderTrade.findMany({
          where: { annDate: { gte: date, lt: nextDay }, inDe: 'DE' },
        })
        return rows.map((r) => ({ ...(r as object), name: undefined }))
      }
      case EventType.SHARE_FLOAT: {
        const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '')
        const rows = await this.prisma.shareFloat.findMany({
          where: { floatDate: dateStr },
        })
        return rows.map((r) => ({ ...(r as object), name: undefined }))
      }
      case EventType.REPURCHASE: {
        const rows = await this.prisma.repurchase.findMany({
          where: { annDate: { gte: date, lt: nextDay } },
        })
        return rows.map((r) => ({ ...(r as object), name: undefined }))
      }
      case EventType.AUDIT_QUALIFIED: {
        const rows = await this.prisma.finaAudit.findMany({
          where: { annDate: { gte: date, lt: nextDay }, auditResult: { not: '标准无保留意见' } },
        })
        return rows.map((r) => ({ ...(r as object), name: undefined }))
      }
      case EventType.DISCLOSURE: {
        const rows = await this.prisma.disclosureDate.findMany({
          where: { actualDate: { gte: date, lt: nextDay } },
        })
        return rows.map((r) => ({ ...(r as object), name: undefined }))
      }
    }
  }

  /**
   * 条件匹配器：将规则 conditions JSON 与事件记录字段做比较。
   *
   * 支持的操作符：
   *  - 直接值：{ "type": "预增" }
   *  - gte/lte/gt/lt：{ "pChangeMin": { "gte": 50 } }
   *  - in：{ "type": { "in": ["预增", "略增"] } }
   */
  private matchConditions(event: Record<string, unknown>, conditions: Record<string, unknown>): boolean {
    if (!conditions || Object.keys(conditions).length === 0) return true

    for (const [field, expected] of Object.entries(conditions)) {
      const actual = event[field]
      if (actual == null) return false

      if (typeof expected === 'object' && expected !== null && !Array.isArray(expected)) {
        const ops = expected as Record<string, unknown>
        if ('gte' in ops && (actual as number) < (ops.gte as number)) return false
        if ('lte' in ops && (actual as number) > (ops.lte as number)) return false
        if ('gt' in ops && (actual as number) <= (ops.gt as number)) return false
        if ('lt' in ops && (actual as number) >= (ops.lt as number)) return false
        if ('in' in ops && !(ops.in as unknown[]).includes(actual)) return false
      } else {
        if (actual !== expected) return false
      }
    }

    return true
  }
}

// Augment EVENT_TYPE_CONFIGS to satisfy the import (already imported above)
void EVENT_TYPE_CONFIGS
