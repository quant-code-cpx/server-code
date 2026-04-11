import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsString, IsNotEmpty, IsOptional, IsInt, Min, Max } from 'class-validator'
import { Type } from 'class-transformer'

export class IndustryDetailQueryDto {
  @ApiProperty({ description: '行业名称（如 "银行"、"电子"）', example: '银行' })
  @IsString()
  @IsNotEmpty()
  industry: string

  @ApiPropertyOptional({ description: '趋势数据天数，默认 20', example: 20 })
  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(60)
  @Type(() => Number)
  days?: number
}
