import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsString, IsNotEmpty, IsOptional, IsInt, Min, Max } from 'class-validator'
import { Type } from 'class-transformer'

export class IndustryDetailQueryDto {
  @ApiPropertyOptional({
    description: '东财行业板块完整代码（如 BK0438.DC），优先级最高',
    example: 'BK0438.DC',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  tsCode?: string

  @ApiPropertyOptional({
    description: '行业名称（如 "银行"、"食品饮料"），与 tsCode 至少传一个',
    example: '银行',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  industry?: string

  @ApiPropertyOptional({ description: '趋势数据天数，默认 20', example: 20 })
  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(60)
  @Type(() => Number)
  days?: number
}
