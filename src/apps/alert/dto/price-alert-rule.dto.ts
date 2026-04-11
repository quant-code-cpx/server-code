import { IsEnum, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator'
import { PartialType } from '@nestjs/swagger'
import { PriceAlertRuleStatus, PriceAlertRuleType } from '@prisma/client'

export class CreatePriceAlertRuleDto {
  @IsString()
  tsCode: string

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
  @IsOptional()
  @IsEnum(PriceAlertRuleStatus)
  status?: PriceAlertRuleStatus
}
