import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsEnum, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator'
import { EventType } from '../event-type.registry'

export class EventStudyEventsQueryDto {
  @ApiProperty({ enum: EventType, description: '事件类型' })
  @IsEnum(EventType)
  eventType: EventType

  @ApiPropertyOptional({ description: '股票代码' })
  @IsOptional()
  @IsString()
  tsCode?: string

  @ApiPropertyOptional({ description: '查询起始日期（YYYYMMDD）' })
  @IsOptional()
  @Matches(/^\d{8}$/)
  startDate?: string

  @ApiPropertyOptional({ description: '查询截止日期（YYYYMMDD）' })
  @IsOptional()
  @Matches(/^\d{8}$/)
  endDate?: string

  @ApiPropertyOptional({ description: '页码', default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number = 1

  @ApiPropertyOptional({ description: '每页条数', default: 50 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number = 50
}
