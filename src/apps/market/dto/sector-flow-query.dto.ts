import { IsEnum, IsInt, IsOptional, Matches, Max, Min } from 'class-validator'
import { ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { MoneyFlowQueryDto } from './money-flow-query.dto'

export class SectorFlowQueryDto extends MoneyFlowQueryDto {
  @ApiPropertyOptional({
    description: '板块类型筛选，不传则返回全部三类',
    enum: ['INDUSTRY', 'CONCEPT', 'REGION'],
  })
  @IsOptional()
  @IsEnum(['INDUSTRY', 'CONCEPT', 'REGION'])
  content_type?: 'INDUSTRY' | 'CONCEPT' | 'REGION'

  @ApiPropertyOptional({ description: 'Top N 截断，默认不限制', minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number
}
