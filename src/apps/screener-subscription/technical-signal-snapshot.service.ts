import { createHash } from 'node:crypto'
import { Injectable, Logger } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { formatDateToCompactTradeDate, parseCompactTradeDateToUtcDate } from 'src/common/utils/trade-date.util'
import {
  createQfqBars,
  TECHNICAL_SIGNAL_DEFINITIONS,
  TechnicalIndicatorEngine,
  type IndicatorPoint,
  type RawTechnicalSignalBar,
} from 'src/apps/technical-signal/domain'
import { PrismaService } from 'src/shared/prisma.service'

const STOCK_BATCH_SIZE = 100

const EVENT_METADATA: Record<string, { metricId: string; eventType: string; strength: number }> = {
  'macd.golden-cross': { metricId: 'signal.macd', eventType: 'GOLDEN_CROSS', strength: 1 },
  'macd.death-cross': { metricId: 'signal.macd', eventType: 'DEATH_CROSS', strength: 1 },
  'kdj.golden-cross': { metricId: 'signal.kdj', eventType: 'GOLDEN_CROSS', strength: 1 },
  'kdj.death-cross': { metricId: 'signal.kdj', eventType: 'DEATH_CROSS', strength: 1 },
  'rsi6.oversold-enter': { metricId: 'signal.rsi6', eventType: 'OVERSOLD_ENTER', strength: 1 },
  'rsi6.overbought-enter': { metricId: 'signal.rsi6', eventType: 'OVERBOUGHT_ENTER', strength: 1 },
  'boll.upper-breakout': { metricId: 'signal.boll', eventType: 'BREAK_UP', strength: 1 },
  'boll.lower-breakdown': { metricId: 'signal.boll', eventType: 'BREAK_DOWN', strength: 1 },
}

type SnapshotInsert = Prisma.TechnicalSignalDailySnapshotCreateManyInput
type EventInsert = Prisma.TechnicalSignalEventCreateManyInput

export interface TechnicalSignalSnapshotBuildResult {
  tradeDate: string
  catalogVersion: string
  universeCount: number
  snapshotCount: number
  eventCount: number
  skippedCount: number
}

/**
 * B3 全市场批处理。仅使用本地日线 + 复权因子和统一 domain engine；不调用逐股详情 API。
 * 日级快照不可回写，重复任务依赖唯一键安全幂等。
 */
@Injectable()
export class TechnicalSignalSnapshotService {
  private readonly logger = new Logger(TechnicalSignalSnapshotService.name)
  private readonly engine = new TechnicalIndicatorEngine()
  private readonly catalogVersion = `signal-v1-${createHash('sha256')
    .update(
      JSON.stringify(
        TECHNICAL_SIGNAL_DEFINITIONS.map((definition) => [
          definition.signalKey,
          definition.semanticsVersion,
          definition.definitionHash,
        ]),
      ),
    )
    .digest('hex')
    .slice(0, 12)}`

  constructor(private readonly prisma: PrismaService) {}

  getCatalogVersion(): string {
    return this.catalogVersion
  }

  async buildForTradeDate(tradeDate: string): Promise<TechnicalSignalSnapshotBuildResult> {
    const targetDate = parseCompactTradeDateToUtcDate(tradeDate)
    const [stocks, activeDaily] = await Promise.all([
      this.prisma.stockBasic.findMany({
        where: {
          listStatus: 'L',
          AND: [
            { OR: [{ listDate: null }, { listDate: { lte: targetDate } }] },
            { OR: [{ delistDate: null }, { delistDate: { gt: targetDate } }] },
          ],
        },
        select: { tsCode: true },
      }),
      this.prisma.daily.findMany({ where: { tradeDate: targetDate }, select: { tsCode: true } }),
    ])
    const activeCodes = new Set(activeDaily.map((row) => row.tsCode))
    const universeCodes = stocks.map((stock) => stock.tsCode).filter((tsCode) => activeCodes.has(tsCode))
    const aggregate = { snapshotCount: 0, eventCount: 0, skippedCount: 0 }

    for (let offset = 0; offset < universeCodes.length; offset += STOCK_BATCH_SIZE) {
      const codes = universeCodes.slice(offset, offset + STOCK_BATCH_SIZE)
      const batch = await this.buildBatch(codes, targetDate, tradeDate)
      aggregate.snapshotCount += batch.snapshotCount
      aggregate.eventCount += batch.eventCount
      aggregate.skippedCount += batch.skippedCount
    }

    this.logger.log(
      `Built technical signal snapshot ${tradeDate}: ${aggregate.snapshotCount}/${universeCodes.length} snapshots, ${aggregate.eventCount} events`,
    )
    return { tradeDate, catalogVersion: this.catalogVersion, universeCount: universeCodes.length, ...aggregate }
  }

  private async buildBatch(codes: string[], targetDate: Date, tradeDate: string) {
    const [dailyRows, adjFactorRows] = await Promise.all([
      this.prisma.daily.findMany({
        where: { tsCode: { in: codes }, tradeDate: { lte: targetDate } },
        orderBy: [{ tsCode: 'asc' }, { tradeDate: 'asc' }],
        select: {
          tsCode: true,
          tradeDate: true,
          open: true,
          high: true,
          low: true,
          close: true,
          vol: true,
          syncedAt: true,
        },
      }),
      this.prisma.adjFactor.findMany({
        where: { tsCode: { in: codes }, tradeDate: { lte: targetDate } },
        orderBy: [{ tsCode: 'asc' }, { tradeDate: 'asc' }],
        select: { tsCode: true, tradeDate: true, adjFactor: true, syncedAt: true },
      }),
    ])
    const adjFactorByKey = new Map<string, (typeof adjFactorRows)[number]>()
    for (const row of adjFactorRows) {
      const date = formatDateToCompactTradeDate(row.tradeDate)
      if (date) adjFactorByKey.set(`${row.tsCode}:${date}`, row)
    }
    const dailyByCode = new Map<string, typeof dailyRows>()
    for (const row of dailyRows) {
      const rows = dailyByCode.get(row.tsCode) ?? []
      rows.push(row)
      dailyByCode.set(row.tsCode, rows)
    }

    const snapshots: SnapshotInsert[] = []
    const events: EventInsert[] = []
    let skippedCount = 0
    for (const tsCode of codes) {
      const rows = dailyByCode.get(tsCode) ?? []
      const bars = rows
        .map((row): RawTechnicalSignalBar | null => {
          const date = formatDateToCompactTradeDate(row.tradeDate)
          const adj = date ? adjFactorByKey.get(`${tsCode}:${date}`) : undefined
          if (!date || !adj || !isValidMarketRow(row, adj.adjFactor)) return null
          return {
            tradeDate: date,
            open: row.open!,
            high: row.high!,
            low: row.low!,
            close: row.close!,
            vol: row.vol!,
            adjFactor: adj.adjFactor!,
          }
        })
        .filter((bar): bar is RawTechnicalSignalBar => bar !== null)
      if (bars.length !== rows.length || bars.length < 2 || bars[bars.length - 1]?.tradeDate !== tradeDate) {
        skippedCount += 1
        continue
      }
      try {
        const points = this.engine.compute(createQfqBars(bars))
        const current = points[points.length - 1]
        const previous = points[points.length - 2]
        if (!current || !previous) {
          skippedCount += 1
          continue
        }
        const detected = TECHNICAL_SIGNAL_DEFINITIONS.flatMap((definition) => {
          const evidence = definition.evaluate(previous, current)
          const metadata = EVENT_METADATA[definition.signalKey]
          return evidence && metadata ? [{ definition, evidence, metadata }] : []
        })
        const dataVersions = {
          daily: `target:${tradeDate}`,
          adjFactor: `target:${tradeDate}`,
          catalogVersion: this.catalogVersion,
        }
        snapshots.push({
          tsCode,
          tradeDate,
          catalogVersion: this.catalogVersion,
          bullishCount: detected.filter(({ definition }) => definition.direction === 'BULLISH').length,
          bearishCount: detected.filter(({ definition }) => definition.direction === 'BEARISH').length,
          totalScore:
            detected.filter(({ definition }) => definition.direction === 'BULLISH').length -
            detected.filter(({ definition }) => definition.direction === 'BEARISH').length,
          metrics: snapshotMetrics(
            current,
            detected.map(({ definition }) => definition.signalKey),
          ) as Prisma.InputJsonValue,
          dataVersions: dataVersions as Prisma.InputJsonValue,
        })
        for (const { definition, evidence, metadata } of detected) {
          events.push({
            tsCode,
            tradeDate,
            metricId: metadata.metricId,
            semanticsVersion: definition.semanticsVersion,
            eventType: metadata.eventType,
            direction: definition.direction,
            strength: metadata.strength,
            eventKey: `${definition.signalKey}@${definition.semanticsVersion}:${definition.definitionHash}`,
            evidence: {
              signalKey: definition.signalKey,
              definitionHash: definition.definitionHash,
              displayName: definition.displayName,
              ...evidence,
            } as Prisma.InputJsonValue,
          })
        }
      } catch {
        skippedCount += 1
      }
    }
    if (snapshots.length || events.length) {
      await this.prisma.$transaction(async (tx) => {
        if (snapshots.length) {
          await tx.technicalSignalDailySnapshot.createMany({ data: snapshots, skipDuplicates: true })
        }
        if (events.length) await tx.technicalSignalEvent.createMany({ data: events, skipDuplicates: true })
      })
    }
    return { snapshotCount: snapshots.length, eventCount: events.length, skippedCount }
  }
}

function isValidMarketRow(
  row: { open: number | null; high: number | null; low: number | null; close: number | null; vol: number | null },
  adjFactor: number | null,
): boolean {
  const values = [row.open, row.high, row.low, row.close, row.vol, adjFactor]
  return (
    values.every((value) => value !== null && Number.isFinite(value)) &&
    row.open! > 0 &&
    row.high! > 0 &&
    row.low! > 0 &&
    row.close! > 0 &&
    row.vol! >= 0 &&
    adjFactor! > 0 &&
    row.high! >= Math.max(row.open!, row.close!, row.low!) &&
    row.low! <= Math.min(row.open!, row.close!, row.high!)
  )
}

function snapshotMetrics(current: IndicatorPoint, eventKeys: string[]) {
  return {
    indicators: {
      macdDif: current.macdDif,
      macdDea: current.macdDea,
      kdjK: current.kdjK,
      kdjD: current.kdjD,
      rsi6: current.rsi6,
      bollUpper: current.bollUpper,
      bollLower: current.bollLower,
    },
    eventKeys,
  }
}
