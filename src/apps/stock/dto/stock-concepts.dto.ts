import { IsNotEmpty, IsString } from 'class-validator'
import { ApiProperty } from '@nestjs/swagger'

export class StockConceptsDto {
  @ApiProperty({ description: '股票代码，如 "000001.SZ"' })
  @IsString()
  @IsNotEmpty()
  tsCode: string
}
