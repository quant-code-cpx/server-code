import { Injectable } from '@nestjs/common'
import { PrismaService } from 'src/shared/prisma.service'
import { TradeLogQueryDto, TradeLogSummaryDto } from '../dto/trade-log.dto'

export interface TradeLogParams {
  portfolioId: string
  userId: number
  tsCode: string
  stockName?: string
  action: string
  quantity: number
  price?: number
  reason: string
  detail?: Record<string, unknown>
}

@Injectable()
export class PortfolioTradeLogService {
  constructor(private readonly prisma: PrismaService) {}

  async log(params: TradeLogParams): Promise<void> {
    await this.prisma.portfolioTradeLog.create({
      data: {
        portfolioId: params.portfolioId,
        userId: params.userId,
        tsCode: params.tsCode,
        stockName: params.stockName,
        action: params.action,
        quantity: params.quantity,
        price: params.price,
        reason: params.reason,
        detail: params.detail as object,
      },
    })
  }

  async query(dto: TradeLogQueryDto, userId: number) {
    const { portfolioId, startDate, endDate, tsCode, action, reason, page = 1, pageSize = 20 } = dto

    // ownership check
    await this.prisma.portfolio.findFirstOrThrow({ where: { id: portfolioId, userId } })

    const where: Record<string, unknown> = { portfolioId }
    if (tsCode) where.tsCode = tsCode
    if (action) where.action = action
    if (reason) where.reason = reason
    if (startDate || endDate) {
      where.createdAt = {
        ...(startDate ? { gte: new Date(startDate) } : {}),
        ...(endDate ? { lte: new Date(endDate + 'T23:59:59.999Z') } : {}),
      }
    }

    const [total, items] = await Promise.all([
      this.prisma.portfolioTradeLog.count({ where }),
      this.prisma.portfolioTradeLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ])

    return { total, page, pageSize, items }
  }

  async summary(dto: TradeLogSummaryDto, userId: number) {
    const { portfolioId, startDate, endDate } = dto

    // ownership check
    await this.prisma.portfolio.findFirstOrThrow({ where: { id: portfolioId, userId } })

    const where: Record<string, unknown> = { portfolioId }
    if (startDate || endDate) {
      where.createdAt = {
        ...(startDate ? { gte: new Date(startDate) } : {}),
        ...(endDate ? { lte: new Date(endDate + 'T23:59:59.999Z') } : {}),
      }
    }

    const rows = await this.prisma.portfolioTradeLog.groupBy({
      by: ['action', 'reason', 'tsCode', 'stockName'],
      where,
      _count: { id: true },
    })

    return rows
  }
}
