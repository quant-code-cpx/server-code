import { Injectable } from '@nestjs/common'
import { CORE_INDEX_NAME_MAP } from 'src/constant/tushare.constant'
import { getShanghaiCompactTradeDate } from 'src/common/utils/trade-date.util'
import { PrismaService } from 'src/shared/prisma.service'

export type SectorMembershipMode = 'SECTORS_FOR_SECURITY' | 'MEMBERS_FOR_SECTOR'
export type SectorMembershipType = 'INDUSTRY' | 'CONCEPT' | 'INDEX'

export interface SectorMembershipInput {
  mode: SectorMembershipMode
  tsCode?: string
  sectorCode?: string
  sectorType?: SectorMembershipType
  effectiveDate?: string
  limit: number
}

export interface SectorMembershipItem {
  tsCode: string
  name: string | null
  sectorCode: string
  sectorName: string | null
  sectorType: SectorMembershipType
  level: string | null
  weight: number | null
  inDate: string | null
  outDate: string | null
}

export class SectorHistoryUnavailableError extends Error {
  constructor() {
    super('THS 概念成分缺少历史有效期，不能回答历史时点查询')
    this.name = SectorHistoryUnavailableError.name
  }
}

@Injectable()
export class SectorToolFacade {
  constructor(private readonly prisma: PrismaService) {}

  async membership(input: SectorMembershipInput) {
    const requestedTypes = input.sectorType
      ? [input.sectorType]
      : (['INDUSTRY', 'CONCEPT', 'INDEX'] as SectorMembershipType[])
    if (requestedTypes.includes('CONCEPT') && isHistoricalDate(input.effectiveDate)) {
      throw new SectorHistoryUnavailableError()
    }

    const resultSets = await Promise.all(
      requestedTypes.map((type) =>
        input.mode === 'SECTORS_FOR_SECURITY'
          ? this.sectorsForSecurity(input.tsCode!, type, input.effectiveDate, input.limit + 1)
          : this.membersForSector(input.sectorCode!, type, input.effectiveDate, input.limit + 1),
      ),
    )
    const allItems = resultSets.flatMap((result) => result.items).sort(compareMembershipItems)
    const truncated = allItems.length > input.limit
    const items = allItems.slice(0, input.limit)
    const asOf =
      resultSets
        .map((result) => result.asOf)
        .filter((value): value is string => value !== null)
        .sort()
        .at(-1) ?? null
    const currentConceptWarning = requestedTypes.includes('CONCEPT') ? ['THS_CONCEPT_CURRENT_ONLY'] : []

    return {
      data: {
        mode: input.mode,
        tsCode: input.tsCode ?? null,
        sectorCode: input.sectorCode ?? null,
        sectorType: input.sectorType ?? null,
        effectiveDate: input.effectiveDate ?? null,
        items,
      },
      truncated,
      asOf,
      warningCodes: currentConceptWarning,
      sourceModels: sourceModelsForTypes(requestedTypes),
    }
  }

  private async sectorsForSecurity(
    tsCode: string,
    type: SectorMembershipType,
    effectiveDate: string | undefined,
    limit: number,
  ): Promise<{ items: SectorMembershipItem[]; asOf: string | null }> {
    if (type === 'INDUSTRY') {
      const date = effectiveDate ? parseIsoDate(effectiveDate) : undefined
      const rows = await this.prisma.indexMemberAll.findMany({
        where: {
          tsCode,
          ...(date ? { inDate: { lte: date }, OR: [{ outDate: null }, { outDate: { gte: date } }] } : { isNew: 'Y' }),
        },
        orderBy: [{ inDate: 'desc' }, { l3Code: 'asc' }],
        take: limit,
        select: {
          tsCode: true,
          name: true,
          l1Code: true,
          l1Name: true,
          l2Code: true,
          l2Name: true,
          l3Code: true,
          l3Name: true,
          inDate: true,
          outDate: true,
        },
      })
      const items = rows.flatMap((row) =>
        [
          ['L1', row.l1Code, row.l1Name],
          ['L2', row.l2Code, row.l2Name],
          ['L3', row.l3Code, row.l3Name],
        ].map(([level, sectorCode, sectorName]) => ({
          tsCode: row.tsCode,
          name: row.name,
          sectorCode,
          sectorName,
          sectorType: type,
          level,
          weight: null,
          inDate: toIsoDate(row.inDate),
          outDate: toIsoDate(row.outDate),
        })),
      )
      return { items: deduplicateItems(items).slice(0, limit), asOf: effectiveDate ?? latestDate(items, 'inDate') }
    }

    if (type === 'CONCEPT') {
      const rows = await this.prisma.thsMember.findMany({
        where: { conCode: tsCode, OR: [{ isNew: 'Y' }, { isNew: null }] },
        include: { board: { select: { tsCode: true, name: true } } },
        orderBy: { tsCode: 'asc' },
        take: limit,
      })
      return {
        items: rows.map((row) => ({
          tsCode,
          name: row.conName,
          sectorCode: row.board.tsCode,
          sectorName: row.board.name,
          sectorType: type,
          level: null,
          weight: null,
          inDate: null,
          outDate: null,
        })),
        asOf: isoToday(),
      }
    }

    const compactDate = effectiveDate?.replaceAll('-', '')
    const rows = await this.prisma.indexWeight.findMany({
      where: { conCode: tsCode, ...(compactDate ? { tradeDate: { lte: compactDate } } : {}) },
      orderBy: [{ indexCode: 'asc' }, { tradeDate: 'desc' }],
      take: limit * 10,
      select: { indexCode: true, conCode: true, tradeDate: true, weight: true },
    })
    const latestByIndex = new Map<string, (typeof rows)[number]>()
    for (const row of rows) if (!latestByIndex.has(row.indexCode)) latestByIndex.set(row.indexCode, row)
    const items = [...latestByIndex.values()].slice(0, limit).map((row) => ({
      tsCode: row.conCode,
      name: null,
      sectorCode: row.indexCode,
      sectorName: CORE_INDEX_NAME_MAP[row.indexCode] ?? null,
      sectorType: type,
      level: null,
      weight: row.weight == null ? null : Number(row.weight),
      inDate: compactToIsoDate(row.tradeDate),
      outDate: null,
    }))
    return { items, asOf: latestDate(items, 'inDate') }
  }

  private async membersForSector(
    sectorCode: string,
    type: SectorMembershipType,
    effectiveDate: string | undefined,
    limit: number,
  ): Promise<{ items: SectorMembershipItem[]; asOf: string | null }> {
    if (type === 'INDUSTRY') {
      const date = effectiveDate ? parseIsoDate(effectiveDate) : undefined
      const rows = await this.prisma.indexMemberAll.findMany({
        where: {
          OR: [{ l1Code: sectorCode }, { l2Code: sectorCode }, { l3Code: sectorCode }],
          ...(date
            ? { inDate: { lte: date }, AND: [{ OR: [{ outDate: null }, { outDate: { gte: date } }] }] }
            : { isNew: 'Y' }),
        },
        orderBy: [{ tsCode: 'asc' }, { inDate: 'desc' }],
        take: limit,
        select: {
          tsCode: true,
          name: true,
          l1Code: true,
          l1Name: true,
          l2Code: true,
          l2Name: true,
          l3Code: true,
          l3Name: true,
          inDate: true,
          outDate: true,
        },
      })
      const items = rows.map((row) => {
        const [level, sectorName] =
          row.l1Code === sectorCode
            ? ['L1', row.l1Name]
            : row.l2Code === sectorCode
              ? ['L2', row.l2Name]
              : ['L3', row.l3Name]
        return {
          tsCode: row.tsCode,
          name: row.name,
          sectorCode,
          sectorName,
          sectorType: type,
          level,
          weight: null,
          inDate: toIsoDate(row.inDate),
          outDate: toIsoDate(row.outDate),
        }
      })
      return { items: deduplicateItems(items), asOf: effectiveDate ?? latestDate(items, 'inDate') }
    }

    if (type === 'CONCEPT') {
      const [board, rows] = await Promise.all([
        this.prisma.thsIndex.findUnique({ where: { tsCode: sectorCode }, select: { name: true } }),
        this.prisma.thsMember.findMany({
          where: { tsCode: sectorCode, OR: [{ isNew: 'Y' }, { isNew: null }] },
          orderBy: { conCode: 'asc' },
          take: limit,
          select: { conCode: true, conName: true },
        }),
      ])
      return {
        items: rows.map((row) => ({
          tsCode: row.conCode,
          name: row.conName,
          sectorCode,
          sectorName: board?.name ?? null,
          sectorType: type,
          level: null,
          weight: null,
          inDate: null,
          outDate: null,
        })),
        asOf: isoToday(),
      }
    }

    const compactDate = effectiveDate?.replaceAll('-', '')
    const snapshot = await this.prisma.indexWeight.findFirst({
      where: { indexCode: sectorCode, ...(compactDate ? { tradeDate: { lte: compactDate } } : {}) },
      orderBy: { tradeDate: 'desc' },
      select: { tradeDate: true },
    })
    if (!snapshot) return { items: [], asOf: null }
    const rows = await this.prisma.indexWeight.findMany({
      where: { indexCode: sectorCode, tradeDate: snapshot.tradeDate },
      orderBy: [{ weight: 'desc' }, { conCode: 'asc' }],
      take: limit,
      select: { conCode: true, weight: true },
    })
    const stocks = await this.prisma.stockBasic.findMany({
      where: { tsCode: { in: rows.map((row) => row.conCode) } },
      select: { tsCode: true, name: true },
    })
    const names = new Map(stocks.map((stock) => [stock.tsCode, stock.name]))
    return {
      items: rows.map((row) => ({
        tsCode: row.conCode,
        name: names.get(row.conCode) ?? null,
        sectorCode,
        sectorName: CORE_INDEX_NAME_MAP[sectorCode] ?? null,
        sectorType: type,
        level: null,
        weight: row.weight == null ? null : Number(row.weight),
        inDate: compactToIsoDate(snapshot.tradeDate),
        outDate: null,
      })),
      asOf: compactToIsoDate(snapshot.tradeDate),
    }
  }
}

function compareMembershipItems(left: SectorMembershipItem, right: SectorMembershipItem): number {
  return (
    left.sectorType.localeCompare(right.sectorType) ||
    left.sectorCode.localeCompare(right.sectorCode) ||
    left.tsCode.localeCompare(right.tsCode)
  )
}

function deduplicateItems(items: SectorMembershipItem[]): SectorMembershipItem[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = `${item.tsCode}:${item.sectorType}:${item.sectorCode}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function sourceModelsForTypes(types: SectorMembershipType[]): string[] {
  const map: Record<SectorMembershipType, string[]> = {
    INDUSTRY: ['IndexMemberAll'],
    CONCEPT: ['ThsIndex', 'ThsMember'],
    INDEX: ['IndexWeight', 'StockBasic'],
  }
  return [...new Set(types.flatMap((type) => map[type]))]
}

function isHistoricalDate(value: string | undefined): boolean {
  return Boolean(value && value.replaceAll('-', '') < getShanghaiCompactTradeDate())
}

function isoToday(): string {
  return compactToIsoDate(getShanghaiCompactTradeDate())!
}

function parseIsoDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`)
}

function compactToIsoDate(value: string | null | undefined): string | null {
  return value && /^\d{8}$/.test(value) ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}` : null
}

function toIsoDate(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null
}

function latestDate(items: SectorMembershipItem[], field: 'inDate'): string | null {
  return (
    items
      .map((item) => item[field])
      .filter((value): value is string => value !== null)
      .sort()
      .at(-1) ?? null
  )
}
