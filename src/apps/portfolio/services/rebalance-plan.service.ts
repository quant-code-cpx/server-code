import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from 'src/shared/prisma.service'
import { OmitAction, RebalancePlanDto, RebalancePlanItemDto, RebalancePlanResponseDto } from '../dto/rebalance-plan.dto'

const DEFAULT_COMMISSION_RATE = 0.00025
const DEFAULT_STAMP_DUTY_RATE = 0.001
const DEFAULT_MIN_COMMISSION = 5

/** Date → Tushare 格式 'YYYYMMDD' (SuspendD.tradeDate 是字符串) */
function toTushareDateStr(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, '')
}

/** 向下取整到 100 股整手 */
function roundToLot(totalValue: number, targetWeight: number, price: number): number {
  if (price <= 0) return 0
  const rawShares = Math.floor((totalValue * targetWeight) / price)
  return Math.floor(rawShares / 100) * 100
}

/** 估算单笔交易成本 */
function calcTradingCost(
  amount: number,
  isSell: boolean,
  commissionRate: number,
  stampDutyRate: number,
  minCommission: number,
): number {
  const commission = Math.max(amount * commissionRate, minCommission)
  const stampDuty = isSell ? amount * stampDutyRate : 0
  return commission + stampDuty
}

@Injectable()
export class RebalancePlanService {
  constructor(private readonly prisma: PrismaService) {}

  async rebalancePlan(dto: RebalancePlanDto, userId: number): Promise<RebalancePlanResponseDto> {
    const commissionRate = dto.commissionRate ?? DEFAULT_COMMISSION_RATE
    const stampDutyRate = dto.stampDutyRate ?? DEFAULT_STAMP_DUTY_RATE
    const minCommission = dto.minCommission ?? DEFAULT_MIN_COMMISSION
    const omitUnspecified = dto.omitUnspecified ?? OmitAction.SELL

    // ─── 1. 权限校验 ──────────────────────────────────────────────────────────
    const portfolio = await this.prisma.portfolio.findUnique({ where: { id: dto.portfolioId } })
    if (!portfolio) throw new NotFoundException('组合不存在')
    if (portfolio.userId !== userId) throw new ForbiddenException('无权访问该组合')

    // ─── 2. 输入校验 ──────────────────────────────────────────────────────────
    const totalWeight = dto.targets.reduce((sum, t) => sum + t.targetWeight, 0)
    if (totalWeight > 1.001) {
      throw new BadRequestException(`目标权重之和 (${totalWeight.toFixed(4)}) 不能超过 1.0`)
    }
    const tsCodes = dto.targets.map((t) => t.tsCode)
    const uniqueCodes = new Set(tsCodes)
    if (uniqueCodes.size !== tsCodes.length) {
      throw new BadRequestException('targets 中存在重复的 tsCode')
    }

    // ─── 3. 读取当前持仓 ──────────────────────────────────────────────────────
    const existingHoldings = await this.prisma.portfolioHolding.findMany({ where: { portfolioId: dto.portfolioId } })
    const holdingMap = new Map(existingHoldings.map((h) => [h.tsCode, h]))

    // ─── 4. 查询最新交易日 & 价格 ────────────────────────────────────────────
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const latestCal = await this.prisma.tradeCal.findFirst({
      where: { isOpen: '1', calDate: { lte: today } },
      orderBy: { calDate: 'desc' },
    })
    const latestDate = latestCal?.calDate ?? null
    const latestDateStr = latestDate ? toTushareDateStr(latestDate) : null

    const allCodes = [...new Set([...tsCodes, ...existingHoldings.map((h) => h.tsCode)])]
    const priceMap = new Map<string, number>()
    if (latestDate) {
      const prices = await this.prisma.daily.findMany({
        where: { tsCode: { in: allCodes }, tradeDate: latestDate },
        select: { tsCode: true, close: true },
      })
      prices.forEach((p) => {
        if (p.close != null) priceMap.set(p.tsCode, p.close)
      })
    }

    // ─── 5. 查询停牌状态 ──────────────────────────────────────────────────────
    const suspendedSet = new Set<string>()
    if (latestDateStr) {
      const suspends = await this.prisma.suspendD.findMany({
        where: { tradeDate: latestDateStr, tsCode: { in: allCodes } },
        select: { tsCode: true },
      })
      suspends.forEach((s) => suspendedSet.add(s.tsCode))
    }

    // ─── 6. 补全股票名称 ──────────────────────────────────────────────────────
    const stockBasics = await this.prisma.stockBasic.findMany({
      where: { tsCode: { in: allCodes } },
      select: { tsCode: true, name: true },
    })
    const nameMap = new Map(stockBasics.map((s) => [s.tsCode, s.name]))

    // ─── 7. 确定 totalValue ───────────────────────────────────────────────────
    let totalValue: number
    if (dto.totalValue != null && dto.totalValue > 0) {
      totalValue = dto.totalValue
    } else {
      totalValue = existingHoldings.reduce((sum, h) => {
        const price = priceMap.get(h.tsCode) ?? Number(h.avgCost)
        return sum + h.quantity * price
      }, 0)
    }

    // ─── 8. 生成调仓计划 ─────────────────────────────────────────────────────
    const items: RebalancePlanItemDto[] = []
    const targetCodeSet = new Set(tsCodes)

    // 遍历 targets
    for (const target of dto.targets) {
      const code = target.tsCode
      const existing = holdingMap.get(code)
      const price = priceMap.get(code) ?? null
      const currentShares = existing?.quantity ?? 0
      const currentPrice = price
      const currentMarketValue = price != null ? currentShares * price : null
      const currentWeight = totalValue > 0 && currentMarketValue != null ? currentMarketValue / totalValue : null
      const stockName = nameMap.get(code) ?? code

      // SKIP 判断
      if (suspendedSet.has(code)) {
        items.push({
          tsCode: code,
          stockName,
          currentShares,
          currentPrice,
          currentMarketValue,
          currentWeight,
          targetWeight: target.targetWeight,
          targetShares: currentShares,
          targetMarketValue: currentMarketValue,
          action: 'SKIP',
          skipReason: 'SUSPENDED',
          deltaShares: 0,
          deltaAmount: null,
          estimatedTradingCost: 0,
        })
        continue
      }
      if (price == null) {
        items.push({
          tsCode: code,
          stockName,
          currentShares,
          currentPrice: null,
          currentMarketValue: null,
          currentWeight: null,
          targetWeight: target.targetWeight,
          targetShares: currentShares,
          targetMarketValue: null,
          action: 'SKIP',
          skipReason: 'NO_PRICE',
          deltaShares: 0,
          deltaAmount: null,
          estimatedTradingCost: 0,
        })
        continue
      }

      // 清仓（targetWeight = 0）→ 直接卖出全部，不用整手约束
      if (target.targetWeight === 0) {
        if (currentShares === 0) {
          items.push({
            tsCode: code,
            stockName,
            currentShares: 0,
            currentPrice,
            currentMarketValue: 0,
            currentWeight: 0,
            targetWeight: 0,
            targetShares: 0,
            targetMarketValue: 0,
            action: 'HOLD',
            deltaShares: 0,
            deltaAmount: null,
            estimatedTradingCost: 0,
          })
        } else {
          const amount = currentShares * price
          items.push({
            tsCode: code,
            stockName,
            currentShares,
            currentPrice,
            currentMarketValue,
            currentWeight,
            targetWeight: 0,
            targetShares: 0,
            targetMarketValue: 0,
            action: 'SELL',
            deltaShares: -currentShares,
            deltaAmount: amount,
            estimatedTradingCost: calcTradingCost(amount, true, commissionRate, stampDutyRate, minCommission),
          })
        }
        continue
      }

      const targetShares = roundToLot(totalValue, target.targetWeight, price)
      if (targetShares === 0) {
        items.push({
          tsCode: code,
          stockName,
          currentShares,
          currentPrice,
          currentMarketValue,
          currentWeight,
          targetWeight: target.targetWeight,
          targetShares: 0,
          targetMarketValue: 0,
          action: 'SKIP',
          skipReason: 'LOT_SIZE',
          deltaShares: 0,
          deltaAmount: null,
          estimatedTradingCost: 0,
        })
        continue
      }

      const targetMarketValue = targetShares * price
      const delta = targetShares - currentShares

      let action: RebalancePlanItemDto['action']
      let deltaAmount: number | null = null
      let estimatedTradingCost = 0

      if (delta === 0) {
        action = 'HOLD'
      } else if (currentShares === 0) {
        action = 'BUY'
        deltaAmount = Math.abs(delta) * price
        estimatedTradingCost = calcTradingCost(deltaAmount, false, commissionRate, stampDutyRate, minCommission)
      } else if (targetShares === 0) {
        action = 'SELL'
        deltaAmount = Math.abs(delta) * price
        estimatedTradingCost = calcTradingCost(deltaAmount, true, commissionRate, stampDutyRate, minCommission)
      } else {
        action = 'ADJUST'
        deltaAmount = Math.abs(delta) * price
        const isSell = delta < 0
        estimatedTradingCost = calcTradingCost(deltaAmount, isSell, commissionRate, stampDutyRate, minCommission)
      }

      items.push({
        tsCode: code,
        stockName,
        currentShares,
        currentPrice,
        currentMarketValue,
        currentWeight,
        targetWeight: target.targetWeight,
        targetShares,
        targetMarketValue,
        action,
        deltaShares: delta,
        deltaAmount,
        estimatedTradingCost,
      })
    }

    // 遍历原有持仓中不在 targets 里的股票
    for (const holding of existingHoldings) {
      if (targetCodeSet.has(holding.tsCode)) continue

      const price = priceMap.get(holding.tsCode) ?? null
      const stockName = nameMap.get(holding.tsCode) ?? holding.stockName
      const currentMarketValue = price != null ? holding.quantity * price : null
      const currentWeight = totalValue > 0 && currentMarketValue != null ? currentMarketValue / totalValue : null

      if (omitUnspecified === OmitAction.SELL) {
        const amount = price != null ? holding.quantity * price : holding.quantity * Number(holding.avgCost)
        items.push({
          tsCode: holding.tsCode,
          stockName,
          currentShares: holding.quantity,
          currentPrice: price,
          currentMarketValue,
          currentWeight,
          targetWeight: 0,
          targetShares: 0,
          targetMarketValue: 0,
          action: 'SELL',
          deltaShares: -holding.quantity,
          deltaAmount: amount,
          estimatedTradingCost: calcTradingCost(amount, true, commissionRate, stampDutyRate, minCommission),
        })
      } else {
        items.push({
          tsCode: holding.tsCode,
          stockName,
          currentShares: holding.quantity,
          currentPrice: price,
          currentMarketValue,
          currentWeight,
          targetWeight: 0,
          targetShares: holding.quantity,
          targetMarketValue: currentMarketValue,
          action: 'HOLD',
          deltaShares: 0,
          deltaAmount: null,
          estimatedTradingCost: 0,
        })
      }
    }

    // ─── 9. 汇总 ─────────────────────────────────────────────────────────────
    let totalBuyAmount = 0
    let totalSellProceeds = 0
    let totalTradingCost = 0

    for (const item of items) {
      totalTradingCost += item.estimatedTradingCost
      if (item.action === 'BUY' || (item.action === 'ADJUST' && item.deltaShares > 0)) {
        totalBuyAmount += item.deltaAmount ?? 0
      }
      if (item.action === 'SELL' || (item.action === 'ADJUST' && item.deltaShares < 0)) {
        totalSellProceeds += item.deltaAmount ?? 0
      }
    }

    const cashBefore =
      Number(portfolio.initialCash) - existingHoldings.reduce((sum, h) => sum + h.quantity * Number(h.avgCost), 0)
    const cashAfter = cashBefore + totalSellProceeds - totalBuyAmount - totalTradingCost

    return {
      portfolioId: dto.portfolioId,
      portfolioName: portfolio.name,
      refDate: latestDate ? latestDate.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
      totalValue,
      items,
      summary: {
        totalBuyAmount,
        totalSellProceeds,
        totalTradingCost,
        buyCount: items.filter((i) => i.action === 'BUY').length,
        sellCount: items.filter((i) => i.action === 'SELL').length,
        adjustCount: items.filter((i) => i.action === 'ADJUST').length,
        holdCount: items.filter((i) => i.action === 'HOLD').length,
        skipCount: items.filter((i) => i.action === 'SKIP').length,
        cashBefore,
        cashAfter,
        isFeasible: cashAfter >= 0,
      },
    }
  }
}
