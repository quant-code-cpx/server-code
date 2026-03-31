import { IsInt, IsOptional, Max, Min } from 'class-validator'
import { ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { MoneyFlowQueryDto } from './money-flow-query.dto'

export class HsgtFlowQueryDto extends MoneyFlowQueryDto {
  @ApiPropertyOptional({ description: '返回天数，默认 20，最大 365', minimum: 5, maximum: 365, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(365)
  days?: number = 20
}
