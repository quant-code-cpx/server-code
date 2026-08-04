export type SubscriptionMetricSource = 'STOCK' | 'FACTOR' | 'SIGNAL'
export type SubscriptionMetricAvailability = 'ENABLED' | 'DISABLED' | 'DATA_NOT_READY'

export interface SubscriptionMetricDefinition {
  id: string
  version: number
  source: SubscriptionMetricSource
  category: string
  label: string
  description: string
  valueType: 'NUMBER' | 'PERCENT' | 'ENUM' | 'BOOLEAN' | 'EVENT'
  unit?: string
  operators: string[]
  enumOptions?: Array<{ value: string; label: string }>
  /** STOCK 指标对应的现有选股筛选字段；由目录定义，前端不得自行猜测。 */
  filterKey?: string
  availability: SubscriptionMetricAvailability
  requiredDataSets: string[]
  semanticsVersion: string
}
