import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator'

export class ExportBacktestTradesDto {
  @ApiProperty({ description: '回测运行 ID' })
  @IsString()
  @IsNotEmpty()
  runId: string
}

export class ExportFactorValuesDto {
  @ApiProperty({ description: '因子名称' })
  @IsString()
  @IsNotEmpty()
  factorId: string

  @ApiPropertyOptional({ description: '开始日期，格式 YYYYMMDD' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{8}$/, { message: 'startDate 格式应为 YYYYMMDD，例如 20240101' })
  startDate?: string

  @ApiPropertyOptional({ description: '结束日期，格式 YYYYMMDD' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{8}$/, { message: 'endDate 格式应为 YYYYMMDD，例如 20240101' })
  endDate?: string
}

export class ExportPortfolioHoldingsDto {
  @ApiProperty({ description: '投资组合 ID' })
  @IsString()
  @IsNotEmpty()
  portfolioId: string
}
