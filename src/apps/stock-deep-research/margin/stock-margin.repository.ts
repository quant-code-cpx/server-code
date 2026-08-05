import { Injectable } from '@nestjs/common'
import { PrismaService } from 'src/shared/prisma.service'

@Injectable()
export class StockMarginRepository {
  constructor(private readonly prisma: PrismaService) {}

  findStock(tsCode: string) {
    return this.prisma.stockBasic.findUnique({ where: { tsCode }, select: { tsCode: true } })
  }

  findCoverageStart(tsCode: string) {
    return this.prisma.marginDetail.findFirst({
      where: { tsCode },
      orderBy: { tradeDate: 'asc' },
      select: { tradeDate: true },
    })
  }

  findLatest(tsCode: string, asOfDate: Date | null) {
    return this.prisma.marginDetail.findFirst({
      where: { tsCode, ...(asOfDate ? { tradeDate: { lte: asOfDate } } : {}) },
      orderBy: { tradeDate: 'desc' },
      select: { tradeDate: true },
    })
  }

  findHistory(tsCode: string, through: Date, take: number) {
    return this.prisma.marginDetail.findMany({
      where: { tsCode, tradeDate: { lte: through } },
      orderBy: { tradeDate: 'desc' },
      take,
    })
  }

  findStockPriceDataThrough(tsCode: string, asOfDate: Date | null) {
    return this.prisma.daily.findFirst({
      where: { tsCode, ...(asOfDate ? { tradeDate: { lte: asOfDate } } : {}) },
      orderBy: { tradeDate: 'desc' },
      select: { tradeDate: true },
    })
  }

  countStockTradingDaysAfter(tsCode: string, after: Date, through: Date) {
    return this.prisma.daily.count({ where: { tsCode, tradeDate: { gt: after, lte: through } } })
  }

  findPriceRows(tsCode: string, tradeDates: Date[]) {
    return Promise.all([
      this.prisma.daily.findMany({
        where: { tsCode, tradeDate: { in: tradeDates } },
        select: { tradeDate: true, close: true },
      }),
      this.prisma.adjFactor.findMany({
        where: { tsCode, tradeDate: { in: tradeDates } },
        select: { tradeDate: true, adjFactor: true },
      }),
    ])
  }
}
