export type MarketMultiAssetToolErrorCode =
  | 'INVALID_ARGUMENT'
  | 'DATA_NOT_FOUND'
  | 'DATA_NOT_READY'
  | 'RESULT_TOO_LARGE'
  | 'UPSTREAM_FAILED'

export class MarketMultiAssetToolError extends Error {
  constructor(
    readonly code: MarketMultiAssetToolErrorCode,
    message: string,
    readonly retryable = false,
  ) {
    super(message)
    this.name = MarketMultiAssetToolError.name
  }
}

export interface MarketMultiAssetWarning {
  code: string
  message: string
  affectedFields?: string[]
}

export type ResearchSectionResult<T> =
  | { status: 'OK'; data: T; error: null }
  | { status: 'NOT_REQUESTED'; data: null; error: null }
  | { status: 'NOT_READY'; data: null; error: { code: string; message: string } }
  | { status: 'ERROR'; data: null; error: { code: string; message: string } }

export function sectionOk<T>(data: T): ResearchSectionResult<T> {
  return { status: 'OK', data, error: null }
}

export function sectionNotRequested(): ResearchSectionResult<never> {
  return { status: 'NOT_REQUESTED', data: null, error: null }
}

export function sectionNotReady(message: string): ResearchSectionResult<never> {
  return { status: 'NOT_READY', data: null, error: { code: 'DATA_NOT_READY', message } }
}

export function sectionError(message: string): ResearchSectionResult<never> {
  return { status: 'ERROR', data: null, error: { code: 'UPSTREAM_FAILED', message } }
}

export function parseIsoDate(value: string | undefined, field: string): Date | null {
  if (value === undefined) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new MarketMultiAssetToolError('INVALID_ARGUMENT', `${field} 必须为 YYYY-MM-DD`)
  }
  const parsed = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime()) || toIsoDate(parsed) !== value) {
    throw new MarketMultiAssetToolError('INVALID_ARGUMENT', `${field} 不是有效日期`)
  }
  return parsed
}

export function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10)
}

export function isoToCompactDate(value: string): string {
  return value.replaceAll('-', '')
}

export function compactToIsoDate(value: string): string {
  if (!/^\d{8}$/.test(value)) {
    throw new MarketMultiAssetToolError('UPSTREAM_FAILED', `数据库日期格式异常：${value}`)
  }
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
}

export function finiteOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function requireInteger(value: number, field: string, minimum: number, maximum: number): void {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new MarketMultiAssetToolError('INVALID_ARGUMENT', `${field} 必须是 ${minimum}-${maximum} 的整数`)
  }
}

export function normalizeSections<T extends string>(
  values: readonly string[] | undefined,
  allowed: readonly T[],
  defaults: readonly T[],
): T[] {
  const sections = values?.length ? [...values] : [...defaults]
  if (sections.length < 1 || sections.length > allowed.length) {
    throw new MarketMultiAssetToolError('INVALID_ARGUMENT', `sections 必须包含 1-${allowed.length} 项`)
  }
  if (new Set(sections).size !== sections.length || sections.some((value) => !allowed.includes(value as T))) {
    throw new MarketMultiAssetToolError('INVALID_ARGUMENT', `sections 仅支持 ${allowed.join('、')} 且不能重复`)
  }
  return sections as T[]
}

export function validateDateRange(
  startDate: Date,
  endDate: Date,
  maximumDays: number,
  startField = 'startDate',
  endField = 'endDate',
): void {
  if (startDate.getTime() > endDate.getTime()) {
    throw new MarketMultiAssetToolError('INVALID_ARGUMENT', `${startField} 不能晚于 ${endField}`)
  }
  const days = Math.floor((endDate.getTime() - startDate.getTime()) / 86_400_000)
  if (days > maximumDays) {
    throw new MarketMultiAssetToolError('INVALID_ARGUMENT', `${startField} 到 ${endField} 最多 ${maximumDays} 天`)
  }
}

export function normalizeUnexpectedError(error: unknown, message: string): MarketMultiAssetToolError {
  if (error instanceof MarketMultiAssetToolError) return error
  return new MarketMultiAssetToolError('UPSTREAM_FAILED', message, true)
}
