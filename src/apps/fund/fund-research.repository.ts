import { Injectable } from '@nestjs/common'
import { PrismaService } from 'src/shared/prisma.service'

@Injectable()
export class FundResearchRepository {
  constructor(private readonly prisma: PrismaService) {}

  findBasic(fundCode: string) {
    return this.prisma.fundBasic.findUnique({ where: { tsCode: fundCode } })
  }

  findNavRange(fundCode: string, startDate: Date, endDate: Date, requestedAsOf: Date | null) {
    return this.prisma.fundNav.findMany({
      where: {
        tsCode: fundCode,
        navDate: { gte: startDate, lte: endDate },
        ...(requestedAsOf ? { annDate: { lte: requestedAsOf } } : {}),
      },
      orderBy: { navDate: 'asc' },
      take: 4_000,
    })
  }

  findPriceRange(fundCode: string, startDate: Date, endDate: Date) {
    return this.prisma.fundDaily.findMany({
      where: { tsCode: fundCode, tradeDate: { gte: startDate, lte: endDate } },
      orderBy: { tradeDate: 'asc' },
      take: 4_000,
    })
  }

  findShareRange(fundCode: string, startDate: Date, endDate: Date) {
    return this.prisma.fundShare.findMany({
      where: { tsCode: fundCode, tradeDate: { gte: startDate, lte: endDate } },
      orderBy: { tradeDate: 'asc' },
      take: 4_000,
    })
  }

  findPreviousShare(fundCode: string, startDate: Date) {
    return this.prisma.fundShare.findFirst({
      where: { tsCode: fundCode, tradeDate: { lt: startDate } },
      orderBy: { tradeDate: 'desc' },
    })
  }

  findHoldings(fundCode: string, asOfDate: Date, periods: number) {
    return this.prisma.fundPortfolio.findMany({
      where: { tsCode: fundCode, annDate: { lte: asOfDate } },
      orderBy: [{ endDate: 'desc' }, { mkv: 'desc' }, { symbol: 'asc' }],
      take: periods * 50,
    })
  }

  async findBounds(fundCode: string) {
    const [navStart, navEnd, priceStart, priceEnd, shareStart, shareEnd, holdingsStart, holdingsEnd] =
      await Promise.all([
        this.prisma.fundNav.findFirst({
          where: { tsCode: fundCode },
          orderBy: { navDate: 'asc' },
          select: { navDate: true },
        }),
        this.prisma.fundNav.findFirst({
          where: { tsCode: fundCode },
          orderBy: { navDate: 'desc' },
          select: { navDate: true },
        }),
        this.prisma.fundDaily.findFirst({
          where: { tsCode: fundCode },
          orderBy: { tradeDate: 'asc' },
          select: { tradeDate: true },
        }),
        this.prisma.fundDaily.findFirst({
          where: { tsCode: fundCode },
          orderBy: { tradeDate: 'desc' },
          select: { tradeDate: true },
        }),
        this.prisma.fundShare.findFirst({
          where: { tsCode: fundCode },
          orderBy: { tradeDate: 'asc' },
          select: { tradeDate: true },
        }),
        this.prisma.fundShare.findFirst({
          where: { tsCode: fundCode },
          orderBy: { tradeDate: 'desc' },
          select: { tradeDate: true },
        }),
        this.prisma.fundPortfolio.findFirst({
          where: { tsCode: fundCode },
          orderBy: { endDate: 'asc' },
          select: { endDate: true },
        }),
        this.prisma.fundPortfolio.findFirst({
          where: { tsCode: fundCode },
          orderBy: { annDate: 'desc' },
          select: { annDate: true },
        }),
      ])
    return { navStart, navEnd, priceStart, priceEnd, shareStart, shareEnd, holdingsStart, holdingsEnd }
  }
}
