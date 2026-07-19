import { Injectable } from '@nestjs/common'
import { stableJson } from 'src/apps/agent/tools/tool-json'
import { PrismaService } from 'src/shared/prisma.service'

export const BACKTEST_RESULT_SECTIONS = [
  'CONFIG',
  'STATUS',
  'METRICS',
  'EQUITY',
  'TRADES_SUMMARY',
  'ATTRIBUTION',
] as const

export const BACKTEST_RESULT_ALGORITHM_VERSION = 'backtest-research-v1'
const BACKTEST_EQUITY_LOAD_LIMIT = 20_000
export type BacktestResultSection = (typeof BACKTEST_RESULT_SECTIONS)[number]

export interface BacktestResultToolInput {
  backtestRunId: string
  sections: BacktestResultSection[]
  maxEquityPoints: number
}

export class BacktestToolNotFoundError extends Error {
  constructor() {
    super('回测不存在')
    this.name = BacktestToolNotFoundError.name
  }
}

export class BacktestToolResultTooLargeError extends Error {
  constructor() {
    super(`回测净值点数超过 ${BACKTEST_EQUITY_LOAD_LIMIT}，请缩小结果范围`)
    this.name = BacktestToolResultTooLargeError.name
  }
}

@Injectable()
export class BacktestToolFacade {
  constructor(private readonly prisma: PrismaService) {}

  async result(userId: number, input: BacktestResultToolInput) {
    const run = await this.prisma.backtestRun.findFirst({
      where: { id: input.backtestRunId, userId, deletedAt: null },
    })
    if (!run) throw new BacktestToolNotFoundError()

    const totalEquityPoints = input.sections.includes('EQUITY')
      ? await this.prisma.backtestDailyNav.count({ where: { runId: run.id } })
      : 0
    if (totalEquityPoints > BACKTEST_EQUITY_LOAD_LIMIT) throw new BacktestToolResultTooLargeError()
    const equityRows = input.sections.includes('EQUITY')
      ? await this.prisma.backtestDailyNav.findMany({
          where: { runId: run.id },
          orderBy: { tradeDate: 'asc' },
          select: {
            tradeDate: true,
            nav: true,
            benchmarkNav: true,
            drawdown: true,
            dailyReturn: true,
            benchmarkReturn: true,
            exposure: true,
            cashRatio: true,
          },
        })
      : []
    const equityPoints = evenlySample(equityRows, input.maxEquityPoints)
    const tradesSummary = input.sections.includes('TRADES_SUMMARY') ? await this.loadTradesSummary(run.id) : null
    const attributionRequested = input.sections.includes('ATTRIBUTION')
    const terminal = ['COMPLETED', 'FAILED', 'CANCELLED'].includes(run.status)
    const componentErrors = attributionRequested
      ? [{ section: 'ATTRIBUTION' as const, code: 'ATTRIBUTION_NOT_PERSISTED' }]
      : []

    return {
      data: {
        backtestRunId: run.id,
        sections: input.sections,
        algorithmVersion: BACKTEST_RESULT_ALGORITHM_VERSION,
        partial: componentErrors.length > 0,
        config: input.sections.includes('CONFIG')
          ? {
              strategyType: run.strategyType,
              strategyConfigJson: stableJson(run.strategyConfig),
              startDate: toIsoDate(run.startDate),
              endDate: toIsoDate(run.endDate),
              benchmarkTsCode: run.benchmarkTsCode,
              universe: run.universe,
              customUniverseTsCodes: stringArrayOrNull(run.customUniverse),
              initialCapital: Number(run.initialCapital),
              rebalanceFrequency: run.rebalanceFrequency,
              priceMode: run.priceMode,
              commissionRate: nullableNumber(run.commissionRate),
              stampDutyRate: nullableNumber(run.stampDutyRate),
              minCommission: nullableNumber(run.minCommission),
              slippageBps: run.slippageBps,
            }
          : null,
        runStatus: input.sections.includes('STATUS')
          ? {
              status: run.status,
              terminal,
              progress: run.progress,
              failedReason: run.failedReason,
              createdAt: run.createdAt.toISOString(),
              startedAt: run.startedAt?.toISOString() ?? null,
              completedAt: run.completedAt?.toISOString() ?? null,
            }
          : null,
        metrics: input.sections.includes('METRICS')
          ? {
              totalReturn: finiteOrNull(run.totalReturn),
              annualizedReturn: finiteOrNull(run.annualizedReturn),
              benchmarkReturn: finiteOrNull(run.benchmarkReturn),
              excessReturn: finiteOrNull(run.excessReturn),
              maxDrawdown: finiteOrNull(run.maxDrawdown),
              sharpeRatio: finiteOrNull(run.sharpeRatio),
              sortinoRatio: finiteOrNull(run.sortinoRatio),
              calmarRatio: finiteOrNull(run.calmarRatio),
              volatility: finiteOrNull(run.volatility),
              alpha: finiteOrNull(run.alpha),
              beta: finiteOrNull(run.beta),
              informationRatio: finiteOrNull(run.informationRatio),
              winRate: finiteOrNull(run.winRate),
              turnoverRate: finiteOrNull(run.turnoverRate),
              tradeCount: run.tradeCount,
              units: { returns: 'DECIMAL' as const, ratios: 'RATIO' as const },
            }
          : null,
        equity: input.sections.includes('EQUITY')
          ? {
              totalPoints: totalEquityPoints,
              returnedPoints: equityPoints.length,
              sampling: equityRows.length > equityPoints.length ? ('EVEN' as const) : ('NONE' as const),
              truncated: equityRows.length > equityPoints.length,
              points: equityPoints.map((point) => ({
                tradeDate: toIsoDate(point.tradeDate),
                nav: Number(point.nav),
                benchmarkNav: nullableNumber(point.benchmarkNav),
                drawdown: finiteOrNull(point.drawdown),
                dailyReturn: finiteOrNull(point.dailyReturn),
                benchmarkReturn: finiteOrNull(point.benchmarkReturn),
                exposure: finiteOrNull(point.exposure),
                cashRatio: finiteOrNull(point.cashRatio),
              })),
            }
          : null,
        tradesSummary,
        attribution: null,
        biasFlags: {
          survivorship: 'UNVERIFIED' as const,
          pointInTimeUniverse: false,
          announcementDate: false,
          adjustment: 'UNVERIFIED' as const,
          reproducible: false,
        },
        componentErrors,
      },
      asOf: toIsoDate(run.endDate),
      sourceModels: backtestSourceModels(input.sections),
      warnings: [
        {
          code: 'BACKTEST_BIAS_UNVERIFIED',
          message: '历史回测的 universe、公告可得日和复权口径尚未完成点时复现验证，禁止据此下强结论',
          affectedFields: ['metrics', 'equity', 'biasFlags'],
        },
        ...(!terminal
          ? [
              {
                code: 'BACKTEST_NOT_TERMINAL',
                message: '回测尚未进入终态，指标和净值可能继续变化',
                affectedFields: ['runStatus', 'metrics', 'equity'],
              },
            ]
          : []),
        ...(attributionRequested
          ? [
              {
                code: 'ATTRIBUTION_NOT_AVAILABLE',
                message: '当前回测未持久化可复现归因结果',
                affectedFields: ['attribution'],
              },
            ]
          : []),
      ],
      truncated: equityRows.length > equityPoints.length,
    }
  }

  private async loadTradesSummary(runId: string) {
    const [aggregate, bySide, symbols] = await Promise.all([
      this.prisma.backtestTrade.aggregate({
        where: { runId },
        _count: true,
        _sum: { amount: true, commission: true, stampDuty: true, slippageCost: true },
      }),
      this.prisma.backtestTrade.groupBy({
        by: ['side'],
        where: { runId },
        orderBy: { side: 'asc' },
        _count: true,
        _sum: { amount: true },
      }),
      this.prisma.backtestTrade.findMany({
        where: { runId },
        distinct: ['tsCode'],
        select: { tsCode: true },
      }),
    ])
    return {
      tradeCount: aggregate._count,
      symbolCount: symbols.length,
      totalAmount: nullableNumber(aggregate._sum.amount),
      totalCommission: nullableNumber(aggregate._sum.commission),
      totalStampDuty: nullableNumber(aggregate._sum.stampDuty),
      totalSlippageCost: nullableNumber(aggregate._sum.slippageCost),
      bySide: bySide.map((row) => ({ side: row.side, count: row._count, amount: nullableNumber(row._sum.amount) })),
      currency: 'CNY' as const,
    }
  }
}

function evenlySample<T>(rows: T[], maximum: number): T[] {
  if (rows.length <= maximum) return rows
  const indexes = Array.from({ length: maximum }, (_, index) => Math.round((index * (rows.length - 1)) / (maximum - 1)))
  return indexes.map((index) => rows[index])
}

function backtestSourceModels(sections: BacktestResultSection[]): string[] {
  const models = new Set<string>(['BacktestRun'])
  if (sections.includes('EQUITY')) models.add('BacktestDailyNav')
  if (sections.includes('TRADES_SUMMARY')) models.add('BacktestTrade')
  return [...models]
}

function stringArrayOrNull(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : null
}

function nullableNumber(value: { toString(): string } | number | null): number | null {
  if (value == null) return null
  return finiteOrNull(Number(value))
}

function finiteOrNull(value: number | null): number | null {
  return value != null && Number.isFinite(value) ? value : null
}

function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10)
}
