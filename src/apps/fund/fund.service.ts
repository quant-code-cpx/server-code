import { Injectable, Logger } from '@nestjs/common'
import dayjs from 'dayjs'
import { PrismaService } from 'src/shared/prisma.service'
import { FundHoldingsQueryDto } from './dto/fund-holdings-query.dto'
import { FundInstitutionalSummaryQueryDto } from './dto/fund-institutional-summary-query.dto'
import { FundEtfFlowQueryDto } from './dto/fund-etf-flow-query.dto'
import { FundHoldingItemDto, FundInstitutionalSummaryItemDto, FundEtfFlowItemDto } from './dto/fund-response.dto'

@Injectable()
export class FundService {
  private readonly logger = new Logger(FundService.name)

  constructor(private readonly prisma: PrismaService) {}

  // ─── 工具方法 ────────────────────────────────────────────────────────────────

  private parseDate(dateStr: string): Date {
    return dayjs(dateStr, 'YYYYMMDD').toDate()
  }

  private formatDate(date: Date): string {
    return dayjs(date).format('YYYYMMDD')
  }

  /** 获取 fund_portfolio 中最新的报告期 */
  private async resolveLatestEndDate(): Promise<Date | null> {
    const row = await this.prisma.fundPortfolio.findFirst({
      orderBy: { endDate: 'desc' },
      select: { endDate: true },
    })
    return row?.endDate ?? null
  }

  // ─── 1. 基金持仓明细 ────────────────────────────────────────────────────────

  async getFundHoldings(query: FundHoldingsQueryDto): Promise<FundHoldingItemDto[]> {
    const endDate = query.end_date ? this.parseDate(query.end_date) : await this.resolveLatestEndDate()

    if (!endDate) {
      return []
    }

    const rows = await this.prisma.fundPortfolio.findMany({
      where: {
        endDate,
        ...(query.ts_code ? { tsCode: query.ts_code } : {}),
      },
      orderBy: [{ tsCode: 'asc' }, { mkv: 'desc' }],
    })

    if (rows.length === 0) {
      return []
    }

    // 批量查询基金名称
    const fundCodes = [...new Set(rows.map((r) => r.tsCode))]
    const basics = await this.prisma.fundBasic.findMany({
      where: { tsCode: { in: fundCodes } },
      select: { tsCode: true, name: true },
    })
    const nameMap = new Map(basics.map((b) => [b.tsCode, b.name]))

    return rows.map((r) => ({
      ts_code: r.tsCode,
      fund_name: nameMap.get(r.tsCode) ?? null,
      end_date: this.formatDate(r.endDate),
      ann_date: this.formatDate(r.annDate),
      symbol: r.symbol,
      mkv: r.mkv,
      amount: r.amount,
      stk_mkv_ratio: r.stkMkvRatio,
      stk_float_ratio: r.stkFloatRatio,
    }))
  }

  // ─── 2. 机构持仓汇总（按股票聚合） ─────────────────────────────────────────

  async getInstitutionalSummary(query: FundInstitutionalSummaryQueryDto): Promise<FundInstitutionalSummaryItemDto[]> {
    const endDate = query.end_date ? this.parseDate(query.end_date) : await this.resolveLatestEndDate()

    if (!endDate) {
      return []
    }

    const rows = await this.prisma.fundPortfolio.findMany({
      where: {
        endDate,
        ...(query.symbol ? { symbol: query.symbol } : {}),
      },
    })

    if (rows.length === 0) {
      return []
    }

    // 批量查询基金名称
    const fundCodes = [...new Set(rows.map((r) => r.tsCode))]
    const basics = await this.prisma.fundBasic.findMany({
      where: { tsCode: { in: fundCodes } },
      select: { tsCode: true, name: true },
    })
    const nameMap = new Map(basics.map((b) => [b.tsCode, b.name]))

    // 按 symbol 分组聚合
    const groupMap = new Map<string, typeof rows>()
    for (const row of rows) {
      const list = groupMap.get(row.symbol) ?? []
      list.push(row)
      groupMap.set(row.symbol, list)
    }

    const result: FundInstitutionalSummaryItemDto[] = []

    for (const [symbol, items] of groupMap.entries()) {
      const total_mkv = items.reduce((s, r) => s + (r.mkv ?? 0), 0)
      const total_amount = items.reduce((s, r) => s + (r.amount ?? 0), 0)
      const validFloatRatios = items.map((r) => r.stkFloatRatio).filter((v): v is number => v != null)
      const avg_stk_float_ratio =
        validFloatRatios.length > 0 ? validFloatRatios.reduce((s, v) => s + v, 0) / validFloatRatios.length : null

      result.push({
        symbol,
        end_date: this.formatDate(endDate),
        fund_count: items.length,
        total_mkv: total_mkv || null,
        total_amount: total_amount || null,
        avg_stk_float_ratio,
        holders: items.map((r) => ({
          ts_code: r.tsCode,
          fund_name: nameMap.get(r.tsCode) ?? null,
          mkv: r.mkv,
          amount: r.amount,
          stk_mkv_ratio: r.stkMkvRatio,
          stk_float_ratio: r.stkFloatRatio,
        })),
      })
    }

    // 按合计市值降序排列
    result.sort((a, b) => (b.total_mkv ?? 0) - (a.total_mkv ?? 0))

    return query.limit ? result.slice(0, query.limit) : result
  }

  // ─── 3. ETF 资金流向（份额变化） ────────────────────────────────────────────

  async getEtfFlow(query: FundEtfFlowQueryDto): Promise<FundEtfFlowItemDto[]> {
    const days = query.days ?? 7
    let startDate: Date

    if (query.start_date) {
      startDate = this.parseDate(query.start_date)
    } else {
      // 查询最新交易日，再往前推 days 天
      const latest = await this.prisma.fundShare.findFirst({
        orderBy: { tradeDate: 'desc' },
        select: { tradeDate: true },
      })
      if (!latest) {
        return []
      }
      startDate = dayjs(latest.tradeDate)
        .subtract(days - 1, 'day')
        .toDate()
    }

    const rows = await this.prisma.fundShare.findMany({
      where: {
        tradeDate: { gte: startDate },
        ...(query.ts_code ? { tsCode: query.ts_code } : {}),
      },
      orderBy: [{ tsCode: 'asc' }, { tradeDate: 'asc' }],
    })

    if (rows.length === 0) {
      return []
    }

    // 批量查询基金名称（ETF 场内，market='E'）
    const fundCodes = [...new Set(rows.map((r) => r.tsCode))]
    const basics = await this.prisma.fundBasic.findMany({
      where: { tsCode: { in: fundCodes } },
      select: { tsCode: true, name: true },
    })
    const nameMap = new Map(basics.map((b) => [b.tsCode, b.name]))

    // 按 tsCode 分组，计算相邻日份额差
    const prevShareMap = new Map<string, number | null>()

    return rows.map((r) => {
      const prev = prevShareMap.get(r.tsCode) ?? null
      const delta = r.fdShare != null && prev != null ? r.fdShare - prev : null
      prevShareMap.set(r.tsCode, r.fdShare ?? null)

      const flow_direction: FundEtfFlowItemDto['flow_direction'] =
        delta == null || delta === 0 ? 'flat' : delta > 0 ? 'inflow' : 'outflow'

      return {
        ts_code: r.tsCode,
        fund_name: nameMap.get(r.tsCode) ?? null,
        trade_date: this.formatDate(r.tradeDate),
        fd_share: r.fdShare,
        share_delta: delta,
        flow_direction,
      }
    })
  }
}
