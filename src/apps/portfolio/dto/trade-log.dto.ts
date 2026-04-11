import { IsString, IsOptional, IsInt, Min, IsDateString } from 'class-validator'
import { Type } from 'class-transformer'

export class TradeLogQueryDto {
  @IsString()
  portfolioId: string

  @IsOptional()
  @IsDateString()
  startDate?: string

  @IsOptional()
  @IsDateString()
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
  @IsDateString()
  startDate?: string

  @IsOptional()
  @IsDateString()
  endDate?: string
}
