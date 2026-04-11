import { Injectable } from '@nestjs/common'
import { PrismaService } from 'src/shared/prisma.service'
import type {
  AdjustmentFactorData,
  DailyBarData,
  IMarketDataProvider,
  LimitPriceData,
  SuspendInfoData,
} from './market-data-provider.interface'

/**
 * Tushare (Prisma DB) 实现的市场数据供应商
 *
 * 从 PostgreSQL 中读取由 Tushare Sync 入库的历史行情数据。
 * 此为 IMarketDataProvider 的默认实现，日后新增实时行情 Provider
 * 时只需再注册一个实现即可，消费端无需任何改动。
 */
@Injectable()
export class TushareMarketDataProvider implements IMarketDataProvider {
  readonly providerId = 'tushare-prisma'

  constructor(private readonly prisma: PrismaService) {}

  async getTradingDays(startDate: Date, endDate: Date): Promise<Date[]> {
    const rows = await this.prisma.tradeCal.findMany({
      where: {
        exchange: 'SSE',
        calDate: { gte: startDate, lte: endDate },
        isOpen: '1',
      },
      orderBy: { calDate: 'asc' },
      select: { calDate: true },
    })
    return rows.map((r) => r.calDate)
  }

  async getDailyBars(
    tsCodes: string[],
    startDate: Date,
    endDate: Date,
  ): Promise<DailyBarData[]> {
    if (tsCodes.length === 0) return []

    const rows = await this.prisma.daily.findMany({
      where: {
        tsCode: { in: tsCodes },
        tradeDate: { gte: startDate, lte: endDate },
      },
      select: {
        tsCode: true,
        tradeDate: true,
        open: true,
        high: true,
        low: true,
        close: true,
        preClose: true,
        vol: true,
        amount: true,
      },
    })

    return rows.map((r) => ({
      tsCode: r.tsCode,
      tradeDate: r.tradeDate,
      open: r.open !== null ? Number(r.open) : null,
      high: r.high !== null ? Number(r.high) : null,
      low: r.low !== null ? Number(r.low) : null,
      close: r.close !== null ? Number(r.close) : null,
      preClose: r.preClose !== null ? Number(r.preClose) : null,
      vol: r.vol !== null ? Number(r.vol) : null,
      amount: r.amount !== null ? Number(r.amount) : null,
    }))
  }

  async getAdjustmentFactors(
    tsCodes: string[],
    startDate: Date,
    endDate: Date,
  ): Promise<AdjustmentFactorData[]> {
    if (tsCodes.length === 0) return []

    const rows = await this.prisma.adjFactor.findMany({
      where: {
        tsCode: { in: tsCodes },
        tradeDate: { gte: startDate, lte: endDate },
      },
      select: { tsCode: true, tradeDate: true, adjFactor: true },
    })

    return rows.map((r) => ({
      tsCode: r.tsCode,
      tradeDate: r.tradeDate,
      adjFactor: r.adjFactor !== null ? Number(r.adjFactor) : 1,
    }))
  }

  /** Convert Date to YYYYMMDD string (for tables that store tradeDate as string) */
  private toYYYYMMDD(date: Date): string {
    return date.toISOString().slice(0, 10).replace(/-/g, '')
  }

  async getLimitPrices(
    tsCodes: string[],
    startDate: Date,
    endDate: Date,
  ): Promise<LimitPriceData[]> {
    if (tsCodes.length === 0) return []

    const startStr = this.toYYYYMMDD(startDate)
    const endStr = this.toYYYYMMDD(endDate)

    const rows = await this.prisma.stkLimit.findMany({
      where: {
        tsCode: { in: tsCodes },
        tradeDate: { gte: startStr, lte: endStr },
      },
      select: { tsCode: true, tradeDate: true, upLimit: true, downLimit: true },
    })

    return rows.map((r) => ({
      tsCode: r.tsCode,
      tradeDate: r.tradeDate,
      upLimit: r.upLimit !== null ? Number(r.upLimit) : null,
      downLimit: r.downLimit !== null ? Number(r.downLimit) : null,
    }))
  }

  async getSuspendData(
    tsCodes: string[],
    startDate: Date,
    endDate: Date,
  ): Promise<SuspendInfoData[]> {
    if (tsCodes.length === 0) return []

    const startStr = this.toYYYYMMDD(startDate)
    const endStr = this.toYYYYMMDD(endDate)

    const rows = await this.prisma.suspendD.findMany({
      where: {
        tsCode: { in: tsCodes },
        tradeDate: { gte: startStr, lte: endStr },
      },
      select: { tsCode: true, tradeDate: true, suspendTiming: true },
    })

    return rows.map((r) => ({
      tsCode: r.tsCode,
      tradeDate: r.tradeDate,
      suspendTiming: r.suspendTiming ?? null,
    }))
  }
}
