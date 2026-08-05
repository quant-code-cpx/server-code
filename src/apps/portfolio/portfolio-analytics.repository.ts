import { Injectable } from '@nestjs/common'
import { PrismaService } from 'src/shared/prisma.service'

@Injectable()
export class PortfolioAnalyticsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findOwnedPortfolio(portfolioId: string, userId: number) {
    return this.prisma.portfolio.findFirst({
      where: { id: portfolioId, userId, isArchived: false },
      select: { id: true, userId: true, name: true, initialCash: true },
    })
  }

  async getCoverage(portfolioId: string, userId: number) {
    const [firstEvent, latestSnapshot] = await Promise.all([
      this.prisma.portfolioHoldingEvent.findFirst({
        where: { portfolioId, userId },
        orderBy: { effectiveDate: 'asc' },
        select: { effectiveDate: true },
      }),
      this.prisma.portfolioDailySnapshot.findFirst({
        where: { portfolioId, portfolio: { userId } },
        orderBy: { tradeDate: 'desc' },
        select: { tradeDate: true },
      }),
    ])
    return { coverageStart: firstEvent?.effectiveDate ?? null, dataThrough: latestSnapshot?.tradeDate ?? null }
  }

  getSnapshots(portfolioId: string, userId: number, startDate: Date, endDate: Date) {
    return this.prisma.portfolioDailySnapshot.findMany({
      where: { portfolioId, portfolio: { userId }, tradeDate: { gte: startDate, lte: endDate } },
      orderBy: { tradeDate: 'asc' },
      take: 1_251,
    })
  }

  getSnapshotAtOrBefore(portfolioId: string, userId: number, asOfDate: Date) {
    return this.prisma.portfolioDailySnapshot.findFirst({
      where: { portfolioId, portfolio: { userId }, tradeDate: { lte: asOfDate } },
      orderBy: { tradeDate: 'desc' },
    })
  }

  getPreviousSnapshot(portfolioId: string, userId: number, tradeDate: Date) {
    return this.prisma.portfolioDailySnapshot.findFirst({
      where: { portfolioId, portfolio: { userId }, tradeDate: { lt: tradeDate } },
      orderBy: { tradeDate: 'desc' },
    })
  }

  getPositions(portfolioId: string, userId: number, tradeDate: Date) {
    return this.prisma.portfolioPositionSnapshot.findMany({
      where: { portfolioId, portfolio: { userId }, tradeDate },
      orderBy: [{ weight: 'desc' }, { tsCode: 'asc' }],
      take: 1_000,
    })
  }

  getBenchmarkCloses(tsCode: string, startDate: Date, endDate: Date) {
    return this.prisma.indexDaily.findMany({
      where: { tsCode, tradeDate: { gte: startDate, lte: endDate } },
      orderBy: { tradeDate: 'asc' },
      select: { tradeDate: true, close: true },
      take: 1_251,
    })
  }

  async getNames(tsCodes: string[]): Promise<Map<string, string | null>> {
    if (tsCodes.length === 0) return new Map()
    const rows = await this.prisma.stockBasic.findMany({
      where: { tsCode: { in: tsCodes } },
      select: { tsCode: true, name: true },
      take: 1_000,
    })
    return new Map(rows.map((row) => [row.tsCode, row.name]))
  }

  async getEvents(portfolioId: string, userId: number, page: number, pageSize: number) {
    const where = { portfolioId, userId, tsCode: { not: '__PORTFOLIO__' } }
    const [total, items] = await Promise.all([
      this.prisma.portfolioHoldingEvent.count({ where }),
      this.prisma.portfolioHoldingEvent.findMany({
        where,
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ])
    return { total, items }
  }
}
