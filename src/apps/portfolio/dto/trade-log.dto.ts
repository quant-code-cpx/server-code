import { IsString, IsOptional, IsInt, Min, Matches } from 'class-validator'
import { Type } from 'class-transformer'

export class TradeLogQueryDto {
  @IsString()
  portfolioId: string

  @IsOptional()
  @Matches(/^\d{8}$/, { message: 'startDate 格式应为 YYYYMMDD' })
  startDate?: string

  @IsOptional()
  @Matches(/^\d{8}$/, { message: 'endDate 格式应为 YYYYMMDD' })
  endDate?: string

  @IsOptional()
  @IsString()
  tsCode?: string

  @IsOptional()
  @IsString()
  action?: string

  @IsOptional()
  @IsString()
  reason?: string

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number = 20
}

export class TradeLogSummaryDto {
  @IsString()
  portfolioId: string

  @IsOptional()
  @Matches(/^\d{8}$/, { message: 'startDate 格式应为 YYYYMMDD' })
  startDate?: string

  @IsOptional()
  @Matches(/^\d{8}$/, { message: 'endDate 格式应为 YYYYMMDD' })
  endDate?: string
}
