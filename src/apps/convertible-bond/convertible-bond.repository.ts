import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from 'src/shared/prisma.service'

export interface ConvertibleBondSearchQuery {
  stockCode?: string
  status: 'LISTED' | 'DELISTED' | 'ALL'
  ratings?: string[]
  asOfDate: Date
  skip: number
  take: number
}

@Injectable()
export class ConvertibleBondRepository {
  constructor(private readonly prisma: PrismaService) {}

  async search(query: ConvertibleBondSearchQuery) {
    const lifecycle: Prisma.CbBasicWhereInput =
      query.status === 'LISTED'
        ? {
            AND: [
              { OR: [{ listDate: null }, { listDate: { lte: query.asOfDate } }] },
              { OR: [{ delistDate: null }, { delistDate: { gte: query.asOfDate } }] },
            ],
          }
        : query.status === 'DELISTED'
          ? { delistDate: { lt: query.asOfDate } }
          : {}
    const where: Prisma.CbBasicWhereInput = {
      ...lifecycle,
      ...(query.stockCode ? { stkCode: query.stockCode } : {}),
      ...(query.ratings?.length
        ? { OR: [{ newestRating: { in: query.ratings } }, { issueRating: { in: query.ratings } }] }
        : {}),
    }
    const [total, items] = await Promise.all([
      this.prisma.cbBasic.count({ where }),
      this.prisma.cbBasic.findMany({
        where,
        orderBy: [{ listDate: 'desc' }, { tsCode: 'asc' }],
        skip: query.skip,
        take: query.take,
      }),
    ])
    return { total, items }
  }

  findBasic(bondCode: string) {
    return this.prisma.cbBasic.findUnique({ where: { tsCode: bondCode } })
  }

  async findDataThrough() {
    const row = await this.prisma.cbDaily.findFirst({ orderBy: { tradeDate: 'desc' }, select: { tradeDate: true } })
    return row?.tradeDate ?? null
  }

  findHistory(bondCode: string, startDate: Date, endDate: Date) {
    return this.prisma.cbDaily.findMany({
      where: { tsCode: bondCode, tradeDate: { gte: startDate, lte: endDate } },
      orderBy: { tradeDate: 'asc' },
      take: 3_000,
    })
  }

  async findHistoryBounds(bondCode: string) {
    const [first, last] = await Promise.all([
      this.prisma.cbDaily.findFirst({
        where: { tsCode: bondCode },
        orderBy: { tradeDate: 'asc' },
        select: { tradeDate: true },
      }),
      this.prisma.cbDaily.findFirst({
        where: { tsCode: bondCode },
        orderBy: { tradeDate: 'desc' },
        select: { tradeDate: true },
      }),
    ])
    return { first: first?.tradeDate ?? null, last: last?.tradeDate ?? null }
  }
}
