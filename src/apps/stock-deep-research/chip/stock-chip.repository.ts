import { Injectable } from '@nestjs/common'
import { PrismaService } from 'src/shared/prisma.service'

@Injectable()
export class StockChipRepository {
  constructor(private readonly prisma: PrismaService) {}

  findStock(tsCode: string) {
    return this.prisma.stockBasic.findUnique({ where: { tsCode }, select: { tsCode: true } })
  }

  findCoverageStart(tsCode: string) {
    return this.prisma.cyqPerf.findFirst({
      where: { tsCode },
      orderBy: { tradeDate: 'asc' },
      select: { tradeDate: true },
    })
  }

  findLatestPerformance(tsCode: string, asOfDate: Date | null) {
    return this.prisma.cyqPerf.findFirst({
      where: { tsCode, ...(asOfDate ? { tradeDate: { lte: asOfDate } } : {}) },
      orderBy: { tradeDate: 'desc' },
    })
  }

  findPerformanceHistory(tsCode: string, through: Date, take: number) {
    return this.prisma.cyqPerf.findMany({
      where: { tsCode, tradeDate: { lte: through } },
      orderBy: { tradeDate: 'desc' },
      take,
      select: { tradeDate: true, cost50pct: true, weightAvg: true, winnerRate: true },
    })
  }

  findDistribution(tsCode: string, tradeDate: Date) {
    return this.prisma.cyqChips.findMany({
      where: { tsCode, tradeDate },
      orderBy: { price: 'asc' },
      select: { price: true, percent: true },
    })
  }

  findClose(tsCode: string, tradeDate: Date) {
    return this.prisma.daily.findUnique({
      where: { tsCode_tradeDate: { tsCode, tradeDate } },
      select: { close: true },
    })
  }

  findEstimationBars(tsCode: string, through: Date, take = 120) {
    return this.prisma.daily.findMany({
      where: { tsCode, tradeDate: { lte: through } },
      orderBy: { tradeDate: 'desc' },
      take,
      select: {
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
  }
}
