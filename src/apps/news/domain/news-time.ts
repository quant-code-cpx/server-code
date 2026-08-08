import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
import customParseFormat from 'dayjs/plugin/customParseFormat'
import { NewsHttpException } from '../news.errors'
import type { NewsPublishedPrecisionValue } from './news.types'

dayjs.extend(utc)
dayjs.extend(timezone)
dayjs.extend(customParseFormat)

const SHANGHAI_TZ = 'Asia/Shanghai'
const MAX_WINDOW_MS = 90 * 24 * 60 * 60 * 1_000

export interface EffectiveNewsWindow {
  after: Date
  before: Date
}

export function resolveNewsWindow(
  after: string | undefined,
  before: string | undefined,
  now: Date,
): EffectiveNewsWindow {
  if ((after && !before) || (!after && before)) throw NewsHttpException.fromKey('NEWS_DATE_RANGE_INVALID')
  if (!after && !before) {
    const start = dayjs(now).tz(SHANGHAI_TZ).startOf('day').subtract(6, 'day').toDate()
    return { after: start, before: new Date(now) }
  }
  const parsedAfter = parseRequestTimestamp(after!)
  const parsedBefore = parseRequestTimestamp(before!)
  if (parsedAfter >= parsedBefore) throw NewsHttpException.fromKey('NEWS_DATE_RANGE_INVALID')
  if (parsedBefore.getTime() - parsedAfter.getTime() > MAX_WINDOW_MS) {
    throw NewsHttpException.fromKey('NEWS_DATE_RANGE_TOO_LARGE')
  }
  return { after: parsedAfter, before: parsedBefore }
}

export function parseRequestTimestamp(value: string): Date {
  if (!/(Z|[+-]\d{2}:\d{2})$/i.test(value)) throw NewsHttpException.fromKey('NEWS_DATE_RANGE_INVALID')
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) throw NewsHttpException.fromKey('NEWS_DATE_RANGE_INVALID')
  return parsed
}

export function assertPublishedTimeInvariant(input: {
  precision: NewsPublishedPrecisionValue
  publishedAt: Date | null
  publishedDate: string | null
}): void {
  const { precision, publishedAt, publishedDate } = input
  if (precision === 'SECOND' && (!publishedAt || publishedDate)) throw new Error('NEWS_PUBLISHED_TIME_INVALID')
  if (
    precision === 'MINUTE' &&
    (!publishedAt || publishedDate || publishedAt.getUTCSeconds() !== 0 || publishedAt.getUTCMilliseconds() !== 0)
  ) {
    throw new Error('NEWS_PUBLISHED_TIME_INVALID')
  }
  if (precision === 'DATE' && (publishedAt || !isIsoDate(publishedDate))) throw new Error('NEWS_PUBLISHED_TIME_INVALID')
  if (precision === 'UNKNOWN' && (publishedAt || publishedDate)) throw new Error('NEWS_PUBLISHED_TIME_INVALID')
}

export function timelineSortAt(input: {
  precision: NewsPublishedPrecisionValue
  publishedAt: Date | null
  publishedDate: string | null
  firstSeenAt: Date
}): Date {
  if (input.precision === 'SECOND' || input.precision === 'MINUTE') return new Date(input.publishedAt!)
  if (input.precision === 'DATE') return dayjs.tz(input.publishedDate!, SHANGHAI_TZ).startOf('day').toDate()
  return new Date(input.firstSeenAt)
}

export function prismaDate(value: string | null): Date | null {
  if (!value) return null
  if (!isIsoDate(value)) throw new Error('NEWS_PUBLISHED_DATE_INVALID')
  return new Date(`${value}T00:00:00.000Z`)
}

export function formatPrismaDate(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null
}

export function shanghaiCompactDate(value: Date): string {
  return dayjs(value).tz(SHANGHAI_TZ).format('YYYYMMDD')
}

export function shanghaiIsoDate(value: Date): string {
  return dayjs(value).tz(SHANGHAI_TZ).format('YYYY-MM-DD')
}

export function isIsoDate(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  return dayjs(value, 'YYYY-MM-DD', true).isValid()
}
