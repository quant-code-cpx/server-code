import { Injectable } from '@nestjs/common'
import {
  computeValuationPercentile,
  VALUATION_PERCENTILE_ALGORITHM_VERSION,
  type ValuationPercentileMethod,
  type ValuationWinsorizePolicy,
} from 'src/apps/agent/quant/valuation-percentile'
import { PrismaService } from 'src/shared/prisma.service'

export const VALUATION_METRICS = ['PE_TTM', 'PB', 'PS_TTM', 'DV_TTM'] as const
export type ValuationMetric = (typeof VALUATION_METRICS)[number]

export interface ValuationToolInput {
  tsCode: string
  metric: ValuationMetric
  startDate: string
  endDate: string
  asOfDate?: string
  percentileMethod: ValuationPercentileMethod
  excludeNonPositive: boolean
  winsorize: ValuationWinsorizePolicy
  minimumSamples: number
}

export class ValuationToolInvalidArgumentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = ValuationToolInvalidArgumentError.name
  }
}

@Injectable()
export class ValuationToolFacade {
  constructor(private readonly prisma: PrismaService) {}

  async percentile(input: ValuationToolInput) {
    const startDate = parseIsoDate(input.startDate)
    const endDate = parseIsoDate(input.endDate)
    const requestedAsOfDate = input.asOfDate ? parseIsoDate(input.asOfDate) : endDate
    const effectiveEndDate = requestedAsOfDate < endDate ? requestedAsOfDate : endDate
    if (startDate > effectiveEndDate) throw new ValuationToolInvalidArgumentError('startDate 不能晚于有效结束日期')
    if (startDate < subtractUtcYears(effectiveEndDate, 10)) {
      throw new ValuationToolInvalidArgumentError('估值查询窗口不能超过十年')
    }

    const rows = await this.prisma.dailyBasic.findMany({
      where: { tsCode: input.tsCode, tradeDate: { gte: startDate, lte: effectiveEndDate } },
      orderBy: { tradeDate: 'asc' },
      select: { tradeDate: true, peTtm: true, pb: true, psTtm: true, dvTtm: true },
    })
    const result = computeValuationPercentile(
      rows.map((row) => ({ date: toIsoDate(row.tradeDate), value: metricValue(row, input.metric) })),
      {
        percentileMethod: input.percentileMethod,
        excludeNonPositive: input.excludeNonPositive,
        winsorize: input.winsorize,
        minimumSamples: input.minimumSamples,
      },
      VALUATION_PERCENTILE_ALGORITHM_VERSION,
    )

    return {
      data: {
        tsCode: input.tsCode,
        metric: input.metric,
        unit: input.metric === 'DV_TTM' ? ('PERCENT' as const) : ('RATIO' as const),
        requestedWindow: { startDate: input.startDate, endDate: input.endDate },
        requestedAsOfDate: input.asOfDate ?? null,
        effectiveEndDate: toIsoDate(effectiveEndDate),
        ...result,
      },
      asOf: result.dataDate,
      sourceModels: ['DailyBasic'],
    }
  }
}

function metricValue(
  row: { peTtm: number | null; pb: number | null; psTtm: number | null; dvTtm: number | null },
  metric: ValuationMetric,
): number | null {
  if (metric === 'PE_TTM') return row.peTtm
  if (metric === 'PB') return row.pb
  if (metric === 'PS_TTM') return row.psTtm
  return row.dvTtm
}

function parseIsoDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`)
}

function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10)
}

function subtractUtcYears(value: Date, years: number): Date {
  const result = new Date(value)
  result.setUTCFullYear(result.getUTCFullYear() - years)
  return result
}
