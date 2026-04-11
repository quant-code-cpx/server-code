import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { PriceAlertRuleStatus, PriceAlertRuleType } from '@prisma/client'
import * as dayjs from 'dayjs'
import { PrismaService } from 'src/shared/prisma.service'
import { EventsGateway } from 'src/websocket/events.gateway'
import { CreatePriceAlertRuleDto, UpdatePriceAlertRuleDto } from './dto/price-alert-rule.dto'

interface PriceAlertPayload {
  ruleId: number
  tsCode: string
  stockName: string | null
  ruleType: PriceAlertRuleType
  threshold: number | null
  tradeDate: string
  actualValue: number
  memo: string | null
}

@Injectable()
export class PriceAlertService {
  private readonly logger = new Logger(PriceAlertService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventsGateway: EventsGateway,
  ) {}

  // ── 规则 CRUD ──────────────────────────────────────────────────────────────

  async createRule(userId: number, dto: CreatePriceAlertRuleDto) {
    const stock = await this.prisma.stockBasic.findUnique({
      where: { tsCode: dto.tsCode },
      select: { name: true },
    })
    return this.prisma.priceAlertRule.create({
      data: {
        userId,
        tsCode: dto.tsCode,
        stockName: stock?.name ?? null,
        ruleType: dto.ruleType,
        threshold: dto.threshold ?? null,
        memo: dto.memo ?? null,
      },
    })
  }

  async listRules(userId: number) {
    return this.prisma.priceAlertRule.findMany({
      where: { userId, status: { not: PriceAlertRuleStatus.DELETED } },
      orderBy: { createdAt: 'desc' },
    })
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
    this.logger.log('定时任务：开始盘后价格预警扫描')
    try {
      await this.runScan()
    } catch (err) {
      this.logger.error('价格预警扫描异常', (err as Error).stack)
    }
  }

  async runScan(): Promise<{ triggered: number }> {
    const rules = await this.prisma.priceAlertRule.findMany({
      where: { status: PriceAlertRuleStatus.ACTIVE },
    })

    if (rules.length === 0) {
      this.logger.log('价格预警：没有活跃规则，跳过扫描')
      return { triggered: 0 }
    }

    // 获取所有涉及股票的最新一日行情
    const tsCodes = [...new Set(rules.map((r) => r.tsCode))]

    // 获取最新交易日
    const latestDaily = await this.prisma.daily.findFirst({
      orderBy: { tradeDate: 'desc' },
      select: { tradeDate: true },
    })
    if (!latestDaily) {
      this.logger.warn('价格预警：数据库中没有日行情数据，跳过扫描')
      return { triggered: 0 }
    }

    const latestTradeDate = latestDaily.tradeDate
    const tradeDateStr = dayjs(latestTradeDate).format('YYYYMMDD')

    // 批量加载当日行情
    const dailyRows = await this.prisma.daily.findMany({
      where: { tsCode: { in: tsCodes }, tradeDate: latestTradeDate },
      select: { tsCode: true, close: true, pctChg: true },
    })
    const dailyMap = new Map(dailyRows.map((r) => [r.tsCode, r]))

    // 批量加载当日涨跌停价（tradeDateStr 是字符串格式）
    const limitTsCodes = rules
      .filter(
        (r) =>
          r.ruleType === PriceAlertRuleType.LIMIT_UP || r.ruleType === PriceAlertRuleType.LIMIT_DOWN,
      )
      .map((r) => r.tsCode)

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

    const triggeredRuleIds: number[] = []
    const updateOps: Promise<unknown>[] = []

    for (const rule of rules) {
      const daily = dailyMap.get(rule.tsCode)
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
          const limits = limitMap.get(rule.tsCode)
          if (close != null && limits?.upLimit != null && close >= limits.upLimit) {
            triggered = true
            actualValue = close
          }
          break
        }
        case PriceAlertRuleType.LIMIT_DOWN: {
          const limits = limitMap.get(rule.tsCode)
          if (close != null && limits?.downLimit != null && close <= limits.downLimit) {
            triggered = true
            actualValue = close
          }
          break
        }
      }

      if (triggered && actualValue != null) {
        triggeredRuleIds.push(rule.id)

        updateOps.push(
          this.prisma.priceAlertRule.update({
            where: { id: rule.id },
            data: {
              lastTriggeredAt: new Date(),
              triggerCount: { increment: 1 },
            },
          }),
        )

        const payload: PriceAlertPayload = {
          ruleId: rule.id,
          tsCode: rule.tsCode,
          stockName: rule.stockName,
          ruleType: rule.ruleType,
          threshold: rule.threshold,
          tradeDate: tradeDateStr,
          actualValue,
          memo: rule.memo,
        }
        this.eventsGateway.emitToUser(rule.userId, 'price-alert', payload)
      }
    }

    await Promise.all(updateOps)

    this.logger.log(`价格预警扫描完成：共扫描 ${rules.length} 条规则，触发 ${triggeredRuleIds.length} 条`)
    return { triggered: triggeredRuleIds.length }
  }
}
