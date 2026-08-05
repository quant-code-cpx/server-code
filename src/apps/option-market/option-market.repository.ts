import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from 'src/shared/prisma.service'

export interface OptionSearchQuery {
  nameQuery?: string
  exchange?: string
  callPut?: string
  maturityFrom?: Date
  maturityTo?: Date
  listedOnly: boolean
  asOfDate: Date
  skip: number
  take: number
}

@Injectable()
export class OptionMarketRepository {
  constructor(private readonly prisma: PrismaService) {}

  async search(query: OptionSearchQuery) {
    const where: Prisma.OptBasicWhereInput = {
      ...(query.nameQuery
        ? {
            OR: [
              { tsCode: { contains: query.nameQuery, mode: 'insensitive' } },
              { name: { contains: query.nameQuery, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(query.exchange ? { exchange: query.exchange } : {}),
      ...(query.callPut ? { callPut: query.callPut } : {}),
      ...(query.maturityFrom || query.maturityTo
        ? {
            maturityDate: {
              ...(query.maturityFrom ? { gte: query.maturityFrom } : {}),
              ...(query.maturityTo ? { lte: query.maturityTo } : {}),
            },
          }
        : {}),
      ...(query.listedOnly
        ? {
            AND: [
              { OR: [{ listDate: null }, { listDate: { lte: query.asOfDate } }] },
              {
                OR: [
                  { delistDate: { gte: query.asOfDate } },
                  { delistDate: null, maturityDate: { gte: query.asOfDate } },
                  { delistDate: null, maturityDate: null },
                ],
              },
            ],
          }
        : {}),
    }
    const [total, items] = await Promise.all([
      this.prisma.optBasic.count({ where }),
      this.prisma.optBasic.findMany({
        where,
        orderBy: [{ maturityDate: 'asc' }, { tsCode: 'asc' }],
        skip: query.skip,
        take: query.take,
      }),
    ])
    return { total, items }
  }

  findContract(optionCode: string) {
    return this.prisma.optBasic.findUnique({ where: { tsCode: optionCode } })
  }

  async findDataThrough() {
    const row = await this.prisma.optDaily.findFirst({ orderBy: { tradeDate: 'desc' }, select: { tradeDate: true } })
    return row?.tradeDate ?? null
  }

  findHistory(optionCode: string, startDate: Date, endDate: Date) {
    return this.prisma.optDaily.findMany({
      where: { tsCode: optionCode, tradeDate: { gte: startDate, lte: endDate } },
      orderBy: { tradeDate: 'asc' },
      take: 2_000,
    })
  }

  async findHistoryBounds(optionCode: string) {
    const [first, last] = await Promise.all([
      this.prisma.optDaily.findFirst({
        where: { tsCode: optionCode },
        orderBy: { tradeDate: 'asc' },
        select: { tradeDate: true },
      }),
      this.prisma.optDaily.findFirst({
        where: { tsCode: optionCode },
        orderBy: { tradeDate: 'desc' },
        select: { tradeDate: true },
      }),
    ])
    return { first: first?.tradeDate ?? null, last: last?.tradeDate ?? null }
  }
}
