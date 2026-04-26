import { Injectable } from '@nestjs/common'
import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'
import { CORE_INDEX_CODES, CORE_INDEX_NAME_MAP } from 'src/constant/tushare.constant'
import { CACHE_NAMESPACE } from 'src/constant/cache.constant'
import { CacheService } from 'src/shared/cache.service'
import { PrismaService } from 'src/shared/prisma.service'
import { IndexDailyQueryDto } from './dto/index-daily-query.dto'
import { IndexConstituentsQueryDto } from './dto/index-constituents-query.dto'

dayjs.extend(utc)
dayjs.extend(timezone)

const INDEX_CACHE_TTL_SECONDS = 4 * 3600

@Injectable()
export class IndexService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: CacheService,
  ) {}

  /**
   * 获取支持的指数列表
   */
  async getIndexList() {
    return CORE_INDEX_CODES.map((code) => ({
      tsCode: code,
      name: CORE_INDEX_NAME_MAP[code] ?? code,
    }))
  }

  /**
   * 查询指数日线行情
   */
  async getIndexDaily(query: IndexDailyQueryDto) {
    const { ts_code } = query

    // 单日查询
    if (query.trade_date) {
      const tradeDate = this.parseDate(query.trade_date)
      const rows = await this.prisma.indexDaily.findMany({
        where: { tsCode: ts_code, tradeDate },
        orderBy: { tradeDate: 'asc' },
      })
      return this.buildDailyResponse(ts_code, rows)
    }

    // 日期范围查询
    const where: Record<string, unknown> = { tsCode: ts_code }
    const dateFilter: Record<string, Date> = {}
    if (query.start_date) dateFilter.gte = this.parseDate(query.start_date)
    if (query.end_date) dateFilter.lte = this.parseDate(query.end_date)

    // 默认最近 3 个月
    if (!query.start_date && !query.end_date) {
      const latestDate = await this.resolveLatestIndexTradeDate()
      if (!latestDate) return this.buildDailyResponse(ts_code, [])
      dateFilter.gte = dayjs(latestDate).subtract(3, 'month').toDate()
    }

    if (Object.keys(dateFilter).length > 0) {
      where.tradeDate = dateFilter
    }

    const rows = await this.prisma.indexDaily.findMany({
      where,
      orderBy: { tradeDate: 'asc' },
    })
    return this.buildDailyResponse(ts_code, rows)
  }

  /**
   * 查询指数成分股及权重
   */
  async getIndexConstituents(query: IndexConstituentsQueryDto) {
    const { index_code } = query
    const requestedTradeDate = query.trade_date ?? 'latest'
    const resolvedTradeDate = await this.resolveAvailableIndexWeightTradeDate(index_code, query.trade_date)
    const cacheKey = `index:constituents:${index_code}:${requestedTradeDate}:${resolvedTradeDate ?? 'empty'}`

    return this.cacheService.rememberJson({
      namespace: CACHE_NAMESPACE.MARKET,
      key: cacheKey,
      ttlSeconds: INDEX_CACHE_TTL_SECONDS,
      loader: async () => {
        if (!resolvedTradeDate) {
          return {
            indexCode: index_code,
            indexName: CORE_INDEX_NAME_MAP[index_code] ?? index_code,
            tradeDate: '',
            dailyTradeDate: '',
            total: 0,
            constituents: [],
          }
        }

        // 查询成分股权重
        const weights = await this.prisma.indexWeight.findMany({
          where: { indexCode: index_code, tradeDate: resolvedTradeDate },
          orderBy: { weight: 'desc' },
        })

        const conCodes = weights.map((w) => w.conCode)

        // 收盘价/涨跌幅/市值用最新交易日，而非权重更新日期
        const latestDailyDate = await this.resolveLatestStockTradeDate()
        const dailyDateObj = latestDailyDate ?? this.parseDate(resolvedTradeDate)

        // 并行获取成分股基本信息、日线行情、每日基础指标
        const [stocks, dailyRows, dailyBasicRows] = await Promise.all([
          this.prisma.stockBasic.findMany({
            where: { tsCode: { in: conCodes } },
            select: { tsCode: true, name: true, industry: true },
          }),
          this.prisma.daily.findMany({
            where: { tsCode: { in: conCodes }, tradeDate: dailyDateObj },
            select: { tsCode: true, close: true, pctChg: true },
          }),
          this.prisma.dailyBasic.findMany({
            where: { tsCode: { in: conCodes }, tradeDate: dailyDateObj },
            select: { tsCode: true, totalMv: true, circMv: true },
          }),
        ])

        const stockMap = new Map(stocks.map((s) => [s.tsCode, s]))
        const dailyMap = new Map(dailyRows.map((d) => [d.tsCode, d]))
        const basicMap = new Map(dailyBasicRows.map((d) => [d.tsCode, d]))

        return {
          indexCode: index_code,
          indexName: CORE_INDEX_NAME_MAP[index_code] ?? index_code,
          tradeDate: resolvedTradeDate,
          dailyTradeDate: latestDailyDate ? dayjs(latestDailyDate).format('YYYYMMDD') : resolvedTradeDate,
          total: weights.length,
          constituents: weights.map((w) => {
            const stock = stockMap.get(w.conCode)
            const daily = dailyMap.get(w.conCode)
            const basic = basicMap.get(w.conCode)
            return {
              conCode: w.conCode,
              name: stock?.name ?? null,
              industry: stock?.industry ?? null,
              weight: w.weight ? Number(w.weight) : null,
              close: daily?.close ?? null,
              pctChg: daily?.pctChg ?? null,
              totalMv: basic?.totalMv ?? null,
              circMv: basic?.circMv ?? null,
              tradeDate: w.tradeDate,
            }
          }),
        }
      },
    })
  }

  private async resolveAvailableIndexWeightTradeDate(indexCode: string, tradeDate?: string): Promise<string | null> {
    const latest = await this.prisma.indexWeight.findFirst({
      where: tradeDate ? { indexCode, tradeDate: { lte: tradeDate } } : { indexCode },
      orderBy: { tradeDate: 'desc' },
      select: { tradeDate: true },
    })

    return latest?.tradeDate ?? null
  }

  private buildDailyResponse(tsCode: string, rows: Array<Record<string, unknown>>) {
    return {
      tsCode,
      name: CORE_INDEX_NAME_MAP[tsCode] ?? tsCode,
      data: rows.map((r) => ({
        tradeDate: dayjs(r.tradeDate as Date).format('YYYY-MM-DD'),
        open: r.open ?? null,
        high: r.high ?? null,
        low: r.low ?? null,
        close: r.close ?? null,
        preClose: r.preClose ?? null,
        change: r.change ?? null,
        pctChg: r.pctChg ?? null,
        vol: r.vol ?? null,
        amount: r.amount ?? null,
      })),
    }
  }

  private parseDate(value: string): Date {
    return dayjs.tz(value, 'YYYYMMDD', 'Asia/Shanghai').toDate()
  }

  private async resolveLatestStockTradeDate(): Promise<Date | null> {
    const record = await this.prisma.daily.findFirst({
      orderBy: { tradeDate: 'desc' },
      select: { tradeDate: true },
    })
    return record?.tradeDate ?? null
  }

  private async resolveLatestIndexTradeDate(): Promise<Date | null> {
    const record = await this.prisma.indexDaily.findFirst({
      orderBy: { tradeDate: 'desc' },
      select: { tradeDate: true },
    })
    return record?.tradeDate ?? null
  }
}
