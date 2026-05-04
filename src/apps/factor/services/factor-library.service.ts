import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common'
import { FactorCategory, Prisma } from '@prisma/client'
import {
  diffCompactTradeDateFromShanghaiToday,
  formatDateToCompactTradeDate,
  getShanghaiCompactTradeDate,
} from 'src/common/utils/trade-date.util'
import { PrismaService } from 'src/shared/prisma.service'
import { BUILTIN_FACTORS, CATEGORY_LABEL_MAP } from '../constants/builtin-factors.constant'
import {
  FactorAdminJobDetailDto,
  FactorAdminJobsQueryDto,
  FactorDetailQueryDto,
  FactorLibraryQueryDto,
  FactorPrecomputeBatchDto,
} from '../dto/factor-library.dto'
import { FactorCategoryGroup, FactorItem } from '../types/factor.types'

@Injectable()
export class FactorLibraryService implements OnModuleInit {
  private readonly logger = new Logger(FactorLibraryService.name)

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.seedBuiltinFactors()
  }

  /** 启动时幂等写入内置因子定义 */
  async seedBuiltinFactors(): Promise<void> {
    try {
      for (const factor of BUILTIN_FACTORS) {
        await this.prisma.factorDefinition.upsert({
          where: { name: factor.name },
          create: {
            name: factor.name,
            label: factor.label,
            description: factor.description,
            category: factor.category,
            sourceType: factor.sourceType,
            expression: factor.expression ?? null,
            sourceTable: factor.sourceTable ?? null,
            sourceField: factor.sourceField ?? null,
            params: (factor.params as Prisma.InputJsonValue | undefined) ?? undefined,
            isEnabled: true,
            sortOrder: factor.sortOrder,
          },
          update: {
            label: factor.label,
            description: factor.description,
            category: factor.category,
            sourceType: factor.sourceType,
            expression: factor.expression ?? null,
            sourceTable: factor.sourceTable ?? null,
            sourceField: factor.sourceField ?? null,
            params: (factor.params as Prisma.InputJsonValue | undefined) ?? undefined,
            sortOrder: factor.sortOrder,
          },
        })
      }
      this.logger.log(`内置因子 seed 完成，共 ${BUILTIN_FACTORS.length} 个`)
    } catch (error) {
      this.logger.error('内置因子 seed 失败', (error as Error).message)
    }
  }

  /** 获取因子库列表，按分类分组，并附加覆盖率状态 */
  async getLibrary(dto: FactorLibraryQueryDto): Promise<{ categories: FactorCategoryGroup[] }> {
    const where: Parameters<typeof this.prisma.factorDefinition.findMany>[0]['where'] = {}
    if (dto.category) where.category = dto.category
    if (dto.enabledOnly !== false) where.isEnabled = true
    if (dto.sourceType) where.sourceType = dto.sourceType

    const factors = await this.prisma.factorDefinition.findMany({
      where,
      orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }],
    })

    // Load latest snapshot summary for all factor names
    interface SummaryRow {
      factor_name: string
      latest_date: string | Date
      total_stocks: bigint
      missing_stocks: bigint
    }
    const snapshotRows = await this.prisma.$queryRaw<SummaryRow[]>(Prisma.sql`
      SELECT s.factor_name,
             s.trade_date AS latest_date,
             s.count      AS total_stocks,
             s.missing    AS missing_stocks
      FROM factor_snapshot_summaries s
      INNER JOIN (
        SELECT factor_name, MAX(trade_date) AS max_date
        FROM factor_snapshot_summaries
        GROUP BY factor_name
      ) latest ON s.factor_name = latest.factor_name AND s.trade_date = latest.max_date
    `)

    interface SnapshotInfo {
      latestDate: string
      coverageRate: number
      staleDays: number
      status: 'HEALTHY' | 'STALE' | 'MISSING'
    }
    const snapshotMap = new Map<string, SnapshotInfo>()
    for (const row of snapshotRows) {
      const total = Number(row.total_stocks)
      const missing = Number(row.missing_stocks)
      const coverageRate = total > 0 ? Math.round(((total - missing) / total) * 10000) / 10000 : 0
      const latestDate = formatDateToCompactTradeDate(row.latest_date)
      const staleDays = latestDate ? (diffCompactTradeDateFromShanghaiToday(latestDate) ?? 999) : 999
      snapshotMap.set(row.factor_name, {
        latestDate: latestDate ?? '',
        coverageRate,
        staleDays,
        status: staleDays <= 5 ? 'HEALTHY' : staleDays <= 30 ? 'STALE' : 'MISSING',
      })
    }

    const enrichedFactors: FactorItem[] = []

    for (const f of factors) {
      const snap = snapshotMap.get(f.name)
      if (dto.coverageMin !== undefined && (snap?.coverageRate ?? 0) < dto.coverageMin) continue
      if (dto.status && (snap?.status ?? 'MISSING') !== dto.status) continue
      // IC metrics are not persisted in factor definitions yet. Keep the filter non-destructive until IC storage lands.

      enrichedFactors.push({
        id: f.id,
        name: f.name,
        label: f.label,
        description: f.description,
        category: f.category,
        sourceType: f.sourceType,
        isBuiltin: f.isBuiltin,
        isEnabled: f.isEnabled,
        sortOrder: f.sortOrder,
        // Enriched status fields
        latestDate: snap?.latestDate ?? null,
        coverageRate: snap?.coverageRate ?? null,
        staleDays: snap?.staleDays ?? null,
        status: snap?.status ?? 'MISSING',
      })
    }

    const sortBy = dto.sortBy ?? 'sortOrder'
    const sortOrder = dto.sortOrder ?? 'asc'
    enrichedFactors.sort((a, b) => {
      const direction = sortOrder === 'desc' ? -1 : 1
      const av = a[sortBy as keyof FactorItem]
      const bv = b[sortBy as keyof FactorItem]
      if (av == null && bv == null) return a.sortOrder - b.sortOrder
      if (av == null) return 1
      if (bv == null) return -1
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * direction
      return String(av).localeCompare(String(bv), 'zh-CN') * direction
    })

    const grouped = new Map<FactorCategory, FactorCategoryGroup>()
    for (const factor of enrichedFactors) {
      if (!grouped.has(factor.category)) {
        grouped.set(factor.category, {
          category: factor.category,
          label: CATEGORY_LABEL_MAP[factor.category] ?? factor.category,
          factors: [],
        })
      }
      grouped.get(factor.category)!.factors.push(factor)
    }

    return { categories: Array.from(grouped.values()) }
  }

  /** 获取单个因子详情 */
  async getDetail(dto: FactorDetailQueryDto) {
    const factor = await this.prisma.factorDefinition.findUnique({
      where: { name: dto.factorName },
    })

    if (!factor) {
      throw new NotFoundException(`因子 "${dto.factorName}" 不存在`)
    }

    return {
      id: factor.id,
      name: factor.name,
      label: factor.label,
      description: factor.description,
      category: factor.category,
      sourceType: factor.sourceType,
      sourceTable: factor.sourceTable,
      sourceField: factor.sourceField,
      expression: factor.expression,
      params: factor.params,
      isBuiltin: factor.isBuiltin,
      isEnabled: factor.isEnabled,
      sortOrder: factor.sortOrder,
      createdAt: factor.createdAt,
      updatedAt: factor.updatedAt,
    }
  }

  // ── Admin batch precompute ─────────────────────────────────────────────────

  /** 批量触发预计算（subset of factors + optional tradeDate） */
  async precomputeBatch(dto: FactorPrecomputeBatchDto): Promise<{ tradeDate: string; factorNames: string[] }> {
    // Resolve tradeDate: use provided, or fetch latest trading day from snapshot summaries
    let tradeDate = dto.tradeDate
    if (!tradeDate) {
      interface LatestRow {
        latest_date: string
      }
      const rows = await this.prisma.$queryRaw<LatestRow[]>(
        Prisma.sql`SELECT MAX(trade_date) AS latest_date FROM factor_snapshot_summaries`,
      )
      tradeDate = rows[0]?.latest_date ?? getShanghaiCompactTradeDate()
    }

    // Determine factor names to precompute
    let factorNames = dto.factorNames ?? []
    if (!factorNames.length) {
      const all = await this.prisma.factorDefinition.findMany({
        where: { isEnabled: true },
        select: { name: true },
      })
      factorNames = all.map((f) => f.name)
    }

    this.logger.log(`[precompute-batch] 准备预计算: tradeDate=${tradeDate}, factors=${factorNames.length}`)

    return { tradeDate, factorNames }
  }

  // ── Admin jobs listing ─────────────────────────────────────────────────────

  /** 列出按交易日分组的预计算批次历史 */
  async listAdminJobs(dto: FactorAdminJobsQueryDto) {
    const page = dto.page ?? 1
    const pageSize = dto.pageSize ?? 20

    interface BatchRow {
      trade_date: string | Date
      factor_count: bigint
      total_stocks: bigint
      missing_stocks: bigint
      latest_synced_at: Date
    }

    const rows = await this.prisma.$queryRaw<BatchRow[]>(Prisma.sql`
      SELECT
        trade_date,
        COUNT(DISTINCT factor_name) AS factor_count,
        SUM(count)                  AS total_stocks,
        SUM(missing)                AS missing_stocks,
        MAX(synced_at)              AS latest_synced_at
      FROM factor_snapshot_summaries
      GROUP BY trade_date
      ORDER BY trade_date DESC
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
    `)

    interface CountRow {
      total: bigint
    }
    const countRows = await this.prisma.$queryRaw<CountRow[]>(
      Prisma.sql`SELECT COUNT(DISTINCT trade_date) AS total FROM factor_snapshot_summaries`,
    )
    const total = Number(countRows[0]?.total ?? 0)

    const items = rows.map((r) => {
      const fc = Number(r.factor_count)
      const ts = Number(r.total_stocks)
      const ms = Number(r.missing_stocks)
      const coverageRate = ts > 0 ? Math.round(((ts - ms) / ts) * 10000) / 10000 : 0
      const tradeDate = formatDateToCompactTradeDate(r.trade_date) ?? ''
      const staleDays = diffCompactTradeDateFromShanghaiToday(tradeDate) ?? 999
      return {
        tradeDate,
        factorCount: fc,
        totalStocks: ts,
        missingStocks: ms,
        coverageRate,
        latestSyncedAt: r.latest_synced_at?.toISOString() ?? null,
        status: staleDays <= 5 ? 'HEALTHY' : staleDays <= 30 ? 'STALE' : 'OLD',
      }
    })

    return { total, page, pageSize, items }
  }

  /** 获取某交易日批次详情（逐因子状态） */
  async getAdminJobDetail(dto: FactorAdminJobDetailDto) {
    interface FactorRow {
      factor_name: string
      count: number
      missing: number
      synced_at: Date
    }

    const rows = await this.prisma.$queryRaw<FactorRow[]>(Prisma.sql`
      SELECT factor_name, count, missing, synced_at
      FROM factor_snapshot_summaries
      WHERE trade_date = ${dto.tradeDate}
      ORDER BY factor_name
    `)

    if (rows.length === 0) return null

    const items = rows.map((r) => {
      const coverageRate = r.count > 0 ? Math.round(((r.count - r.missing) / r.count) * 10000) / 10000 : 0
      return {
        factorName: r.factor_name,
        totalStocks: r.count,
        missingStocks: r.missing,
        coverageRate,
        syncedAt: r.synced_at?.toISOString() ?? null,
        status: coverageRate >= 0.8 ? 'OK' : coverageRate > 0 ? 'LOW_COVERAGE' : 'FAILED',
      }
    })

    return {
      tradeDate: dto.tradeDate,
      factorCount: items.length,
      items,
    }
  }
}
