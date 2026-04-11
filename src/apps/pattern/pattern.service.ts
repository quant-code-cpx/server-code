import { Injectable, Logger } from '@nestjs/common'
import * as dayjs from 'dayjs'
import { BusinessException } from 'src/common/exceptions/business.exception'
import { PrismaService } from 'src/shared/prisma.service'
import { PatternAlgorithm, PatternScope, PatternSearchBySeriesDto, PatternSearchDto } from './dto/pattern-search.dto'
import { PatternMatchDto, PatternSearchResultDto } from './dto/pattern-response.dto'
import { PATTERN_TEMPLATES } from './utils/pattern-templates'
import {
  distanceToSimilarity,
  dtwDistance,
  normalizeToUnitRange,
  normalizedEuclideanDistance,
  round,
} from './utils/similarity'

// ── 内部类型 ────────────────────────────────────────────────────────────────

interface PriceRow {
  tsCode: string
  tradeDate: Date
  close: number | null
  adjFactor: number | null
}

interface AdjustedPoint {
  date: string   // YYYYMMDD
  close: number
}

// ── 常量 ────────────────────────────────────────────────────────────────────

const BATCH_SIZE = 50

// ── 服务 ────────────────────────────────────────────────────────────────────

@Injectable()
export class PatternService {
  private readonly logger = new Logger(PatternService.name)

  constructor(private readonly prisma: PrismaService) {}

  // ── 公共方法 ──────────────────────────────────────────────────────────────

  /** 返回预定义经典形态模板列表 */
  getTemplates() {
    return Object.entries(PATTERN_TEMPLATES).map(([key, val]) => ({
      id: key,
      name: val.name,
      description: val.description,
      length: val.series.length,
    }))
  }

  /** 基于股票日线的形态搜索 */
  async search(dto: PatternSearchDto): Promise<PatternSearchResultDto> {
    const startTime = Date.now()

    // 提取查询形态前复权收盘价序列
    const queryPoints = await this.loadAdjustedCloses(dto.tsCode, dto.startDate, dto.endDate)
    if (queryPoints.length < 5) {
      throw new BusinessException('查询形态至少需要 5 个交易日数据')
    }
    const queryNorm = normalizeToUnitRange(queryPoints.map(p => p.close))

    // 确定候选股票池
    const candidates = await this.getCandidateStocks(dto.scope ?? PatternScope.ALL, dto.indexCode)
    const filtered = (dto.excludeSelf ?? true)
      ? candidates.filter(c => c.tsCode !== dto.tsCode)
      : candidates

    // 全市场滑动窗口搜索
    const matches = await this.slidingWindowSearch(
      queryNorm,
      filtered,
      dto.algorithm ?? PatternAlgorithm.NED,
      dto.topK ?? 20,
      dto.lookbackYears ?? 5,
    )

    return {
      patternLength: queryNorm.length,
      algorithm: dto.algorithm ?? PatternAlgorithm.NED,
      candidateCount: filtered.length,
      elapsedMs: Date.now() - startTime,
      querySeries: queryNorm.map(v => round(v, 4)),
      matches,
    }
  }

  /** 基于自定义序列的形态搜索 */
  async searchBySeries(dto: PatternSearchBySeriesDto): Promise<PatternSearchResultDto> {
    const startTime = Date.now()

    const queryNorm = normalizeToUnitRange(dto.series)

    const candidates = await this.getCandidateStocks(
      dto.scope ?? PatternScope.ALL,
      dto.indexCode,
    )

    const matches = await this.slidingWindowSearch(
      queryNorm,
      candidates,
      dto.algorithm ?? PatternAlgorithm.NED,
      dto.topK ?? 20,
      dto.lookbackYears ?? 5,
    )

    return {
      patternLength: queryNorm.length,
      algorithm: dto.algorithm ?? PatternAlgorithm.NED,
      candidateCount: candidates.length,
      elapsedMs: Date.now() - startTime,
      querySeries: queryNorm.map(v => round(v, 4)),
      matches,
    }
  }

  // ── 核心搜索引擎 ─────────────────────────────────────────────────────────

  /**
   * 全市场滑动窗口搜索。
   * 性能策略：每批 50 只股票批量加载，每只股票只保留最优匹配，全局排序取 topK。
   */
  private async slidingWindowSearch(
    queryNorm: number[],
    candidates: { tsCode: string; name: string | null }[],
    algorithm: PatternAlgorithm,
    topK: number,
    lookbackYears: number,
  ): Promise<PatternMatchDto[]> {
    const windowLen = queryNorm.length
    const cutoffDate = dayjs().subtract(lookbackYears, 'year').format('YYYYMMDD')
    const distanceFn = algorithm === PatternAlgorithm.DTW ? dtwDistance : normalizedEuclideanDistance

    this.logger.debug(
      `滑动窗口搜索: 候选 ${candidates.length} 只, 窗口长度 ${windowLen}, 算法 ${algorithm}, 回溯 ${lookbackYears} 年`,
    )

    const results: PatternMatchDto[] = []

    for (let b = 0; b < candidates.length; b += BATCH_SIZE) {
      const batch = candidates.slice(b, b + BATCH_SIZE)
      const tsCodes = batch.map(c => c.tsCode)
      const nameMap = new Map(batch.map(c => [c.tsCode, c.name]))

      const batchData = await this.batchLoadAdjustedCloses(tsCodes, cutoffDate)

      for (const tsCode of tsCodes) {
        const priceData = batchData.get(tsCode)
        if (!priceData || priceData.length < windowLen) continue

        let bestDistance = Infinity
        let bestStartIdx = -1
        let bestEndIdx = -1

        // 步长 1 的滑动窗口
        for (let i = 0; i <= priceData.length - windowLen; i++) {
          const windowCloses = priceData.slice(i, i + windowLen).map(p => p.close)
          const windowNorm = normalizeToUnitRange(windowCloses)
          const dist = distanceFn(queryNorm, windowNorm)

          if (dist < bestDistance) {
            bestDistance = dist
            bestStartIdx = i
            bestEndIdx = i + windowLen - 1
          }
        }

        if (bestStartIdx === -1) continue

        const futureReturns = this.computeFutureReturns(priceData, bestEndIdx)
        const matchSlice = priceData.slice(bestStartIdx, bestEndIdx + 1)

        results.push({
          tsCode,
          name: nameMap.get(tsCode) ?? null,
          startDate: matchSlice[0].date,
          endDate: matchSlice[matchSlice.length - 1].date,
          distance: round(bestDistance, 6),
          similarity: round(distanceToSimilarity(bestDistance), 2),
          futureReturns,
          normalizedSeries: normalizeToUnitRange(matchSlice.map(p => p.close)).map(v => round(v, 4)),
        })
      }
    }

    results.sort((a, b) => a.distance - b.distance)
    return results.slice(0, topK)
  }

  /**
   * 计算匹配片段结束后第 5/10/20 交易日的累计涨跌幅（%）。
   * 若历史数据不足，则该时间节点不返回。
   */
  private computeFutureReturns(priceData: AdjustedPoint[], endIdx: number): number[] {
    const baseClose = priceData[endIdx]?.close
    if (!baseClose) return []

    const result: number[] = []
    for (const offset of [5, 10, 20]) {
      const futureIdx = endIdx + offset
      if (futureIdx >= priceData.length) break
      result.push(round(((priceData[futureIdx].close - baseClose) / baseClose) * 100, 2))
    }
    return result
  }

  // ── 数据加载 ─────────────────────────────────────────────────────────────

  /**
   * 批量加载多只股票的前复权收盘价序列。
   *
   * 前复权公式：adjClose = close × (latestAdjFactor / rowAdjFactor)
   * 每只股票以该股最新一条 adjFactor 作为基准。
   */
  private async batchLoadAdjustedCloses(
    tsCodes: string[],
    cutoffDate: string,
  ): Promise<Map<string, AdjustedPoint[]>> {
    if (tsCodes.length === 0) return new Map()

    const rows = await this.prisma.$queryRawUnsafe<PriceRow[]>(
      `SELECT d.ts_code AS "tsCode", d.trade_date AS "tradeDate", d.close, af.adj_factor AS "adjFactor"
       FROM stock_daily_prices d
       LEFT JOIN stock_adjustment_factors af
         ON af.ts_code = d.ts_code AND af.trade_date = d.trade_date
       WHERE d.ts_code = ANY($1::text[]) AND d.trade_date >= $2::date
       ORDER BY d.ts_code, d.trade_date ASC`,
      tsCodes,
      cutoffDate,
    )

    // 按 tsCode 分组
    const grouped = new Map<string, PriceRow[]>()
    for (const row of rows) {
      const key = row.tsCode
      if (!grouped.has(key)) grouped.set(key, [])
      grouped.get(key)!.push(row)
    }

    // 逐只股票前复权处理
    const result = new Map<string, AdjustedPoint[]>()
    for (const [tsCode, stockRows] of grouped) {
      const valid = stockRows.filter(r => r.close !== null)
      if (valid.length === 0) continue

      const latestAdj = valid[valid.length - 1]?.adjFactor ?? 1

      result.set(
        tsCode,
        valid.map(r => {
          const factor = r.adjFactor ?? 1
          const multiplier = factor > 0 ? latestAdj / factor : 1
          return {
            date: dayjs(r.tradeDate).format('YYYYMMDD'),
            close: Math.round(r.close! * multiplier * 10000) / 10000,
          }
        }),
      )
    }

    return result
  }

  /**
   * 加载单只股票指定日期区间的前复权收盘价（用于提取查询形态）。
   */
  private async loadAdjustedCloses(
    tsCode: string,
    startDate: string,
    endDate: string,
  ): Promise<AdjustedPoint[]> {
    const rows = await this.prisma.$queryRawUnsafe<PriceRow[]>(
      `SELECT d.ts_code AS "tsCode", d.trade_date AS "tradeDate", d.close, af.adj_factor AS "adjFactor"
       FROM stock_daily_prices d
       LEFT JOIN stock_adjustment_factors af
         ON af.ts_code = d.ts_code AND af.trade_date = d.trade_date
       WHERE d.ts_code = $1 AND d.trade_date BETWEEN $2::date AND $3::date
       ORDER BY d.trade_date ASC`,
      tsCode,
      startDate,
      endDate,
    )

    const valid = rows.filter(r => r.close !== null)
    if (valid.length === 0) return []

    const latestAdj = valid[valid.length - 1]?.adjFactor ?? 1

    return valid.map(r => {
      const factor = r.adjFactor ?? 1
      const multiplier = factor > 0 ? latestAdj / factor : 1
      return {
        date: dayjs(r.tradeDate).format('YYYYMMDD'),
        close: Math.round(r.close! * multiplier * 10000) / 10000,
      }
    })
  }

  /**
   * 获取候选股票池。
   * - ALL：全市场上市 A 股（list_status = 'L'）
   * - INDEX：指定指数成分股（来自 index_constituent_weights）
   */
  private async getCandidateStocks(
    scope: PatternScope,
    indexCode?: string,
  ): Promise<{ tsCode: string; name: string | null }[]> {
    if (scope === PatternScope.INDEX && indexCode) {
      return this.prisma.$queryRaw<{ tsCode: string; name: string | null }[]>`
        SELECT DISTINCT iw.con_code AS "tsCode", sb.name
        FROM index_constituent_weights iw
        JOIN stock_basic_profiles sb ON iw.con_code = sb.ts_code
        WHERE iw.index_code = ${indexCode}
          AND sb.list_status = 'L'
      `
    }

    return this.prisma.stockBasic.findMany({
      where: { listStatus: 'L' },
      select: { tsCode: true, name: true },
    })
  }
}
