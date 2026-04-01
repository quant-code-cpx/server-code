import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from 'src/shared/prisma.service'
import { BacktestResult } from '../types/backtest-engine.types'

@Injectable()
export class BacktestReportService {
  private readonly logger = new Logger(BacktestReportService.name)

  constructor(private readonly prisma: PrismaService) {}

  async saveReport(runId: string, result: BacktestResult): Promise<void> {
    const { navRecords, trades, positions, rebalanceLogs, metrics } = result

    this.logger.log(
      `Saving report for runId=${runId}: navs=${navRecords.length} trades=${trades.length} positions=${positions.length}`,
    )

    // Save daily navs
    if (navRecords.length > 0) {
      await this.prisma.backtestDailyNav.createMany({
        data: navRecords.map((r) => ({
          runId,
          tradeDate: r.tradeDate,
          nav: r.nav,
          benchmarkNav: r.benchmarkNav,
          dailyReturn: r.dailyReturn,
          benchmarkReturn: r.benchmarkReturn,
          drawdown: r.drawdown,
          cash: r.cash,
          positionValue: r.positionValue,
          exposure: r.exposure,
          cashRatio: r.cashRatio,
        })),
        skipDuplicates: true,
      })
    }

    // Save trades
    if (trades.length > 0) {
      await this.prisma.backtestTrade.createMany({
        data: trades.map((t) => ({
          runId,
          tradeDate: t.tradeDate,
          tsCode: t.tsCode,
          side: t.side,
          price: t.price,
          quantity: t.quantity,
          amount: t.amount,
          commission: t.commission,
          stampDuty: t.stampDuty,
          slippageCost: t.slippageCost,
          reason: t.reason,
        })),
      })
    }

    // Save position snapshots
    if (positions.length > 0) {
      await this.prisma.backtestPositionSnapshot.createMany({
        data: positions.map((p) => ({
          runId,
          tradeDate: p.tradeDate,
          tsCode: p.tsCode,
          quantity: p.quantity,
          costPrice: p.costPrice,
          closePrice: p.closePrice,
          marketValue: p.marketValue,
          weight: p.weight,
          unrealizedPnl: p.unrealizedPnl,
          holdingDays: p.holdingDays,
        })),
        skipDuplicates: true,
      })
    }

    // Save rebalance logs
    if (rebalanceLogs.length > 0) {
      await this.prisma.backtestRebalanceLog.createMany({
        data: rebalanceLogs.map((r) => ({
          runId,
          signalDate: r.signalDate,
          executeDate: r.executeDate,
          targetCount: r.targetCount,
          executedBuyCount: r.executedBuyCount,
          executedSellCount: r.executedSellCount,
          skippedLimitCount: r.skippedLimitCount,
          skippedSuspendCount: r.skippedSuspendCount,
          message: r.message,
        })),
      })
    }

    // Update BacktestRun with metrics and COMPLETED status
    await this.prisma.backtestRun.update({
      where: { id: runId },
      data: {
        status: 'COMPLETED',
        progress: 100,
        completedAt: new Date(),
        totalReturn: metrics.totalReturn,
        annualizedReturn: metrics.annualizedReturn,
        benchmarkReturn: metrics.benchmarkReturn,
        excessReturn: metrics.excessReturn,
        maxDrawdown: metrics.maxDrawdown,
        sharpeRatio: metrics.sharpeRatio,
        sortinoRatio: metrics.sortinoRatio,
        calmarRatio: metrics.calmarRatio,
        volatility: metrics.volatility,
        alpha: metrics.alpha,
        beta: metrics.beta,
        informationRatio: metrics.informationRatio,
        winRate: metrics.winRate,
        turnoverRate: metrics.turnoverRate,
        tradeCount: metrics.tradeCount,
      },
    })

    this.logger.log(`Report saved for runId=${runId}`)
  }
}
