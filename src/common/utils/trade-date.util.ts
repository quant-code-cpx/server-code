const COMPACT_DATE_RE = /^\d{8}$/
const MS_PER_DAY = 24 * 60 * 60 * 1000

export function assertCompactTradeDate(value: string, fieldName = 'tradeDate'): void {
  if (!COMPACT_DATE_RE.test(value)) {
    throw new Error(`${fieldName} 必须为 YYYYMMDD 格式`)
  }
}

export function parseCompactTradeDateToUtcDate(value: string, fieldName = 'tradeDate'): Date {
  assertCompactTradeDate(value, fieldName)
  const year = Number(value.slice(0, 4))
  const month = Number(value.slice(4, 6))
  const day = Number(value.slice(6, 8))
  const parsed = new Date(Date.UTC(year, month - 1, day))

  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error(`${fieldName} 不是有效日期`)
  }

  return parsed
}

export function formatDateToCompactTradeDate(date: Date | string | null | undefined): string | null {
  if (!date) return null
  const d = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(d.getTime())) return null
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`
}

function getShanghaiTodayUtcMidnight(reference = new Date()): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(reference)
  const year = Number(parts.find((p) => p.type === 'year')?.value)
  const month = Number(parts.find((p) => p.type === 'month')?.value)
  const day = Number(parts.find((p) => p.type === 'day')?.value)
  return new Date(Date.UTC(year, month - 1, day))
}

export function getShanghaiCompactTradeDate(reference = new Date()): string {
  const today = getShanghaiTodayUtcMidnight(reference)
  return formatDateToCompactTradeDate(today)!
}

export function diffCompactTradeDateFromShanghaiToday(
  value: string | null | undefined,
  reference = new Date(),
): number | null {
  if (!value) return null
  const target = parseCompactTradeDateToUtcDate(value)
  const today = getShanghaiTodayUtcMidnight(reference)
  return Math.floor((today.getTime() - target.getTime()) / MS_PER_DAY)
}

export function addUtcDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY)
}
