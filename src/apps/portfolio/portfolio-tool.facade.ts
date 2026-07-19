import { Injectable } from '@nestjs/common'
import { PrismaService } from 'src/shared/prisma.service'
import { PortfolioRiskService } from './portfolio-risk.service'

export const PORTFOLIO_RISK_SECTIONS = [
  'HOLDINGS',
  'CONCENTRATION',
  'INDUSTRY',
  'MARKET_CAP',
  'BETA',
  'VIOLATIONS',
] as const

export type PortfolioRiskSection = (typeof PORTFOLIO_RISK_SECTIONS)[number]

export interface PortfolioRiskToolInput {
  portfolioId: string
  asOfDate: string
  sections: PortfolioRiskSection[]
}

export class PortfolioToolNotFoundError extends Error {
  constructor() {
    super('组合不存在')
    this.name = PortfolioToolNotFoundError.name
  }
}

@Injectable()
export class PortfolioToolFacade {
  constructor(
    private readonly prisma: PrismaService,
    private readonly portfolioRiskService: PortfolioRiskService,
  ) {}

  async risk(userId: number, input: PortfolioRiskToolInput) {
    const portfolio = await this.prisma.portfolio.findFirst({
      where: { id: input.portfolioId, userId },
      select: { id: true, name: true, kind: true, isArchived: true },
    })
    if (!portfolio) throw new PortfolioToolNotFoundError()

    const [snapshot, holdings, violations] = await Promise.all([
      this.portfolioRiskService.getRiskSnapshot(input.portfolioId, userId, input.asOfDate),
      input.sections.includes('HOLDINGS')
        ? this.prisma.portfolioHolding.findMany({
            where: { portfolioId: input.portfolioId },
            orderBy: [{ createdAt: 'asc' }, { tsCode: 'asc' }],
            select: { tsCode: true, stockName: true, quantity: true, avgCost: true },
          })
        : Promise.resolve([]),
      input.sections.includes('VIOLATIONS')
        ? this.prisma.riskViolationLog.findMany({
            where: {
              portfolioId: input.portfolioId,
              checkedAt: { lte: new Date(`${input.asOfDate}T23:59:59.999Z`) },
            },
            orderBy: [{ checkedAt: 'desc' }, { id: 'desc' }],
            take: 100,
            select: {
              id: true,
              ruleType: true,
              actualValue: true,
              threshold: true,
              detail: true,
              checkedAt: true,
            },
          })
        : Promise.resolve([]),
    ])

    const componentErrors = requestedComponentErrors(input.sections, snapshot.errors)
    const positionMap = new Map((snapshot.position?.positions ?? []).map((position) => [position.tsCode, position]))
    const dataAsOf = normalizeDate(
      snapshot.position?.tradeDate ??
        snapshot.industry?.tradeDate ??
        snapshot.marketCap?.tradeDate ??
        snapshot.beta?.tradeDate ??
        null,
    )

    return {
      data: {
        portfolio: { ...portfolio },
        requestedAsOfDate: input.asOfDate,
        dataAsOf,
        sections: input.sections,
        partial: componentErrors.length > 0,
        holdings: input.sections.includes('HOLDINGS')
          ? holdings.map((holding) => {
              const position = positionMap.get(holding.tsCode)
              return {
                tsCode: holding.tsCode,
                stockName: holding.stockName,
                quantity: holding.quantity,
                avgCost: Number(holding.avgCost),
                marketValue: position?.marketValue ?? null,
                weight: position?.weight ?? null,
              }
            })
          : null,
        concentration: input.sections.includes('CONCENTRATION') ? (snapshot.position?.concentration ?? null) : null,
        industry: input.sections.includes('INDUSTRY')
          ? snapshot.industry
            ? { ...snapshot.industry, tradeDate: normalizeDate(snapshot.industry.tradeDate) }
            : null
          : null,
        marketCap: input.sections.includes('MARKET_CAP')
          ? snapshot.marketCap
            ? { ...snapshot.marketCap, tradeDate: normalizeDate(snapshot.marketCap.tradeDate) }
            : null
          : null,
        beta: input.sections.includes('BETA')
          ? snapshot.beta
            ? { ...snapshot.beta, tradeDate: normalizeDate(snapshot.beta.tradeDate) }
            : null
          : null,
        violations: input.sections.includes('VIOLATIONS')
          ? violations.map((violation) => ({
              id: violation.id,
              ruleType: violation.ruleType,
              actualValue: violation.actualValue,
              threshold: violation.threshold,
              detail: violation.detail,
              checkedAt: violation.checkedAt.toISOString(),
            }))
          : null,
        componentErrors,
      },
      asOf: dataAsOf,
      sourceModels: portfolioSourceModels(input.sections),
    }
  }
}

function requestedComponentErrors(
  sections: PortfolioRiskSection[],
  errors: Record<string, string> | undefined,
): Array<{ section: PortfolioRiskSection; code: string }> {
  if (!errors) return []
  const errorKeys: Partial<Record<PortfolioRiskSection, string>> = {
    CONCENTRATION: 'position',
    INDUSTRY: 'industry',
    MARKET_CAP: 'marketCap',
    BETA: 'beta',
  }
  return sections.flatMap((section) =>
    errorKeys[section] && errors[errorKeys[section]!] ? [{ section, code: 'COMPONENT_FAILED' }] : [],
  )
}

function portfolioSourceModels(sections: PortfolioRiskSection[]): string[] {
  const models = new Set<string>(['Portfolio'])
  if (sections.includes('HOLDINGS') || sections.includes('CONCENTRATION')) models.add('PortfolioHolding')
  if (sections.includes('INDUSTRY')) models.add('StockBasic')
  if (sections.includes('MARKET_CAP')) models.add('DailyBasic')
  if (sections.includes('BETA')) {
    models.add('Daily')
    models.add('IndexDaily')
  }
  if (sections.includes('VIOLATIONS')) models.add('RiskViolationLog')
  return [...models]
}

function normalizeDate(value: string | null): string | null {
  if (!value) return null
  return /^\d{8}$/.test(value) ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}` : value
}
