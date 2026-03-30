import { IsEnum, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator'
import { ApiProperty } from '@nestjs/swagger'
import { Type } from 'class-transformer'

export class FactorValuesQueryDto {
  @ApiProperty({ description: '因子名称，如 pe_ttm' })
  @IsString()
  factorName: string

  @ApiProperty({ description: '交易日 YYYYMMDD' })
  @IsString()
  @Matches(/^\d{8}$/, { message: 'tradeDate must be in YYYYMMDD format' })
  tradeDate: string

  @ApiProperty({ required: false, description: '股票池，如 000300.SH（沪深300），不传则全市场' })
  @IsOptional()
  @IsString()
  universe?: string

  @ApiProperty({ required: false, default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  page?: number = 1

  @ApiProperty({ required: false, default: 50 })
  @IsOptional()
  @IsInt()
  @Min(10)
  @Max(500)
  @Type(() => Number)
  pageSize?: number = 50

  @ApiProperty({ required: false, enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsEnum(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc'
}
