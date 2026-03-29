import { IsInt, IsNotEmpty, IsString, IsOptional, Max, MaxLength, Min } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'

export class StockDetailFinancialStatementsDto {
  @ApiProperty({ example: '000001.SZ', description: '股票代码（ts_code）' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(16)
  tsCode: string

  @ApiPropertyOptional({ description: '返回最近 N 个报告期（report_type=1 合并报表）', default: 8, maximum: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  periods?: number = 8
}
