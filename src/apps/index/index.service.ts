import { Injectable } from '@nestjs/common'
import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'
import { CORE_INDEX_CODES } from 'src/constant/tushare.constant'
import { CACHE_NAMESPACE } from 'src/constant/cache.constant'
import { CacheService } from 'src/shared/cache.service'
import { PrismaService } from 'src/shared/prisma.service'
import { IndexDailyQueryDto } from './dto/index-daily-query.dto'
import { IndexConstituentsQueryDto } from './dto/index-constituents-query.dto'

dayjs.extend(utc)
dayjs.extend(timezone)

const INDEX_CACHE_TTL_SECONDS = 4 * 3600

/** 指数代码 → 中文名称映射 */
const INDEX_NAME_MAP: Record<string, string> = {
  '000001.SH': '上证指数',
  '399001.SZ': '深证成指',
  '399006.SZ': '创业板指',
  '000300.SH': '沪深300',
  '000905.SH': '中证500',
  '000852.SH': '中证1000',
  '000016.SH': '上证50',
}

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
      name: INDEX_NAME_MAP[code] ?? code,
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
    const cacheKey = `index:constituents:${index_code}:${query.trade_date ?? 'latest'}`

    return this.cacheService.rememberJson({
      namespace: CACHE_NAMESPACE.MARKET,
      key: cacheKey,
      ttlSeconds: INDEX_CACHE_TTL_SECONDS,
      loader: async () => {
        // 确定查询日期
        let tradeDate: string
        if (query.trade_date) {
          tradeDate = query.trade_date
        } else {
          const latest = await this.prisma.indexWeight.findFirst({
            where: { indexCode: index_code },
            orderBy: { tradeDate: 'desc' },
            select: { tradeDate: true },
          })
          if (!latest) {
            return {
              indexCode: index_code,
              indexName: INDEX_NAME_MAP[index_code] ?? index_code,
              tradeDate: '',
              total: 0,
              constituents: [],
            }
          }
          tradeDate = latest.tradeDate
        }

        // 查询成分股权重
        const weights = await this.prisma.indexWeight.findMany({
          where: { indexCode: index_code, tradeDate },
          orderBy: { weight: 'desc' },
        })

        // 批量获取成分股名称
        const conCodes = weights.map((w) => w.conCode)
        const stocks = await this.prisma.stockBasic.findMany({
          where: { tsCode: { in: conCodes } },
          select: { tsCode: true, name: true },
        })
        const nameMap = new Map(stocks.map((s) => [s.tsCode, s.name]))

        return {
          indexCode: index_code,
          indexName: INDEX_NAME_MAP[index_code] ?? index_code,
          tradeDate,
          total: weights.length,
          constituents: weights.map((w) => ({
            conCode: w.conCode,
            name: nameMap.get(w.conCode) ?? null,
            weight: w.weight ? Number(w.weight) : null,
            tradeDate: w.tradeDate,
          })),
        }
      },
    })
  }

  private buildDailyResponse(tsCode: string, rows: Array<Record<string, unknown>>) {
    return {
      tsCode,
      name: INDEX_NAME_MAP[tsCode] ?? tsCode,
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

  private async resolveLatestIndexTradeDate(): Promise<Date | null> {
    const record = await this.prisma.indexDaily.findFirst({
      orderBy: { tradeDate: 'desc' },
      select: { tradeDate: true },
    })
    return record?.tradeDate ?? null
  }
}
