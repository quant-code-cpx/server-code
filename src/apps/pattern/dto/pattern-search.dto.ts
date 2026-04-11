import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator'

export enum PatternAlgorithm {
  /** 归一化欧氏距离（快速） */
  NED = 'NED',
  /** 动态时间弯曲（精确） */
  DTW = 'DTW',
}

export enum PatternScope {
  /** 全市场上市 A 股 */
  ALL = 'ALL',
  /** 指定指数成分股 */
  INDEX = 'INDEX',
}

export class PatternSearchDto {
  @ApiProperty({ description: '查询形态所属股票代码', example: '000001.SZ' })
  @IsString()
  tsCode: string

  @ApiProperty({ description: '形态起始日期（YYYYMMDD）', example: '20260301' })
  @Matches(/^\d{8}$/)
  startDate: string

  @ApiProperty({ description: '形态截止日期（YYYYMMDD）', example: '20260401' })
  @Matches(/^\d{8}$/)
  endDate: string

  @ApiPropertyOptional({
    description: '相似度算法，NED=归一化欧氏距离（快），DTW=动态时间弯曲（精确）',
    enum: PatternAlgorithm,
    default: PatternAlgorithm.NED,
  })
  @IsOptional()
  @IsEnum(PatternAlgorithm)
  algorithm?: PatternAlgorithm = PatternAlgorithm.NED

  @ApiPropertyOptional({ description: '返回结果数量', default: 20 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  topK?: number = 20

  @ApiPropertyOptional({ description: '搜索范围', enum: PatternScope, default: PatternScope.ALL })
  @IsOptional()
  @IsEnum(PatternScope)
  scope?: PatternScope = PatternScope.ALL

  @ApiPropertyOptional({ description: '指数代码（scope=INDEX 时生效）', example: '000300.SH' })
  @IsOptional()
  @IsString()
  indexCode?: string

  @ApiPropertyOptional({ description: '候选序列历史回溯年数', default: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  lookbackYears?: number = 5

  @ApiPropertyOptional({ description: '是否排除查询股票本身', default: true })
  @IsOptional()
  @IsBoolean()
  excludeSelf?: boolean = true
}

export class PatternSearchBySeriesDto {
  @ApiProperty({ description: '自定义价格序列（至少 5 个数值）', type: [Number], example: [10, 12, 15, 13, 16] })
  @IsArray()
  @ArrayMinSize(5)
  @IsNumber({}, { each: true })
  series: number[]

  @ApiPropertyOptional({ enum: PatternAlgorithm, default: PatternAlgorithm.NED })
  @IsOptional()
  @IsEnum(PatternAlgorithm)
  algorithm?: PatternAlgorithm = PatternAlgorithm.NED

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  topK?: number = 20

  @ApiPropertyOptional({ enum: PatternScope, default: PatternScope.ALL })
  @IsOptional()
  @IsEnum(PatternScope)
  scope?: PatternScope = PatternScope.ALL

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  indexCode?: string

  @ApiPropertyOptional({ default: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  lookbackYears?: number = 5
}
