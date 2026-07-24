import { Injectable } from '@nestjs/common'
import { PrismaService } from 'src/shared/prisma.service'
import { FactorRankingFactorName } from '../types/backtest-engine.types'

const FINANCIAL_FACTOR_COLUMNS: Partial<Record<FactorRankingFactorName, string>> = {
  roe: 'roe',
  roa: 'roa',
  revenue_yoy: 'revenue_yoy',
  netprofit_yoy: 'netprofit_yoy',
  grossprofit_margin: 'grossprofit_margin',
  netprofit_margin: 'netprofit_margin',
}

export interface PointInTimeFinancialValue {
  tsCode: string
  value: number
  endDate: Date
  announcementDate: Date
}

@Injectable()
export class PointInTimeFinancialService {
  constructor(private readonly prisma: PrismaService) {}

  async loadLatestVisibleMetric(
    factorName: FactorRankingFactorName,
    signalDate: Date,
    universe: string[],
  ): Promise<Map<string, PointInTimeFinancialValue>> {
    const column = FINANCIAL_FACTOR_COLUMNS[factorName]
    if (!column || universe.length === 0) return new Map()

    const signalDateString = signalDate.toISOString().slice(0, 10)
    const rows = await this.prisma.$queryRawUnsafe<
      Array<{
        ts_code: string
        value: number
        end_date: Date
        ann_date: Date
        update_flag: string | null
      }>
    >(
      `SELECT DISTINCT ON (fi.ts_code)
         fi.ts_code,
         fi.${column}::float AS value,
         fi.end_date,
         fi.ann_date,
         fi.update_flag
       FROM financial_indicator_snapshots fi
       WHERE fi.ts_code = ANY($1::text[])
         AND fi.ann_date IS NOT NULL
         AND fi.ann_date <= $2::date
         AND fi.${column} IS NOT NULL
       ORDER BY
         fi.ts_code,
         fi.end_date DESC,
         fi.ann_date DESC,
         (fi.update_flag = '1') DESC,
         fi.synced_at DESC`,
      universe,
      signalDateString,
    )

    return new Map(
      rows.map((row) => [
        row.ts_code,
        {
          tsCode: row.ts_code,
          value: Number(row.value),
          endDate: row.end_date,
          announcementDate: row.ann_date,
        },
      ]),
    )
  }
}
