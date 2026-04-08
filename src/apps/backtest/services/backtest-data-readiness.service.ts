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

    const warnings: string[] = []
    const errors: string[] = []

    // Check trading calendar
    const tradeCalCount = await this.prisma.tradeCal.count({
      where: { exchange: 'SSE', calDate: { gte: startDate, lte: endDate }, isOpen: '1' },
    })
    const hasTradeCal = tradeCalCount > 0

    // Check daily prices
    const dailyCount = await this.prisma.daily.count({
      where: { tradeDate: { gte: startDate, lte: endDate } },
    })
    const hasDaily = dailyCount > 0

    // Check adj factor
    const adjCount = await this.prisma.adjFactor.count({
      where: { tradeDate: { gte: startDate, lte: endDate } },
    })
    const hasAdjFactor = adjCount > 0

    // Check index daily (benchmark)
    const benchmarkCode = dto.benchmarkTsCode ?? '000300.SH'
    const indexDailyCount = await this.prisma.indexDaily.count({
      where: { tsCode: benchmarkCode, tradeDate: { gte: startDate, lte: endDate } },
    })
    const hasIndexDaily = indexDailyCount > 0

    // Check stk_limit
    const stkLimitCount = await this.prisma.stkLimit.count({
      where: {
        tradeDate: { gte: startStr, lte: endStr },
      },
    })
    const hasStkLimit = stkLimitCount > 0

    // Check suspend
    const suspendCount = await this.prisma.suspendD.count({
      where: {
        tradeDate: { gte: startStr, lte: endStr },
      },
    })
    const hasSuspendD = suspendCount > 0

    // Check index weight (only needed for index universe)
    const needsIndexWeight = dto.universe && !['ALL_A', 'CUSTOM'].includes(dto.universe)
    let hasIndexWeight = true
    if (needsIndexWeight) {
      const iwCount = await this.prisma.indexWeight.count({
        where: { tradeDate: { gte: startStr.replace(/-/g, ''), lte: endStr.replace(/-/g, '') } },
      })
      hasIndexWeight = iwCount > 0
    }

    // Get earliest/latest available dates
    const earliestRow = await this.prisma.daily.findFirst({
      orderBy: { tradeDate: 'asc' },
      select: { tradeDate: true },
    })
    const latestRow = await this.prisma.daily.findFirst({
      orderBy: { tradeDate: 'desc' },
      select: { tradeDate: true },
    })

    // Estimate universe size
    let estimatedUniverseSize: number | null = null
    if (hasDaily) {
      estimatedUniverseSize = await this.prisma.daily
        .groupBy({
          by: ['tsCode'],
          where: { tradeDate: { gte: startDate, lte: endDate } },
        })
        .then((rows) => rows.length)
    }

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
