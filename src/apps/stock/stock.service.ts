import { Injectable } from '@nestjs/common'
import { Prisma, StockExchange, StockListStatus } from '@prisma/client'
import { PrismaService } from 'src/shared/prisma.service'
import { StockListQueryDto } from './dto/stock-list-query.dto'

/**
 * StockService
 *
 * 股票管理服务：当前优先面向已同步入库的基础数据做查询，
 * 返回值尽量覆盖股票列表和股票详情场景所需的关键字段。
 */
@Injectable()
export class StockService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: StockListQueryDto) {
    const where: Prisma.StockBasicWhereInput = {
      exchange: query.exchange ? (query.exchange as StockExchange) : undefined,
      listStatus: query.list_status ? (query.list_status as StockListStatus) : undefined,
      industry: query.industry
        ? {
            contains: query.industry,
            mode: 'insensitive',
          }
        : undefined,
    }

    const [total, items] = await this.prisma.$transaction([
      this.prisma.stockBasic.count({ where }),
      this.prisma.stockBasic.findMany({
        where,
        orderBy: [{ listDate: 'desc' }, { tsCode: 'asc' }],
        take: 200,
        select: {
          tsCode: true,
          symbol: true,
          name: true,
          area: true,
          industry: true,
          market: true,
          exchange: true,
          listStatus: true,
          listDate: true,
          delistDate: true,
          isHs: true,
        },
      }),
    ])

    return {
      total,
      items,
    }
  }

  async findOne(code: string) {
    const [stock, company, latestDaily, latestDailyBasic, latestAdjFactor] = await this.prisma.$transaction([
      this.prisma.stockBasic.findUnique({
        where: { tsCode: code },
      }),
      this.prisma.stockCompany.findUnique({
        where: { tsCode: code },
      }),
      this.prisma.daily.findFirst({
        where: { tsCode: code },
        orderBy: { tradeDate: 'desc' },
      }),
      this.prisma.dailyBasic.findFirst({
        where: { tsCode: code },
        orderBy: { tradeDate: 'desc' },
      }),
      this.prisma.adjFactor.findFirst({
        where: { tsCode: code },
        orderBy: { tradeDate: 'desc' },
      }),
    ])

    if (!stock) {
      return null
    }

    return {
      stock,
      company,
      latestDaily,
      latestDailyBasic,
      latestAdjFactor,
    }
  }
}
