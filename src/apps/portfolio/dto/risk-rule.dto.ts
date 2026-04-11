import { IsBoolean, IsEnum, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator'
import { PortfolioRiskRuleType } from '@prisma/client'

export class CreateRiskRuleDto {
  @IsString()
  portfolioId: string

  @IsEnum(PortfolioRiskRuleType)
  ruleType: PortfolioRiskRuleType

  @IsNumber()
  @Min(0.01)
  @Max(1.0)
  threshold: number

  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean

  @IsOptional()
  @IsString()
  @MaxLength(200)
  memo?: string
}

export class UpdateRiskRuleDto {
  @IsString()
  ruleId: string

  @IsNumber()
  @Min(0.01)
  @Max(1.0)
  threshold: number

  @IsBoolean()
  isEnabled: boolean

  @IsOptional()
  @IsString()
  @MaxLength(200)
  memo?: string
}
