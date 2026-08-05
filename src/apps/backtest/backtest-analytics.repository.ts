import { Injectable } from '@nestjs/common'
import { PrismaService } from 'src/shared/prisma.service'

@Injectable()
export class BacktestAnalyticsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findOwnedRun(runId: string, userId: number) {
    return this.prisma.backtestRun.findFirst({
      where: { id: runId, userId, deletedAt: null },
      select: {
        id: true,
        status: true,
        engineVersion: true,
        dataContractVersion: true,
        universePolicyVersion: true,
        financialAsOfPolicyVersion: true,
        adjustmentPolicyVersion: true,
        reproducibilityStatus: true,
        qualityFlags: true,
        completedAt: true,
      },
    })
  }

  async ownsParamSweep(sweepId: string, userId: number): Promise<boolean> {
    return Boolean(await this.prisma.paramSweep.findFirst({ where: { id: sweepId, userId }, select: { id: true } }))
  }

  async ownsWalkForward(runId: string, userId: number): Promise<boolean> {
    return Boolean(
      await this.prisma.backtestWalkForwardRun.findFirst({
        where: { id: runId, userId, deletedAt: null },
        select: { id: true },
      }),
    )
  }

  async ownsComparison(groupId: string, userId: number): Promise<boolean> {
    return Boolean(
      await this.prisma.backtestComparisonGroup.findFirst({ where: { id: groupId, userId }, select: { id: true } }),
    )
  }
}
