import { Injectable } from '@nestjs/common'
import { PrismaService } from 'src/shared/prisma.service'
import { ValidateBacktestRunDto } from '../dto/backtest-validate.dto'
import { ValidateBacktestRunResponseDto } from '../dto/backtest-response.dto'

@Injectable()
export class BacktestDataReadinessService {
  constructor(private readonly prisma: PrismaService) {}

  async checkReadiness(dto: ValidateBacktestRunDto): Promise<ValidateBacktestRunResponseDto> {
    const startDate = this.parseDate(dto.startDate)
    const endDate = this.parseDate(dto.endDate)
    const startStr = dto.startDate
    const endStr = dto.endDate
    const compactStartStr = startStr.replace(/-/g, '')
    const compactEndStr = endStr.replace(/-/g, '')
    const benchmarkCode = dto.benchmarkTsCode ?? '000300.SH'
    const needsIndexWeight = dto.universe && !['ALL_A', 'CUSTOM'].includes(dto.universe)

    const warnings: string[] = []
    const errors: string[] = []

    const [
      tradeCalCount,
      dailyRow,
      adjFactorRow,
      indexDailyRow,
      stkLimitRow,
      suspendRow,
      indexWeightRow,
      earliestRow,
      latestRow,
      universeCountRows,
    ] = await Promise.all([
      this.prisma.tradeCal.count({
        where: { exchange: 'SSE', calDate: { gte: startDate, lte: endDate }, isOpen: '1' },
      }),
      this.prisma.daily.findFirst({
        where: { tradeDate: { gte: startDate, lte: endDate } },
        select: { tsCode: true },
      }),
      this.prisma.adjFactor.findFirst({
        where: { tradeDate: { gte: startDate, lte: endDate } },
        select: { tsCode: true },
      }),
      this.prisma.indexDaily.findFirst({
        where: { tsCode: benchmarkCode, tradeDate: { gte: startDate, lte: endDate } },
        select: { tsCode: true },
      }),
      this.prisma.stkLimit.findFirst({
        where: { tradeDate: { gte: startStr, lte: endStr } },
        select: { tsCode: true },
      }),
      this.prisma.suspendD.findFirst({
        where: { tradeDate: { gte: startStr, lte: endStr } },
        select: { tsCode: true },
      }),
      needsIndexWeight
        ? this.prisma.indexWeight.findFirst({
            where: { tradeDate: { gte: compactStartStr, lte: compactEndStr } },
            select: { indexCode: true },
          })
        : Promise.resolve({ indexCode: null }),
      this.prisma.daily.findFirst({
        orderBy: { tradeDate: 'asc' },
        select: { tradeDate: true },
      }),
      this.prisma.daily.findFirst({
        orderBy: { tradeDate: 'desc' },
        select: { tradeDate: true },
      }),
      this.prisma.$queryRaw<{ count: bigint | number | string }[]>`
        SELECT COUNT(DISTINCT ts_code)::bigint AS count
        FROM stock_daily_prices
        WHERE trade_date >= ${startDate} AND trade_date <= ${endDate}
      `,
    ])

    const hasTradeCal = tradeCalCount > 0
    const hasDaily = Boolean(dailyRow)
    const hasAdjFactor = Boolean(adjFactorRow)
    const hasIndexDaily = Boolean(indexDailyRow)
    const hasStkLimit = Boolean(stkLimitRow)
    const hasSuspendD = Boolean(suspendRow)
    const hasIndexWeight = needsIndexWeight ? Boolean(indexWeightRow) : true
    const estimatedUniverseSize = hasDaily ? Number(universeCountRows[0]?.count ?? 0) : null

    // Validation logic
    if (!hasTradeCal) errors.push('交易日历数据不完整，无法确定交易日')
    if (!hasDaily) errors.push('股票日线数据在回测区间内缺失')
    if (!hasAdjFactor) errors.push('复权因子数据在回测区间内缺失')
    if (!hasIndexDaily) errors.push(`基准指数 ${benchmarkCode} 日线数据在回测区间内缺失`)

    if (dto.enableTradeConstraints !== false) {
      if (!hasStkLimit) warnings.push('涨跌停价格数据缺失，回测将无法模拟涨跌停约束，结果可能偏乐观')
      if (!hasSuspendD) warnings.push('停牌数据缺失，回测将假设所有股票均可交易，结果可能偏乐观')
    }

    if (needsIndexWeight && !hasIndexWeight) {
      errors.push(`指数成分权重数据缺失，无法使用 ${dto.universe} 作为股票池（会产生幸存者偏差）`)
    }

    const isValid = errors.length === 0

    return {
      isValid,
      warnings,
      errors,
      dataReadiness: {
        hasDaily,
        hasAdjFactor,
        hasTradeCal,
        hasIndexDaily,
        hasStkLimit,
        hasSuspendD,
        hasIndexWeight,
      },
      stats: {
        tradingDays: tradeCalCount,
        estimatedUniverseSize,
        earliestAvailableDate: earliestRow ? earliestRow.tradeDate.toISOString().slice(0, 10) : null,
        latestAvailableDate: latestRow ? latestRow.tradeDate.toISOString().slice(0, 10) : null,
      },
    }
  }

  private parseDate(dateStr: string): Date {
    return new Date(`${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`)
  }
}
