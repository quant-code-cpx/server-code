import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsEnum, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator'
import { EventType } from '../event-type.registry'

export class EventStudyAnalyzeDto {
  @ApiProperty({ enum: EventType, description: '事件类型' })
  @IsEnum(EventType)
  eventType: EventType

  @ApiPropertyOptional({ description: '仅分析指定股票（留空则分析全部事件样本）', example: '000001.SZ' })
  @IsOptional()
  @IsString()
  tsCode?: string

  @ApiPropertyOptional({ description: '事件日期范围起始（YYYYMMDD）', example: '20240101' })
  @IsOptional()
  @Matches(/^\d{8}$/)
  startDate?: string

  @ApiPropertyOptional({ description: '事件日期范围截止（YYYYMMDD）', example: '20260401' })
  @IsOptional()
  @Matches(/^\d{8}$/)
  endDate?: string

  @ApiPropertyOptional({ description: '事件前窗口天数（交易日）', default: 5 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(60)
  preDays?: number = 5

  @ApiPropertyOptional({ description: '事件后窗口天数（交易日）', default: 20 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(120)
  postDays?: number = 20

  @ApiPropertyOptional({
    description: '基准指数代码',
    default: '000300.SH',
    example: '000300.SH',
  })
  @IsOptional()
  @IsString()
  benchmarkCode?: string = '000300.SH'
}
