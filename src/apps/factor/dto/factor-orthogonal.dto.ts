import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator'

// ── Factor orthogonalize ─────────────────────────────────────────────────────

export class FactorOrthogonalizeDto {
  @ApiProperty({ type: [String], description: '需要正交化的因子列表（2~20 个）' })
  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(2)
  @ArrayMaxSize(20)
  factorNames: string[]

  @ApiProperty({ description: '计算日期 YYYYMMDD', example: '20260327' })
  @IsString()
  @Matches(/^\d{8}$/, { message: 'tradeDate 格式应为 YYYYMMDD，例如 20240101' })
  tradeDate: string

  @ApiPropertyOptional({ description: '股票池 indexCode' })
  @IsOptional()
  @IsString()
  universe?: string

  @ApiPropertyOptional({
    description: '正交化方法',
    enum: ['regression', 'symmetric'],
    default: 'regression',
  })
  @IsOptional()
  @IsIn(['regression', 'symmetric'])
  method?: 'regression' | 'symmetric'
}

// ── Fama-MacBeth ──────────────────────────────────────────────────────────────

export class FamaMacBethDto {
  @ApiProperty({ type: [String], description: '待检验的因子列表（1~20 个）' })
  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  factorNames: string[]

  @ApiProperty({ description: '起始日期 YYYYMMDD' })
  @IsString()
  @Matches(/^\d{8}$/, { message: 'startDate 格式应为 YYYYMMDD，例如 20240101' })
  startDate: string

  @ApiProperty({ description: '结束日期 YYYYMMDD' })
  @IsString()
  @Matches(/^\d{8}$/, { message: 'endDate 格式应为 YYYYMMDD，例如 20240101' })
  endDate: string

  @ApiPropertyOptional({ description: '股票池 indexCode' })
  @IsOptional()
  @IsString()
  universe?: string

  @ApiPropertyOptional({ description: '未来收益窗口（交易日，默认 5）', default: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  @Type(() => Number)
  forwardDays?: number
}
