import { Injectable } from '@nestjs/common'
import { PrismaService } from 'src/shared/prisma.service'

@Injectable()
export class MacroResearchRepository {
  constructor(private readonly prisma: PrismaService) {}

  findCpi(startPeriod: string | undefined, endPeriod: string | undefined, limit: number) {
    return this.prisma.macroCpi.findMany({
      where: { month: { ...(startPeriod ? { gte: startPeriod } : {}), ...(endPeriod ? { lte: endPeriod } : {}) } },
      orderBy: { month: 'desc' },
      take: limit,
    })
  }

  findPpi(startPeriod: string | undefined, endPeriod: string | undefined, limit: number) {
    return this.prisma.macroPpi.findMany({
      where: { month: { ...(startPeriod ? { gte: startPeriod } : {}), ...(endPeriod ? { lte: endPeriod } : {}) } },
      orderBy: { month: 'desc' },
      take: limit,
    })
  }

  findGdp(startPeriod: string | undefined, endPeriod: string | undefined, limit: number) {
    return this.prisma.macroGdp.findMany({
      where: { quarter: { ...(startPeriod ? { gte: startPeriod } : {}), ...(endPeriod ? { lte: endPeriod } : {}) } },
      orderBy: { quarter: 'desc' },
      take: limit,
    })
  }

  findShibor(startDate: Date | undefined, endDate: Date | undefined, limit: number) {
    return this.prisma.macroShibor.findMany({
      where: { date: { ...(startDate ? { gte: startDate } : {}), ...(endDate ? { lte: endDate } : {}) } },
      orderBy: { date: 'desc' },
      take: limit,
    })
  }
}
