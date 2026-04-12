import { IsEnum, IsInt, IsNumber, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator'
import { ApiProperty, PartialType } from '@nestjs/swagger'
import { PriceAlertRuleStatus, PriceAlertRuleType } from '@prisma/client'

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
