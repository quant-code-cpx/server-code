import { IsNotEmpty, IsString, MaxLength } from 'class-validator'
import { ApiProperty } from '@nestjs/swagger'

export class StockDetailShareholdersDto {
  @ApiProperty({ example: '000001.SZ', description: '股票代码（ts_code）' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(16)
  tsCode: string
}
