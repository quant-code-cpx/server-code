import { Injectable } from '@nestjs/common'
import { PrismaService } from 'src/shared/prisma.service'

@Injectable()
export class StockShareholderRepository {
  constructor(private readonly prisma: PrismaService) {}

  findStock(tsCode: string) {
    return this.prisma.stockBasic.findUnique({ where: { tsCode }, select: { tsCode: true } })
  }

  findHolderCounts(tsCode: string, asOfDate: Date, take: number) {
    return this.prisma.stkHolderNumber.findMany({
      where: { tsCode, annDate: { lte: asOfDate } },
      orderBy: [{ endDate: 'desc' }, { annDate: 'desc' }],
      take,
    })
  }

  findTop10(tsCode: string, asOfDate: Date, take: number) {
    return this.prisma.top10Holders.findMany({
      where: { tsCode, annDate: { not: null, lte: asOfDate } },
      orderBy: [{ endDate: 'desc' }, { annDate: 'desc' }, { holdRatio: 'desc' }],
      take,
    })
  }

  findTop10Float(tsCode: string, asOfDate: Date, take: number) {
    return this.prisma.top10FloatHolders.findMany({
      where: { tsCode, annDate: { not: null, lte: asOfDate } },
      orderBy: [{ endDate: 'desc' }, { annDate: 'desc' }, { holdRatio: 'desc' }],
      take,
    })
  }

  findTrades(tsCode: string, asOfDate: Date, take: number) {
    return this.prisma.stkHolderTrade.findMany({
      where: { tsCode, annDate: { lte: asOfDate } },
      orderBy: [{ annDate: 'desc' }, { id: 'desc' }],
      take,
    })
  }

  findPledges(tsCode: string, asOfDate: Date, take: number) {
    return this.prisma.pledgeStat.findMany({
      where: { tsCode, endDate: { lte: asOfDate } },
      orderBy: { endDate: 'desc' },
      take,
    })
  }
}
