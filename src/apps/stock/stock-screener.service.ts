import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma, ScreenerStrategy } from '@prisma/client'
import dayjs from 'dayjs'
import { CACHE_KEY_PREFIX, CACHE_NAMESPACE, CACHE_TTL_SECONDS } from 'src/constant/cache.constant'
import { CacheService } from 'src/shared/cache.service'
import { PrismaService } from 'src/shared/prisma.service'
import { CreateScreenerStrategyDto, UpdateScreenerStrategyDto } from './dto/stock-screener-strategy.dto'
import { ScreenerFiltersDto, StockScreenerQueryDto, ScreenerSortBy } from './dto/stock-screener-query.dto'

// 选股器排序字段安全映射
const SCREENER_SORT_MAP: Record<ScreenerSortBy, string> = {
  [ScreenerSortBy.TOTAL_MV]: 'db.total_mv',
  [ScreenerSortBy.CIRC_MV]: 'db.circ_mv',
  [ScreenerSortBy.PE_TTM]: 'db.pe_ttm',
  [ScreenerSortBy.PB]: 'db.pb',
  [ScreenerSortBy.DV_TTM]: 'db.dv_ttm',
  [ScreenerSortBy.PCT_CHG]: 'd.pct_chg',
  [ScreenerSortBy.TURNOVER_RATE]: 'db.turnover_rate',
  [ScreenerSortBy.AMOUNT]: 'd.amount',
  [ScreenerSortBy.ROE]: 'fi.roe',
  [ScreenerSortBy.REVENUE_YOY]: 'fi.revenue_yoy',
  [ScreenerSortBy.NETPROFIT_YOY]: 'fi.netprofit_yoy',
  [ScreenerSortBy.GROSS_MARGIN]: 'fi.grossprofit_margin',
  [ScreenerSortBy.NET_MARGIN]: 'fi.netprofit_margin',
  [ScreenerSortBy.DEBT_TO_ASSETS]: 'fi.debt_to_assets',
  [ScreenerSortBy.MAIN_NET_INFLOW_5D]: 'mf_agg.main_net_5d',
  [ScreenerSortBy.LIST_DATE]: 'sb.list_date',
}

// 内置选股预设
interface ScreenerPreset {
  id: string
  name: string
  description: string
  filters: Partial<StockScreenerQueryDto>
}

const BUILT_IN_PRESETS: ScreenerPreset[] = [
  {
    id: 'value',
    name: '低估值蓝筹',
    description: 'PE<15, PB<2, 股息率>2%, 市值>100亿',
    filters: {
      maxPeTtm: 15,
      maxPb: 2,
      minDvTtm: 2,
      minTotalMv: 1000000,
      sortBy: ScreenerSortBy.DV_TTM,
      sortOrder: 'desc',
    },
  },
  {
    id: 'growth',
    name: '高成长',
    description: '营收增速>20%, 净利增速>20%, ROE>10%',
    filters: {
      minRevenueYoy: 20,
      minNetprofitYoy: 20,
      minRoe: 10,
      sortBy: ScreenerSortBy.NETPROFIT_YOY,
      sortOrder: 'desc',
    },
  },
  {
    id: 'quality',
    name: '优质白马',
    description: 'ROE>15%, 毛利率>30%, 资产负债率<60%, 经营现金流/净利>0.8',
    filters: {
      minRoe: 15,
      minGrossMargin: 30,
      maxDebtToAssets: 60,
      minOcfToNetprofit: 0.8,
      sortBy: ScreenerSortBy.ROE,
      sortOrder: 'desc',
    },
  },
  {
    id: 'dividend',
    name: '高股息',
    description: '股息率>3%, PE<20, 市值>50亿',
    filters: {
      minDvTtm: 3,
      maxPeTtm: 20,
      minTotalMv: 500000,
      sortBy: ScreenerSortBy.DV_TTM,
      sortOrder: 'desc',
    },
  },
  {
    id: 'small_growth',
    name: '小盘成长',
    description: '市值<100亿, 营收增速>30%, 净利增速>30%',
    filters: {
      maxTotalMv: 1000000,
      minRevenueYoy: 30,
      minNetprofitYoy: 30,
      sortBy: ScreenerSortBy.NETPROFIT_YOY,
      sortOrder: 'desc',
    },
  },
  {
    id: 'main_inflow',
    name: '主力资金流入',
    description: '近5日主力净流入>0, 换手率>1%',
    filters: {
      minMainNetInflow5d: 0,
      minTurnoverRate: 1,
      sortBy: ScreenerSortBy.MAIN_NET_INFLOW_5D,
      sortOrder: 'desc',
    },
  },
]

const MAX_SCREENER_STRATEGIES = 20

@Injectable()
export class StockScreenerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: CacheService,
  ) {}

  async screener(query: StockScreenerQueryDto) {
    const page = query.page ?? 1
    const pageSize = query.pageSize ?? 20
    const offset = (page - 1) * pageSize
    const sortBy = query.sortBy ?? ScreenerSortBy.TOTAL_MV
    const sortOrder = query.sortOrder ?? 'desc'

    const stockConditions: Prisma.Sql[] = [Prisma.sql`sb.list_status = 'L'`]
    const valuationConditions: Prisma.Sql[] = []
    const marketConditions: Prisma.Sql[] = []
    const financialConditions: Prisma.Sql[] = []
    const moneyflowConditions: Prisma.Sql[] = []

    if (query.exchange) stockConditions.push(Prisma.sql`sb.exchange = ${query.exchange}::"StockExchange"`)
    if (query.market) stockConditions.push(Prisma.sql`sb.market = ${query.market}`)
    if (query.industry) stockConditions.push(Prisma.sql`sb.industry = ${query.industry}`)
    if (query.area) stockConditions.push(Prisma.sql`sb.area = ${query.area}`)
    if (query.isHs) stockConditions.push(Prisma.sql`sb.is_hs = ${query.isHs}`)

    // 估值
    if (query.minPeTtm !== undefined) valuationConditions.push(Prisma.sql`db.pe_ttm >= ${query.minPeTtm}`)
    if (query.maxPeTtm !== undefined) valuationConditions.push(Prisma.sql`db.pe_ttm <= ${query.maxPeTtm}`)
    if (query.minPb !== undefined) valuationConditions.push(Prisma.sql`db.pb >= ${query.minPb}`)
    if (query.maxPb !== undefined) valuationConditions.push(Prisma.sql`db.pb <= ${query.maxPb}`)
    if (query.minDvTtm !== undefined) valuationConditions.push(Prisma.sql`db.dv_ttm >= ${query.minDvTtm}`)
    if (query.minTotalMv !== undefined) valuationConditions.push(Prisma.sql`db.total_mv >= ${query.minTotalMv}`)
    if (query.maxTotalMv !== undefined) valuationConditions.push(Prisma.sql`db.total_mv <= ${query.maxTotalMv}`)
    if (query.minCircMv !== undefined) valuationConditions.push(Prisma.sql`db.circ_mv >= ${query.minCircMv}`)
    if (query.maxCircMv !== undefined) valuationConditions.push(Prisma.sql`db.circ_mv <= ${query.maxCircMv}`)
    if (query.minTurnoverRate !== undefined)
      valuationConditions.push(Prisma.sql`db.turnover_rate >= ${query.minTurnoverRate}`)
    if (query.maxTurnoverRate !== undefined)
      valuationConditions.push(Prisma.sql`db.turnover_rate <= ${query.maxTurnoverRate}`)

    // 行情
    if (query.minPctChg !== undefined) marketConditions.push(Prisma.sql`d.pct_chg >= ${query.minPctChg}`)
    if (query.maxPctChg !== undefined) marketConditions.push(Prisma.sql`d.pct_chg <= ${query.maxPctChg}`)
    if (query.minAmount !== undefined) marketConditions.push(Prisma.sql`d.amount >= ${query.minAmount}`)
    if (query.maxAmount !== undefined) marketConditions.push(Prisma.sql`d.amount <= ${query.maxAmount}`)

    // 成长
    if (query.minRevenueYoy !== undefined)
      financialConditions.push(Prisma.sql`fi.revenue_yoy >= ${query.minRevenueYoy}`)
    if (query.maxRevenueYoy !== undefined)
      financialConditions.push(Prisma.sql`fi.revenue_yoy <= ${query.maxRevenueYoy}`)
    if (query.minNetprofitYoy !== undefined)
      financialConditions.push(Prisma.sql`fi.netprofit_yoy >= ${query.minNetprofitYoy}`)
    if (query.maxNetprofitYoy !== undefined)
      financialConditions.push(Prisma.sql`fi.netprofit_yoy <= ${query.maxNetprofitYoy}`)

    // 盈利
    if (query.minRoe !== undefined) financialConditions.push(Prisma.sql`fi.roe >= ${query.minRoe}`)
    if (query.maxRoe !== undefined) financialConditions.push(Prisma.sql`fi.roe <= ${query.maxRoe}`)
    if (query.minGrossMargin !== undefined)
      financialConditions.push(Prisma.sql`fi.grossprofit_margin >= ${query.minGrossMargin}`)
    if (query.maxGrossMargin !== undefined)
      financialConditions.push(Prisma.sql`fi.grossprofit_margin <= ${query.maxGrossMargin}`)
    if (query.minNetMargin !== undefined)
      financialConditions.push(Prisma.sql`fi.netprofit_margin >= ${query.minNetMargin}`)
    if (query.maxNetMargin !== undefined)
      financialConditions.push(Prisma.sql`fi.netprofit_margin <= ${query.maxNetMargin}`)

    // 财务健康
    if (query.maxDebtToAssets !== undefined)
      financialConditions.push(Prisma.sql`fi.debt_to_assets <= ${query.maxDebtToAssets}`)
    if (query.minCurrentRatio !== undefined)
      financialConditions.push(Prisma.sql`fi.current_ratio >= ${query.minCurrentRatio}`)
    if (query.minQuickRatio !== undefined)
      financialConditions.push(Prisma.sql`fi.quick_ratio >= ${query.minQuickRatio}`)

    // 现金流
    if (query.minOcfToNetprofit !== undefined) {
      financialConditions.push(Prisma.sql`fi.ocf_to_netprofit >= ${query.minOcfToNetprofit}`)
    }

    // 资金流
    if (query.minMainNetInflow5d !== undefined) {
      moneyflowConditions.push(Prisma.sql`mf_agg.main_net_5d >= ${query.minMainNetInflow5d}`)
    }
    if (query.minMainNetInflow20d !== undefined) {
      moneyflowConditions.push(Prisma.sql`mf_agg.main_net_20d >= ${query.minMainNetInflow20d}`)
    }

    const whereClause = Prisma.sql`WHERE ${Prisma.join(
      [...stockConditions, ...valuationConditions, ...marketConditions, ...financialConditions, ...moneyflowConditions],
      ' AND ',
    )}`
    const sortCol = Prisma.raw(SCREENER_SORT_MAP[sortBy])
    const sortDir = Prisma.raw(sortOrder === 'asc' ? 'ASC NULLS LAST' : 'DESC NULLS LAST')

    const valuationJoin = Prisma.sql`
      LEFT JOIN LATERAL (
        SELECT pe_ttm, pb, dv_ttm, total_mv, circ_mv, turnover_rate
        FROM stock_daily_valuation_metrics
        WHERE ts_code = sb.ts_code
        ORDER BY trade_date DESC LIMIT 1
      ) db ON true`

    const marketJoin = Prisma.sql`
      LEFT JOIN LATERAL (
        SELECT trade_date, close, pct_chg, amount, vol
        FROM stock_daily_prices
        WHERE ts_code = sb.ts_code
        ORDER BY trade_date DESC LIMIT 1
      ) d ON true`

    const financialJoin = Prisma.sql`
      LEFT JOIN LATERAL (
        SELECT end_date, roe, grossprofit_margin, netprofit_margin,
               revenue_yoy, netprofit_yoy, debt_to_assets,
               current_ratio, quick_ratio, ocf_to_netprofit
        FROM financial_indicator_snapshots
        WHERE ts_code = sb.ts_code
        ORDER BY end_date DESC LIMIT 1
      ) fi ON true`

    const moneyflowAggregateJoin = Prisma.sql`
      LEFT JOIN LATERAL (
        SELECT
          SUM(CASE WHEN rn <= 5 THEN
            (COALESCE(buy_elg_amount, 0) - COALESCE(sell_elg_amount, 0)
             + COALESCE(buy_lg_amount, 0) - COALESCE(sell_lg_amount, 0))
          ELSE 0 END) AS main_net_5d,
          SUM(CASE WHEN rn <= 20 THEN
            (COALESCE(buy_elg_amount, 0) - COALESCE(sell_elg_amount, 0)
             + COALESCE(buy_lg_amount, 0) - COALESCE(sell_lg_amount, 0))
          ELSE 0 END) AS main_net_20d
        FROM (
          SELECT *, ROW_NUMBER() OVER (ORDER BY trade_date DESC) AS rn
          FROM stock_capital_flows
          WHERE ts_code = sb.ts_code
        ) sub
        WHERE rn <= 20
      ) mf_agg ON true`

    // 资金流 JOIN 按需拼接（聚合查询开销较高）
    const moneyflowJoin =
      moneyflowConditions.length > 0 || sortBy === ScreenerSortBy.MAIN_NET_INFLOW_5D
        ? moneyflowAggregateJoin
        : Prisma.sql`LEFT JOIN LATERAL (SELECT NULL::numeric AS main_net_5d, NULL::numeric AS main_net_20d) mf_agg ON true`

    const countValuationJoin = valuationConditions.length > 0 ? valuationJoin : Prisma.empty
    const countMarketJoin = marketConditions.length > 0 ? marketJoin : Prisma.empty
    const countFinancialJoin = financialConditions.length > 0 ? financialJoin : Prisma.empty
    const countMoneyflowJoin = moneyflowConditions.length > 0 ? moneyflowAggregateJoin : Prisma.empty

    interface ScreenerRow {
      tsCode: string
      name: string | null
      industry: string | null
      market: string | null
      listDate: Date | null
      close: number | null
      pctChg: number | null
      amount: number | null
      turnoverRate: number | null
      peTtm: number | null
      pb: number | null
      dvTtm: number | null
      totalMv: number | null
      circMv: number | null
      revenueYoy: number | null
      netprofitYoy: number | null
      roe: number | null
      grossMargin: number | null
      netMargin: number | null
      debtToAssets: number | null
      currentRatio: number | null
      quickRatio: number | null
      ocfToNetprofit: number | null
      latestFinDate: Date | null
      mainNetInflow5d: number | null
      mainNetInflow20d: number | null
    }

    const [countResult, items] = await Promise.all([
      this.prisma.$queryRaw<[{ count: bigint }]>`
        SELECT COUNT(*)::bigint AS count
        FROM stock_basic_profiles sb
        ${countValuationJoin}
        ${countMarketJoin}
        ${countFinancialJoin}
        ${countMoneyflowJoin}
        ${whereClause}
      `,
      this.prisma.$queryRaw<ScreenerRow[]>`
        SELECT
          sb.ts_code            AS "tsCode",
          sb.name,
          sb.industry,
          sb.market,
          sb.list_date          AS "listDate",
          d.close,
          d.pct_chg             AS "pctChg",
          d.amount,
          db.turnover_rate      AS "turnoverRate",
          db.pe_ttm             AS "peTtm",
          db.pb,
          db.dv_ttm             AS "dvTtm",
          db.total_mv           AS "totalMv",
          db.circ_mv            AS "circMv",
          fi.revenue_yoy        AS "revenueYoy",
          fi.netprofit_yoy      AS "netprofitYoy",
          fi.roe,
          fi.grossprofit_margin AS "grossMargin",
          fi.netprofit_margin   AS "netMargin",
          fi.debt_to_assets     AS "debtToAssets",
          fi.current_ratio      AS "currentRatio",
          fi.quick_ratio        AS "quickRatio",
          fi.ocf_to_netprofit   AS "ocfToNetprofit",
          fi.end_date           AS "latestFinDate",
          mf_agg.main_net_5d    AS "mainNetInflow5d",
          mf_agg.main_net_20d   AS "mainNetInflow20d"
        FROM stock_basic_profiles sb
        ${valuationJoin}
        ${marketJoin}
        ${financialJoin}
        ${moneyflowJoin}
        ${whereClause}
        ORDER BY ${sortCol} ${sortDir}
        LIMIT ${pageSize} OFFSET ${offset}
      `,
    ])

    const formatDate = (d: Date | null) => (d ? dayjs(d).format('YYYY-MM-DD') : null)

    return {
      page,
      pageSize,
      total: Number(countResult[0]?.count ?? 0),
      items: items.map((r) => ({
        ...r,
        listDate: formatDate(r.listDate),
        latestFinDate: formatDate(r.latestFinDate),
        peTtm: r.peTtm !== null ? Number(r.peTtm) : null,
        pb: r.pb !== null ? Number(r.pb) : null,
        dvTtm: r.dvTtm !== null ? Number(r.dvTtm) : null,
        totalMv: r.totalMv !== null ? Number(r.totalMv) : null,
        circMv: r.circMv !== null ? Number(r.circMv) : null,
        turnoverRate: r.turnoverRate !== null ? Number(r.turnoverRate) : null,
        close: r.close !== null ? Number(r.close) : null,
        pctChg: r.pctChg !== null ? Number(r.pctChg) : null,
        amount: r.amount !== null ? Number(r.amount) : null,
        revenueYoy: r.revenueYoy !== null ? Number(r.revenueYoy) : null,
        netprofitYoy: r.netprofitYoy !== null ? Number(r.netprofitYoy) : null,
        roe: r.roe !== null ? Number(r.roe) : null,
        grossMargin: r.grossMargin !== null ? Number(r.grossMargin) : null,
        netMargin: r.netMargin !== null ? Number(r.netMargin) : null,
        debtToAssets: r.debtToAssets !== null ? Number(r.debtToAssets) : null,
        currentRatio: r.currentRatio !== null ? Number(r.currentRatio) : null,
        quickRatio: r.quickRatio !== null ? Number(r.quickRatio) : null,
        ocfToNetprofit: r.ocfToNetprofit !== null ? Number(r.ocfToNetprofit) : null,
        mainNetInflow5d: r.mainNetInflow5d !== null ? Number(r.mainNetInflow5d) : null,
        mainNetInflow20d: r.mainNetInflow20d !== null ? Number(r.mainNetInflow20d) : null,
      })),
    }
  }

  async getIndustries() {
    return this.cacheService.rememberJson({
      namespace: CACHE_NAMESPACE.STOCK_METADATA,
      key: CACHE_KEY_PREFIX.STOCK_INDUSTRIES,
      ttlSeconds: CACHE_TTL_SECONDS.STOCK_METADATA,
      loader: async () => {
        interface IndustryRow {
          name: string
          count: bigint
        }

        const rows = await this.prisma.$queryRaw<IndustryRow[]>`
          SELECT industry AS name, COUNT(*)::bigint AS count
          FROM stock_basic_profiles
          WHERE list_status = 'L' AND industry IS NOT NULL AND industry != ''
          GROUP BY industry
          ORDER BY count DESC
        `

        return { industries: rows.map((r) => ({ name: r.name, count: Number(r.count) })) }
      },
    })
  }

  async getAreas() {
    return this.cacheService.rememberJson({
      namespace: CACHE_NAMESPACE.STOCK_METADATA,
      key: CACHE_KEY_PREFIX.STOCK_AREAS,
      ttlSeconds: CACHE_TTL_SECONDS.STOCK_METADATA,
      loader: async () => {
        interface AreaRow {
          name: string
          count: bigint
        }

        const rows = await this.prisma.$queryRaw<AreaRow[]>`
          SELECT area AS name, COUNT(*)::bigint AS count
          FROM stock_basic_profiles
          WHERE list_status = 'L' AND area IS NOT NULL AND area != ''
          GROUP BY area
          ORDER BY count DESC
        `

        return { areas: rows.map((r) => ({ name: r.name, count: Number(r.count) })) }
      },
    })
  }

  getScreenerPresets(): {
    presets: { id: string; name: string; description: string; filters: Record<string, unknown>; type: 'builtin' }[]
  } {
    return {
      presets: BUILT_IN_PRESETS.map((preset) => ({
        ...preset,
        type: 'builtin' as const,
      })),
    }
  }

  async getStrategies(userId: number) {
    const strategies = await this.prisma.screenerStrategy.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
    })

    return {
      strategies: strategies.map((strategy) => ({
        ...this.serializeStrategy(strategy),
        type: 'user' as const,
      })),
    }
  }

  async createStrategy(userId: number, dto: CreateScreenerStrategyDto) {
    const count = await this.prisma.screenerStrategy.count({ where: { userId } })
    if (count >= MAX_SCREENER_STRATEGIES) {
      throw new BadRequestException(`策略数量已达上限（最多 ${MAX_SCREENER_STRATEGIES} 条）`)
    }

    try {
      const strategy = await this.prisma.screenerStrategy.create({
        data: {
          userId,
          name: dto.name,
          description: dto.description ?? null,
          filters: this.serializeStrategyFilters(dto.filters),
          sortBy: dto.sortBy ?? null,
          sortOrder: dto.sortOrder ?? null,
        },
      })

      return this.serializeStrategy(strategy)
    } catch (error) {
      if (this.isStrategyNameConflict(error)) {
        throw new ConflictException('同名策略已存在')
      }

      throw error
    }
  }

  async updateStrategy(userId: number, id: number, dto: UpdateScreenerStrategyDto) {
    const existing = await this.prisma.screenerStrategy.findFirst({
      where: { id, userId },
      select: { id: true },
    })

    if (!existing) {
      throw new NotFoundException('策略不存在')
    }

    try {
      const strategy = await this.prisma.screenerStrategy.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.description !== undefined ? { description: dto.description } : {}),
          ...(dto.filters !== undefined ? { filters: this.serializeStrategyFilters(dto.filters) } : {}),
          ...(dto.sortBy !== undefined ? { sortBy: dto.sortBy } : {}),
          ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        },
      })

      return this.serializeStrategy(strategy)
    } catch (error) {
      if (this.isStrategyNameConflict(error)) {
        throw new ConflictException('同名策略已存在')
      }

      throw error
    }
  }

  async deleteStrategy(userId: number, id: number) {
    const existing = await this.prisma.screenerStrategy.findFirst({
      where: { id, userId },
      select: { id: true },
    })

    if (!existing) {
      throw new NotFoundException('策略不存在')
    }

    await this.prisma.screenerStrategy.delete({ where: { id } })
    return { message: '删除成功' }
  }

  private serializeStrategy(strategy: ScreenerStrategy) {
    return {
      id: strategy.id,
      name: strategy.name,
      description: strategy.description,
      filters: this.deserializeStrategyFilters(strategy.filters),
      sortBy: strategy.sortBy,
      sortOrder: strategy.sortOrder as 'asc' | 'desc' | null,
      createdAt: strategy.createdAt.toISOString(),
      updatedAt: strategy.updatedAt.toISOString(),
    }
  }

  private serializeStrategyFilters(filters: ScreenerFiltersDto): Prisma.InputJsonObject {
    return Object.fromEntries(
      Object.entries(filters).filter(([, value]) => value !== undefined),
    ) as Prisma.InputJsonObject
  }

  private deserializeStrategyFilters(filters: Prisma.JsonValue): Record<string, unknown> {
    if (!filters || typeof filters !== 'object' || Array.isArray(filters)) {
      return {}
    }

    return filters as Record<string, unknown>
  }

  private isStrategyNameConflict(error: unknown) {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
  }
}
