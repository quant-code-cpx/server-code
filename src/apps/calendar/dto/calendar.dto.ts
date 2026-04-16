import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsArray, IsOptional, IsString, Matches, IsInt, Min, Max } from 'class-validator'
import { Type } from 'class-transformer'

export class QueryCalendarDto {
  @ApiProperty({ description: '开始日期，格式 YYYYMMDD', example: '20240101' })
  @IsString()
  @Matches(/^\d{8}$/, { message: 'startDate 格式应为 YYYYMMDD，例如 20240101' })
  startDate: string

  @ApiProperty({ description: '结束日期，格式 YYYYMMDD', example: '20240131' })
  @IsString()
  @Matches(/^\d{8}$/, { message: 'endDate 格式应为 YYYYMMDD，例如 20240131' })
  endDate: string

  @ApiPropertyOptional({
    description: '事件类型过滤，可选值: DIVIDEND, SHARE_FLOAT, DISCLOSURE',
    example: ['DIVIDEND'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  types?: string[]

  @ApiPropertyOptional({ description: '股票代码过滤', example: ['000001.SZ'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tsCodes?: string[]
}

export class QueryUpcomingDto {
  @ApiPropertyOptional({ description: '未来天数，默认 30', example: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  days?: number
}
