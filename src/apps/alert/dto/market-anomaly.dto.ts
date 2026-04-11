import { IsEnum, IsNumber, IsOptional, IsString, Matches, Min } from 'class-validator'
import { Transform, Type } from 'class-transformer'
import { MarketAnomalyType } from '@prisma/client'

export class MarketAnomalyQueryDto {
  @IsOptional()
  @Matches(/^\d{8}$/, { message: 'tradeDate 格式应为 YYYYMMDD' })
  tradeDate?: string

  @IsOptional()
  @IsEnum(MarketAnomalyType)
  type?: MarketAnomalyType

  @IsOptional()
  @IsString()
  tsCode?: string

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Transform(({ value }: { value: number }) => Math.min(value, 100))
  pageSize?: number = 20
}

export class MarketAnomalyDto {
  id: number
  tradeDate: string
  tsCode: string
  stockName: string | null
  anomalyType: MarketAnomalyType
  value: number
  threshold: number
  detail: unknown
  scannedAt: Date
}
