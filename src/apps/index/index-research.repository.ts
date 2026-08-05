import { Injectable } from '@nestjs/common'
import { PrismaService } from 'src/shared/prisma.service'

@Injectable()
export class IndexResearchRepository {
  constructor(private readonly prisma: PrismaService) {}

  findAny(indexCode: string) {
    return this.prisma.indexDaily.findFirst({ where: { tsCode: indexCode }, select: { tsCode: true } })
  }

  findDailyBounds(indexCode: string, asOfDate?: Date) {
    const where = { tsCode: indexCode, ...(asOfDate ? { tradeDate: { lte: asOfDate } } : {}) }
    return Promise.all([
      this.prisma.indexDaily.findFirst({ where, orderBy: { tradeDate: 'asc' }, select: { tradeDate: true } }),
      this.prisma.indexDaily.findFirst({ where, orderBy: { tradeDate: 'desc' }, select: { tradeDate: true } }),
    ])
  }

  findLatestDaily(indexCode: string, asOfDate: Date) {
    return this.prisma.indexDaily.findFirst({
      where: { tsCode: indexCode, tradeDate: { lte: asOfDate } },
      orderBy: { tradeDate: 'desc' },
    })
  }

  findDailyRange(indexCode: string, startDate: Date, endDate: Date) {
    return this.prisma.indexDaily.findMany({
      where: { tsCode: indexCode, tradeDate: { gte: startDate, lte: endDate } },
      orderBy: { tradeDate: 'asc' },
      take: 2_500,
    })
  }

  findValuationBounds(indexCode: string, asOfDate?: Date) {
    const where = { tsCode: indexCode, ...(asOfDate ? { tradeDate: { lte: asOfDate } } : {}) }
    return Promise.all([
      this.prisma.indexDailyBasic.findFirst({ where, orderBy: { tradeDate: 'asc' }, select: { tradeDate: true } }),
      this.prisma.indexDailyBasic.findFirst({ where, orderBy: { tradeDate: 'desc' }, select: { tradeDate: true } }),
    ])
  }

  findValuationRange(indexCode: string, startDate: Date, endDate: Date) {
    return this.prisma.indexDailyBasic.findMany({
      where: { tsCode: indexCode, tradeDate: { gte: startDate, lte: endDate } },
      orderBy: { tradeDate: 'asc' },
      take: 2_500,
    })
  }

  async findConstituents(indexCode: string, asOfCompactDate: string, limit: number) {
    const latest = await this.prisma.indexWeight.findFirst({
      where: { indexCode, tradeDate: { lte: asOfCompactDate } },
      orderBy: { tradeDate: 'desc' },
      select: { tradeDate: true },
    })
    if (!latest) return null
    const [total, weights] = await Promise.all([
      this.prisma.indexWeight.count({ where: { indexCode, tradeDate: latest.tradeDate } }),
      this.prisma.indexWeight.findMany({
        where: { indexCode, tradeDate: latest.tradeDate },
        orderBy: [{ weight: 'desc' }, { conCode: 'asc' }],
        take: limit,
      }),
    ])
    const stocks = await this.prisma.stockBasic.findMany({
      where: { tsCode: { in: weights.map((weight) => weight.conCode) } },
      select: { tsCode: true, name: true },
    })
    const names = new Map(stocks.map((stock) => [stock.tsCode, stock.name]))
    return {
      weightDate: latest.tradeDate,
      total,
      items: weights.map((weight) => ({
        tsCode: weight.conCode,
        name: names.get(weight.conCode) ?? null,
        weightPct: weight.weight === null ? null : Number(weight.weight),
      })),
    }
  }
}
