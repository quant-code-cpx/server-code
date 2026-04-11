import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { Decimal } from '@prisma/client/runtime/library'
import { PrismaService } from 'src/shared/prisma.service'
import { CacheService } from 'src/shared/cache.service'
import { CACHE_KEY_PREFIX } from 'src/constant/cache.constant'
import { ApplyBacktestDto, ApplyBacktestResponseDto, ApplyMode, RebalanceActionDto } from '../dto/apply-backtest.dto'
import { PortfolioTradeLogService } from './portfolio-trade-log.service'

@Injectable()
export class BacktestPortfolioBridgeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: CacheService,
    private readonly tradeLogService: PortfolioTradeLogService,
  ) {}

  async applyBacktest(dto: ApplyBacktestDto, userId: number): Promise<ApplyBacktestResponseDto> {
    const mode = dto.mode ?? ApplyMode.REPLACE

    // ─── 1. 校验回测归属与状态 ─────────────────────────────────────────────
    const run = await this.prisma.backtestRun.findUnique({ where: { id: dto.backtestRunId } })
    if (!run) throw new NotFoundException('回测任务不存在')
    if (run.userId !== userId) throw new ForbiddenException('无权访问该回测')
    if (run.status !== 'COMPLETED') throw new BadRequestException('回测尚未完成，无法导入')

    // ─── 2. 获取末日持仓快照 ──────────────────────────────────────────────
    const latestSnapshotRow = await this.prisma.backtestPositionSnapshot.findFirst({
      where: { runId: dto.backtestRunId },
      orderBy: { tradeDate: 'desc' },
      select: { tradeDate: true },
    })
    if (!latestSnapshotRow) throw new BadRequestException('该回测无持仓快照数据')

    const snapshots = await this.prisma.backtestPositionSnapshot.findMany({
      where: { runId: dto.backtestRunId, tradeDate: latestSnapshotRow.tradeDate },
    })
    if (snapshots.length === 0) throw new BadRequestException('该回测无持仓快照数据')

    // ─── 3. 确定目标组合 ────────────────────────────────────────────────────
    let portfolioId: string
    let portfolioName: string

    if (dto.portfolioId) {
      const portfolio = await this.prisma.portfolio.findUnique({ where: { id: dto.portfolioId } })
      if (!portfolio) throw new NotFoundException('组合不存在')
      if (portfolio.userId !== userId) throw new ForbiddenException('无权访问该组合')
      portfolioId = portfolio.id
      portfolioName = portfolio.name
    } else {
      const name = dto.portfolioName ?? `回测导入-${run.name ?? dto.backtestRunId.slice(0, 8)}`
      const newPortfolio = await this.prisma.portfolio.create({
        data: { userId, name, initialCash: run.initialCapital },
        select: { id: true, name: true },
      })
      portfolioId = newPortfolio.id
      portfolioName = newPortfolio.name
    }

    // ─── 4. 读取目标组合当前持仓 ────────────────────────────────────────────
    const existingHoldings = await this.prisma.portfolioHolding.findMany({ where: { portfolioId } })
    const existingMap = new Map(existingHoldings.map((h) => [h.tsCode, h]))

    // ─── 5. 补全股票名称 ─────────────────────────────────────────────────────
    const tsCodes = snapshots.map((s) => s.tsCode)
    const stockBasics = await this.prisma.stockBasic.findMany({
      where: { tsCode: { in: tsCodes } },
      select: { tsCode: true, name: true },
    })
    const nameMap = new Map(stockBasics.map((s) => [s.tsCode, s.name]))

    // ─── 6. 生成调仓计划 ─────────────────────────────────────────────────────
    const snapshotMap = new Map(snapshots.map((s) => [s.tsCode, s]))
    const changes: RebalanceActionDto[] = []

    if (mode === ApplyMode.REPLACE) {
      for (const snapshot of snapshots) {
        const existing = existingMap.get(snapshot.tsCode)
        const targetQty = snapshot.quantity
        const targetCost = Number(snapshot.costPrice ?? 0)
        const prevQty = existing?.quantity ?? 0
        const prevCost = existing ? Number(existing.avgCost) : 0

        let action: RebalanceActionDto['action']
        if (!existing) {
          action = 'BUY'
        } else if (prevQty === targetQty && Math.abs(prevCost - targetCost) < 0.0001) {
          action = 'HOLD'
        } else {
          action = 'ADJUST'
        }

        changes.push({
          tsCode: snapshot.tsCode,
          stockName: nameMap.get(snapshot.tsCode) ?? snapshot.tsCode,
          action,
          previousQuantity: prevQty,
          previousAvgCost: prevCost,
          targetQuantity: targetQty,
          targetAvgCost: targetCost,
          deltaQuantity: targetQty - prevQty,
        })
      }
      // REPLACE 模式下，原有但回测中无的持仓 → SELL
      for (const holding of existingHoldings) {
        if (!snapshotMap.has(holding.tsCode)) {
          changes.push({
            tsCode: holding.tsCode,
            stockName: holding.stockName,
            action: 'SELL',
            previousQuantity: holding.quantity,
            previousAvgCost: Number(holding.avgCost),
            targetQuantity: 0,
            targetAvgCost: 0,
            deltaQuantity: -holding.quantity,
          })
        }
      }
    } else {
      // MERGE: 回测中有 → BUY/ADJUST；回测中无 → HOLD
      for (const snapshot of snapshots) {
        const existing = existingMap.get(snapshot.tsCode)
        const snapshotQty = snapshot.quantity
        const snapshotCost = Number(snapshot.costPrice ?? 0)

        if (!existing) {
          changes.push({
            tsCode: snapshot.tsCode,
            stockName: nameMap.get(snapshot.tsCode) ?? snapshot.tsCode,
            action: 'BUY',
            previousQuantity: 0,
            previousAvgCost: 0,
            targetQuantity: snapshotQty,
            targetAvgCost: snapshotCost,
            deltaQuantity: snapshotQty,
          })
        } else {
          const newQty = existing.quantity + snapshotQty
          const newAvgCost = (existing.quantity * Number(existing.avgCost) + snapshotQty * snapshotCost) / newQty
          changes.push({
            tsCode: snapshot.tsCode,
            stockName: nameMap.get(snapshot.tsCode) ?? snapshot.tsCode,
            action: 'ADJUST',
            previousQuantity: existing.quantity,
            previousAvgCost: Number(existing.avgCost),
            targetQuantity: newQty,
            targetAvgCost: newAvgCost,
            deltaQuantity: snapshotQty,
          })
        }
      }
      // MERGE 模式下，原有但回测中无的持仓 → HOLD（保持不动）
      for (const holding of existingHoldings) {
        if (!snapshotMap.has(holding.tsCode)) {
          changes.push({
            tsCode: holding.tsCode,
            stockName: holding.stockName,
            action: 'HOLD',
            previousQuantity: holding.quantity,
            previousAvgCost: Number(holding.avgCost),
            targetQuantity: holding.quantity,
            targetAvgCost: Number(holding.avgCost),
            deltaQuantity: 0,
          })
        }
      }
    }

    // ─── 7. 事务执行调仓 ─────────────────────────────────────────────────────
    if (mode === ApplyMode.REPLACE) {
      await this.prisma.$transaction([
        this.prisma.portfolioHolding.deleteMany({ where: { portfolioId } }),
        this.prisma.portfolioHolding.createMany({
          data: snapshots.map((s) => ({
            portfolioId,
            tsCode: s.tsCode,
            stockName: nameMap.get(s.tsCode) ?? s.tsCode,
            quantity: s.quantity,
            avgCost: new Decimal(Number(s.costPrice ?? 0)),
          })),
        }),
      ])
    } else {
      await this.prisma.$transaction(
        snapshots.map((s) => {
          const existing = existingMap.get(s.tsCode)
          if (existing) {
            const newQty = existing.quantity + s.quantity
            const newAvgCost =
              (existing.quantity * Number(existing.avgCost) + s.quantity * Number(s.costPrice ?? 0)) / newQty
            return this.prisma.portfolioHolding.update({
              where: { id: existing.id },
              data: { quantity: newQty, avgCost: new Decimal(newAvgCost) },
            })
          } else {
            return this.prisma.portfolioHolding.create({
              data: {
                portfolioId,
                tsCode: s.tsCode,
                stockName: nameMap.get(s.tsCode) ?? s.tsCode,
                quantity: s.quantity,
                avgCost: new Decimal(Number(s.costPrice ?? 0)),
              },
            })
          }
        }),
      )
    }

    // ─── 8. 清除组合缓存 ─────────────────────────────────────────────────────
    await this.cacheService.invalidateByPrefixes([
      `${CACHE_KEY_PREFIX.PORTFOLIO_DETAIL}:${portfolioId}`,
      `${CACHE_KEY_PREFIX.PORTFOLIO_PNL_TODAY}:${portfolioId}`,
      `${CACHE_KEY_PREFIX.PORTFOLIO_PNL_HIST}:${portfolioId}:`,
      `${CACHE_KEY_PREFIX.PORTFOLIO_RISK}:ind:${portfolioId}`,
      `${CACHE_KEY_PREFIX.PORTFOLIO_RISK}:pos:${portfolioId}`,
      `${CACHE_KEY_PREFIX.PORTFOLIO_RISK}:cap:${portfolioId}`,
      `${CACHE_KEY_PREFIX.PORTFOLIO_RISK}:beta:${portfolioId}`,
    ])

    // ─── 9. 写交易日志 ────────────────────────────────────────────────────────
    const loggableChanges = changes.filter((c) => c.action !== 'HOLD')
    await Promise.all(
      loggableChanges.map((c) =>
        this.tradeLogService.log({
          portfolioId,
          userId,
          tsCode: c.tsCode,
          stockName: c.stockName,
          action: c.action,
          quantity: Math.abs(c.deltaQuantity),
          price: c.targetAvgCost,
          reason: 'BACKTEST_IMPORT',
          detail: { backtestRunId: dto.backtestRunId, mode },
        }),
      ),
    )

    // ─── 10. 统计并返回 ────────────────────────────────────────────────────────
    const added = changes.filter((c) => c.action === 'BUY').length
    const updated = changes.filter((c) => c.action === 'ADJUST').length
    const removed = changes.filter((c) => c.action === 'SELL').length
    const unchanged = changes.filter((c) => c.action === 'HOLD').length
    const totalHoldings = mode === ApplyMode.REPLACE ? snapshots.length : existingHoldings.length + added

    return {
      portfolioId,
      portfolioName,
      backtestRunId: dto.backtestRunId,
      mode,
      snapshotDate: latestSnapshotRow.tradeDate.toISOString().slice(0, 10),
      changes,
      summary: { added, updated, removed, unchanged, totalHoldings },
    }
  }
}
