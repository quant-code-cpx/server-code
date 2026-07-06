import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { formatDateToCompactTradeDate, parseCompactTradeDateToUtcDate } from 'src/common/utils/trade-date.util'
import { PrismaService } from 'src/shared/prisma.service'
import { AlertLimitListDto, AlertLimitNextDayPerfDto, AlertLimitSummaryDto } from './dto/alert-limit.dto'

export interface LimitMeta {
  requestedDate: string | null
  actualDate: string | null
  isHoliday: boolean
}

type LimitItemsQuery = Pick<
  AlertLimitListDto,
  'limitType' | 'industry' | 'keyword' | 'minStreak' | 'sortBy' | 'sortOrder'
>

@Injectable()
export class AlertLimitService {
  constructor(private readonly prisma: PrismaService) {}

  async list(dto: AlertLimitListDto) {
    const { actualDate, meta } = await this.resolveTradeDate(dto.tradeDate)
    if (!actualDate) return { page: dto.page ?? 1, pageSize: dto.pageSize ?? 50, total: 0, items: [], meta }

    const items = await this.loadLimitItems(actualDate, dto)
    const page = dto.page ?? 1
    const pageSize = dto.pageSize ?? 50
    const total = items.length
    return {
      page,
      pageSize,
      total,
      items: items.slice((page - 1) * pageSize, page * pageSize),
      meta,
    }
  }

  async summary(dto: AlertLimitSummaryDto) {
    const range = Math.max(1, dto.range ?? 1)

    // 找到最近 range 个交易日
    const { actualDate } = await this.resolveTradeDate(dto.tradeDate)
    if (!actualDate) return []

    const anchorDate = parseCompactTradeDateToUtcDate(actualDate)
    const rows = await this.prisma.$queryRaw<
      Array<{ trade_date: Date | string; limit_up: number; limit_down: number; max_streak: number | null }>
    >(Prisma.sql`
      WITH recent_dates AS (
        SELECT DISTINCT trade_date
        FROM limit_list_d
        WHERE trade_date <= ${anchorDate}
        ORDER BY trade_date DESC
        LIMIT ${range}
      )
      SELECT
        l.trade_date,
        COUNT(*) FILTER (WHERE l.limit = 'U')::int AS limit_up,
        COUNT(*) FILTER (WHERE l.limit = 'D')::int AS limit_down,
        MAX(COALESCE(l.limit_times, substring(l.up_stat from '([0-9]+)')::int, 1))::int AS max_streak
      FROM limit_list_d l
      INNER JOIN recent_dates d ON d.trade_date = l.trade_date
      GROUP BY l.trade_date
      ORDER BY l.trade_date ASC
    `)

    return rows.map((row) => ({
      date:
        row.trade_date instanceof Date
          ? (formatDateToCompactTradeDate(row.trade_date) ?? '')
          : String(row.trade_date).replace(/-/g, '').slice(0, 8),
      limitUp: Number(row.limit_up ?? 0),
      limitDown: Number(row.limit_down ?? 0),
      maxStreak: Number(row.max_streak ?? 0),
      sealRate: null,
      promoteRate: null,
      failRate: null,
    }))
  }

  async nextDayPerf(dto: AlertLimitNextDayPerfDto) {
    const { actualDate, meta } = await this.resolveTradeDate(dto.tradeDate)
    if (!actualDate) return { meta, nextTradeDate: null, total: 0, avgPctChg: null, upRatio: null, items: [] }

    const baseItems = await this.loadLimitItems(actualDate, {
      limitType: dto.limitType,
      minStreak: dto.minStreak,
    })
    const tsCodes = baseItems.map((i) => i.tsCode)
    if (!tsCodes.length) return { meta, nextTradeDate: null, total: 0, avgPctChg: null, upRatio: null, items: [] }

    const baseDate = parseCompactTradeDateToUtcDate(actualDate)
    const nextDaily = await this.prisma.daily.findFirst({
      where: { tradeDate: { gt: baseDate } },
      orderBy: { tradeDate: 'asc' },
      select: { tradeDate: true },
    })
    if (!nextDaily)
      return { meta, nextTradeDate: null, total: tsCodes.length, avgPctChg: null, upRatio: null, items: [] }

    const nextRows = await this.prisma.daily.findMany({
      where: { tsCode: { in: tsCodes }, tradeDate: nextDaily.tradeDate },
      select: { tsCode: true, close: true, pctChg: true },
    })
    const nextMap = new Map(nextRows.map((r) => [r.tsCode, r]))
    const items = baseItems.map((item) => {
      const next = nextMap.get(item.tsCode)
      return { ...item, nextClose: next?.close ?? null, nextPctChg: next?.pctChg ?? null }
    })
    const valid = items.filter((i) => i.nextPctChg != null)
    const avgPctChg = valid.length ? valid.reduce((s, i) => s + Number(i.nextPctChg), 0) / valid.length : null
    const upRatio = valid.length ? valid.filter((i) => Number(i.nextPctChg) > 0).length / valid.length : null

    return {
      meta,
      nextTradeDate: formatDateToCompactTradeDate(nextDaily.tradeDate),
      total: baseItems.length,
      avgPctChg: avgPctChg == null ? null : Math.round(avgPctChg * 10000) / 10000,
      upRatio: upRatio == null ? null : Math.round(upRatio * 10000) / 10000,
      items,
    }
  }

  private async resolveTradeDate(requestedDate?: string): Promise<{ actualDate: string | null; meta: LimitMeta }> {
    const requested = requestedDate ? parseCompactTradeDateToUtcDate(requestedDate) : undefined
    const latest = await this.prisma.limitListD.findFirst({
      where: requested ? { tradeDate: { lte: requested } } : undefined,
      orderBy: { tradeDate: 'desc' },
      select: { tradeDate: true },
    })
    const actualDate = formatDateToCompactTradeDate(latest?.tradeDate)
    return {
      actualDate,
      meta: {
        requestedDate: requestedDate ?? null,
        actualDate,
        isHoliday: Boolean(requestedDate && actualDate && requestedDate !== actualDate),
      },
    }
  }

  private async loadLimitItems(actualDate: string, dto: LimitItemsQuery) {
    const where = this.buildWhere(actualDate, dto)
    const rows = await this.prisma.limitListD.findMany({ where })
    const concepts = await this.loadConcepts(rows.map((r) => r.tsCode))

    let items = rows.map((r) => this.mapLimitRow(r, concepts.get(r.tsCode) ?? []))
    if (dto.minStreak) items = items.filter((i) => i.streakDays >= dto.minStreak!)

    const sortBy = dto.sortBy ?? 'sealRatio'
    const sortOrder = dto.sortOrder ?? 'desc'
    items.sort((a, b) => {
      const av = Number(a[sortBy] ?? 0)
      const bv = Number(b[sortBy] ?? 0)
      return sortOrder === 'asc' ? av - bv : bv - av
    })

    return items
  }

  private buildWhere(actualDate: string, dto: LimitItemsQuery): Prisma.LimitListDWhereInput {
    return {
      tradeDate: parseCompactTradeDateToUtcDate(actualDate),
      ...(dto.limitType ? { limit: dto.limitType === 'UP' ? 'U' : 'D' } : {}),
      ...(dto.industry ? { industry: { contains: dto.industry, mode: 'insensitive' } } : {}),
      ...(dto.keyword
        ? {
            OR: [
              { tsCode: { contains: dto.keyword, mode: 'insensitive' } },
              { name: { contains: dto.keyword, mode: 'insensitive' } },
            ],
          }
        : {}),
    }
  }

  private mapLimitRow(row: Awaited<ReturnType<PrismaService['limitListD']['findMany']>>[number], concepts: string[]) {
    const streakDays = this.getStreakDays(row)
    const sealRatio = row.amount && row.fdAmount ? Number(row.fdAmount) / Number(row.amount) : null
    // fdPercent: 封单金额(万元) / 流通市值(亿元*10000) × 100，即封单占流通市值百分比
    const fdPercent =
      row.floatMv && row.fdAmount
        ? Math.round((Number(row.fdAmount) / (Number(row.floatMv) * 10000)) * 100 * 10000) / 10000
        : null
    return {
      tradeDate: formatDateToCompactTradeDate(row.tradeDate),
      tsCode: row.tsCode,
      name: row.name,
      stockName: row.name,
      industry: row.industry ?? null,
      concepts,
      close: row.close,
      pctChg: row.pctChg,
      amount: row.amount,
      floatMv: row.floatMv,
      totalMv: row.totalMv,
      turnoverRatio: row.turnoverRatio,
      firstTime: row.firstTime,
      lastTime: row.lastTime,
      firstSealTime: row.firstTime,
      lastSealTime: row.lastTime,
      openTimes: row.openTimes,
      limitType: this.normalizeLimitType(row.limit),
      pctChgLimit: row.pctChg,
      sealPattern: this.getSealPattern(row.firstTime, row.openTimes),
      sealRatio: sealRatio == null ? null : Math.round(sealRatio * 10000) / 10000,
      fdPercent,
      streakDays,
      streakStatus: this.normalizeLimitType(row.limit) === 'DOWN' ? `${streakDays}连跌停` : `${streakDays}连板`,
      upStat: row.upStat,
    }
  }

  private getSealPattern(
    firstTime: string | null,
    openTimes: number | null,
  ): 'ONE_LINE' | 'EARLY_SEAL' | 'LATE_SEAL' | 'REOPENED' {
    if ((openTimes ?? 0) > 0) return 'REOPENED'
    if (!firstTime) return 'LATE_SEAL'
    const compact = firstTime.replace(/:/g, '')
    if (compact <= '093100') return 'ONE_LINE'
    if (compact <= '100000') return 'EARLY_SEAL'
    return 'LATE_SEAL'
  }

  private getStreakDays(row: { limitTimes: number | null; upStat: string | null }): number {
    if (row.limitTimes && row.limitTimes > 0) return row.limitTimes
    const match = row.upStat?.match(/(\d+)/)
    return match ? Number(match[1]) : 1
  }

  private normalizeLimitType(limit: string | null): 'UP' | 'DOWN' | 'OTHER' {
    if (limit === 'U') return 'UP'
    if (limit === 'D') return 'DOWN'
    return 'OTHER'
  }

  private async loadConcepts(tsCodes: string[]): Promise<Map<string, string[]>> {
    if (!tsCodes.length) return new Map()
    interface ConceptRow {
      con_code: string
      concepts: string[]
    }
    const rows = await this.prisma.$queryRaw<ConceptRow[]>(Prisma.sql`
      SELECT m.con_code, ARRAY_AGG(b.name ORDER BY b.name) AS concepts
      FROM ths_index_members m
      INNER JOIN ths_index_boards b ON b.ts_code = m.ts_code
      WHERE m.con_code IN (${Prisma.join(tsCodes)})
        AND COALESCE(m.is_new, 'Y') = 'Y'
        AND b.type = 'N'
      GROUP BY m.con_code
    `)
    return new Map(rows.map((r) => [r.con_code, r.concepts ?? []]))
  }
}
