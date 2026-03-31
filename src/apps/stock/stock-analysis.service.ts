import { Injectable, Logger } from '@nestjs/common'
import * as dayjs from 'dayjs'
import { PrismaService } from 'src/shared/prisma.service'
import { computeAllIndicators, OhlcvBar, detectMALatestCross } from './utils/technical-indicators'
import { estimateChipDistribution } from './utils/chip-estimation'
import { generateTimingSignals, calcTimingScore } from './utils/timing-signals'
import {
  StockTechnicalIndicatorsDto,
  StockTimingSignalsDto,
  StockChipDistributionDto,
  StockMarginQueryDto,
  StockRelativeStrengthDto,
} from './dto/stock-analysis-request.dto'
import {
  StockTechnicalDataDto,
  StockTimingSignalsDataDto,
  ChipDistributionDataDto,
  StockMarginDataResponseDto,
  StockRelativeStrengthDataDto,
} from './dto/stock-response.dto'

// 指数代码到名称的映射
const INDEX_NAME_MAP: Record<string, string> = {
  '000300.SH': '沪深300',
  '000001.SH': '上证指数',
  '399001.SZ': '深证成指',
  '399006.SZ': '创业板指',
  '000688.SH': '科创50',
  '000016.SH': '上证50',
  '399005.SZ': '中小100',
}

// 周期对应数据表
const PERIOD_TABLE_MAP: Record<string, string> = {
  D: 'stock_daily_prices',
  W: 'stock_weekly_prices',
  M: 'stock_monthly_prices',
}

interface OhlcvRow {
  tradeDate: Date
  open: number | null
  high: number | null
  low: number | null
  close: number | null
  preClose: number | null
  pctChg: number | null
  vol: number | null
  amount: number | null
  adjFactor: number | null
}

@Injectable()
export class StockAnalysisService {
  private readonly logger = new Logger(StockAnalysisService.name)

  constructor(private readonly prisma: PrismaService) {}

  // ─── 技术指标 ────────────────────────────────────────────────────────────────

  async getTechnicalIndicators(dto: StockTechnicalIndicatorsDto): Promise<StockTechnicalDataDto> {
    const { tsCode, period = 'D', days = 120 } = dto

    // 查询 days + 300 条原始数据作为计算 buffer
    const fetchCount = days + 300
    const tableName = PERIOD_TABLE_MAP[period] ?? 'stock_daily_prices'

    const rawRows = await this.fetchOhlcvRows(tsCode, tableName, fetchCount)

    if (rawRows.length === 0) {
      return {
        tsCode,
        period,
        dataDate: null,
        maStatus: {
          bullishAlign: null,
          bearishAlign: null,
          aboveMa20: null,
          aboveMa60: null,
          aboveMa250: null,
          latestCross: null,
        },
        signals: {
          macd: null,
          kdj: null,
          rsi: null,
          boll: null,
          wr: null,
          cci: null,
          dmi: null,
          sar: null,
          volumePrice: null,
        },
        history: [],
      }
    }

    // 前复权处理
    const bars = this.applyAdjFactor(rawRows)

    // 计算所有技术指标
    const allPoints = computeAllIndicators(bars)

    // 截取最近 days 条
    const history = allPoints.slice(-days)

    // 最新数据点摘要
    const latest = history[history.length - 1]
    const dataDate = latest?.tradeDate ?? null

    return {
      tsCode,
      period,
      dataDate,
      maStatus: this.buildMaStatus(history),
      signals: this.buildSignalSummary(history),
      history,
    }
  }

  // ─── 择时信号 ────────────────────────────────────────────────────────────────

  async getTimingSignals(dto: StockTimingSignalsDto): Promise<StockTimingSignalsDataDto> {
    const { tsCode, days = 60 } = dto

    // 复用技术指标计算：查 days + 300 作为 buffer
    const fetchCount = days + 300
    const rawRows = await this.fetchOhlcvRows(tsCode, 'stock_daily_prices', fetchCount)
    const bars = this.applyAdjFactor(rawRows)
    const allPoints = computeAllIndicators(bars)

    // 截取最近 days + 5 条（信号检测需要前一天对比）
    const points = allPoints.slice(-(days + 5))

    const signals = generateTimingSignals(points, days)
    const scoreSummary = calcTimingScore(points)

    return {
      tsCode,
      scoreSummary,
      signals,
    }
  }

  // ─── 筹码分布 ────────────────────────────────────────────────────────────────

  async getChipDistribution(dto: StockChipDistributionDto): Promise<ChipDistributionDataDto> {
    const { tsCode, tradeDate } = dto

    // 先尝试从 cyq_performance 表读取真实数据（如果已同步）
    const cyqData = await this.tryGetCyqPerf(tsCode, tradeDate)
    if (cyqData) return cyqData

    // 降级：从 OHLCV 估算
    const rawRows = await this.fetchOhlcvRows(tsCode, 'stock_daily_prices', 120)
    const bars = this.applyAdjFactor(rawRows)

    if (bars.length === 0) {
      return {
        tsCode,
        tradeDate: tradeDate ?? dayjs().format('YYYYMMDD'),
        currentPrice: null,
        concentration: {
          range90Low: null,
          range90High: null,
          range70Low: null,
          range70High: null,
          score: null,
          profitRatio: null,
          avgCost: null,
        },
        distribution: [],
        keyLevels: {
          peakPrice: null,
          resistanceHigh: null,
          resistanceLow: null,
          supportHigh: null,
          supportLow: null,
        },
        isEstimated: true,
      }
    }

    // 截取到指定日期
    let usedBars = bars
    if (tradeDate) {
      usedBars = bars.filter((b) => b.tradeDate <= tradeDate)
    }

    const currentPrice = usedBars[usedBars.length - 1]?.close ?? null
    const usedTradeDate = usedBars[usedBars.length - 1]?.tradeDate ?? (tradeDate ?? dayjs().format('YYYYMMDD'))

    if (!currentPrice) {
      return {
        tsCode,
        tradeDate: usedTradeDate,
        currentPrice: null,
        concentration: { range90Low: null, range90High: null, range70Low: null, range70High: null, score: null, profitRatio: null, avgCost: null },
        distribution: [],
        keyLevels: { peakPrice: null, resistanceHigh: null, resistanceLow: null, supportHigh: null, supportLow: null },
        isEstimated: true,
      }
    }

    const result = estimateChipDistribution(usedBars, currentPrice)

    return {
      tsCode,
      tradeDate: usedTradeDate,
      currentPrice,
      concentration: result.concentration,
      distribution: result.distribution,
      keyLevels: result.keyLevels,
      isEstimated: true,
    }
  }

  // ─── 融资融券 ────────────────────────────────────────────────────────────────

  async getMarginData(dto: StockMarginQueryDto): Promise<StockMarginDataResponseDto> {
    const { tsCode, days = 60 } = dto

    const emptyResponse: StockMarginDataResponseDto = {
      tsCode,
      summary: {
        latestRzye: null,
        latestRqye: null,
        latestRzrqye: null,
        rzNetBuy5d: null,
        rzNetBuy20d: null,
        rzye5dChgPct: null,
        rzye20dChgPct: null,
        trend: 'stable',
      },
      history: [],
      available: false,
    }

    // 检查表是否存在并有数据
    try {
      const cutoffDate = dayjs().subtract(days, 'day').toDate()

      interface MarginRow {
        tradeDate: Date
        rzye: number | null
        rzmre: number | null
        rzche: number | null
        rzjmre: number | null
        rqye: number | null
        rqmcl: number | null
        rqchl: number | null
        rzrqye: number | null
      }

      const marginRows = await this.prisma.$queryRaw<MarginRow[]>`
        SELECT
          m.trade_date AS "tradeDate",
          m.rzye, m.rzmre, m.rzche, m.rzjmre,
          m.rqye, m.rqmcl, m.rqchl, m.rzrqye
        FROM margin_detail m
        WHERE m.ts_code = ${tsCode}
          AND m.trade_date >= ${cutoffDate}
        ORDER BY m.trade_date ASC
      `

      if (marginRows.length === 0) {
        return emptyResponse
      }

      // 获取对应的收盘价
      interface CloseRow {
        tradeDate: Date
        close: number | null
        adjFactor: number | null
      }

      const closeRows = await this.prisma.$queryRaw<CloseRow[]>`
        SELECT
          d.trade_date AS "tradeDate",
          d.close,
          af.adj_factor AS "adjFactor"
        FROM stock_daily_prices d
        LEFT JOIN stock_adjustment_factors af ON af.ts_code = d.ts_code AND af.trade_date = d.trade_date
        WHERE d.ts_code = ${tsCode}
          AND d.trade_date >= ${cutoffDate}
        ORDER BY d.trade_date ASC
      `

      const closeMap = new Map<string, number | null>()
      if (closeRows.length > 0) {
        const latestAdj = closeRows[closeRows.length - 1]?.adjFactor ?? 1
        for (const row of closeRows) {
          const factor = row.adjFactor ?? 1
          const adjMultiplier = factor > 0 ? latestAdj / factor : 1
          const adjClose = row.close !== null ? Math.round(row.close * adjMultiplier * 100) / 100 : null
          closeMap.set(dayjs(row.tradeDate).format('YYYYMMDD'), adjClose)
        }
      }

      const history = marginRows.map((row) => {
        const tradeDateStr = dayjs(row.tradeDate).format('YYYYMMDD')
        return {
          tradeDate: tradeDateStr,
          rzye: row.rzye,
          rzmre: row.rzmre,
          rzche: row.rzche,
          rzjmre: row.rzjmre,
          rqye: row.rqye,
          rqmcl: row.rqmcl,
          rqchl: row.rqchl,
          rzrqye: row.rzrqye,
          close: closeMap.get(tradeDateStr) ?? null,
        }
      })

      const summary = this.buildMarginSummary(history)

      return { tsCode, summary, history, available: true }
    } catch {
      // 表不存在或查询失败，返回不可用
      return emptyResponse
    }
  }

  // ─── 相对强弱 ────────────────────────────────────────────────────────────────

  async getRelativeStrength(dto: StockRelativeStrengthDto): Promise<StockRelativeStrengthDataDto> {
    const { tsCode, benchmarkCode = '000300.SH', days = 120 } = dto
    const cutoffDate = dayjs().subtract(days + 30, 'day').toDate() // 稍多取一些确保有足够数据

    interface PriceRow {
      tradeDate: Date
      pctChg: number | null
      close: number | null
    }

    const [stockRows, benchmarkRows] = await Promise.all([
      this.prisma.$queryRaw<PriceRow[]>`
        SELECT trade_date AS "tradeDate", pct_chg AS "pctChg", close
        FROM stock_daily_prices
        WHERE ts_code = ${tsCode}
          AND trade_date >= ${cutoffDate}
        ORDER BY trade_date ASC
      `,
      this.prisma.$queryRaw<PriceRow[]>`
        SELECT trade_date AS "tradeDate", pct_chg AS "pctChg", close
        FROM index_daily_prices
        WHERE ts_code = ${benchmarkCode}
          AND trade_date >= ${cutoffDate}
        ORDER BY trade_date ASC
      `,
    ])

    if (stockRows.length === 0 || benchmarkRows.length === 0) {
      return {
        tsCode,
        benchmarkCode,
        benchmarkName: INDEX_NAME_MAP[benchmarkCode] ?? benchmarkCode,
        summary: {
          stockTotalReturn: null,
          benchmarkTotalReturn: null,
          excessReturn: null,
          excess20d: null,
          annualizedVol: null,
          maxDrawdown: null,
          beta: null,
          informationRatio: null,
        },
        history: [],
      }
    }

    // 以日期为 key，合并两组数据
    const stockMap = new Map<string, PriceRow>()
    for (const r of stockRows) {
      stockMap.set(dayjs(r.tradeDate).format('YYYYMMDD'), r)
    }

    // 找共同交易日并截取最近 days 条
    const commonDates = benchmarkRows
      .map((r) => dayjs(r.tradeDate).format('YYYYMMDD'))
      .filter((d) => stockMap.has(d))
      .slice(-days)

    if (commonDates.length === 0) {
      return {
        tsCode,
        benchmarkCode,
        benchmarkName: INDEX_NAME_MAP[benchmarkCode] ?? benchmarkCode,
        summary: {
          stockTotalReturn: null,
          benchmarkTotalReturn: null,
          excessReturn: null,
          excess20d: null,
          annualizedVol: null,
          maxDrawdown: null,
          beta: null,
          informationRatio: null,
        },
        history: [],
      }
    }

    // 计算累计涨跌幅（以第一个共同日为基准，归一化为 0）
    let stockCum = 0
    let benchmarkCum = 0

    // 起始收盘价（用于 rsRatio）
    const firstDate = commonDates[0]
    const firstStock = stockMap.get(firstDate)?.close ?? null
    const firstBenchmark = benchmarkRows.find((r) => dayjs(r.tradeDate).format('YYYYMMDD') === firstDate)?.close ?? null

    const history = commonDates.map((dateStr, idx) => {
      const stockRow = stockMap.get(dateStr)!
      const bmRow = benchmarkRows.find((r) => dayjs(r.tradeDate).format('YYYYMMDD') === dateStr)!

      const stockPct = stockRow.pctChg ?? 0
      const bmPct = bmRow.pctChg ?? 0

      if (idx > 0) {
        stockCum = (1 + stockCum / 100) * (1 + stockPct / 100) * 100 - 100
        benchmarkCum = (1 + benchmarkCum / 100) * (1 + bmPct / 100) * 100 - 100
      }

      const excessReturn = stockCum - benchmarkCum

      const stockClose = stockRow.close ?? null
      const bmClose = bmRow.close ?? null
      let rsRatio = 1
      if (firstStock && firstBenchmark && stockClose !== null && bmClose !== null && firstBenchmark > 0 && firstStock > 0) {
        rsRatio = (stockClose / firstStock) / (bmClose / firstBenchmark)
      }

      return {
        tradeDate: dateStr,
        stockCumReturn: Math.round(stockCum * 100) / 100,
        benchmarkCumReturn: Math.round(benchmarkCum * 100) / 100,
        excessReturn: Math.round(excessReturn * 100) / 100,
        rsRatio: Math.round(rsRatio * 10000) / 10000,
      }
    })

    const summary = this.buildRelativeStrengthSummary(history, stockRows, benchmarkRows)

    return {
      tsCode,
      benchmarkCode,
      benchmarkName: INDEX_NAME_MAP[benchmarkCode] ?? benchmarkCode,
      summary,
      history,
    }
  }

  // ─── 辅助方法 ─────────────────────────────────────────────────────────────────

  private async fetchOhlcvRows(tsCode: string, tableName: string, limit: number): Promise<OhlcvRow[]> {
    const safeTable = PERIOD_TABLE_MAP[
      Object.entries(PERIOD_TABLE_MAP).find(([, v]) => v === tableName)?.[0] ?? 'D'
    ] ?? 'stock_daily_prices'

    // 使用 Prisma 查询，通过字符串模板避免 SQL 注入
    // tableName 来自受控映射，安全
    if (safeTable === 'stock_weekly_prices') {
      return this.prisma.$queryRaw<OhlcvRow[]>`
        SELECT
          t.trade_date AS "tradeDate",
          t.open, t.high, t.low, t.close,
          t.pre_close  AS "preClose",
          t.pct_chg    AS "pctChg",
          t.vol, t.amount,
          af.adj_factor AS "adjFactor"
        FROM stock_weekly_prices t
        LEFT JOIN stock_adjustment_factors af
          ON af.ts_code = t.ts_code AND af.trade_date = t.trade_date
        WHERE t.ts_code = ${tsCode}
        ORDER BY t.trade_date DESC
        LIMIT ${limit}
      `.then((rows) => (rows as OhlcvRow[]).reverse())
    } else if (safeTable === 'stock_monthly_prices') {
      return this.prisma.$queryRaw<OhlcvRow[]>`
        SELECT
          t.trade_date AS "tradeDate",
          t.open, t.high, t.low, t.close,
          t.pre_close  AS "preClose",
          t.pct_chg    AS "pctChg",
          t.vol, t.amount,
          af.adj_factor AS "adjFactor"
        FROM stock_monthly_prices t
        LEFT JOIN stock_adjustment_factors af
          ON af.ts_code = t.ts_code AND af.trade_date = t.trade_date
        WHERE t.ts_code = ${tsCode}
        ORDER BY t.trade_date DESC
        LIMIT ${limit}
      `.then((rows) => (rows as OhlcvRow[]).reverse())
    } else {
      return this.prisma.$queryRaw<OhlcvRow[]>`
        SELECT
          t.trade_date AS "tradeDate",
          t.open, t.high, t.low, t.close,
          t.pre_close  AS "preClose",
          t.pct_chg    AS "pctChg",
          t.vol, t.amount,
          af.adj_factor AS "adjFactor"
        FROM stock_daily_prices t
        LEFT JOIN stock_adjustment_factors af
          ON af.ts_code = t.ts_code AND af.trade_date = t.trade_date
        WHERE t.ts_code = ${tsCode}
        ORDER BY t.trade_date DESC
        LIMIT ${limit}
      `.then((rows) => (rows as OhlcvRow[]).reverse())
    }
  }

  /** 前复权处理：以最新 adjFactor 为基准 */
  private applyAdjFactor(rows: OhlcvRow[]): OhlcvBar[] {
    if (rows.length === 0) return []

    const latestAdj = rows[rows.length - 1]?.adjFactor ?? 1

    return rows
      .filter((row) => row.close !== null && row.open !== null && row.high !== null && row.low !== null)
      .map((row) => {
        const factor = row.adjFactor ?? 1
        const multiplier = factor > 0 ? latestAdj / factor : 1
        const adj = (v: number | null) => (v !== null ? Math.round(v * multiplier * 10000) / 10000 : 0)

        return {
          tradeDate: dayjs(row.tradeDate).format('YYYYMMDD'),
          open: adj(row.open),
          high: adj(row.high),
          low: adj(row.low),
          close: adj(row.close),
          preClose: adj(row.preClose),
          vol: row.vol ?? 0,
          amount: row.amount ?? 0,
        }
      })
  }

  /** 均线状态摘要 */
  private buildMaStatus(history: ReturnType<typeof computeAllIndicators>) {
    const latest = history[history.length - 1]
    if (!latest) {
      return { bullishAlign: null, bearishAlign: null, aboveMa20: null, aboveMa60: null, aboveMa250: null, latestCross: null }
    }

    const { ma5, ma10, ma20, ma60, ma250, close } = latest
    const allValid = ma5 !== null && ma10 !== null && ma20 !== null && ma60 !== null

    const bullishAlign = allValid ? ma5! > ma10! && ma10! > ma20! && ma20! > ma60! : null
    const bearishAlign = allValid ? ma5! < ma10! && ma10! < ma20! && ma20! < ma60! : null
    const aboveMa20 = close !== null && ma20 !== null ? close > ma20 : null
    const aboveMa60 = close !== null && ma60 !== null ? close > ma60 : null
    const aboveMa250 = close !== null && ma250 !== null ? close > ma250 : null
    const latestCross = detectMALatestCross(history)

    return { bullishAlign, bearishAlign, aboveMa20, aboveMa60, aboveMa250, latestCross }
  }

  /** 各指标最新状态信号摘要 */
  private buildSignalSummary(history: ReturnType<typeof computeAllIndicators>) {
    const p = history[history.length - 1]
    const prev = history[history.length - 2]

    if (!p) {
      return { macd: null, kdj: null, rsi: null, boll: null, wr: null, cci: null, dmi: null, sar: null, volumePrice: null }
    }

    // MACD
    let macd: string | null = null
    if (p.macdDif !== null && p.macdDea !== null) {
      if (prev && prev.macdDif !== null && prev.macdDea !== null) {
        if (prev.macdDif <= prev.macdDea && p.macdDif > p.macdDea) macd = 'golden_cross'
        else if (prev.macdDif >= prev.macdDea && p.macdDif < p.macdDea) macd = 'death_cross'
      }
      if (!macd) macd = p.macdDif > 0 ? 'above_zero' : 'below_zero'
    }

    // KDJ
    let kdj: string | null = null
    if (p.kdjK !== null && p.kdjD !== null && p.kdjJ !== null) {
      if (p.kdjJ > 100) kdj = 'overbought'
      else if (p.kdjJ < 0) kdj = 'oversold'
      else if (prev && prev.kdjK !== null && prev.kdjD !== null) {
        if (prev.kdjK <= prev.kdjD && p.kdjK > p.kdjD) kdj = 'golden_cross'
        else if (prev.kdjK >= prev.kdjD && p.kdjK < p.kdjD) kdj = 'death_cross'
      }
    }

    // RSI
    let rsi: string | null = null
    if (p.rsi6 !== null) {
      if (p.rsi6 > 80) rsi = 'overbought'
      else if (p.rsi6 < 20) rsi = 'oversold'
      else rsi = 'neutral'
    }

    // BOLL
    let boll: string | null = null
    if (p.close !== null && p.bollUpper !== null && p.bollMid !== null && p.bollLower !== null) {
      if (p.close > p.bollUpper) boll = 'above_upper'
      else if (p.close > p.bollMid * 1.005) boll = 'near_upper'
      else if (p.close < p.bollLower) boll = 'below_lower'
      else if (p.close < p.bollMid * 0.995) boll = 'near_lower'
      else boll = 'middle'
    }

    // WR
    let wr: string | null = null
    if (p.wr6 !== null) {
      if (p.wr6 > -20) wr = 'overbought'
      else if (p.wr6 < -80) wr = 'oversold'
      else wr = 'neutral'
    }

    // CCI
    let cci: string | null = null
    if (p.cci !== null) {
      if (p.cci > 100) cci = 'overbought'
      else if (p.cci < -100) cci = 'oversold'
      else cci = 'neutral'
    }

    // DMI
    let dmi: string | null = null
    if (p.dmiPdi !== null && p.dmiMdi !== null && p.dmiAdx !== null) {
      if (p.dmiPdi > p.dmiMdi && p.dmiAdx > 25) dmi = 'bullish_trend'
      else if (p.dmiPdi < p.dmiMdi && p.dmiAdx > 25) dmi = 'bearish_trend'
      else dmi = 'no_trend'
    }

    // SAR
    let sar: string | null = null
    if (p.sarBullish !== null) {
      sar = p.sarBullish ? 'bullish' : 'bearish'
    }

    // 量价
    let volumePrice: string | null = null
    if (p.vol !== null && p.volMa5 !== null && prev && prev.close !== null && p.close !== null && p.volMa5 > 0) {
      const volRatio = p.vol / p.volMa5
      const priceUp = p.close > prev.close
      if (priceUp && volRatio > 1.3) volumePrice = 'volume_price_up'
      else if (priceUp && volRatio < 0.7) volumePrice = 'volume_price_diverge'
      else if (!priceUp && volRatio < 0.7) volumePrice = 'shrink_consolidate'
    }

    return { macd, kdj, rsi, boll, wr, cci, dmi, sar, volumePrice }
  }

  /** 融资融券摘要统计 */
  private buildMarginSummary(history: Array<{ tradeDate: string; rzye: number | null; rzjmre: number | null; rqye: number | null; rzrqye: number | null }>) {
    if (history.length === 0) {
      return {
        latestRzye: null,
        latestRqye: null,
        latestRzrqye: null,
        rzNetBuy5d: null,
        rzNetBuy20d: null,
        rzye5dChgPct: null,
        rzye20dChgPct: null,
        trend: 'stable' as const,
      }
    }

    const latest = history[history.length - 1]

    // 5日融资净买入
    const last5 = history.slice(-5)
    const rzNetBuy5d = last5.some((r) => r.rzjmre !== null)
      ? last5.reduce((a, b) => a + (b.rzjmre ?? 0), 0)
      : null

    // 20日融资净买入
    const last20 = history.slice(-20)
    const rzNetBuy20d = last20.some((r) => r.rzjmre !== null)
      ? last20.reduce((a, b) => a + (b.rzjmre ?? 0), 0)
      : null

    // 5日融资余额变化率
    const rzye5dAgo = history.length >= 5 ? history[history.length - 5]?.rzye : null
    const rzye5dChgPct =
      latest.rzye !== null && rzye5dAgo !== null && rzye5dAgo > 0
        ? Math.round(((latest.rzye - rzye5dAgo) / rzye5dAgo) * 10000) / 100
        : null

    // 20日融资余额变化率
    const rzye20dAgo = history.length >= 20 ? history[history.length - 20]?.rzye : null
    const rzye20dChgPct =
      latest.rzye !== null && rzye20dAgo !== null && rzye20dAgo > 0
        ? Math.round(((latest.rzye - rzye20dAgo) / rzye20dAgo) * 10000) / 100
        : null

    // 趋势判断（基于 5日变化率）
    let trend: 'increasing' | 'decreasing' | 'stable' = 'stable'
    if (rzye5dChgPct !== null) {
      if (rzye5dChgPct > 2) trend = 'increasing'
      else if (rzye5dChgPct < -2) trend = 'decreasing'
    }

    return {
      latestRzye: latest.rzye,
      latestRqye: latest.rqye,
      latestRzrqye: latest.rzrqye,
      rzNetBuy5d,
      rzNetBuy20d,
      rzye5dChgPct,
      rzye20dChgPct,
      trend,
    }
  }

  /** 相对强弱统计摘要 */
  private buildRelativeStrengthSummary(
    history: Array<{ stockCumReturn: number; benchmarkCumReturn: number; excessReturn: number }>,
    stockRows: Array<{ pctChg: number | null; close: number | null }>,
    benchmarkRows: Array<{ pctChg: number | null; close: number | null }>,
  ) {
    if (history.length === 0) {
      return { stockTotalReturn: null, benchmarkTotalReturn: null, excessReturn: null, excess20d: null, annualizedVol: null, maxDrawdown: null, beta: null, informationRatio: null }
    }

    const last = history[history.length - 1]
    const stockTotalReturn = last.stockCumReturn
    const benchmarkTotalReturn = last.benchmarkCumReturn
    const excessReturn = last.excessReturn

    // 最近20日超额收益
    const prevExcess20d = history.length >= 21 ? history[history.length - 21].excessReturn : 0
    const excess20d = history.length >= 20
      ? history[history.length - 1].excessReturn - prevExcess20d
      : excessReturn

    // 年化波动率（个股）
    const stockReturns = stockRows
      .map((r) => (r.pctChg !== null && r.pctChg !== undefined ? r.pctChg / 100 : null))
      .filter((v): v is number => v !== null)
    let annualizedVol: number | null = null
    if (stockReturns.length > 5) {
      const mean = stockReturns.reduce((a, b) => a + b, 0) / stockReturns.length
      const variance = stockReturns.reduce((a, b) => a + (b - mean) ** 2, 0) / stockReturns.length
      annualizedVol = Math.round(Math.sqrt(variance * 252) * 10000) / 100
    }

    // 最大回撤
    let maxDrawdown: number | null = null
    let peak = 0
    let maxDD = 0
    for (const p of history) {
      if (p.stockCumReturn > peak) peak = p.stockCumReturn
      const dd = peak - p.stockCumReturn
      if (dd > maxDD) maxDD = dd
    }
    maxDrawdown = Math.round(maxDD * 100) / 100

    // Beta
    let beta: number | null = null
    const sReturns = stockRows.map((r) => (r.pctChg ?? 0) / 100)
    const bReturns = benchmarkRows.map((r) => (r.pctChg ?? 0) / 100)
    const n = Math.min(sReturns.length, bReturns.length)
    if (n > 5) {
      const slice = Math.min(n, history.length)
      const sr = sReturns.slice(-slice)
      const br = bReturns.slice(-slice)
      const sMean = sr.reduce((a, b) => a + b, 0) / slice
      const bMean = br.reduce((a, b) => a + b, 0) / slice
      let cov = 0
      let bVar = 0
      for (let i = 0; i < slice; i++) {
        cov += (sr[i] - sMean) * (br[i] - bMean)
        bVar += (br[i] - bMean) ** 2
      }
      beta = bVar > 0 ? Math.round((cov / bVar) * 100) / 100 : null
    }

    // 信息比率（超额收益均值 / 超额收益标准差，年化）
    let informationRatio: number | null = null
    if (history.length > 5) {
      const excessReturns = history.map((h, i) => (i > 0 ? h.excessReturn - history[i - 1].excessReturn : 0)).slice(1)
      if (excessReturns.length > 0) {
        const eMean = excessReturns.reduce((a, b) => a + b, 0) / excessReturns.length
        const eStd = Math.sqrt(excessReturns.reduce((a, b) => a + (b - eMean) ** 2, 0) / excessReturns.length)
        informationRatio = eStd > 0 ? Math.round((eMean / eStd) * Math.sqrt(252) * 100) / 100 : null
      }
    }

    return {
      stockTotalReturn,
      benchmarkTotalReturn,
      excessReturn,
      excess20d: Math.round((excess20d ?? 0) * 100) / 100,
      annualizedVol,
      maxDrawdown,
      beta,
      informationRatio,
    }
  }

  /** 尝试从 cyq_performance 表读取真实筹码数据 */
  private async tryGetCyqPerf(tsCode: string, tradeDate?: string): Promise<ChipDistributionDataDto | null> {
    try {
      interface CyqRow {
        tradeDate: Date
        cost5Pct: number | null
        cost15Pct: number | null
        cost50Pct: number | null
        cost85Pct: number | null
        cost95Pct: number | null
        weightAvg: number | null
        winner: number | null
        hisLow: number | null
        hisHigh: number | null
      }

      let cyqRow: CyqRow | null = null

      if (tradeDate) {
        const targetDate = dayjs(tradeDate, 'YYYYMMDD').toDate()
        const rows = await this.prisma.$queryRaw<CyqRow[]>`
          SELECT trade_date AS "tradeDate", cost_5pct AS "cost5Pct", cost_15pct AS "cost15Pct",
                 cost_50pct AS "cost50Pct", cost_85pct AS "cost85Pct", cost_95pct AS "cost95Pct",
                 weight_avg AS "weightAvg", winner, his_low AS "hisLow", his_high AS "hisHigh"
          FROM cyq_performance
          WHERE ts_code = ${tsCode} AND trade_date = ${targetDate}
          LIMIT 1
        `
        cyqRow = rows[0] ?? null
      } else {
        const rows = await this.prisma.$queryRaw<CyqRow[]>`
          SELECT trade_date AS "tradeDate", cost_5pct AS "cost5Pct", cost_15pct AS "cost15Pct",
                 cost_50pct AS "cost50Pct", cost_85pct AS "cost85Pct", cost_95pct AS "cost95Pct",
                 weight_avg AS "weightAvg", winner, his_low AS "hisLow", his_high AS "hisHigh"
          FROM cyq_performance
          WHERE ts_code = ${tsCode}
          ORDER BY trade_date DESC
          LIMIT 1
        `
        cyqRow = rows[0] ?? null
      }

      if (!cyqRow) return null

      // 获取当日收盘价
      const tradeDateStr = dayjs(cyqRow.tradeDate).format('YYYYMMDD')
      const closeRows = await this.prisma.$queryRaw<Array<{ close: number | null }>>`
        SELECT close FROM stock_daily_prices
        WHERE ts_code = ${tsCode} AND trade_date = ${cyqRow.tradeDate}
        LIMIT 1
      `
      const currentPrice = closeRows[0]?.close ?? null

      // 从成本分位数构建分布直方图（100个 bin 用线性插值近似）
      const distribution = this.buildDistributionFromCyq(cyqRow, currentPrice)

      return {
        tsCode,
        tradeDate: tradeDateStr,
        currentPrice,
        concentration: {
          range90Low: cyqRow.cost5Pct,
          range90High: cyqRow.cost95Pct,
          range70Low: cyqRow.cost15Pct,
          range70High: cyqRow.cost85Pct,
          score: null, // 无法直接计算
          profitRatio: cyqRow.winner,
          avgCost: cyqRow.weightAvg,
        },
        distribution,
        keyLevels: {
          peakPrice: cyqRow.cost50Pct,
          resistanceHigh: null,
          resistanceLow: null,
          supportHigh: null,
          supportLow: null,
        },
        isEstimated: false,
      }
    } catch {
      return null
    }
  }

  /** 从 CYQ 成本分位数近似生成直方图 */
  private buildDistributionFromCyq(
    cyq: { cost5Pct: number | null; cost15Pct: number | null; cost50Pct: number | null; cost85Pct: number | null; cost95Pct: number | null; hisLow: number | null; hisHigh: number | null },
    currentPrice: number | null,
  ) {
    const low = cyq.hisLow ?? cyq.cost5Pct ?? 0
    const high = cyq.hisHigh ?? cyq.cost95Pct ?? 0
    if (low >= high) return []

    const BINS = 100
    const binWidth = (high - low) / BINS
    const bins: Array<{ priceLow: number; priceHigh: number; percent: number; isProfit: boolean }> = []

    // 用分位数构建近似正态分布（线性插值 5 区间）
    const quantiles: Array<[number, number]> = []
    if (cyq.cost5Pct !== null) quantiles.push([0.05, cyq.cost5Pct])
    if (cyq.cost15Pct !== null) quantiles.push([0.15, cyq.cost15Pct])
    if (cyq.cost50Pct !== null) quantiles.push([0.5, cyq.cost50Pct])
    if (cyq.cost85Pct !== null) quantiles.push([0.85, cyq.cost85Pct])
    if (cyq.cost95Pct !== null) quantiles.push([0.95, cyq.cost95Pct])

    for (let b = 0; b < BINS; b++) {
      const priceLow = low + b * binWidth
      const priceHigh = priceLow + binWidth
      const priceMid = (priceLow + priceHigh) / 2

      // 通过分位数插值估算该价格对应的累积概率密度
      let cdfLow = 0
      let cdfHigh = 0
      for (let q = 0; q < quantiles.length - 1; q++) {
        const [p1, v1] = quantiles[q]
        const [p2, v2] = quantiles[q + 1]
        if (priceLow >= v1 && priceLow <= v2) {
          cdfLow = p1 + ((priceLow - v1) / (v2 - v1)) * (p2 - p1)
        }
        if (priceHigh >= v1 && priceHigh <= v2) {
          cdfHigh = p1 + ((priceHigh - v1) / (v2 - v1)) * (p2 - p1)
        }
      }

      const percent = Math.max(0, (cdfHigh - cdfLow) * 100)
      bins.push({
        priceLow: Math.round(priceLow * 100) / 100,
        priceHigh: Math.round(priceHigh * 100) / 100,
        percent: Math.round(percent * 10000) / 10000,
        isProfit: currentPrice !== null ? priceHigh <= currentPrice : false,
      })
    }

    return bins
  }
}
