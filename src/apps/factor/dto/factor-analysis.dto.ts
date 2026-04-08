import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator'
import { ApiProperty } from '@nestjs/swagger'
import { Type } from 'class-transformer'

export class FactorIcAnalysisDto {
  @ApiProperty({ description: '因子名称' })
  @IsString()
  factorName: string

  @ApiProperty({ description: '分析起始日期 YYYYMMDD' })
  @IsString()
  @Matches(/^\d{8}$/, { message: 'startDate 格式应为 YYYYMMDD，例如 20240101' })
  startDate: string

  @ApiProperty({ description: '分析结束日期 YYYYMMDD' })
  @IsString()
  @Matches(/^\d{8}$/, { message: 'endDate 格式应为 YYYYMMDD，例如 20240101' })
  endDate: string

  @ApiProperty({ required: false, description: '股票池，如 000300.SH（沪深300）' })
  @IsOptional()
  @IsString()
  universe?: string

  @ApiProperty({ required: false, default: 5, description: '未来N日收益率（默认5日）' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60)
  @Type(() => Number)
  forwardDays?: number = 5

  @ApiProperty({ required: false, enum: ['rank', 'normal'], default: 'rank', description: 'Rank IC (Spearman) 或 Normal IC (Pearson)' })
  @IsOptional()
  @IsEnum(['rank', 'normal'])
  icMethod?: 'rank' | 'normal' = 'rank'
}

export class FactorQuantileAnalysisDto {
  @ApiProperty({ description: '因子名称' })
  @IsString()
  factorName: string

  @ApiProperty({ description: '分析起始日期 YYYYMMDD' })
  @IsString()
  @Matches(/^\d{8}$/, { message: 'startDate 格式应为 YYYYMMDD，例如 20240101' })
  startDate: string

  @ApiProperty({ description: '分析结束日期 YYYYMMDD' })
  @IsString()
  @Matches(/^\d{8}$/, { message: 'endDate 格式应为 YYYYMMDD，例如 20240101' })
  endDate: string

  @ApiProperty({ required: false, description: '股票池' })
  @IsOptional()
  @IsString()
  universe?: string

  @ApiProperty({ required: false, default: 5, description: '分几组（默认5组）' })
  @IsOptional()
  @IsInt()
  @Min(3)
  @Max(10)
  @Type(() => Number)
  quantiles?: number = 5

  @ApiProperty({ required: false, default: 5, description: '调仓周期（交易日）' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  @Type(() => Number)
  rebalanceDays?: number = 5
}

export class FactorDecayAnalysisDto {
  @ApiProperty({ description: '因子名称' })
  @IsString()
  factorName: string

  @ApiProperty({ description: '分析起始日期 YYYYMMDD' })
  @IsString()
  @Matches(/^\d{8}$/, { message: 'startDate 格式应为 YYYYMMDD，例如 20240101' })
  startDate: string

  @ApiProperty({ description: '分析结束日期 YYYYMMDD' })
  @IsString()
  @Matches(/^\d{8}$/, { message: 'endDate 格式应为 YYYYMMDD，例如 20240101' })
  endDate: string

  @ApiProperty({ required: false, description: '股票池' })
  @IsOptional()
  @IsString()
  universe?: string

  @ApiProperty({ required: false, description: '持有期列表（交易日）', default: [1, 3, 5, 10, 20] })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Type(() => Number)
  periods?: number[] = [1, 3, 5, 10, 20]
}

export class FactorDistributionDto {
  @ApiProperty({ description: '因子名称' })
  @IsString()
  factorName: string

  @ApiProperty({ description: '交易日 YYYYMMDD' })
  @IsString()
  @Matches(/^\d{8}$/, { message: 'tradeDate 格式应为 YYYYMMDD，例如 20240101' })
  tradeDate: string

  @ApiProperty({ required: false, description: '股票池' })
  @IsOptional()
  @IsString()
  universe?: string

  @ApiProperty({ required: false, default: 50, description: '直方图的柱数' })
  @IsOptional()
  @IsInt()
  @Min(10)
  @Max(100)
  @Type(() => Number)
  bins?: number = 50
}

export class FactorCorrelationDto {
  @ApiProperty({ description: '因子名称列表（2~20个）', type: [String] })
  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(2)
  @ArrayMaxSize(20)
  factorNames: string[]

  @ApiProperty({ description: '计算日期 YYYYMMDD' })
  @IsString()
  @Matches(/^\d{8}$/, { message: 'tradeDate 格式应为 YYYYMMDD，例如 20240101' })
  tradeDate: string

  @ApiProperty({ required: false, description: '股票池' })
  @IsOptional()
  @IsString()
  universe?: string

  @ApiProperty({ required: false, enum: ['spearman', 'pearson'], default: 'spearman' })
  @IsOptional()
  @IsEnum(['spearman', 'pearson'])
  method?: 'spearman' | 'pearson' = 'spearman'
}
