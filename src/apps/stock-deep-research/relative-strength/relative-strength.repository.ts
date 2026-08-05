import { Injectable } from '@nestjs/common'
import { PrismaService } from 'src/shared/prisma.service'

@Injectable()
export class RelativeStrengthRepository {
  constructor(private readonly prisma: PrismaService) {}

  findStock(tsCode: string) {
    return this.prisma.stockBasic.findUnique({ where: { tsCode }, select: { tsCode: true } })
  }

  async findCoverage(tsCode: string, benchmarkCode: string) {
    const [stock, benchmark] = await Promise.all([
      this.prisma.daily.findFirst({ where: { tsCode }, orderBy: { tradeDate: 'asc' }, select: { tradeDate: true } }),
      this.prisma.indexDaily.findFirst({
        where: { tsCode: benchmarkCode },
        orderBy: { tradeDate: 'asc' },
        select: { tradeDate: true },
      }),
    ])
    return { stock: stock?.tradeDate ?? null, benchmark: benchmark?.tradeDate ?? null }
  }

  async findRows(tsCode: string, benchmarkCode: string, asOfDate: Date | null, take: number) {
    const where = asOfDate ? { tradeDate: { lte: asOfDate } } : {}
    const [stock, benchmark] = await Promise.all([
      this.prisma.daily.findMany({
        where: { tsCode, ...where },
        orderBy: { tradeDate: 'desc' },
        take,
        select: { tradeDate: true, close: true },
      }),
      this.prisma.indexDaily.findMany({
        where: { tsCode: benchmarkCode, ...where },
        orderBy: { tradeDate: 'desc' },
        take,
        select: { tradeDate: true, close: true },
      }),
    ])
    const factors = await this.prisma.adjFactor.findMany({
      where: { tsCode, tradeDate: { in: stock.map((row) => row.tradeDate) } },
      select: { tradeDate: true, adjFactor: true },
    })
    return { stock, benchmark, factors }
  }
}
