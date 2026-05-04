import {
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator'
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger'
import { PriceAlertRuleStatus, PriceAlertRuleType } from '@prisma/client'
import { Type } from 'class-transformer'

export class CreatePriceAlertRuleDto {
  /** 单股预警时必填；关联自选股组或组合时可不填 */
  @ValidateIf((o: CreatePriceAlertRuleDto) => !o.watchlistId && !o.portfolioId)
  @IsString()
  tsCode?: string

  /** 关联自选股组 ID（与 tsCode / portfolioId 三选一或叠加） */
  @IsOptional()
  @IsInt()
  watchlistId?: number

  /** 关联投资组合 ID（与 tsCode / watchlistId 三选一或叠加） */
  @IsOptional()
  @IsString()
  portfolioId?: string

  @IsEnum(PriceAlertRuleType)
  ruleType: PriceAlertRuleType

  /** PCT_CHANGE_UP/DOWN、PRICE_ABOVE/BELOW 时必填；LIMIT_UP/DOWN 时不填 */
  @IsOptional()
  @IsNumber()
  threshold?: number

  @IsOptional()
  @IsString()
  @MaxLength(256)
  memo?: string
}

export class UpdatePriceAlertRuleDto extends PartialType(CreatePriceAlertRuleDto) {
  @ApiProperty({ description: '规则 ID' })
  @IsInt()
  id: number

  @IsOptional()
  @IsEnum(PriceAlertRuleStatus)
  status?: PriceAlertRuleStatus
}

export class ListPriceAlertRulesDto {
  @ApiPropertyOptional({ description: '规则名/股票关键词模糊搜索' })
  @IsOptional()
  @IsString()
  keyword?: string

  @ApiPropertyOptional({ enum: PriceAlertRuleStatus })
  @IsOptional()
  @IsEnum(PriceAlertRuleStatus)
  status?: PriceAlertRuleStatus

  @ApiPropertyOptional({ type: [String], enum: Object.values(PriceAlertRuleType), description: '规则类型过滤（多选）' })
  @IsOptional()
  @IsArray()
  @IsEnum(PriceAlertRuleType, { each: true })
  ruleTypes?: PriceAlertRuleType[]

  @ApiPropertyOptional({ enum: ['SINGLE_STOCK', 'WATCHLIST', 'PORTFOLIO'], description: '规则来源类型' })
  @IsOptional()
  @IsIn(['SINGLE_STOCK', 'WATCHLIST', 'PORTFOLIO'])
  sourceType?: 'SINGLE_STOCK' | 'WATCHLIST' | 'PORTFOLIO'

  @ApiPropertyOptional({ description: '最后触发时间起 (ISO 8601)' })
  @IsOptional()
  @IsString()
  triggeredFrom?: string

  @ApiPropertyOptional({ description: '最后触发时间止 (ISO 8601)' })
  @IsOptional()
  @IsString()
  triggeredTo?: string

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number = 1

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  pageSize?: number = 20

  @ApiPropertyOptional({ enum: ['createdAt', 'lastTriggeredAt', 'triggerCount'], default: 'createdAt' })
  @IsOptional()
  @IsString()
  sortBy?: string = 'createdAt'

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsString()
  sortOrder?: string = 'desc'
}

export class ListPriceAlertHistoryDto {
  @ApiPropertyOptional({ description: '按规则 ID 过滤' })
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  ruleId?: number

  @ApiPropertyOptional({ description: '触发时间起 (ISO 8601)' })
  @IsOptional()
  @IsString()
  triggeredFrom?: string

  @ApiPropertyOptional({ description: '触发时间止 (ISO 8601)' })
  @IsOptional()
  @IsString()
  triggeredTo?: string

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number = 1

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  pageSize?: number = 20

  @ApiPropertyOptional({ enum: ['triggeredAt', 'actualValue', 'tsCode'], default: 'triggeredAt' })
  @IsOptional()
  @IsIn(['triggeredAt', 'actualValue', 'tsCode'])
  sortBy?: 'triggeredAt' | 'actualValue' | 'tsCode' = 'triggeredAt'

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc'
}
