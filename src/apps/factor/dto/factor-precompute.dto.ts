import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator'

export class FactorPrecomputeTriggerDto {
  @ApiProperty({ description: '目标交易日 YYYYMMDD', example: '20260327' })
  @IsString()
  @Matches(/^\d{8}$/, { message: 'tradeDate 格式应为 YYYYMMDD，例如 20240101' })
  tradeDate: string

  @ApiPropertyOptional({
    description: '仅预计算指定因子（不传则计算全部启用因子）',
    type: [String],
    example: ['pe_ttm', 'roe'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  factorNames?: string[]
}

export class FactorBackfillDto {
  @ApiProperty({ description: '回补起始日期 YYYYMMDD', example: '20230101' })
  @IsString()
  @Matches(/^\d{8}$/, { message: 'startDate 格式应为 YYYYMMDD，例如 20240101' })
  startDate: string

  @ApiProperty({ description: '回补结束日期 YYYYMMDD', example: '20260327' })
  @IsString()
  @Matches(/^\d{8}$/, { message: 'endDate 格式应为 YYYYMMDD，例如 20240101' })
  endDate: string

  @ApiPropertyOptional({
    description: '仅回补指定因子（不传则回补全部启用因子）',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(100)
  factorNames?: string[]

  @ApiPropertyOptional({
    description: '跳过已存在快照数据的日期（默认 true）',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  skipExisting?: boolean
}
