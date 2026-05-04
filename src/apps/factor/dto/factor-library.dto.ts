import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Min,
} from 'class-validator'
import { FactorCategory, FactorSourceType } from '@prisma/client'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform, Type } from 'class-transformer'

export class FactorLibraryQueryDto {
  @ApiPropertyOptional({ enum: FactorCategory, description: '按分类筛选' })
  @IsOptional()
  @IsEnum(FactorCategory)
  category?: FactorCategory

  @ApiPropertyOptional({ default: true, description: '仅返回已启用的因子' })
  @IsOptional()
  @IsBoolean()
  enabledOnly?: boolean = true

  @ApiPropertyOptional({ enum: FactorSourceType, description: '数据来源类型筛选，如 BUILTIN / CUSTOM' })
  @IsOptional()
  @IsEnum(FactorSourceType)
  sourceType?: FactorSourceType

  @ApiPropertyOptional({ enum: ['HEALTHY', 'STALE', 'MISSING'], description: '因子快照健康状态筛选' })
  @IsOptional()
  @IsIn(['HEALTHY', 'STALE', 'MISSING'])
  status?: 'HEALTHY' | 'STALE' | 'MISSING'

  @ApiPropertyOptional({ description: '最低 IC 绝对值（0~1），用于过滤低质量因子' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  icMin?: number

  @ApiPropertyOptional({ description: '最低覆盖率（0~1）' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  coverageMin?: number

  @ApiPropertyOptional({
    description: '排序字段',
    enum: ['name', 'category', 'sortOrder', 'coverageRate', 'latestDate'],
  })
  @IsOptional()
  @IsIn(['name', 'category', 'sortOrder', 'coverageRate', 'latestDate'])
  sortBy?: string

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'asc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc'
}

export class FactorDetailQueryDto {
  @ApiProperty({ description: '因子名称标识，如 pe_ttm' })
  @IsString()
  @IsNotEmpty()
  factorName: string
}

export class FactorPrecomputeBatchDto {
  @ApiPropertyOptional({ type: [String], description: '要预计算的因子名称列表；不传则全量' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  factorNames?: string[]

  @ApiPropertyOptional({ description: '指定交易日 YYYYMMDD；不传取最新交易日' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{8}$/)
  tradeDate?: string
}

export class FactorAdminJobsQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Transform(({ value }: { value: number }) => Math.min(value, 100))
  pageSize?: number = 20
}

export class FactorAdminJobDetailDto {
  @ApiProperty({ description: '交易日 YYYYMMDD，作为批次唯一标识' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{8}$/)
  tradeDate: string
}
