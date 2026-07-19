import { Inject, Injectable } from '@nestjs/common'
import { AgentToolsConfig, type IAgentToolsConfig } from 'src/config/agent-tools.config'
import { PrismaService } from 'src/shared/prisma.service'
import { FinancialToolInvalidArgumentError } from './financial-tool.facade'

export interface MoneyflowToolInput {
  tsCode: string
  startDate: string
  endDate: string
  includeOrderBuckets: boolean
  limit: number
}

@Injectable()
export class MoneyflowToolFacade {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(AgentToolsConfig.KEY) private readonly config: IAgentToolsConfig,
  ) {}

  async getDaily(input: MoneyflowToolInput) {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > this.config.moneyflowMaxDays) {
      throw new FinancialToolInvalidArgumentError(`资金流天数必须是 1-${this.config.moneyflowMaxDays} 的整数`)
    }
    const startDate = parseIsoDate(input.startDate, 'startDate')
    const endDate = parseIsoDate(input.endDate, 'endDate')
    if (startDate.getTime() > endDate.getTime()) {
      throw new FinancialToolInvalidArgumentError('startDate 不能晚于 endDate')
    }

    const records = await this.prisma.moneyflow.findMany({
      where: { tsCode: input.tsCode, tradeDate: { gte: startDate, lte: endDate } },
      orderBy: { tradeDate: 'desc' },
      take: input.limit + 1,
      select: {
        tradeDate: true,
        buySmVol: true,
        buySmAmount: true,
        sellSmVol: true,
        sellSmAmount: true,
        buyMdVol: true,
        buyMdAmount: true,
        sellMdVol: true,
        sellMdAmount: true,
        buyLgVol: true,
        buyLgAmount: true,
        sellLgVol: true,
        sellLgAmount: true,
        buyElgVol: true,
        buyElgAmount: true,
        sellElgVol: true,
        sellElgAmount: true,
        netMfVol: true,
        netMfAmount: true,
      },
    })

    const truncated = records.length > input.limit
    const days = records
      .slice(0, input.limit)
      .sort((left, right) => left.tradeDate.getTime() - right.tradeDate.getTime())
      .map((row) => ({
        tradeDate: formatDate(row.tradeDate),
        netAmount: row.netMfAmount,
        netVolume: row.netMfVol,
        ...(input.includeOrderBuckets
          ? {
              orderBuckets: {
                small: bucket(row.buySmVol, row.buySmAmount, row.sellSmVol, row.sellSmAmount),
                medium: bucket(row.buyMdVol, row.buyMdAmount, row.sellMdVol, row.sellMdAmount),
                large: bucket(row.buyLgVol, row.buyLgAmount, row.sellLgVol, row.sellLgAmount),
                extraLarge: bucket(row.buyElgVol, row.buyElgAmount, row.sellElgVol, row.sellElgAmount),
              },
            }
          : {}),
      }))

    return {
      data: {
        tsCode: input.tsCode,
        startDate: input.startDate,
        endDate: input.endDate,
        includeOrderBuckets: input.includeOrderBuckets,
        units: {
          amount: 'CNY_10K' as const,
          volume: 'LOT' as const,
          netSign: 'POSITIVE_INFLOW' as const,
        },
        days,
      },
      truncated,
      asOf: days.at(-1)?.tradeDate ?? null,
      sourceModels: ['Moneyflow'],
    }
  }
}

function bucket(
  buyVolume: number | null,
  buyAmount: number | null,
  sellVolume: number | null,
  sellAmount: number | null,
) {
  return {
    buyVolume,
    buyAmount,
    sellVolume,
    sellAmount,
    netVolume: buyVolume !== null && sellVolume !== null ? buyVolume - sellVolume : null,
    netAmount: buyAmount !== null && sellAmount !== null ? Number((buyAmount - sellAmount).toPrecision(15)) : null,
  }
}

function parseIsoDate(value: string, label: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new FinancialToolInvalidArgumentError(`${label} 格式必须为 YYYY-MM-DD`)
  const parsed = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime()) || formatDate(parsed) !== value) {
    throw new FinancialToolInvalidArgumentError(`${label} 不是有效日历日期`)
  }
  return parsed
}

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10)
}
