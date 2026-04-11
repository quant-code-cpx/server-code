import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { PrismaService } from 'src/shared/prisma.service'
import { PortfolioService } from 'src/apps/portfolio/portfolio.service'
import { EventsGateway } from 'src/websocket/events.gateway'
import {
  DriftDetectionDto,
  DriftDetectionResponseDto,
  DriftItemDto,
  IndustryDriftItemDto,
} from './dto/drift-detection.dto'

@Injectable()
export class DriftDetectionService {
  private readonly logger = new Logger(DriftDetectionService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly portfolioService: PortfolioService,
    private readonly eventsGateway: EventsGateway,
  ) {}

  /**
   * 手动触发漂移检测（来自 PortfolioController）。
   */
  async detect(dto: DriftDetectionDto, userId: number): Promise<DriftDetectionResponseDto> {
    const portfolio = await this.portfolioService.assertOwner(dto.portfolioId, userId)

    // 确定策略 ID
    let strategyId = dto.strategyId
    if (!strategyId) {
      const activation = await this.prisma.signalActivation.findFirst({
        where: { portfolioId: dto.portfolioId, isActive: true },
        select: { strategyId: true },
      })
      if (!activation) throw new BadRequestException('组合未关联策略信号，请先激活策略并关联组合，或手动指定 strategyId')
      strategyId = activation.strategyId
    }

    const threshold = dto.alertThreshold ?? 0.3
    return this.computeDrift(dto.portfolioId, portfolio.name, strategyId, userId, threshold)
  }

  /**
   * 由 SignalGenerationService 在信号生成后自动调用（超阈值推送 WebSocket）。
   */
  async detectAndNotify(activationId: string, userId: number): Promise<void> {
    const activation = await this.prisma.signalActivation.findUnique({
      where: { id: activationId },
    })
    if (!activation?.portfolioId) return

    try {
      const result = await this.computeDrift(
        activation.portfolioId,
        '',
        activation.strategyId,
        userId,
        activation.alertThreshold,
      )

      if (result.isAlert) {
        // 查组合名
        const portfolio = await this.prisma.portfolio.findUnique({
          where: { id: activation.portfolioId },
          select: { name: true },
        })
        this.eventsGateway.emitToUser(userId, 'drift_alert', {
          portfolioId: activation.portfolioId,
          portfolioName: portfolio?.name ?? activation.portfolioId,
          strategyId: activation.strategyId,
          totalDriftScore: result.totalDriftScore,
          tradeDate: result.tradeDate,
          message: `组合「${portfolio?.name ?? activation.portfolioId}」与策略信号偏离度 ${(result.totalDriftScore * 100).toFixed(1)}%，超过阈值 ${(result.totalDriftScore * 100).toFixed(1)}%`,
        })
      }
    } catch (err) {
      this.logger.warn(`漂移检测失败（activation=${activationId}）：${(err as Error).message}`)
    }
  }

  // ── 核心计算 ──────────────────────────────────────────────────────────────

  private async computeDrift(
    portfolioId: string,
    portfolioName: string,
    strategyId: string,
    userId: number,
    alertThreshold: number,
  ): Promise<DriftDetectionResponseDto> {
    // 加载最新信号日期
    const latestSignal = await this.prisma.tradingSignal.findFirst({
      where: { strategyId, userId },
      orderBy: { tradeDate: 'desc' },
      select: { tradeDate: true },
    })

    if (!latestSignal) {
      // 无信号 → 偏离为 0
      return this.emptyResult(portfolioId, strategyId, alertThreshold)
    }

    const tradeDate = latestSignal.tradeDate

    // 加载信号目标
    const signals = await this.prisma.tradingSignal.findMany({
      where: { strategyId, userId, tradeDate },
      select: { tsCode: true, action: true, targetWeight: true },
    })

    // 加载当前持仓
    const holdings = await this.prisma.portfolioHolding.findMany({
      where: { portfolioId },
      select: { tsCode: true, quantity: true, avgCost: true },
    })

    // 计算实际权重（按最新收盘价，如无则用成本价）
    const tsCodes = holdings.map((h) => h.tsCode)
    let priceMap = new Map<string, number>()

    if (tsCodes.length > 0) {
      const today = new Date()
      today.setHours(23, 59, 59, 0)
      const latestPrices = await this.prisma.daily.findMany({
        where: { tsCode: { in: tsCodes } },
        orderBy: { tradeDate: 'desc' },
        distinct: ['tsCode'],
        select: { tsCode: true, close: true },
      })
      priceMap = new Map(latestPrices.map((p) => [p.tsCode, p.close ? Number(p.close) : 0]))
    }

    const holdingMvMap = new Map<string, number>()
    let totalMv = 0
    for (const h of holdings) {
      const price = priceMap.get(h.tsCode) ?? Number(h.avgCost)
      const mv = h.quantity * price
      holdingMvMap.set(h.tsCode, mv)
      totalMv += mv
    }

    const actualWeightMap = new Map<string, number>()
    if (totalMv > 0) {
      for (const [ts, mv] of holdingMvMap) {
        actualWeightMap.set(ts, mv / totalMv)
      }
    }

    // 构建信号目标权重 Map（仅 BUY/HOLD 的股票）
    const signalTargetMap = new Map<string, number>()
    const buyHoldSignals = signals.filter((s) => s.action === 'BUY' || s.action === 'HOLD')
    const equalWeight = buyHoldSignals.length > 0 ? 1 / buyHoldSignals.length : 0
    for (const s of buyHoldSignals) {
      signalTargetMap.set(s.tsCode, s.targetWeight ?? equalWeight)
    }

    // 行业信息
    const allTsCodes = [...new Set([...actualWeightMap.keys(), ...signalTargetMap.keys()])]
    const stocks = await this.prisma.stockBasic.findMany({
      where: { tsCode: { in: allTsCodes } },
      select: { tsCode: true, name: true, industry: true },
    })
    const stockInfoMap = new Map(stocks.map((s) => [s.tsCode, { name: s.name ?? s.tsCode, industry: s.industry ?? '其他' }]))

    // ── 计算偏离度 ────────────────────────────────────────────────────────

    const actualSet = new Set(actualWeightMap.keys())
    const targetSet = new Set(signalTargetMap.keys())

    // 持仓偏离度 D_position = (|A\S| + |S\A|) / |A∪S|
    const unionSize = new Set([...actualSet, ...targetSet]).size
    if (unionSize === 0) return this.emptyResult(portfolioId, strategyId, alertThreshold)

    const inActualNotTarget = [...actualSet].filter((ts) => !targetSet.has(ts)).length
    const inTargetNotActual = [...targetSet].filter((ts) => !actualSet.has(ts)).length
    const positionDrift = (inActualNotTarget + inTargetNotActual) / unionSize

    // 权重偏离度 D_weight — 对共同持仓做 RMSE
    const intersection = [...actualSet].filter((ts) => targetSet.has(ts))
    let weightSqSum = 0
    for (const ts of intersection) {
      const diff = (actualWeightMap.get(ts) ?? 0) - (signalTargetMap.get(ts) ?? 0)
      weightSqSum += diff * diff
    }
    const weightDrift = intersection.length > 0 ? Math.sqrt(weightSqSum / intersection.length) : 0

    // 行业暴露偏离度 D_industry = 0.5 * Σ|w_k^actual - w_k^target|
    const actualIndustryMap = new Map<string, number>()
    for (const [ts, w] of actualWeightMap) {
      const industry = stockInfoMap.get(ts)?.industry ?? '其他'
      actualIndustryMap.set(industry, (actualIndustryMap.get(industry) ?? 0) + w)
    }
    const targetIndustryMap = new Map<string, number>()
    for (const [ts, w] of signalTargetMap) {
      const industry = stockInfoMap.get(ts)?.industry ?? '其他'
      targetIndustryMap.set(industry, (targetIndustryMap.get(industry) ?? 0) + w)
    }

    const allIndustries = new Set([...actualIndustryMap.keys(), ...targetIndustryMap.keys()])
    let industryAbsDiffSum = 0
    const industryItems: IndustryDriftItemDto[] = []
    for (const ind of allIndustries) {
      const aw = actualIndustryMap.get(ind) ?? 0
      const tw = targetIndustryMap.get(ind) ?? 0
      const diff = aw - tw
      industryAbsDiffSum += Math.abs(diff)
      industryItems.push({ industry: ind, actualWeight: aw, targetWeight: tw, diff })
    }
    const industryDrift = industryAbsDiffSum / 2
    industryItems.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))

    // 总偏离度
    const totalDriftScore = 0.4 * positionDrift + 0.4 * weightDrift + 0.2 * industryDrift
    const isAlert = totalDriftScore >= alertThreshold

    // ── 构建逐只明细 ──────────────────────────────────────────────────────

    const items: DriftItemDto[] = []
    for (const ts of new Set([...actualSet, ...targetSet])) {
      const aw = actualWeightMap.get(ts) ?? null
      const tw = signalTargetMap.get(ts) ?? null
      const stockName = stockInfoMap.get(ts)?.name ?? ts
      let driftType: DriftItemDto['driftType']
      if (aw !== null && tw === null) driftType = 'EXTRA_IN_PORTFOLIO'
      else if (aw === null && tw !== null) driftType = 'MISSING_IN_PORTFOLIO'
      else if (Math.abs((aw ?? 0) - (tw ?? 0)) < 0.001) driftType = 'ALIGNED'
      else driftType = 'WEIGHT_DRIFT'

      items.push({
        tsCode: ts,
        stockName,
        actualWeight: aw,
        targetWeight: tw,
        weightDiff: aw !== null && tw !== null ? aw - tw : null,
        driftType,
      })
    }
    items.sort((a, b) => Math.abs(b.weightDiff ?? 0) - Math.abs(a.weightDiff ?? 0))

    return {
      portfolioId,
      strategyId,
      tradeDate: tradeDate.toISOString().slice(0, 10),
      totalDriftScore: round4(totalDriftScore),
      isAlert,
      alertThreshold,
      positionDrift: round4(positionDrift),
      weightDrift: round4(weightDrift),
      industryDrift: round4(industryDrift),
      items,
      industryItems,
    }
  }

  private emptyResult(portfolioId: string, strategyId: string, alertThreshold: number): DriftDetectionResponseDto {
    return {
      portfolioId,
      strategyId,
      tradeDate: '',
      totalDriftScore: 0,
      isAlert: false,
      alertThreshold,
      positionDrift: 0,
      weightDrift: 0,
      industryDrift: 0,
      items: [],
      industryItems: [],
    }
  }
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000
}
