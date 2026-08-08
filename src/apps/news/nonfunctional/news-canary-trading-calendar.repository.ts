import { shanghaiCalendarDate, type NewsCanaryTradingCalendarWindow } from './news-canary-monitor'

const CALENDAR_WINDOW_DAYS = 90
const DAY_MS = 86_400_000

export interface NewsCanaryTradingCalendarDataSource {
  findSseCalendarEntries(input: { fromDate: Date; toDate: Date }): Promise<
    Array<{
      calendarDate: Date
      isOpen: string | null
    }>
  >
}

export async function loadSseNewsCanaryTradingCalendar(
  dataSource: NewsCanaryTradingCalendarDataSource,
  now: Date,
): Promise<NewsCanaryTradingCalendarWindow> {
  const referenceDate = new Date(`${shanghaiCalendarDate(now)}T00:00:00.000Z`)
  const rows = await dataSource.findSseCalendarEntries({
    fromDate: new Date(referenceDate.getTime() - CALENDAR_WINDOW_DAYS * DAY_MS),
    toDate: new Date(referenceDate.getTime() + CALENDAR_WINDOW_DAYS * DAY_MS),
  })
  return {
    exchange: 'SSE',
    entries: rows.map((row) => ({
      calendarDate: row.calendarDate.toISOString().slice(0, 10),
      isOpen: row.isOpen === '1',
    })),
  }
}
