import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator'

export class CreateResearchNoteDto {
  @ApiPropertyOptional({ description: '关联股票代码（可选）', example: '600519.SH' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{6}\.(SH|SZ|BJ)$/)
  tsCode?: string

  @ApiProperty({ description: '标题', maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  title: string

  @ApiProperty({ description: 'Markdown 内容', maxLength: 10000 })
  @IsString()
  @MinLength(1)
  @MaxLength(10000)
  content: string

  @ApiPropertyOptional({ type: [String], maxItems: 10 })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(30, { each: true })
  @ArrayMaxSize(10)
  tags?: string[]

  @ApiPropertyOptional({ description: '置顶' })
  @IsOptional()
  @IsBoolean()
  isPinned?: boolean
}

export class UpdateResearchNoteDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/^\d{6}\.(SH|SZ|BJ)$/)
  tsCode?: string

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  title?: string

  @ApiPropertyOptional({ maxLength: 10000 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(10000)
  content?: string

  @ApiPropertyOptional({ type: [String], maxItems: 10 })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(30, { each: true })
  @ArrayMaxSize(10)
  tags?: string[]

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isPinned?: boolean
}

export class ResearchNoteQueryDto {
  @ApiPropertyOptional({ description: '按股票代码筛选' })
  @IsOptional()
  @IsString()
  tsCode?: string

  @ApiPropertyOptional({ type: [String], description: '按标签筛选（AND 语义）' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[]

  @ApiPropertyOptional({ description: '标题/内容关键词模糊搜索' })
  @IsOptional()
  @IsString()
  keyword?: string

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number = 1

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  pageSize?: number = 20

  @ApiPropertyOptional({ enum: ['createdAt', 'updatedAt'], default: 'updatedAt' })
  @IsOptional()
  @IsIn(['createdAt', 'updatedAt'])
  sortBy?: string = 'updatedAt'

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: string = 'desc'

  @ApiPropertyOptional({ description: '只看置顶笔记' })
  @IsOptional()
  @IsBoolean()
  pinnedOnly?: boolean

  @ApiPropertyOptional({ description: '只看关联了股票的笔记' })
  @IsOptional()
  @IsBoolean()
  hasStock?: boolean

  @ApiPropertyOptional({ description: '包含已软删的笔记（管理用）' })
  @IsOptional()
  @IsBoolean()
  includeDeleted?: boolean

  @ApiPropertyOptional({ description: '创建日期起 YYYYMMDD', example: '20260101' })
  @IsOptional()
  @Matches(/^\d{8}$/)
  since?: string

  @ApiPropertyOptional({ description: '创建日期止 YYYYMMDD', example: '20261231' })
  @IsOptional()
  @Matches(/^\d{8}$/)
  until?: string
}
