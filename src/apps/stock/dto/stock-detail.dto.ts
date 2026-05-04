import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

export class StockDetailDto {
  @ApiProperty({ example: '000001.SZ', description: '股票代码（ts_code）' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(16)
  code: string

  @ApiPropertyOptional({ example: '20240320', description: '指定查询交易日，格式 YYYYMMDD；不传取最新' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{8}$/, { message: 'tradeDate 格式应为 YYYYMMDD' })
  tradeDate?: string
}
