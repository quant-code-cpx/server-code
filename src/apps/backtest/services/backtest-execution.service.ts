import { Injectable } from '@nestjs/common'
import {
  BacktestConfig,
  DailyBar,
  PortfolioState,
  TradeRecord,
  RebalanceLogRecord,
  SignalOutput,
} from '../types/backtest-engine.types'

/** A 股最小交易单位：1 手 = 100 股 */
const LOT_SIZE = 100

@Injectable()
export class BacktestExecutionService {
  /**
   * Execute trades for a rebalance: sell positions not in targets, buy new targets.
   * Returns trades executed and a rebalance log entry.
   */
  executeTrades(
    portfolio: PortfolioState,
    signal: SignalOutput,
    bars: Map<string, DailyBar>,
    config: BacktestConfig,
    signalDate: Date,
    executeDate: Date,
  ): { trades: TradeRecord[]; rebalanceLog: RebalanceLogRecord } {
    const trades: TradeRecord[] = []
    let skippedLimitCount = 0
    let skippedSuspendCount = 0

    const targetMap = new Map(signal.targets.map((t) => [t.tsCode, t.weight]))

    // Compute target weights (equal if not specified)
    const totalTargets = signal.targets.length
    const effectiveWeights = new Map<string, number>()
    if (totalTargets > 0) {
      let totalSpecified = 0
      let unspecifiedCount = 0
      for (const t of signal.targets) {
        if (t.weight !== undefined && t.weight !== null) {
          totalSpecified += t.weight
          effectiveWeights.set(t.tsCode, t.weight)
        } else {
          unspecifiedCount++
        }
      }
      const remainingWeight = Math.max(0, 1 - totalSpecified)
      const equalShare = unspecifiedCount > 0 ? remainingWeight / unspecifiedCount : 0
      for (const t of signal.targets) {
        if (!effectiveWeights.has(t.tsCode)) {
          effectiveWeights.set(t.tsCode, equalShare)
        }
      }
    }

    // Apply maxWeightPerStock cap
    if (config.maxWeightPerStock < 1) {
      for (const [code, w] of effectiveWeights) {
        effectiveWeights.set(code, Math.min(w, config.maxWeightPerStock))
      }
    }

    // Apply maxPositions cap (take top N by weight)
    if (totalTargets > config.maxPositions) {
      const sorted = [...effectiveWeights.entries()].sort((a, b) => b[1] - a[1]).slice(0, config.maxPositions)
      effectiveWeights.clear()
      for (const [code, w] of sorted) effectiveWeights.set(code, w)
    }

    // ── STEP 1: SELLS ────────────────────────────────────────────────────────
    for (const [tsCode, pos] of portfolio.positions) {
      if (effectiveWeights.has(tsCode)) continue // keep position

      const bar = bars.get(tsCode)
      const execPrice = this.getExecutionPrice(bar, config)

      if (!execPrice || !bar) {
        // Cannot get price, skip sell (will be forced out next time)
        continue
      }

      if (config.enableTradeConstraints) {
        if (bar.isSuspended) {
          skippedSuspendCount++
          continue
        }
        if (bar.downLimit !== null && execPrice <= bar.downLimit) {
          skippedLimitCount++
          continue
        }
      }

      const amount = execPrice * pos.quantity
      const slippageCost = (amount * config.slippageBps) / 10000
      const actualPrice = execPrice - slippageCost / pos.quantity
      const commission = Math.max(amount * config.commissionRate, config.minCommission)
      const stampDuty = amount * config.stampDutyRate

      portfolio.cash += amount - commission - stampDuty - slippageCost
      portfolio.positions.delete(tsCode)

      trades.push({
        tradeDate: executeDate,
        tsCode,
        side: 'SELL',
        price: actualPrice,
        quantity: pos.quantity,
        amount,
        commission,
        stampDuty,
        slippageCost,
        reason: 'rebalance-sell',
      })
    }

    // ── STEP 2: BUYS ─────────────────────────────────────────────────────────
    const totalNav = portfolio.cash + this.computePositionValue(portfolio, bars, config)
    let executedBuyCount = 0

    // Track stocks sold today to enforce T+1 restriction
    const soldToday = new Set(trades.filter((t) => t.side === 'SELL').map((t) => t.tsCode))

    // Sort by target weight descending so high-weight targets get cash priority
    const sortedTargets = [...effectiveWeights.entries()].sort((a, b) => b[1] - a[1])

    for (const [tsCode, targetWeight] of sortedTargets) {
      // T+1: skip stocks sold in this same execution round
      if (config.enableT1Restriction && soldToday.has(tsCode)) continue

      const bar = bars.get(tsCode)
      const execPrice = this.getExecutionPrice(bar, config)

      if (!execPrice || !bar) continue

      if (config.enableTradeConstraints) {
        if (bar.isSuspended) {
          skippedSuspendCount++
          continue
        }
        if (bar.upLimit !== null && execPrice >= bar.upLimit) {
          skippedLimitCount++
          continue
        }
      }

      const targetValue = totalNav * targetWeight
      const currentPos = portfolio.positions.get(tsCode)
      const currentValue = currentPos ? currentPos.quantity * execPrice : 0
      const diffValue = targetValue - currentValue

      if (diffValue <= 0) continue // already at or above target

      // Partial fill: use available cash if insufficient for full target
      const availableValue = config.partialFillEnabled ? Math.min(diffValue, portfolio.cash) : diffValue
      if (!config.partialFillEnabled && portfolio.cash < diffValue) continue

      // 买入数量必须是 LOT_SIZE 的整数倍
      const rawQty = Math.floor(availableValue / execPrice / LOT_SIZE) * LOT_SIZE
      if (rawQty <= 0) continue

      const amount = rawQty * execPrice
      if (portfolio.cash < amount) continue

      const slippageCost = (amount * config.slippageBps) / 10000
      const actualPrice = execPrice + slippageCost / rawQty
      const commission = Math.max(amount * config.commissionRate, config.minCommission)

      portfolio.cash -= amount + commission + slippageCost

      if (currentPos) {
        const totalQty = currentPos.quantity + rawQty
        currentPos.costPrice = (currentPos.costPrice * currentPos.quantity + actualPrice * rawQty) / totalQty
        currentPos.quantity = totalQty
      } else {
        portfolio.positions.set(tsCode, {
          tsCode,
          quantity: rawQty,
          costPrice: actualPrice,
          entryDate: executeDate,
        })
      }

      trades.push({
        tradeDate: executeDate,
        tsCode,
        side: 'BUY',
        price: actualPrice,
        quantity: rawQty,
        amount,
        commission,
        stampDuty: 0,
        slippageCost,
        reason: 'rebalance-buy',
      })

      executedBuyCount++
    }

    const rebalanceLog: RebalanceLogRecord = {
      signalDate,
      executeDate,
      targetCount: totalTargets,
      executedBuyCount,
      executedSellCount: trades.filter((t) => t.side === 'SELL').length,
      skippedLimitCount,
      skippedSuspendCount,
      message: null,
    }

    return { trades, rebalanceLog }
  }

  private getExecutionPrice(bar: DailyBar | undefined, config: BacktestConfig): number | null {
    if (!bar) return null
    const price = config.priceMode === 'NEXT_CLOSE' ? bar.close : bar.open
    if (!price || price <= 0) return null
    return price
  }

  private computePositionValue(portfolio: PortfolioState, bars: Map<string, DailyBar>, config: BacktestConfig): number {
    let value = 0
    for (const [tsCode, pos] of portfolio.positions) {
      const bar = bars.get(tsCode)
      const price = bar?.close ?? this.getExecutionPrice(bar, config)
      if (price) value += pos.quantity * price
    }
    return value
  }
}
