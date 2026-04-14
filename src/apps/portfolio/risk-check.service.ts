import { Injectable } from '@nestjs/common'
import { PortfolioRiskRuleType } from '@prisma/client'
import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'
import { PrismaService } from 'src/shared/prisma.service'
import { CreateRiskRuleDto, UpdateRiskRuleDto } from './dto/risk-rule.dto'
import { PortfolioService } from './portfolio.service'
import { PortfolioRiskService } from './portfolio-risk.service'
import { EventsGateway } from 'src/websocket/events.gateway'

dayjs.extend(utc)
dayjs.extend(timezone)

@Injectable()
export class RiskCheckService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly portfolioService: PortfolioService,
    private readonly riskService: PortfolioRiskService,
    private readonly eventsGateway: EventsGateway,
  ) {}

  // ─── 规则管理 ─────────────────────────────────────────────────────────────

  async listRules(portfolioId: string, userId: number) {
    await this.portfolioService.assertOwner(portfolioId, userId)
    return this.prisma.portfolioRiskRule.findMany({
      where: { portfolioId },
      orderBy: { createdAt: 'asc' },
    })
  }

  async upsertRule(dto: CreateRiskRuleDto, userId: number) {
    await this.portfolioService.assertOwner(dto.portfolioId, userId)
    return this.prisma.portfolioRiskRule.upsert({
      where: {
        portfolioId_ruleType: { portfolioId: dto.portfolioId, ruleType: dto.ruleType },
      },
      create: {
        portfolioId: dto.portfolioId,
        ruleType: dto.ruleType,
        threshold: dto.threshold,
        isEnabled: dto.isEnabled ?? true,
        memo: dto.memo,
      },
      update: {
        threshold: dto.threshold,
        isEnabled: dto.isEnabled ?? true,
        memo: dto.memo,
      },
    })
  }

  async updateRule(dto: UpdateRiskRuleDto, userId: number) {
    const rule = await this.prisma.portfolioRiskRule.findUniqueOrThrow({
      where: { id: dto.ruleId },
      select: { id: true, portfolioId: true },
    })
    await this.portfolioService.assertOwner(rule.portfolioId, userId)
    return this.prisma.portfolioRiskRule.update({
      where: { id: dto.ruleId },
      data: {
        threshold: dto.threshold,
        isEnabled: dto.isEnabled,
        memo: dto.memo,
      },
    })
  }

  async deleteRule(ruleId: string, userId: number) {
    const rule = await this.prisma.portfolioRiskRule.findUniqueOrThrow({
      where: { id: ruleId },
      select: { id: true, portfolioId: true },
    })
    await this.portfolioService.assertOwner(rule.portfolioId, userId)
    await this.prisma.portfolioRiskRule.delete({ where: { id: ruleId } })
    return { success: true }
  }

  // ─── 风险检测 ─────────────────────────────────────────────────────────────

  async runCheck(portfolioId: string, userId: number) {
    await this.portfolioService.assertOwner(portfolioId, userId)
    const rules = await this.prisma.portfolioRiskRule.findMany({
      where: { portfolioId, isEnabled: true },
    })

    if (!rules.length) return { portfolioId, violations: [], checkedAt: new Date() }

    const violations: {
      ruleId: string
      ruleType: PortfolioRiskRuleType
      actualValue: number
      threshold: number
      detail: string
    }[] = []

    for (const rule of rules) {
      const violation = await this.checkRule(portfolioId, rule, userId)
      if (violation) violations.push(violation)
    }

    // 写入违规日志
    if (violations.length > 0) {
      await this.prisma.riskViolationLog.createMany({
        data: violations.map((v) => ({
          portfolioId,
          ruleId: v.ruleId,
          ruleType: v.ruleType,
          actualValue: v.actualValue,
          threshold: v.threshold,
          detail: v.detail,
        })),
      })
      // 推送风控告警给组合所属用户
      this.eventsGateway.emitToUser(userId, 'risk_violation', {
        portfolioId,
        violations: violations.map((v) => ({
          ruleType: v.ruleType,
          actualValue: v.actualValue,
          threshold: v.threshold,
          detail: v.detail,
        })),
        checkedAt: new Date(),
      })
    }

    return {
      portfolioId,
      violations,
      checkedAt: new Date(),
    }
  }

  async listViolations(portfolioId: string, userId: number, limit = 50) {
    await this.portfolioService.assertOwner(portfolioId, userId)
    return this.prisma.riskViolationLog.findMany({
      where: { portfolioId },
      orderBy: { checkedAt: 'desc' },
      take: limit,
    })
  }

  // ─── 持仓变动自动检测（仅检查单一仓位和行业集中度）──────────────────────

  async autoCheckOnHoldingChange(portfolioId: string, userId: number) {
    const rules = await this.prisma.portfolioRiskRule.findMany({
      where: {
        portfolioId,
        isEnabled: true,
        ruleType: {
          in: [PortfolioRiskRuleType.MAX_SINGLE_POSITION, PortfolioRiskRuleType.MAX_INDUSTRY_WEIGHT],
        },
      },
    })
    if (!rules.length) return

    const violations: {
      ruleId: string
      ruleType: PortfolioRiskRuleType
      actualValue: number
      threshold: number
      detail: string
    }[] = []

    for (const rule of rules) {
      const violation = await this.checkRule(portfolioId, rule, userId)
      if (violation) violations.push(violation)
    }

    if (violations.length > 0) {
      await this.prisma.riskViolationLog.createMany({
        data: violations.map((v) => ({
          portfolioId,
          ruleId: v.ruleId,
          ruleType: v.ruleType,
          actualValue: v.actualValue,
          threshold: v.threshold,
          detail: v.detail,
        })),
      })
      // 推送风控告警给组合所属用户
      this.eventsGateway.emitToUser(userId, 'risk_violation', {
        portfolioId,
        violations: violations.map((v) => ({
          ruleType: v.ruleType,
          actualValue: v.actualValue,
          threshold: v.threshold,
          detail: v.detail,
        })),
        checkedAt: new Date(),
      })
    }
  }

  // ─── 私有方法 ─────────────────────────────────────────────────────────────

  private async checkRule(
    portfolioId: string,
    rule: { id: string; ruleType: PortfolioRiskRuleType; threshold: number },
    userId: number,
  ) {
    switch (rule.ruleType) {
      case PortfolioRiskRuleType.MAX_SINGLE_POSITION:
        return this.checkSinglePosition(portfolioId, rule, userId)
      case PortfolioRiskRuleType.MAX_INDUSTRY_WEIGHT:
        return this.checkIndustryWeight(portfolioId, rule, userId)
      case PortfolioRiskRuleType.MAX_DRAWDOWN_STOP:
        return this.checkMaxDrawdown(portfolioId, rule, userId)
      default:
        return null
    }
  }

  private async checkSinglePosition(
    portfolioId: string,
    rule: { id: string; ruleType: PortfolioRiskRuleType; threshold: number },
    userId: number,
  ) {
    const result = await this.riskService.getPositionConcentration(portfolioId, userId)
    const maxWeight = result.concentration.top1Weight
    if (maxWeight > rule.threshold) {
      const topPos = result.positions[0]
      return {
        ruleId: rule.id,
        ruleType: rule.ruleType,
        actualValue: maxWeight,
        threshold: rule.threshold,
        detail: `最大单一仓位 ${topPos?.stockName ?? ''} 占比 ${(maxWeight * 100).toFixed(2)}%，超过阈值 ${(rule.threshold * 100).toFixed(2)}%`,
      }
    }
    return null
  }

  private async checkIndustryWeight(
    portfolioId: string,
    rule: { id: string; ruleType: PortfolioRiskRuleType; threshold: number },
    userId: number,
  ) {
    const result = await this.riskService.getIndustryDistribution(portfolioId, userId)
    const maxIndustry = [...result.industries].sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0))[0]
    if (!maxIndustry) return null
    const maxWeight = maxIndustry.weight ?? 0
    if (maxWeight > rule.threshold) {
      return {
        ruleId: rule.id,
        ruleType: rule.ruleType,
        actualValue: maxWeight,
        threshold: rule.threshold,
        detail: `行业 ${maxIndustry.industry} 占比 ${(maxWeight * 100).toFixed(2)}%，超过阈值 ${(rule.threshold * 100).toFixed(2)}%`,
      }
    }
    return null
  }

  private async checkMaxDrawdown(
    portfolioId: string,
    rule: { id: string; ruleType: PortfolioRiskRuleType; threshold: number },
    userId: number,
  ) {
    // 查近 250 个交易日内的历史净值
    const latestDate = await this.portfolioService.getLatestTradeDate()
    if (!latestDate) return null

    // 向前推 ~365 天作为起始（使用 dayjs 安全处理闰年）
    const start = dayjs(latestDate).subtract(1, 'year').toDate()
    const startDate = this.formatDate(start)
    const endDate = this.formatDate(latestDate)

    type NavRow = { trade_date: Date; market_value: unknown; cost_basis: unknown }
    const rows = await this.prisma.$queryRaw<NavRow[]>`
      SELECT
        d.trade_date,
        SUM(h.quantity * d.close)    AS market_value,
        SUM(h.quantity * h.avg_cost) AS cost_basis
      FROM portfolio_holdings h
      JOIN stock_daily_prices d
        ON d.ts_code = h.ts_code
        AND d.trade_date BETWEEN ${startDate}::date AND ${endDate}::date
      WHERE h.portfolio_id = ${portfolioId}
      GROUP BY d.trade_date
      ORDER BY d.trade_date
    `

    if (rows.length < 2) return null

    const navs = rows.map((r) => {
      const mv = Number(r.market_value)
      const cb = Number(r.cost_basis)
      return cb > 0 ? mv / cb : 1
    })

    // 计算最大回撤（从初始 NAV=1.0 开始，表示投资起始基准，避免低估回撤）
    let maxDrawdown = 0
    let peak = 1.0 // 初始高水位 = 投资起始净值（相对收益 1.0）
    for (const nav of navs) {
      if (nav > peak) peak = nav
      const dd = peak > 0 ? (peak - nav) / peak : 0
      if (dd > maxDrawdown) maxDrawdown = dd
    }

    if (maxDrawdown > rule.threshold) {
      return {
        ruleId: rule.id,
        ruleType: rule.ruleType,
        actualValue: maxDrawdown,
        threshold: rule.threshold,
        detail: `历史最大回撤 ${(maxDrawdown * 100).toFixed(2)}%，超过止损阈值 ${(rule.threshold * 100).toFixed(2)}%`,
      }
    }
    return null
  }

  private formatDate(date: Date): string {
    return dayjs(date).tz('Asia/Shanghai').format('YYYYMMDD')
  }
}
