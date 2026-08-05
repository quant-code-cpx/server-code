import { Injectable } from '@nestjs/common'
import {
  formatDateToCompactTradeDate,
  getShanghaiCompactTradeDate,
  parseCompactTradeDateToUtcDate,
} from 'src/common/utils/trade-date.util'
import { PrismaService } from 'src/shared/prisma.service'
import {
  DATA_AVAILABILITY_CATALOG,
  type DataAvailabilityCatalogEntry,
  type DataAvailabilityDataset,
} from './data-availability.catalog'

interface AvailabilityDelegate {
  findFirst(args: Record<string, unknown>): Promise<Record<string, unknown> | null>
  count(args: Record<string, unknown>): Promise<number>
}

export interface DataAvailabilitySnapshot {
  dataset: DataAvailabilityDataset
  coverageStart: string | null
  dataThrough: string | null
  rowCount: number | null
  lastSyncedAt: string | null
  syncStatus: 'SUCCESS' | 'FAILED' | 'RUNNING' | 'UNKNOWN'
  qualityStatus: 'PASS' | 'WARN' | 'FAIL' | 'UNKNOWN'
}

@Injectable()
export class DataAvailabilityRepository {
  constructor(private readonly prisma: PrismaService) {}

  async load(dataset: DataAvailabilityDataset, tsCode?: string): Promise<DataAvailabilitySnapshot> {
    const catalog = DATA_AVAILABILITY_CATALOG[dataset]
    const delegate = this.delegate(dataset)
    const dateField = catalog.dateField
    const where = {
      ...(tsCode ? { tsCode } : {}),
      ...(dateField === 'annDate' ? { annDate: { not: null } } : {}),
    }
    const [first, latest, rowCount, syncLog, progress, quality] = await Promise.all([
      delegate.findFirst({ where, orderBy: { [dateField]: 'asc' }, select: { [dateField]: true } }),
      delegate.findFirst({ where, orderBy: { [dateField]: 'desc' }, select: { [dateField]: true } }),
      tsCode ? delegate.count({ where }) : Promise.resolve(null),
      this.prisma.tushareSyncLog.findFirst({
        where: { task: catalog.syncTask },
        orderBy: { startedAt: 'desc' },
        select: { status: true, finishedAt: true, startedAt: true },
      }),
      this.prisma.tushareSyncProgress.findUnique({
        where: { task: catalog.syncTask },
        select: { status: true, updatedAt: true },
      }),
      this.prisma.dataQualityCheck.findFirst({
        where: { dataSet: { in: [catalog.qualityDataSet, catalog.dataset] } },
        orderBy: { checkDate: 'desc' },
        select: { status: true },
      }),
    ])
    return {
      dataset,
      coverageStart: rowDate(first, dateField),
      dataThrough: rowDate(latest, dateField),
      rowCount,
      lastSyncedAt: (syncLog?.finishedAt ?? syncLog?.startedAt ?? progress?.updatedAt)?.toISOString() ?? null,
      syncStatus:
        progress?.status === 'RUNNING'
          ? 'RUNNING'
          : syncLog?.status === 'SUCCESS'
            ? 'SUCCESS'
            : syncLog?.status === 'FAILED'
              ? 'FAILED'
              : 'UNKNOWN',
      qualityStatus: normalizeQualityStatus(quality?.status),
    }
  }

  async loadRecentOpenDates(limit = 1_000): Promise<string[]> {
    const today = parseCompactTradeDateToUtcDate(getShanghaiCompactTradeDate())
    const rows = await this.prisma.tradeCal.findMany({
      where: { exchange: 'SSE', isOpen: '1', calDate: { lte: today } },
      orderBy: { calDate: 'desc' },
      take: limit,
      select: { calDate: true },
    })
    return rows
      .map((row) => formatDateToCompactTradeDate(row.calDate))
      .filter((value): value is string => value !== null)
      .map(toIsoDate)
  }

  private delegate(dataset: DataAvailabilityDataset): AvailabilityDelegate {
    switch (dataset) {
      case 'STOCK_DAILY':
        return this.prisma.daily as unknown as AvailabilityDelegate
      case 'STOCK_DAILY_BASIC':
        return this.prisma.dailyBasic as unknown as AvailabilityDelegate
      case 'STOCK_ADJ_FACTOR':
        return this.prisma.adjFactor as unknown as AvailabilityDelegate
      case 'STOCK_TECHNICAL_FACTOR':
        return this.prisma.stkFactor as unknown as AvailabilityDelegate
      case 'STOCK_MONEYFLOW':
        return this.prisma.moneyflow as unknown as AvailabilityDelegate
      case 'FINANCIAL_INDICATOR':
        return this.prisma.finaIndicator as unknown as AvailabilityDelegate
      case 'INCOME_STATEMENT':
        return this.prisma.income as unknown as AvailabilityDelegate
      case 'BALANCE_SHEET':
        return this.prisma.balanceSheet as unknown as AvailabilityDelegate
      case 'CASHFLOW':
        return this.prisma.cashflow as unknown as AvailabilityDelegate
      case 'INDEX_DAILY':
        return this.prisma.indexDaily as unknown as AvailabilityDelegate
      case 'SECTOR_DAILY':
        return this.prisma.thsDaily as unknown as AvailabilityDelegate
      case 'MARKET_MONEYFLOW':
        return this.prisma.moneyflowMktDc as unknown as AvailabilityDelegate
      case 'HSGT':
        return this.prisma.moneyflowHsgt as unknown as AvailabilityDelegate
      case 'MARGIN_DETAIL':
        return this.prisma.marginDetail as unknown as AvailabilityDelegate
      case 'CYQ_PERF':
        return this.prisma.cyqPerf as unknown as AvailabilityDelegate
      case 'CYQ_CHIPS':
        return this.prisma.cyqChips as unknown as AvailabilityDelegate
    }
  }
}

function rowDate(row: Record<string, unknown> | null, field: DataAvailabilityCatalogEntry['dateField']): string | null {
  const value = row?.[field]
  if (!(value instanceof Date)) return null
  const compact = formatDateToCompactTradeDate(value)
  return compact ? toIsoDate(compact) : null
}

function normalizeQualityStatus(value: string | null | undefined): DataAvailabilitySnapshot['qualityStatus'] {
  switch (value?.toLowerCase()) {
    case 'pass':
      return 'PASS'
    case 'warn':
      return 'WARN'
    case 'fail':
      return 'FAIL'
    default:
      return 'UNKNOWN'
  }
}

function toIsoDate(compact: string): string {
  return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`
}
