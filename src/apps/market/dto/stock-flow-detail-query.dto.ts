import { IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'

export class StockFlowDetailQueryDto {
  @ApiProperty({ description: '股票代码，如 000001.SZ' })
  @IsString()
  @IsNotEmpty()
  ts_code: string

  @ApiPropertyOptional({ description: '历史天数，默认 20，最大 60', minimum: 5, maximum: 60, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(60)
  days?: number = 20
}
