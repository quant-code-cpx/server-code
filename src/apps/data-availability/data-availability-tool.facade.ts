import { Injectable } from '@nestjs/common'
import {
  DATA_AVAILABILITY_CATALOG,
  DATA_AVAILABILITY_DATASETS,
  type DataAvailabilityDataset,
} from './data-availability.catalog'
import { DataAvailabilityRepository } from './data-availability.repository'

export interface DataAvailabilityInput {
  datasets: string[]
  tsCode?: string
}

export class DataAvailabilityToolError extends Error {
  constructor(
    readonly code: 'INVALID_ARGUMENT' | 'UPSTREAM_FAILED',
    message: string,
    readonly retryable = false,
  ) {
    super(message)
    this.name = DataAvailabilityToolError.name
  }
}

@Injectable()
export class DataAvailabilityToolFacade {
  constructor(private readonly repository: DataAvailabilityRepository) {}

  async getAvailability(input: DataAvailabilityInput) {
    const datasets = normalizeDatasets(input.datasets)
    const tsCode = input.tsCode ? normalizeTsCode(input.tsCode) : undefined
    if (tsCode) {
      const unsupported = datasets.filter((dataset) => !DATA_AVAILABILITY_CATALOG[dataset].supportsSecurityScope)
      if (unsupported.length) {
        throw new DataAvailabilityToolError(
          'INVALID_ARGUMENT',
          `以下数据集不支持 SECURITY scope：${unsupported.join(', ')}`,
        )
      }
    }
    try {
      const [snapshots, recentOpenDates] = await Promise.all([
        mapLimit(datasets, 4, (dataset) => this.repository.load(dataset, tsCode)),
        this.repository.loadRecentOpenDates(),
      ])
      return {
        data: {
          scope: tsCode ? ('SECURITY' as const) : ('MARKET' as const),
          tsCode: tsCode ?? null,
          items: snapshots.map((snapshot) => {
            const catalog = DATA_AVAILABILITY_CATALOG[snapshot.dataset]
            const lagTradingDays = snapshot.dataThrough
              ? recentOpenDates.filter((date) => date > snapshot.dataThrough!).length
              : null
            const notes: string[] = []
            if (snapshot.qualityStatus === 'UNKNOWN') notes.push('尚无数据质量检查记录，水位线仍按真实库存返回')
            if (!tsCode) notes.push('市场 scope 不执行大表精确 COUNT，rowCount 固定为 null')
            const status = resolveStatus({
              hasData: snapshot.dataThrough !== null,
              syncStatus: snapshot.syncStatus,
              qualityStatus: snapshot.qualityStatus,
              lagTradingDays,
              allowedLagTradingDays: catalog.allowedLagTradingDays,
            })
            return {
              dataset: snapshot.dataset,
              scope: tsCode ? ('SECURITY' as const) : ('MARKET' as const),
              tsCode: tsCode ?? null,
              status,
              coverageStart: snapshot.coverageStart,
              dataThrough: snapshot.dataThrough,
              rowCount: snapshot.rowCount,
              lastSyncedAt: snapshot.lastSyncedAt,
              syncStatus: snapshot.syncStatus,
              qualityStatus: snapshot.qualityStatus,
              lagTradingDays,
              recommendedTool: catalog.recommendedTool,
              sourceTask: catalog.syncTask,
              sourceModels: [catalog.sourceModel],
              notes,
            }
          }),
        },
        warnings: [],
      }
    } catch (error) {
      if (error instanceof DataAvailabilityToolError) throw error
      throw new DataAvailabilityToolError('UPSTREAM_FAILED', '数据可用性查询暂时失败', true)
    }
  }
}

function normalizeDatasets(values: string[]): DataAvailabilityDataset[] {
  if (!Array.isArray(values) || values.length < 1 || values.length > 20) {
    throw new DataAvailabilityToolError('INVALID_ARGUMENT', 'datasets 必须包含 1-20 项')
  }
  const unique = new Set(values)
  if (unique.size !== values.length) throw new DataAvailabilityToolError('INVALID_ARGUMENT', 'datasets 不能重复')
  const unknown = values.filter((value) => !DATA_AVAILABILITY_DATASETS.includes(value as DataAvailabilityDataset))
  if (unknown.length) throw new DataAvailabilityToolError('INVALID_ARGUMENT', `未知数据集：${unknown.join(', ')}`)
  return values as DataAvailabilityDataset[]
}

function normalizeTsCode(value: string): string {
  const tsCode = value.trim().toUpperCase()
  if (!/^\d{6}\.(SH|SZ|BJ)$/.test(tsCode)) {
    throw new DataAvailabilityToolError('INVALID_ARGUMENT', 'tsCode 必须为 A 股代码，例如 600089.SH')
  }
  return tsCode
}

function resolveStatus(input: {
  hasData: boolean
  syncStatus: 'SUCCESS' | 'FAILED' | 'RUNNING' | 'UNKNOWN'
  qualityStatus: 'PASS' | 'WARN' | 'FAIL' | 'UNKNOWN'
  lagTradingDays: number | null
  allowedLagTradingDays: number
}): 'READY' | 'DEGRADED' | 'EMPTY' | 'FAILED' {
  if (!input.hasData) return 'EMPTY'
  if (input.syncStatus === 'FAILED' || input.qualityStatus === 'FAIL') return 'FAILED'
  if (
    input.qualityStatus === 'WARN' ||
    (input.lagTradingDays !== null && input.lagTradingDays > input.allowedLagTradingDays)
  ) {
    return 'DEGRADED'
  }
  return 'READY'
}

async function mapLimit<T, R>(items: readonly T[], limit: number, handler: (item: T) => Promise<R>): Promise<R[]> {
  const output = new Array<R>(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      output[index] = await handler(items[index])
    }
  })
  await Promise.all(workers)
  return output
}
