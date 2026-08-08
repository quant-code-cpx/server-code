import { Type } from 'class-transformer'
import { IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

export class PortfolioIdRequestDto {
  @ApiProperty({ description: '组合 ID' })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  portfolioId: string
}

export class PortfolioRiskRuleIdRequestDto {
  @ApiProperty({ description: '风控规则 ID' })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  ruleId: string
}

export class PortfolioViolationQueryDto extends PortfolioIdRequestDto {
  @ApiPropertyOptional({ description: '返回记录数', default: 50, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number
}
