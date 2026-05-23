import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { CalendarEventType } from './calendar-query.dto'

export class CalendarEventDto {
  date: string
  tsCode: string
  stockName: string | null
  type: CalendarEventType
  title: string
  detail: Record<string, unknown>
  impactScore: number | null
  impactLevel: 'HIGH' | 'MEDIUM' | 'LOW' | null
  isInWatchlist: boolean | null
}

export class CalendarResultDto {
  startDate: string
  endDate: string
  totalCount: number
  events: CalendarEventDto[]
}

export class CalendarHistoryTrendSampleDto {
  @ApiProperty({ description: '事件日期（YYYYMMDD）', example: '20260520' })
  eventDate: string

  @ApiProperty({ description: '事件标题', example: '中国交建 分红除息' })
  eventTitle: string

  @ApiProperty({
    description: '各时间窗口累计超额收益（d1=1日, d5=5日, d10=10日）',
    example: { d1: 0.0012, d5: 0.0035, d10: 0.0078 },
  })
  returns: Record<string, number | null>
}

export class CalendarHistoryTrendDto {
  @ApiProperty({ type: [CalendarHistoryTrendSampleDto] })
  samples: CalendarHistoryTrendSampleDto[]

  @ApiProperty({
    description: '各窗口平均累计超额收益',
    example: { d1: 0.001, d5: 0.003, d10: 0.006 },
  })
  average: Record<string, number | null>
}
