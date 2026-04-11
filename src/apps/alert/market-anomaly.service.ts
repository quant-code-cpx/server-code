import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { MarketAnomalyType } from '@prisma/client'
import * as dayjs from 'dayjs'
import { PrismaService } from 'src/shared/prisma.service'
import { EventsGateway } from 'src/websocket/events.gateway'
import { MarketAnomalyDto, MarketAnomalyQueryDto } from './dto/market-anomaly.dto'

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

  // ── 查询接口 ────────────────────────────────────────────────────────────────

  async queryAnomalies(query: MarketAnomalyQueryDto) {
    const page = query.page ?? 1
    const pageSize = query.pageSize ?? 20

    // 解析 tradeDate：不传则取最新
    let tradeDate: Date | undefined
    if (query.tradeDate) {
      tradeDate = dayjs(query.tradeDate, 'YYYYMMDD').toDate()
    } else {
      const latest = await this.prisma.marketAnomaly.findFirst({
        orderBy: { tradeDate: 'desc' },
        select: { tradeDate: true },
      })
      if (!latest) return { page, pageSize, total: 0, items: [] as MarketAnomalyDto[] }
      tradeDate = latest.tradeDate
    }

    const where = {
      tradeDate,
      ...(query.type ? { anomalyType: query.type } : {}),
      ...(query.tsCode ? { tsCode: query.tsCode } : {}),
    }

    const [total, rows] = await Promise.all([
      this.prisma.marketAnomaly.count({ where }),
      this.prisma.marketAnomaly.findMany({
        where,
        orderBy: [{ anomalyType: 'asc' }, { value: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ])

    const items: MarketAnomalyDto[] = rows.map((r) => ({
      id: r.id,
      tradeDate: dayjs(r.tradeDate).format('YYYYMMDD'),
      tsCode: r.tsCode,
      stockName: r.stockName,
      anomalyType: r.anomalyType,
      value: r.value,
      threshold: r.threshold,
      detail: r.detail,
      scannedAt: r.scannedAt,
    }))

    return { page, pageSize, total, items }
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
    const tradeDateStr = dayjs(latestTradeDate).format('YYYYMMDD')

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
            gte: dayjs(cutoff).format('YYYYMMDD'),
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
        const tradeDateKey = dayjs(rec.tradeDate).format('YYYYMMDD')
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

  private async fetchStockNames(tsCodes: string[]): Promise<Map<string, string>> {
    if (tsCodes.length === 0) return new Map()
    const stocks = await this.prisma.stockBasic.findMany({
      where: { tsCode: { in: tsCodes } },
      select: { tsCode: true, name: true },
    })
    return new Map(stocks.map((s) => [s.tsCode, s.name ?? '']))
  }
}
