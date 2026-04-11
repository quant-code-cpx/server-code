import { CalendarEventType } from './calendar-query.dto'

export class CalendarEventDto {
  date: string
  tsCode: string
  stockName: string | null
  type: CalendarEventType
  title: string
  detail: Record<string, unknown>
}

export class CalendarResultDto {
  startDate: string
  endDate: string
  totalCount: number
  events: CalendarEventDto[]
}
