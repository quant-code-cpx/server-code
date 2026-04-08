import {
  IsArray,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator'
import { ApiProperty } from '@nestjs/swagger'
import { Type } from 'class-transformer'

export class FactorCondition {
  @ApiProperty({ description: '因子名称' })
  @IsString()
  factorName: string

  @ApiProperty({
    description: '比较方式',
    enum: ['gt', 'gte', 'lt', 'lte', 'between', 'top_pct', 'bottom_pct'],
  })
  @IsEnum(['gt', 'gte', 'lt', 'lte', 'between', 'top_pct', 'bottom_pct'])
  operator: 'gt' | 'gte' | 'lt' | 'lte' | 'between' | 'top_pct' | 'bottom_pct'

  @ApiProperty({ required: false, description: '阈值（gt/gte/lt/lte 使用）' })
  @IsOptional()
  @IsNumber()
  value?: number

  @ApiProperty({ required: false, description: '范围下界（between 使用）' })
  @IsOptional()
  @IsNumber()
  min?: number

  @ApiProperty({ required: false, description: '范围上界（between 使用）' })
  @IsOptional()
  @IsNumber()
  max?: number

  @ApiProperty({ required: false, description: '百分位（top_pct/bottom_pct 使用，0~100）' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  percent?: number
}

export class FactorScreeningDto {
  @ApiProperty({ type: [FactorCondition], description: '筛选条件列表' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FactorCondition)
  conditions: FactorCondition[]

  @ApiProperty({ description: '选股日期 YYYYMMDD' })
  @IsString()
  @Matches(/^\d{8}$/, { message: 'tradeDate 格式应为 YYYYMMDD，例如 20240101' })
  tradeDate: string

  @ApiProperty({ required: false, description: '股票池，如 000300.SH' })
  @IsOptional()
  @IsString()
  universe?: string

  @ApiProperty({ required: false, description: '按哪个因子排序' })
  @IsOptional()
  @IsString()
  sortBy?: string

  @ApiProperty({ required: false, enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsEnum(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc'

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
  @Max(200)
  @Type(() => Number)
  pageSize?: number = 50
}
