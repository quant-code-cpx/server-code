import { Inject, Injectable } from '@nestjs/common'
import { createHash, randomUUID } from 'crypto'
import { PrismaService } from 'src/shared/prisma.service'
import { REDIS_CLIENT } from 'src/shared/redis.provider'
import type { RedisClientType } from 'redis'
import { FactorComputeService } from './factor-compute.service'
import { FactorCondition, FactorScreeningDto } from '../dto/factor-screening.dto'

@Injectable()
export class FactorScreeningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly compute: FactorComputeService,
    @Inject(REDIS_CLIENT) private readonly redis: RedisClientType,
  ) {}

  async screening(dto: FactorScreeningDto) {
    const tradeDate = dto.tradeDate
    const page = dto.page ?? 1
    const pageSize = dto.pageSize ?? 50
    const sortOrder = dto.sortOrder ?? 'desc'
    const requestHash = this.hashRequest(dto)
    const requestId = randomUUID()
    const cacheKey = `factor:screening:${requestHash}:${page}:${pageSize}`

    const cached = await Promise.resolve(this.redis.get(cacheKey)).catch(() => null)
    if (cached) return JSON.parse(cached)

    const warnings: string[] = []
    const errors: string[] = []
    if (!dto.conditions.length) {
      warnings.push('未提供筛选条件')
      return this.emptyResult(dto, page, pageSize, requestId, requestHash, warnings, errors)
    }

    // Get factor values for each condition's factor (+ sortBy if different)
    const allFactorNames = new Set<string>(dto.conditions.map((c) => c.factorName))
    if (dto.sortBy) allFactorNames.add(dto.sortBy)

    const factorMaps = new Map<string, Map<string, number | null>>()
    for (const factorName of allFactorNames) {
      const vals = await this.compute.getRawFactorValuesForDate(factorName, tradeDate, dto.universe)
      const map = new Map<string, number | null>()
      for (const v of vals) map.set(v.tsCode, v.factorValue)
      factorMaps.set(factorName, map)
    }

    // Determine universe of stocks (all stocks present in the first condition's factor)
    const firstMap = factorMaps.get(dto.conditions[0]?.factorName)
    if (!firstMap) {
      warnings.push('首个筛选条件无可用因子值')
      return this.emptyResult(dto, page, pageSize, requestId, requestHash, warnings, errors)
    }

    // Start with all ts_codes from the first condition factor
    let candidateCodes = Array.from(firstMap.keys())
    const universeSize = candidateCodes.length
    const conditionPassCounts: Array<{
      factorName: string
      operator: FactorCondition['operator']
      passCount: number
      remainingCount: number
    }> = []

    // Apply each condition to filter
    for (const condition of dto.conditions) {
      const fMap = factorMaps.get(condition.factorName)
      if (!fMap) {
        errors.push(`因子 ${condition.factorName} 缺少截面值`)
        candidateCodes = []
        break
      }

      // For percent-based operators, compute threshold from the current candidate set
      let passSet: Set<string>

      if (condition.operator === 'top_pct' || condition.operator === 'bottom_pct') {
        // Rank stocks by this factor among all stocks in the factor map
        const ranked = this.rankStocks(fMap, condition.operator === 'top_pct' ? 'desc' : 'asc')
        const pct = condition.percent ?? 20
        const keepCount = Math.max(1, Math.round((ranked.length * pct) / 100))
        passSet = new Set(ranked.slice(0, keepCount).map((r) => r.tsCode))
      } else {
        passSet = new Set<string>()
        for (const [tsCode, val] of fMap) {
          if (val == null) continue
          if (this.passesCondition(val, condition)) passSet.add(tsCode)
        }
      }

      candidateCodes = candidateCodes.filter((c) => passSet.has(c))
      conditionPassCounts.push({
        factorName: condition.factorName,
        operator: condition.operator,
        passCount: passSet.size,
        remainingCount: candidateCodes.length,
      })
    }

    // Fetch stock names and industry for qualifying stocks
    const stockInfo = await this.getStockInfo(candidateCodes)

    // Build result items with factor values
    const items = candidateCodes.map((tsCode) => {
      const info = stockInfo.get(tsCode)
      const factors: Record<string, number | null> = {}
      for (const factorName of allFactorNames) {
        factors[factorName] = factorMaps.get(factorName)?.get(tsCode) ?? null
      }
      return { tsCode, name: info?.name ?? null, industry: info?.industry ?? null, factors }
    })

    // Sort
    if (dto.sortBy && factorMaps.has(dto.sortBy)) {
      const sortMap = factorMaps.get(dto.sortBy)!
      items.sort((a, b) => {
        const av = sortMap.get(a.tsCode) ?? null
        const bv = sortMap.get(b.tsCode) ?? null
        if (av == null && bv == null) return 0
        if (av == null) return 1
        if (bv == null) return -1
        return sortOrder === 'desc' ? bv - av : av - bv
      })
    }

    const total = items.length
    const offset = (page - 1) * pageSize
    const pageItems = items.slice(offset, offset + pageSize)

    const result = {
      requestId,
      requestHash,
      tradeDate,
      universe: dto.universe ?? null,
      conditionCount: dto.conditions.length,
      conditionPassCounts,
      summary: {
        universeSize,
        matchedCount: total,
        returnedCount: pageItems.length,
        pageCount: Math.ceil(total / pageSize),
      },
      warnings,
      errors,
      total,
      page,
      pageSize,
      items: pageItems,
    }

    await Promise.resolve(this.redis.set(cacheKey, JSON.stringify(result), { EX: 60 })).catch(() => undefined)
    return result
  }

  private passesCondition(val: number, cond: FactorCondition): boolean {
    switch (cond.operator) {
      case 'gt':
        return cond.value != null && val > cond.value
      case 'gte':
        return cond.value != null && val >= cond.value
      case 'lt':
        return cond.value != null && val < cond.value
      case 'lte':
        return cond.value != null && val <= cond.value
      case 'between':
        return cond.min != null && cond.max != null && val >= cond.min && val <= cond.max
      default:
        return true
    }
  }

  private rankStocks(fMap: Map<string, number | null>, order: 'asc' | 'desc'): Array<{ tsCode: string; val: number }> {
    const entries: Array<{ tsCode: string; val: number }> = []
    for (const [tsCode, val] of fMap) {
      if (val != null) entries.push({ tsCode, val })
    }
    entries.sort((a, b) => (order === 'desc' ? b.val - a.val : a.val - b.val))
    return entries
  }

  private async getStockInfo(
    tsCodes: string[],
  ): Promise<Map<string, { name: string | null; industry: string | null }>> {
    if (!tsCodes.length) return new Map()
    const rows = await this.prisma.stockBasic.findMany({
      where: { tsCode: { in: tsCodes } },
      select: { tsCode: true, name: true, industry: true },
    })
    const map = new Map<string, { name: string | null; industry: string | null }>()
    for (const r of rows) map.set(r.tsCode, { name: r.name, industry: r.industry ?? null })
    return map
  }

  private emptyResult(
    dto: FactorScreeningDto,
    page: number,
    pageSize: number,
    requestId = randomUUID(),
    requestHash = this.hashRequest(dto),
    warnings: string[] = [],
    errors: string[] = [],
  ) {
    return {
      requestId,
      requestHash,
      tradeDate: dto.tradeDate,
      universe: dto.universe ?? null,
      conditionCount: dto.conditions.length,
      conditionPassCounts: [],
      summary: { universeSize: 0, matchedCount: 0, returnedCount: 0, pageCount: 0 },
      warnings,
      errors,
      total: 0,
      page,
      pageSize,
      items: [],
    }
  }

  private hashRequest(dto: FactorScreeningDto): string {
    return createHash('sha1').update(JSON.stringify(dto)).digest('hex')
  }
}
