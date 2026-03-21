import { IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'

export class StockDetailMoneyFlowDto {
  @ApiProperty({ example: '000001.SZ', description: '股票代码（ts_code）' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(16)
  tsCode: string

  @ApiPropertyOptional({ description: '查询最近 N 个交易日的资金流数据', default: 60, maximum: 120 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(120)
  days?: number = 60
}
