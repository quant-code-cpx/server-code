import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator'
import { Type } from 'class-transformer'

export class IndustryDetailQueryDto {
  @ApiProperty({ description: '行业名称（如 "银行"、"电子"）', example: '银行' })
  @IsString()
  @IsNotEmpty()
  industry: string

  @ApiPropertyOptional({ description: '趋势数据天数，默认 20', minimum: 5, maximum: 60, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(60)
  days?: number = 20
}
