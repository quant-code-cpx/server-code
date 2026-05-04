import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { formatDateToCompactTradeDate, parseCompactTradeDateToUtcDate } from 'src/common/utils/trade-date.util'
import { PrismaService } from 'src/shared/prisma.service'
import {
  ActivateSignalDto,
  DeactivateSignalDto,
  LatestSignalQueryDto,
  LatestSignalResponseDto,
  SignalActivationItemDto,
  SignalHistoryQueryDto,
  SignalHistoryResponseDto,
  TradingSignalItemDto,
} from './dto/signal.dto'

@Injectable()
export class SignalService {
  constructor(private readonly prisma: PrismaService) {}

  // ── 激活策略信号 ──────────────────────────────────────────────────────────

  async activate(dto: ActivateSignalDto, userId: number): Promise<SignalActivationItemDto> {
    // 验证策略存在且归属当前用户
    const strategy = await this.prisma.strategy.findFirst({
      where: { id: dto.strategyId, userId },
      select: { id: true, name: true, strategyType: true },
    })
    if (!strategy) throw new NotFoundException('策略不存在或无权访问')

    // 若指定了组合，验证归属
    if (dto.portfolioId) {
      const portfolio = await this.prisma.portfolio.findFirst({
        where: { id: dto.portfolioId, userId },
        select: { id: true },
      })
      if (!portfolio) throw new NotFoundException('组合不存在或无权访问')
    }

    const activation = await this.prisma.signalActivation.upsert({
      where: { userId_strategyId: { userId, strategyId: dto.strategyId } },
      create: {
        userId,
        strategyId: dto.strategyId,
        portfolioId: dto.portfolioId ?? null,
        isActive: true,
        universe: dto.universe ?? 'ALL_A',
        benchmarkTsCode: dto.benchmarkTsCode ?? '000300.SH',
        lookbackDays: dto.lookbackDays ?? 250,
        alertThreshold: dto.alertThreshold ?? 0.3,
      },
      update: {
        isActive: true,
        ...(dto.portfolioId !== undefined && { portfolioId: dto.portfolioId }),
        ...(dto.universe !== undefined && { universe: dto.universe }),
        ...(dto.benchmarkTsCode !== undefined && { benchmarkTsCode: dto.benchmarkTsCode }),
        ...(dto.lookbackDays !== undefined && { lookbackDays: dto.lookbackDays }),
        ...(dto.alertThreshold !== undefined && { alertThreshold: dto.alertThreshold }),
      },
    })

    return this.toActivationItem(activation, strategy.name)
  }

  // ── 停用策略信号 ──────────────────────────────────────────────────────────

  async deactivate(dto: DeactivateSignalDto, userId: number): Promise<SignalActivationItemDto> {
    const activation = await this.prisma.signalActivation.findUnique({
      where: { userId_strategyId: { userId, strategyId: dto.strategyId } },
    })
    if (!activation) throw new NotFoundException('激活记录不存在')

    const updated = await this.prisma.signalActivation.update({
      where: { id: activation.id },
      data: { isActive: false },
    })

    const strategy = await this.prisma.strategy.findUnique({
      where: { id: dto.strategyId },
      select: { name: true },
    })

    return this.toActivationItem(updated, strategy?.name ?? dto.strategyId)
  }

  // ── 查询已激活策略列表 ────────────────────────────────────────────────────

  async listActivations(userId: number): Promise<SignalActivationItemDto[]> {
    const activations = await this.prisma.signalActivation.findMany({
      where: { userId, isActive: true },
      orderBy: { createdAt: 'desc' },
    })

    if (activations.length === 0) return []

    const strategyIds = [...new Set(activations.map((a) => a.strategyId))]
    const strategies = await this.prisma.strategy.findMany({
      where: { id: { in: strategyIds } },
      select: { id: true, name: true },
    })
    const strategyNameMap = new Map(strategies.map((s) => [s.id, s.name]))

    return activations.map((a) => this.toActivationItem(a, strategyNameMap.get(a.strategyId) ?? a.strategyId))
  }

  // ── 查询最新信号 ──────────────────────────────────────────────────────────

  async getLatestSignals(dto: LatestSignalQueryDto, userId: number): Promise<LatestSignalResponseDto[]> {
    // 确定日期
    let tradeDate: Date | undefined
    if (dto.tradeDate) {
      tradeDate = this.parseDateStr(dto.tradeDate)
    } else {
      const latest = await this.getLatestSignalDate(userId, dto.strategyId)
      if (!latest) return []
      tradeDate = latest
    }

    const where: Parameters<typeof this.prisma.tradingSignal.findMany>[0]['where'] = {
      userId,
      tradeDate,
      ...(dto.strategyId && { strategyId: dto.strategyId }),
    }

    const signals = await this.prisma.tradingSignal.findMany({
      where,
      orderBy: [{ strategyId: 'asc' }, { tsCode: 'asc' }],
    })

    if (signals.length === 0) return []

    // 按 strategyId 分组
    const groupMap = new Map<string, typeof signals>()
    for (const s of signals) {
      const arr = groupMap.get(s.strategyId) ?? []
      arr.push(s)
      groupMap.set(s.strategyId, arr)
    }

    const strategyIds = [...groupMap.keys()]
    const strategies = await this.prisma.strategy.findMany({
      where: { id: { in: strategyIds } },
      select: { id: true, name: true },
    })
    const nameMap = new Map(strategies.map((s) => [s.id, s.name]))

    // 批量查股票名
    const tsCodes = [...new Set(signals.map((s) => s.tsCode))]
    const stocks = await this.prisma.stockBasic.findMany({
      where: { tsCode: { in: tsCodes } },
      select: { tsCode: true, name: true },
    })
    const stockNameMap = new Map(stocks.map((s) => [s.tsCode, s.name]))

    const now = Date.now()
    const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000

    const results: LatestSignalResponseDto[] = []
    for (const [strategyId, items] of groupMap) {
      const generatedAt = items[0].createdAt.toISOString()
      const ageMs = now - items[0].createdAt.getTime()
      const signalItems = items.map((s) => this.toSignalItem(s, stockNameMap.get(s.tsCode) ?? s.tsCode))
      results.push({
        strategyId,
        strategyName: nameMap.get(strategyId) ?? strategyId,
        tradeDate: formatDateToCompactTradeDate(items[0].tradeDate) ?? '',
        signals: signalItems,
        aggregateStats: this.buildAggregateStats(signalItems),
        generatedAt,
        lastRunAt: generatedAt,
        status: ageMs > TWO_DAYS_MS ? 'STALE' : 'OK',
      })
    }

    return results
  }

  // ── 查询信号历史 ──────────────────────────────────────────────────────────

  async getSignalHistory(dto: SignalHistoryQueryDto, userId: number): Promise<SignalHistoryResponseDto> {
    const page = dto.page ?? 1
    const pageSize = dto.pageSize ?? 20

    const where: Prisma.TradingSignalWhereInput = {
      userId,
      strategyId: dto.strategyId,
      ...(dto.actions?.length ? { action: { in: dto.actions } } : {}),
      ...(dto.confidenceMin !== undefined || dto.confidenceMax !== undefined
        ? {
            confidence: {
              ...(dto.confidenceMin !== undefined ? { gte: dto.confidenceMin } : {}),
              ...(dto.confidenceMax !== undefined ? { lte: dto.confidenceMax } : {}),
            },
          }
        : {}),
    }
    if (dto.startDate || dto.endDate) {
      where.tradeDate = {
        ...(dto.startDate ? { gte: this.parseDateStr(dto.startDate) } : {}),
        ...(dto.endDate ? { lte: this.parseDateStr(dto.endDate) } : {}),
      }
    }
    if (dto.stockKeyword) {
      const stocks = await this.prisma.stockBasic.findMany({
        where: {
          OR: [
            { tsCode: { contains: dto.stockKeyword, mode: 'insensitive' } },
            { name: { contains: dto.stockKeyword, mode: 'insensitive' } },
          ],
        },
        select: { tsCode: true },
      })
      where.tsCode = { in: stocks.map((s) => s.tsCode) }
    }

    // 先获取不同日期列表
    const distinctDates = await this.prisma.tradingSignal.findMany({
      where,
      select: { tradeDate: true },
      distinct: ['tradeDate'],
      orderBy: { tradeDate: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    })

    const totalDates = await this.prisma.tradingSignal.groupBy({
      by: ['tradeDate'],
      where,
    })

    if (distinctDates.length === 0) {
      return {
        strategyId: dto.strategyId,
        total: 0,
        page,
        pageSize,
        groups: [],
        aggregateStats: this.buildAggregateStats([]),
      }
    }

    const targetDates = distinctDates.map((d) => d.tradeDate)
    const signals = await this.prisma.tradingSignal.findMany({
      where: { ...where, tradeDate: { in: targetDates } },
      orderBy: [{ tradeDate: 'desc' }, { tsCode: 'asc' }],
    })

    const tsCodes = [...new Set(signals.map((s) => s.tsCode))]
    const stocks = await this.prisma.stockBasic.findMany({
      where: { tsCode: { in: tsCodes } },
      select: { tsCode: true, name: true },
    })
    const stockNameMap = new Map(stocks.map((s) => [s.tsCode, s.name]))

    const forwardWindow = dto.forwardWindow ?? 5
    const activation = await this.prisma.signalActivation.findUnique({
      where: { userId_strategyId: { userId, strategyId: dto.strategyId } },
      select: { benchmarkTsCode: true },
    })
    const metricsMap = await this.computeForwardMetrics(
      signals,
      forwardWindow,
      activation?.benchmarkTsCode ?? '000300.SH',
    )
    const firstOccurrenceMap = await this.computeFirstOccurrence(signals)
    const enrichedSignals = signals.map((s) =>
      this.toSignalItem(s, stockNameMap.get(s.tsCode) ?? s.tsCode, {
        forwardReturn: metricsMap.get(s.id)?.forwardReturn ?? null,
        excessReturn: metricsMap.get(s.id)?.excessReturn ?? null,
        isFirstOccurrence: firstOccurrenceMap.get(s.id) ?? true,
      }),
    )

    const dateGroupMap = new Map<string, TradingSignalItemDto[]>()
    for (const item of enrichedSignals) {
      const key = item.tradeDate ?? ''
      const arr = dateGroupMap.get(key) ?? []
      arr.push(item)
      dateGroupMap.set(key, arr)
    }

    const groups = [...dateGroupMap.entries()].map(([date, items]) => ({
      tradeDate: date,
      signalCount: items.length,
      signals: items,
      aggregateStats: this.buildAggregateStats(items),
    }))

    return {
      strategyId: dto.strategyId,
      total: totalDates.length,
      page,
      pageSize,
      groups,
      aggregateStats: this.buildAggregateStats(enrichedSignals),
    }
  }

  // ── 工具方法 ──────────────────────────────────────────────────────────────

  private async computeForwardMetrics(
    signals: Array<{ id: string; tsCode: string; tradeDate: Date }>,
    forwardWindow: number,
    benchmarkTsCode: string,
  ): Promise<Map<string, { forwardReturn: number | null; excessReturn: number | null }>> {
    const result = new Map<string, { forwardReturn: number | null; excessReturn: number | null }>()
    if (!signals.length) return result

    const minDate = signals.reduce((m, s) => (s.tradeDate < m ? s.tradeDate : m), signals[0].tradeDate)
    const maxDate = signals.reduce((m, s) => (s.tradeDate > m ? s.tradeDate : m), signals[0].tradeDate)
    const rangeEnd = new Date(maxDate.getTime() + (forwardWindow * 3 + 10) * 24 * 60 * 60 * 1000)
    const tsCodes = [...new Set(signals.map((s) => s.tsCode))]

    const [dailyRows, benchRows] = await Promise.all([
      this.prisma.daily.findMany({
        where: { tsCode: { in: tsCodes }, tradeDate: { gte: minDate, lte: rangeEnd } },
        select: { tsCode: true, tradeDate: true, close: true },
        orderBy: [{ tsCode: 'asc' }, { tradeDate: 'asc' }],
      }),
      this.prisma.indexDaily.findMany({
        where: { tsCode: benchmarkTsCode, tradeDate: { gte: minDate, lte: rangeEnd } },
        select: { tradeDate: true, close: true },
        orderBy: { tradeDate: 'asc' },
      }),
    ])

    const byCode = new Map<string, typeof dailyRows>()
    for (const row of dailyRows) {
      const arr = byCode.get(row.tsCode) ?? []
      arr.push(row)
      byCode.set(row.tsCode, arr)
    }

    for (const signal of signals) {
      const signalDate = formatDateToCompactTradeDate(signal.tradeDate)
      const stockReturn = this.forwardReturnForRows(byCode.get(signal.tsCode) ?? [], signalDate, forwardWindow)
      const benchReturn = this.forwardReturnForRows(benchRows, signalDate, forwardWindow)
      result.set(signal.id, {
        forwardReturn: stockReturn,
        excessReturn:
          stockReturn == null || benchReturn == null ? null : Math.round((stockReturn - benchReturn) * 10000) / 10000,
      })
    }

    return result
  }

  private forwardReturnForRows(
    rows: Array<{ tradeDate: Date; close: number | null }>,
    signalDate: string | null,
    forwardWindow: number,
  ): number | null {
    if (!signalDate || !rows.length) return null
    const idx = rows.findIndex((r) => formatDateToCompactTradeDate(r.tradeDate) === signalDate)
    if (idx === -1 || idx + forwardWindow >= rows.length) return null
    const start = rows[idx].close
    const end = rows[idx + forwardWindow].close
    if (!start || !end) return null
    return Math.round(((end - start) / start) * 100 * 10000) / 10000
  }

  private async computeFirstOccurrence(
    signals: Array<{ id: string; strategyId: string; tsCode: string; action: string; tradeDate: Date }>,
  ): Promise<Map<string, boolean>> {
    const result = new Map<string, boolean>()
    await Promise.all(
      signals.map(async (s) => {
        const prior = await this.prisma.tradingSignal.count({
          where: { strategyId: s.strategyId, tsCode: s.tsCode, action: s.action, tradeDate: { lt: s.tradeDate } },
        })
        result.set(s.id, prior === 0)
      }),
    )
    return result
  }

  private buildAggregateStats(items: TradingSignalItemDto[]) {
    const avg = (values: number[]) =>
      values.length ? Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 10000) / 10000 : null
    return {
      total: items.length,
      buyCount: items.filter((i) => i.action === 'BUY').length,
      sellCount: items.filter((i) => i.action === 'SELL').length,
      holdCount: items.filter((i) => i.action === 'HOLD').length,
      avgConfidence: avg(items.map((i) => i.confidence).filter((v): v is number => v != null)),
      avgForwardReturn: avg(items.map((i) => i.forwardReturn).filter((v): v is number => v != null)),
      avgExcessReturn: avg(items.map((i) => i.excessReturn).filter((v): v is number => v != null)),
    }
  }

  private async getLatestSignalDate(userId: number, strategyId?: string): Promise<Date | null> {
    const latest = await this.prisma.tradingSignal.findFirst({
      where: { userId, ...(strategyId && { strategyId }) },
      orderBy: { tradeDate: 'desc' },
      select: { tradeDate: true },
    })
    return latest?.tradeDate ?? null
  }

  parseDateStr(dateStr: string): Date {
    if (dateStr.length === 8) {
      return parseCompactTradeDateToUtcDate(dateStr)
    }
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) throw new BadRequestException(`无效日期格式: ${dateStr}`)
    return d
  }

  private toActivationItem(
    a: {
      id: string
      strategyId: string
      portfolioId: string | null
      isActive: boolean
      universe: string
      benchmarkTsCode: string
      lookbackDays: number
      alertThreshold: number
      lastSignalDate: Date | null
      createdAt: Date
      updatedAt: Date
    },
    strategyName: string,
  ): SignalActivationItemDto {
    return {
      id: a.id,
      strategyId: a.strategyId,
      strategyName,
      portfolioId: a.portfolioId,
      isActive: a.isActive,
      universe: a.universe,
      benchmarkTsCode: a.benchmarkTsCode,
      lookbackDays: a.lookbackDays,
      alertThreshold: a.alertThreshold,
      lastSignalDate: a.lastSignalDate ? a.lastSignalDate.toISOString().slice(0, 10) : null,
      createdAt: a.createdAt.toISOString(),
      updatedAt: a.updatedAt.toISOString(),
    }
  }

  private toSignalItem(
    s: {
      id?: string
      strategyId?: string
      tsCode: string
      tradeDate?: Date
      action: string
      targetWeight: number | null
      confidence: number | null
    },
    stockName: string,
    metrics?: { forwardReturn?: number | null; excessReturn?: number | null; isFirstOccurrence?: boolean },
  ): TradingSignalItemDto {
    return {
      strategyId: s.strategyId,
      tradeDate: formatDateToCompactTradeDate(s.tradeDate),
      tsCode: s.tsCode,
      stockName,
      action: s.action as 'BUY' | 'SELL' | 'HOLD',
      targetWeight: s.targetWeight,
      confidence: s.confidence,
      forwardReturn: metrics?.forwardReturn ?? null,
      excessReturn: metrics?.excessReturn ?? null,
      isFirstOccurrence: metrics?.isFirstOccurrence,
    }
  }
}
