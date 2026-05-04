import { ApiPropertyOptional } from '@nestjs/swagger'
import { Transform, Type } from 'class-transformer'
import { IsIn, IsInt, IsNumber, IsOptional, IsString, Matches, Max, Min } from 'class-validator'

export class AlertLimitListDto {
  @ApiPropertyOptional({ description: '交易日 YYYYMMDD；不传取最新' })
  @IsOptional()
  @Matches(/^\d{8}$/)
  tradeDate?: string

  @ApiPropertyOptional({ enum: ['UP', 'DOWN'], description: '涨停/跌停方向' })
  @IsOptional()
  @IsIn(['UP', 'DOWN'])
  limitType?: 'UP' | 'DOWN'

  @ApiPropertyOptional({ description: '行业筛选' })
  @IsOptional()
  @IsString()
  industry?: string

  @ApiPropertyOptional({ description: '股票代码/名称关键词' })
  @IsOptional()
  @IsString()
  keyword?: string

  @ApiPropertyOptional({ description: '最小连板/连跌停天数' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  minStreak?: number

  @ApiPropertyOptional({ enum: ['sealRatio', 'streakDays', 'amount', 'pctChg'], default: 'sealRatio' })
  @IsOptional()
  @IsIn(['sealRatio', 'streakDays', 'amount', 'pctChg'])
  sortBy?: 'sealRatio' | 'streakDays' | 'amount' | 'pctChg' = 'sealRatio'

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc'

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  @Transform(({ value }: { value: number }) => Math.min(value, 200))
  pageSize?: number = 50
}

export class AlertLimitSummaryDto {
  @ApiPropertyOptional({ description: '交易日 YYYYMMDD；不传取最新' })
  @IsOptional()
  @Matches(/^\d{8}$/)
  tradeDate?: string
}

export class AlertLimitNextDayPerfDto {
  @ApiPropertyOptional({ description: '交易日 YYYYMMDD；不传取最新' })
  @IsOptional()
  @Matches(/^\d{8}$/)
  tradeDate?: string

  @ApiPropertyOptional({ enum: ['UP', 'DOWN'], description: '涨停/跌停方向' })
  @IsOptional()
  @IsIn(['UP', 'DOWN'])
  limitType?: 'UP' | 'DOWN'

  @ApiPropertyOptional({ description: '最小连板/连跌停天数' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  minStreak?: number
}
