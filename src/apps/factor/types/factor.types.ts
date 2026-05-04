import { FactorCategory, FactorSourceType } from '@prisma/client'

export interface FactorItem {
  id: string
  name: string
  label: string
  description: string | null
  category: FactorCategory
  sourceType: FactorSourceType
  isBuiltin: boolean
  isEnabled: boolean
  sortOrder: number
  // Enriched status (optional — present when loaded with snapshot data)
  latestDate?: string | null
  coverageRate?: number | null
  staleDays?: number | null
  status?: 'HEALTHY' | 'STALE' | 'MISSING'
}

export interface FactorCategoryGroup {
  category: FactorCategory
  label: string
  factors: FactorItem[]
}

export interface FactorStats {
  latestDate?: string
  coverage?: number
  mean?: number
  median?: number
  stdDev?: number
}

export interface FactorValueItem {
  tsCode: string
  name: string | null
  industry: string | null
  value: number | null
  percentile: number | null
}

export interface FactorValueSummary {
  count: number
  missing: number
  mean: number | null
  median: number | null
  stdDev: number | null
  min: number | null
  max: number | null
  q25: number | null
  q75: number | null
}

/** DB field mapping for FIELD_REF factors */
export interface FactorFieldMapping {
  table: 'daily_basic' | 'fina_indicator' | 'moneyflow'
  column: string
  /** Whether to use point-in-time logic (ann_date <= tradeDate) */
  pointInTime?: boolean
}
