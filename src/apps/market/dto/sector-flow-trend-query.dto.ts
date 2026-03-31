import { IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'

export class SectorFlowTrendQueryDto {
  @ApiProperty({ description: '板块代码，如 BK0475' })
  @IsString()
  @IsNotEmpty()
  ts_code: string

  @ApiPropertyOptional({
    description: '板块类型，默认 INDUSTRY',
    enum: ['INDUSTRY', 'CONCEPT', 'REGION'],
    default: 'INDUSTRY',
  })
  @IsOptional()
  @IsEnum(['INDUSTRY', 'CONCEPT', 'REGION'])
  content_type?: 'INDUSTRY' | 'CONCEPT' | 'REGION' = 'INDUSTRY'

  @ApiPropertyOptional({ description: '历史天数，默认 20，最大 60', minimum: 5, maximum: 60, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(60)
  days?: number = 20
}
