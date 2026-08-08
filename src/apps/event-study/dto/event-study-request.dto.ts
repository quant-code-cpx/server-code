import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { EventType } from '../event-type.registry'

export class EventTypeRequestDto {
  @ApiProperty({ enum: EventType, description: '事件类型' })
  @IsEnum(EventType)
  eventType: EventType
}

export class EventCalendarRequestDto {
  @ApiPropertyOptional({ enum: EventType, description: '事件类型（单选）' })
  @IsOptional()
  @IsEnum(EventType)
  eventType?: EventType

  @ApiPropertyOptional({ enum: EventType, isArray: true, description: '事件类型（多选）' })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(Object.values(EventType).length)
  @IsEnum(EventType, { each: true })
  eventTypes?: EventType[]

  @ApiProperty({ description: '起始日期（YYYYMMDD）', example: '20240101' })
  @IsString()
  @Matches(/^\d{8}$/)
  startDate: string

  @ApiProperty({ description: '结束日期（YYYYMMDD）', example: '20240131' })
  @IsString()
  @Matches(/^\d{8}$/)
  endDate: string

  @ApiPropertyOptional({ description: '股票代码' })
  @IsOptional()
  @IsString()
  tsCode?: string
}

export class EventSignalRuleListRequestDto {
  @ApiPropertyOptional({ description: '页码', default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1

  @ApiPropertyOptional({ description: '每页条数', default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20
}

export class EventSignalRuleIdRequestDto {
  @ApiProperty({ description: '事件信号规则 ID' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  id: number
}

export class EventSignalRulePreviewRequestDto {
  @ApiPropertyOptional({ description: '已有规则 ID；传入后使用该规则配置' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  ruleId?: number

  @ApiPropertyOptional({ enum: EventType, description: '临时预览的事件类型' })
  @IsOptional()
  @IsEnum(EventType)
  eventType?: EventType

  @ApiPropertyOptional({ description: '临时预览的筛选条件 JSON' })
  @IsOptional()
  @IsObject()
  conditions?: Record<string, unknown>

  @ApiPropertyOptional({ description: '起始日期（YYYYMMDD）' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{8}$/)
  startDate?: string

  @ApiPropertyOptional({ description: '结束日期（YYYYMMDD）' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{8}$/)
  endDate?: string

  @ApiPropertyOptional({ description: '参与预览的事件条数', default: 200, minimum: 1, maximum: 500 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  pageSize?: number
}

export class EventSignalQueryRequestDto extends EventSignalRuleListRequestDto {
  @ApiPropertyOptional({ description: '股票代码筛选' })
  @IsOptional()
  @IsString()
  tsCode?: string
}
