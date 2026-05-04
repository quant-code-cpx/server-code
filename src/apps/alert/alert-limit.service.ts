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

@Injectable()
export class AlertLimitService {
  constructor(private readonly prisma: PrismaService) {}

  async list(dto: AlertLimitListDto) {
    const { actualDate, meta } = await this.resolveTradeDate(dto.tradeDate)
    if (!actualDate) return { page: dto.page ?? 1, pageSize: dto.pageSize ?? 50, total: 0, items: [], meta }

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
    const { actualDate, meta } = await this.resolveTradeDate(dto.tradeDate)
    if (!actualDate) return { meta, total: 0, byLimitType: {}, byIndustry: [], topStreaks: [] }

    const rows = await this.prisma.limitListD.findMany({
      where: { tradeDate: parseCompactTradeDateToUtcDate(actualDate) },
    })
    const byLimitType = rows.reduce<Record<string, number>>((acc, r) => {
      const key = this.normalizeLimitType(r.limit)
      acc[key] = (acc[key] ?? 0) + 1
      return acc
    }, {})
    const byIndustryMap = new Map<string, number>()
    for (const row of rows)
      byIndustryMap.set(row.industry ?? '未分类', (byIndustryMap.get(row.industry ?? '未分类') ?? 0) + 1)
    const byIndustry = [...byIndustryMap.entries()]
      .map(([industry, count]) => ({ industry, count }))
      .sort((a, b) => b.count - a.count)

    const topStreaks = rows
      .map((r) => ({
        tsCode: r.tsCode,
        name: r.name,
        streakDays: this.getStreakDays(r),
        limitType: this.normalizeLimitType(r.limit),
      }))
      .sort((a, b) => b.streakDays - a.streakDays)
      .slice(0, 20)

    return { meta, total: rows.length, byLimitType, byIndustry, topStreaks }
  }

  async nextDayPerf(dto: AlertLimitNextDayPerfDto) {
    const { actualDate, meta } = await this.resolveTradeDate(dto.tradeDate)
    if (!actualDate) return { meta, nextTradeDate: null, total: 0, avgPctChg: null, upRatio: null, items: [] }

    const listResult = await this.list({
      tradeDate: actualDate,
      limitType: dto.limitType,
      minStreak: dto.minStreak,
      page: 1,
      pageSize: 200,
    })
    const tsCodes = listResult.items.map((i) => i.tsCode)
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
    const items = listResult.items.map((item) => {
      const next = nextMap.get(item.tsCode)
      return { ...item, nextClose: next?.close ?? null, nextPctChg: next?.pctChg ?? null }
    })
    const valid = items.filter((i) => i.nextPctChg != null)
    const avgPctChg = valid.length ? valid.reduce((s, i) => s + Number(i.nextPctChg), 0) / valid.length : null
    const upRatio = valid.length ? valid.filter((i) => Number(i.nextPctChg) > 0).length / valid.length : null

    return {
      meta,
      nextTradeDate: formatDateToCompactTradeDate(nextDaily.tradeDate),
      total: tsCodes.length,
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

  private buildWhere(actualDate: string, dto: AlertLimitListDto): Prisma.LimitListDWhereInput {
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
    return {
      tradeDate: formatDateToCompactTradeDate(row.tradeDate),
      tsCode: row.tsCode,
      name: row.name,
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
      openTimes: row.openTimes,
      limitType: this.normalizeLimitType(row.limit),
      pctChgLimit: row.pctChg,
      sealPattern: this.getSealPattern(row.firstTime, row.openTimes),
      sealRatio: sealRatio == null ? null : Math.round(sealRatio * 10000) / 10000,
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
