import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { MarketAnomalyType, Prisma } from '@prisma/client'
import dayjs from 'dayjs'
import { formatDateToCompactTradeDate, parseCompactTradeDateToUtcDate } from 'src/common/utils/trade-date.util'
import { PrismaService } from 'src/shared/prisma.service'
import { EventsGateway } from 'src/websocket/events.gateway'
import {
  AnomalySortField,
  MarketAnomalyDetailDto,
  MarketAnomalyDto,
  MarketAnomalyListResponseDto,
  MarketAnomalyQueryDto,
} from './dto/market-anomaly.dto'

const VOLUME_SURGE_MULTIPLIER = 3.0
const CONSECUTIVE_LIMIT_MIN = 2
const LARGE_INFLOW_RATIO = 0.15

@Injectable()
export class MarketAnomalyService {
  private readonly logger = new Logger(MarketAnomalyService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventsGateway: EventsGateway,
  ) {}

  // ── 统计聚合（standalone，不依赖分页） ──────────────────────────────────────

  async getSummary(tradeDate?: string) {
    let parsedDate: Date | undefined
    if (tradeDate) {
      parsedDate = parseCompactTradeDateToUtcDate(tradeDate)
    } else {
      const latest = await this.prisma.marketAnomaly.findFirst({
        orderBy: { tradeDate: 'desc' },
        select: { tradeDate: true },
      })
      if (!latest) return { tradeDate: null, byType: {}, total: 0, latestScanAt: null }
      parsedDate = latest.tradeDate
    }

    const [typeCountRows, latestScan] = await Promise.all([
      this.prisma.marketAnomaly.groupBy({
        by: ['anomalyType'],
        where: { tradeDate: parsedDate },
        _count: { _all: true },
      }),
      this.prisma.marketAnomaly.findFirst({
        where: { tradeDate: parsedDate },
        orderBy: { scannedAt: 'desc' },
        select: { scannedAt: true },
      }),
    ])

    const byType = Object.fromEntries(typeCountRows.map((r) => [r.anomalyType, r._count._all]))
    const total = typeCountRows.reduce((s, r) => s + r._count._all, 0)

    return {
      tradeDate: formatDateToCompactTradeDate(parsedDate),
      byType,
      total,
      latestScanAt: latestScan?.scannedAt?.toISOString() ?? null,
    }
  }

  // ── 单条异动详情 ────────────────────────────────────────────────────────────

  async getDetail(id: number) {
    const row = await this.prisma.marketAnomaly.findUnique({ where: { id } })
    if (!row) return null

    const strength = row.threshold > 0 ? row.value / row.threshold : row.value

    // Enrich with stock name from stockBasic if missing
    let stockName = row.stockName
    if (!stockName) {
      const stock = await this.prisma.stockBasic.findFirst({
        where: { tsCode: row.tsCode },
        select: { name: true },
      })
      stockName = stock?.name ?? null
    }

    return {
      id: row.id,
      tradeDate: formatDateToCompactTradeDate(row.tradeDate),
      tsCode: row.tsCode,
      stockName,
      anomalyType: row.anomalyType,
      value: row.value,
      threshold: row.threshold,
      strength,
      detail: row.detail as MarketAnomalyDetailDto | null,
      metrics: row.detail ?? { value: row.value, threshold: row.threshold },
      unit: this.getUnit(row.anomalyType),
      reason: this.getReason(row.anomalyType),
      sourceTables: this.getSourceTables(row.anomalyType),
      relatedAnomalies: await this.findRelatedAnomalies(row.tsCode, row.id, row.tradeDate),
      history: await this.findAnomalyHistory(row.tsCode, row.anomalyType),
      scannedAt: row.scannedAt,
    }
  }

  // ── 查询接口 ────────────────────────────────────────────────────────────────

  async queryAnomalies(query: MarketAnomalyQueryDto): Promise<MarketAnomalyListResponseDto> {
    const page = query.page ?? 1
    const pageSize = query.pageSize ?? 20
    const sortBy: AnomalySortField = query.sortBy ?? 'strength'
    const sortOrder = query.sortOrder ?? 'desc'

    // 解析 tradeDate：不传则取最新
    let tradeDate: Date | undefined
    if (query.tradeDate) {
      tradeDate = parseCompactTradeDateToUtcDate(query.tradeDate)
    } else {
      const latest = await this.prisma.marketAnomaly.findFirst({
        orderBy: { tradeDate: 'desc' },
        select: { tradeDate: true },
      })
      if (!latest) {
        return { page, pageSize, total: 0, items: [], stats: { byType: {}, total: 0 } }
      }
      tradeDate = latest.tradeDate
    }

    const typeFilter = query.types?.length ? { in: query.types } : query.type
    const where: Prisma.MarketAnomalyWhereInput = {
      tradeDate,
      ...(typeFilter ? { anomalyType: typeFilter } : {}),
      ...(query.tsCode ? { tsCode: query.tsCode } : {}),
      ...(query.keyword
        ? {
            OR: [
              { tsCode: { contains: query.keyword, mode: 'insensitive' } },
              { stockName: { contains: query.keyword, mode: 'insensitive' } },
            ],
          }
        : {}),
    }

    // 全量数据（per-tradeDate 数量有限，可安全全量取，后续在内存中做强度过滤/多类型过滤）
    const allRows = await this.prisma.marketAnomaly.findMany({ where })

    // 强度 = value / threshold（用于跨类型规范化排序）
    let withStrength = allRows.map((r) => ({ ...r, strength: r.threshold > 0 ? r.value / r.threshold : r.value }))
    if (query.severity) {
      withStrength = withStrength.filter((r) => this.matchSeverity(r.strength, query.severity!))
    }
    if (query.multiTypeOnly) {
      const typeCounts = new Map<string, Set<string>>()
      for (const row of withStrength) {
        const set = typeCounts.get(row.tsCode) ?? new Set<string>()
        set.add(row.anomalyType)
        typeCounts.set(row.tsCode, set)
      }
      withStrength = withStrength.filter((r) => (typeCounts.get(r.tsCode)?.size ?? 0) > 1)
    }
    if (query.isNewOnly) {
      const latestScanAt = withStrength.reduce<Date | null>(
        (latest, r) => (!latest || r.scannedAt > latest ? r.scannedAt : latest),
        null,
      )
      if (latestScanAt)
        withStrength = withStrength.filter((r) => Math.abs(r.scannedAt.getTime() - latestScanAt.getTime()) <= 60_000)
    }

    const total = withStrength.length
    const byType = withStrength.reduce<Record<string, number>>((acc, r) => {
      acc[r.anomalyType] = (acc[r.anomalyType] ?? 0) + 1
      return acc
    }, {})

    // 排序
    withStrength.sort((a, b) => {
      let cmp = 0
      if (sortBy === 'strength') cmp = a.strength - b.strength
      else if (sortBy === 'value') cmp = a.value - b.value
      else if (sortBy === 'scannedAt') cmp = a.scannedAt.getTime() - b.scannedAt.getTime()
      else if (sortBy === 'tsCode') cmp = a.tsCode.localeCompare(b.tsCode)
      else if (sortBy === 'anomalyType') cmp = a.anomalyType.localeCompare(b.anomalyType)

      if (cmp !== 0) return sortOrder === 'asc' ? cmp : -cmp
      // 稳定次级排序：strength desc → value desc → id desc
      if (sortBy !== 'strength') {
        const strengthDiff = b.strength - a.strength
        if (strengthDiff !== 0) return strengthDiff
      }
      if (sortBy !== 'value') {
        const valueDiff = b.value - a.value
        if (valueDiff !== 0) return valueDiff
      }
      return b.id - a.id
    })

    // 分页
    const rows = withStrength.slice((page - 1) * pageSize, page * pageSize)

    const items: MarketAnomalyDto[] = rows.map((r) => ({
      id: r.id,
      tradeDate: formatDateToCompactTradeDate(r.tradeDate) ?? '',
      tsCode: r.tsCode,
      stockName: r.stockName,
      anomalyType: r.anomalyType,
      value: r.value,
      threshold: r.threshold,
      strength: r.strength,
      detail: r.detail as MarketAnomalyDetailDto | null,
      scannedAt: r.scannedAt,
    }))

    return { page, pageSize, total, items, stats: { byType, total } }
  }

  // ── 盘后扫描 ────────────────────────────────────────────────────────────────

  /**
   * 每日 19:00（上海时间，工作日）盘后异动扫描。
   * 与价格预警使用相同时间窗口，各自独立不阻塞。
   */
  @Cron('0 0 19 * * 1-5', { timeZone: 'Asia/Shanghai' })
  async dailyScan() {
    this.logger.log('定时任务：开始盘后异动监控扫描')
    try {
      await this.runScan()
    } catch (err) {
      this.logger.error('异动监控扫描异常', (err as Error).stack)
    }
  }

  async runScan(): Promise<{
    tradeDate: string
    volumeSurgeCount: number
    limitUpCount: number
    largeInflowCount: number
    totalNew: number
  }> {
    // 获取最新交易日
    const latestDaily = await this.prisma.daily.findFirst({
      orderBy: { tradeDate: 'desc' },
      select: { tradeDate: true },
    })
    if (!latestDaily) {
      this.logger.warn('异动监控：数据库中没有日行情数据，跳过扫描')
      return { tradeDate: '', volumeSurgeCount: 0, limitUpCount: 0, largeInflowCount: 0, totalNew: 0 }
    }

    const latestTradeDate = latestDaily.tradeDate
    const tradeDateStr = formatDateToCompactTradeDate(latestTradeDate) ?? ''

    const [volumeSurgeCount, limitUpCount, largeInflowCount] = await Promise.all([
      this.scanVolumeSurge(latestTradeDate, tradeDateStr),
      this.scanConsecutiveLimitUp(latestTradeDate, tradeDateStr),
      this.scanLargeNetInflow(latestTradeDate, tradeDateStr),
    ])

    const totalNew = volumeSurgeCount + limitUpCount + largeInflowCount

    this.logger.log(
      `异动扫描完成 [${tradeDateStr}]：量能异动 ${volumeSurgeCount}，连板 ${limitUpCount}，大单流入 ${largeInflowCount}，合计 ${totalNew}`,
    )

    this.eventsGateway.broadcastNotification('market-anomaly-scan-completed', {
      tradeDate: tradeDateStr,
      volumeSurgeCount,
      limitUpCount,
      largeInflowCount,
      totalNew,
    })

    return { tradeDate: tradeDateStr, volumeSurgeCount, limitUpCount, largeInflowCount, totalNew }
  }

  // ── VOLUME_SURGE ───────────────────────────────────────────────────────────

  private async scanVolumeSurge(latestTradeDate: Date, tradeDateStr: string) {
    // 取最近 21 个交易日数据（最新日 + 前 20 日）
    const cutoff = dayjs(latestTradeDate).subtract(30, 'day').toDate()
    const rows = await this.prisma.daily.findMany({
      where: { tradeDate: { gte: cutoff, lte: latestTradeDate } },
      select: { tsCode: true, tradeDate: true, vol: true },
      orderBy: [{ tsCode: 'asc' }, { tradeDate: 'asc' }],
    })

    // 按 tsCode 分组
    const byCode = new Map<string, { tradeDate: Date; vol: number | null }[]>()
    for (const r of rows) {
      if (!byCode.has(r.tsCode)) byCode.set(r.tsCode, [])
      byCode.get(r.tsCode)!.push({ tradeDate: r.tradeDate, vol: r.vol })
    }

    const latestTs = latestTradeDate.getTime()
    const stockNames = await this.fetchStockNames([...byCode.keys()])

    const upserts: Promise<unknown>[] = []
    let count = 0

    for (const [tsCode, records] of byCode) {
      // 只取最新交易日为目标日的记录
      const sorted = records.sort((a, b) => a.tradeDate.getTime() - b.tradeDate.getTime())
      const latest = sorted[sorted.length - 1]
      if (latest.tradeDate.getTime() !== latestTs) continue
      if (latest.vol == null) continue

      // 取前 20 日计算均量（排除最新日）
      const prior = sorted.slice(-21, -1).filter((r) => r.vol != null)
      if (prior.length < 5) continue // 数据不足

      const avg20Vol = prior.reduce((s, r) => s + r.vol!, 0) / prior.length
      if (avg20Vol <= 0) continue

      const ratio = latest.vol / avg20Vol
      if (ratio >= VOLUME_SURGE_MULTIPLIER) {
        count++
        upserts.push(
          this.prisma.marketAnomaly.upsert({
            where: {
              tradeDate_tsCode_anomalyType: {
                tradeDate: latestTradeDate,
                tsCode,
                anomalyType: MarketAnomalyType.VOLUME_SURGE,
              },
            },
            create: {
              tradeDate: latestTradeDate,
              tsCode,
              stockName: stockNames.get(tsCode) ?? null,
              anomalyType: MarketAnomalyType.VOLUME_SURGE,
              value: ratio,
              threshold: VOLUME_SURGE_MULTIPLIER,
              detail: { vol: latest.vol, avg20Vol, tradeDateStr },
            },
            update: {
              stockName: stockNames.get(tsCode) ?? null,
              value: ratio,
              detail: { vol: latest.vol, avg20Vol, tradeDateStr },
              scannedAt: new Date(),
            },
          }),
        )
      }
    }

    await Promise.all(upserts)
    return count
  }

  // ── CONSECUTIVE_LIMIT_UP ──────────────────────────────────────────────────

  private async scanConsecutiveLimitUp(latestTradeDate: Date, tradeDateStr: string) {
    // 取最近 5 个交易日的日行情和涨跌停价
    const cutoff = dayjs(latestTradeDate).subtract(10, 'day').toDate()

    const [dailyRows, limitRows] = await Promise.all([
      this.prisma.daily.findMany({
        where: { tradeDate: { gte: cutoff, lte: latestTradeDate } },
        select: { tsCode: true, tradeDate: true, close: true },
        orderBy: [{ tsCode: 'asc' }, { tradeDate: 'asc' }],
      }),
      this.prisma.stkLimit.findMany({
        where: {
          tradeDate: {
            gte: formatDateToCompactTradeDate(cutoff) ?? '',
            lte: tradeDateStr,
          },
        },
        select: { tsCode: true, tradeDate: true, upLimit: true },
      }),
    ])

    // 构建涨停价 map: tsCode+tradeDate -> upLimit
    const limitMap = new Map<string, number>()
    for (const r of limitRows) {
      if (r.upLimit != null) {
        limitMap.set(`${r.tsCode}|${r.tradeDate}`, Number(r.upLimit))
      }
    }

    // 按 tsCode 分组日行情
    const byCode = new Map<string, { tradeDate: Date; close: number | null }[]>()
    for (const r of dailyRows) {
      if (!byCode.has(r.tsCode)) byCode.set(r.tsCode, [])
      byCode.get(r.tsCode)!.push({ tradeDate: r.tradeDate, close: r.close })
    }

    const latestTs = latestTradeDate.getTime()
    const stockNames = await this.fetchStockNames([...byCode.keys()])

    const upserts: Promise<unknown>[] = []
    let count = 0

    for (const [tsCode, records] of byCode) {
      const sorted = records.sort((a, b) => a.tradeDate.getTime() - b.tradeDate.getTime())
      const latest = sorted[sorted.length - 1]
      if (latest.tradeDate.getTime() !== latestTs) continue

      // 从最新日往前统计连续涨停天数
      let consecutiveDays = 0
      for (let i = sorted.length - 1; i >= 0; i--) {
        const rec = sorted[i]
        const tradeDateKey = formatDateToCompactTradeDate(rec.tradeDate) ?? ''
        const upLimit = limitMap.get(`${tsCode}|${tradeDateKey}`)
        if (rec.close != null && upLimit != null && rec.close >= upLimit) {
          consecutiveDays++
        } else {
          break
        }
      }

      if (consecutiveDays >= CONSECUTIVE_LIMIT_MIN) {
        count++
        upserts.push(
          this.prisma.marketAnomaly.upsert({
            where: {
              tradeDate_tsCode_anomalyType: {
                tradeDate: latestTradeDate,
                tsCode,
                anomalyType: MarketAnomalyType.CONSECUTIVE_LIMIT_UP,
              },
            },
            create: {
              tradeDate: latestTradeDate,
              tsCode,
              stockName: stockNames.get(tsCode) ?? null,
              anomalyType: MarketAnomalyType.CONSECUTIVE_LIMIT_UP,
              value: consecutiveDays,
              threshold: CONSECUTIVE_LIMIT_MIN,
              detail: { consecutiveDays, tradeDateStr },
            },
            update: {
              stockName: stockNames.get(tsCode) ?? null,
              value: consecutiveDays,
              detail: { consecutiveDays, tradeDateStr },
              scannedAt: new Date(),
            },
          }),
        )
      }
    }

    await Promise.all(upserts)
    return count
  }

  // ── LARGE_NET_INFLOW ──────────────────────────────────────────────────────

  private async scanLargeNetInflow(latestTradeDate: Date, tradeDateStr: string) {
    const [moneyflowRows, dailyRows] = await Promise.all([
      this.prisma.moneyflow.findMany({
        where: { tradeDate: latestTradeDate },
        select: { tsCode: true, buyElgAmount: true, sellElgAmount: true },
      }),
      this.prisma.daily.findMany({
        where: { tradeDate: latestTradeDate },
        select: { tsCode: true, amount: true },
      }),
    ])

    const dailyAmountMap = new Map<string, number>()
    for (const r of dailyRows) {
      if (r.amount != null) dailyAmountMap.set(r.tsCode, r.amount)
    }

    const tsCodes = moneyflowRows.map((r) => r.tsCode)
    const stockNames = await this.fetchStockNames(tsCodes)

    const upserts: Promise<unknown>[] = []
    let count = 0

    for (const r of moneyflowRows) {
      if (r.buyElgAmount == null || r.sellElgAmount == null) continue
      const amount = dailyAmountMap.get(r.tsCode)
      if (!amount || amount <= 0) continue

      const netElg = r.buyElgAmount - r.sellElgAmount
      const ratio = netElg / amount
      if (ratio >= LARGE_INFLOW_RATIO) {
        count++
        upserts.push(
          this.prisma.marketAnomaly.upsert({
            where: {
              tradeDate_tsCode_anomalyType: {
                tradeDate: latestTradeDate,
                tsCode: r.tsCode,
                anomalyType: MarketAnomalyType.LARGE_NET_INFLOW,
              },
            },
            create: {
              tradeDate: latestTradeDate,
              tsCode: r.tsCode,
              stockName: stockNames.get(r.tsCode) ?? null,
              anomalyType: MarketAnomalyType.LARGE_NET_INFLOW,
              value: ratio,
              threshold: LARGE_INFLOW_RATIO,
              detail: {
                buyElgAmount: r.buyElgAmount,
                sellElgAmount: r.sellElgAmount,
                netElg,
                amount,
                tradeDateStr,
              },
            },
            update: {
              stockName: stockNames.get(r.tsCode) ?? null,
              value: ratio,
              detail: {
                buyElgAmount: r.buyElgAmount,
                sellElgAmount: r.sellElgAmount,
                netElg,
                amount,
                tradeDateStr,
              },
              scannedAt: new Date(),
            },
          }),
        )
      }
    }

    await Promise.all(upserts)
    return count
  }

  // ── helper ─────────────────────────────────────────────────────────────────

  private matchSeverity(strength: number, severity: 'LOW' | 'MEDIUM' | 'HIGH'): boolean {
    if (severity === 'HIGH') return strength >= 3
    if (severity === 'MEDIUM') return strength >= 1.5 && strength < 3
    return strength < 1.5
  }

  private getUnit(type: MarketAnomalyType): string {
    switch (type) {
      case MarketAnomalyType.VOLUME_SURGE:
        return '倍'
      case MarketAnomalyType.CONSECUTIVE_LIMIT_UP:
        return '天'
      case MarketAnomalyType.LARGE_NET_INFLOW:
        return '占成交额比例'
      default:
        return ''
    }
  }

  private getReason(type: MarketAnomalyType): string {
    switch (type) {
      case MarketAnomalyType.VOLUME_SURGE:
        return '当日成交量显著高于近 20 日均量'
      case MarketAnomalyType.CONSECUTIVE_LIMIT_UP:
        return '连续涨停天数达到阈值'
      case MarketAnomalyType.LARGE_NET_INFLOW:
        return '超大单净流入占成交额比例达到阈值'
      default:
        return '触发异动监控规则'
    }
  }

  private getSourceTables(type: MarketAnomalyType): string[] {
    switch (type) {
      case MarketAnomalyType.VOLUME_SURGE:
        return ['daily_prices']
      case MarketAnomalyType.CONSECUTIVE_LIMIT_UP:
        return ['daily_prices', 'stock_limit_prices']
      case MarketAnomalyType.LARGE_NET_INFLOW:
        return ['moneyflow', 'daily_prices']
      default:
        return ['market_anomalies']
    }
  }

  private async findRelatedAnomalies(tsCode: string, id: number, tradeDate: Date) {
    const rows = await this.prisma.marketAnomaly.findMany({
      where: { tsCode, tradeDate, id: { not: id } },
      orderBy: { anomalyType: 'asc' },
      take: 20,
    })
    return rows.map((r) => ({
      id: r.id,
      anomalyType: r.anomalyType,
      value: r.value,
      threshold: r.threshold,
      strength: r.threshold > 0 ? r.value / r.threshold : r.value,
    }))
  }

  private async findAnomalyHistory(tsCode: string, anomalyType: MarketAnomalyType) {
    const rows = await this.prisma.marketAnomaly.findMany({
      where: { tsCode, anomalyType },
      orderBy: { tradeDate: 'desc' },
      take: 20,
    })
    return rows.map((r) => ({
      id: r.id,
      tradeDate: formatDateToCompactTradeDate(r.tradeDate),
      value: r.value,
      threshold: r.threshold,
      strength: r.threshold > 0 ? r.value / r.threshold : r.value,
      scannedAt: r.scannedAt,
    }))
  }

  private async fetchStockNames(tsCodes: string[]): Promise<Map<string, string>> {
    if (tsCodes.length === 0) return new Map()
    const stocks = await this.prisma.stockBasic.findMany({
      where: { tsCode: { in: tsCodes } },
      select: { tsCode: true, name: true },
    })
    return new Map(stocks.map((s) => [s.tsCode, s.name ?? '']))
  }
}
