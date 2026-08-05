import { Injectable } from '@nestjs/common'
import { PrismaService } from 'src/shared/prisma.service'
import { isoToCompactDate } from '../stock-deep-research.types'

export interface StockEventQuery {
  tsCode: string
  startDate: Date
  endDate: Date
  asOfDate: Date
}

@Injectable()
export class StockEventRepository {
  constructor(private readonly prisma: PrismaService) {}

  findStock(tsCode: string) {
    return this.prisma.stockBasic.findUnique({ where: { tsCode }, select: { tsCode: true } })
  }

  findForecasts(query: StockEventQuery) {
    return this.prisma.forecast.findMany({
      where: {
        tsCode: query.tsCode,
        annDate: { gte: query.startDate, lte: minDate(query.endDate, query.asOfDate) },
      },
    })
  }

  findDisclosures(query: StockEventQuery) {
    return this.prisma.disclosureDate.findMany({
      where: {
        tsCode: query.tsCode,
        OR: [
          { actualDate: { gte: query.startDate, lte: minDate(query.endDate, query.asOfDate) } },
          {
            preDate: { gte: query.startDate, lte: query.endDate },
            annDate: { not: null, lte: query.asOfDate },
          },
        ],
      },
    })
  }

  findDividends(query: StockEventQuery) {
    return this.prisma.dividend.findMany({
      where: {
        tsCode: query.tsCode,
        annDate: { not: null, lte: query.asOfDate },
        OR: [
          { exDate: { gte: query.startDate, lte: query.endDate } },
          { recordDate: { gte: query.startDate, lte: query.endDate } },
          { annDate: { gte: query.startDate, lte: query.endDate } },
        ],
      },
    })
  }

  findRepurchases(query: StockEventQuery) {
    return this.prisma.repurchase.findMany({
      where: {
        tsCode: query.tsCode,
        annDate: { lte: query.asOfDate },
        OR: [
          { endDate: { gte: query.startDate, lte: query.endDate } },
          { annDate: { gte: query.startDate, lte: query.endDate } },
        ],
      },
    })
  }

  findShareFloats(query: StockEventQuery) {
    const start = isoToCompactDate(query.startDate.toISOString().slice(0, 10))
    const end = isoToCompactDate(query.endDate.toISOString().slice(0, 10))
    const asOf = isoToCompactDate(query.asOfDate.toISOString().slice(0, 10))
    return this.prisma.shareFloat.findMany({
      where: {
        tsCode: query.tsCode,
        floatDate: { gte: start, lte: end },
        annDate: { not: null, lte: asOf },
      },
    })
  }

  findSuspensions(query: StockEventQuery) {
    return this.prisma.suspendD.findMany({
      where: {
        tsCode: query.tsCode,
        tradeDate: {
          gte: isoToCompactDate(query.startDate.toISOString().slice(0, 10)),
          lte: isoToCompactDate(minDate(query.endDate, query.asOfDate).toISOString().slice(0, 10)),
        },
      },
    })
  }

  findTopList(query: StockEventQuery) {
    return this.prisma.topList.findMany({
      where: {
        tsCode: query.tsCode,
        tradeDate: {
          gte: isoToCompactDate(query.startDate.toISOString().slice(0, 10)),
          lte: isoToCompactDate(minDate(query.endDate, query.asOfDate).toISOString().slice(0, 10)),
        },
      },
    })
  }

  findBlockTrades(query: StockEventQuery) {
    return this.prisma.blockTrade.findMany({
      where: {
        tsCode: query.tsCode,
        tradeDate: {
          gte: isoToCompactDate(query.startDate.toISOString().slice(0, 10)),
          lte: isoToCompactDate(minDate(query.endDate, query.asOfDate).toISOString().slice(0, 10)),
        },
      },
    })
  }
}

function minDate(left: Date, right: Date): Date {
  return left < right ? left : right
}
