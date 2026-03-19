import { Injectable } from '@nestjs/common'
import { MoneyflowContentType } from '@prisma/client'
import { PrismaService } from 'src/shared/prisma.service'
import { MoneyFlowQueryDto } from './dto/money-flow-query.dto'

/**
 * MarketService
 *
 * 当前先基于同步入库的东财资金流向表提供查询，
 * 对外返回“最新交易日”或指定日期的市场 / 行业 / 概念 / 地域资金流向。
 */
@Injectable()
export class MarketService {
  constructor(private readonly prisma: PrismaService) {}

  async getMarketMoneyFlow(query: MoneyFlowQueryDto) {
    const tradeDate = query.trade_date ? this.parseDate(query.trade_date) : await this.resolveLatestMarketTradeDate()
    if (!tradeDate) {
      return []
    }

    return this.prisma.moneyflowMktDc.findMany({
      where: { tradeDate },
      orderBy: { tradeDate: 'desc' },
    })
  }

  async getSectorFlow(query: MoneyFlowQueryDto) {
    const tradeDate = query.trade_date ? this.parseDate(query.trade_date) : await this.resolveLatestSectorTradeDate()
    if (!tradeDate) {
      return {
        tradeDate: null,
        industry: [],
        concept: [],
        region: [],
      }
    }

    const rows = await this.prisma.moneyflowIndDc.findMany({
      where: { tradeDate },
      orderBy: [{ contentType: 'asc' }, { rank: 'asc' }, { netAmount: 'desc' }],
    })

    return {
      tradeDate,
      industry: rows.filter((item) => item.contentType === MoneyflowContentType.INDUSTRY),
      concept: rows.filter((item) => item.contentType === MoneyflowContentType.CONCEPT),
      region: rows.filter((item) => item.contentType === MoneyflowContentType.REGION),
    }
  }

  private async resolveLatestMarketTradeDate() {
    const record = await this.prisma.moneyflowMktDc.findFirst({
      orderBy: { tradeDate: 'desc' },
      select: { tradeDate: true },
    })

    return record?.tradeDate ?? null
  }

  private async resolveLatestSectorTradeDate() {
    const record = await this.prisma.moneyflowIndDc.findFirst({
      orderBy: { tradeDate: 'desc' },
      select: { tradeDate: true },
    })

    return record?.tradeDate ?? null
  }

  private parseDate(value: string) {
    return new Date(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T00:00:00+08:00`)
  }
}
