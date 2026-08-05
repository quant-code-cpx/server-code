export type DeepResearchToolErrorCode =
  | 'INVALID_ARGUMENT'
  | 'DATA_NOT_FOUND'
  | 'DATA_NOT_READY'
  | 'RESULT_TOO_LARGE'
  | 'UPSTREAM_FAILED'

export class StockDeepResearchToolError extends Error {
  constructor(
    readonly code: DeepResearchToolErrorCode,
    message: string,
    readonly retryable = false,
  ) {
    super(message)
    this.name = StockDeepResearchToolError.name
  }
}

export interface StockDeepResearchWarning {
  code: string
  message: string
  affectedFields?: string[]
}

export type SectionResult<T> =
  | { status: 'OK'; data: T; error: null }
  | { status: 'NOT_REQUESTED'; data: null; error: null }
  | { status: 'NOT_READY'; data: null; error: { code: string; message: string } }
  | { status: 'ERROR'; data: null; error: { code: string; message: string } }

export function ok<T>(data: T): SectionResult<T> {
  return { status: 'OK', data, error: null }
}

export function notRequested(): SectionResult<never> {
  return { status: 'NOT_REQUESTED', data: null, error: null }
}

export function notReady(message: string): SectionResult<never> {
  return { status: 'NOT_READY', data: null, error: { code: 'DATA_NOT_READY', message } }
}

export function normalizeTsCode(value: string): string {
  const tsCode = value?.trim().toUpperCase()
  if (!/^\d{6}\.(SH|SZ|BJ)$/.test(tsCode)) {
    throw new StockDeepResearchToolError('INVALID_ARGUMENT', 'tsCode 必须为 A 股代码，例如 600089.SH')
  }
  return tsCode
}

export function parseIsoDate(value: string | undefined, field = 'asOfDate'): Date | null {
  if (value === undefined) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new StockDeepResearchToolError('INVALID_ARGUMENT', `${field} 必须为 YYYY-MM-DD`)
  }
  const parsed = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime()) || toIsoDate(parsed) !== value) {
    throw new StockDeepResearchToolError('INVALID_ARGUMENT', `${field} 不是有效日期`)
  }
  return parsed
}

export function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10)
}

export function compactToIsoDate(value: string): string | null {
  if (!/^\d{8}$/.test(value)) return null
  const iso = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
  return parseIsoDate(iso, 'date') ? iso : null
}

export function isoToCompactDate(value: string): string {
  return value.replaceAll('-', '')
}

export function finiteOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

export function normalizeSections<T extends string>(
  values: readonly string[] | undefined,
  allowed: readonly T[],
  defaults: readonly T[],
): T[] {
  const sections = values?.length ? [...values] : [...defaults]
  if (sections.length < 1 || sections.length > allowed.length) {
    throw new StockDeepResearchToolError('INVALID_ARGUMENT', `sections 必须包含 1-${allowed.length} 项`)
  }
  if (new Set(sections).size !== sections.length || sections.some((section) => !allowed.includes(section as T))) {
    throw new StockDeepResearchToolError('INVALID_ARGUMENT', `sections 仅支持 ${allowed.join('、')} 且不能重复`)
  }
  return sections as T[]
}

export function requireInteger(value: number, field: string, minimum: number, maximum: number): void {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new StockDeepResearchToolError('INVALID_ARGUMENT', `${field} 必须是 ${minimum}-${maximum} 的整数`)
  }
}

export function sanitizeExternalText(value: string | null | undefined, maximum = 2_000): string | null {
  if (!value) return null
  return (
    value
      .replace(/[\u0000-\u001F\u007F]/g, ' ')
      .trim()
      .slice(0, maximum) || null
  )
}

export function normalizeUnexpectedError(error: unknown, message: string): StockDeepResearchToolError {
  if (error instanceof StockDeepResearchToolError) return error
  return new StockDeepResearchToolError('UPSTREAM_FAILED', message, true)
}

export async function assertStockExists(
  find: (tsCode: string) => Promise<{ tsCode: string } | null>,
  tsCode: string,
): Promise<void> {
  if (!(await find(tsCode))) throw new StockDeepResearchToolError('DATA_NOT_FOUND', `证券不存在：${tsCode}`)
}
