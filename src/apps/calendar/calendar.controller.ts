import { Controller, Post, Body, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { JwtAuthGuard } from 'src/lifecycle/guard/jwt-auth.guard'
import { ApiSuccessRawResponse } from 'src/common/decorators/api-success-response.decorator'
import { CalendarService } from './calendar.service'
import { QueryCalendarDto, QueryUpcomingDto } from './dto/calendar.dto'

@ApiTags('calendar')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('calendar')
export class CalendarController {
  constructor(private readonly calendarService: CalendarService) {}

  @Post('range')
  @ApiOperation({ summary: '按日期范围查询事件日历' })
  @ApiSuccessRawResponse({ type: 'object' })
  async getEventsByRange(@Body() dto: QueryCalendarDto) {
    return this.calendarService.getEventsByDateRange(dto.startDate, dto.endDate, dto.types, dto.tsCodes)
  }

  @Post('upcoming')
  @ApiOperation({ summary: '查询即将到来的事件' })
  @ApiSuccessRawResponse({ type: 'object' })
  async getUpcomingEvents(@Body() dto: QueryUpcomingDto) {
    return this.calendarService.getUpcomingEvents(dto.days ?? 30)
  }
}
