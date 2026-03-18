import { IsIn, IsOptional, IsString } from 'class-validator'
import { ApiPropertyOptional } from '@nestjs/swagger'

export class StockListQueryDto {
  @ApiPropertyOptional({ description: '交易所：SSE（上交所）/ SZSE（深交所）/ BSE（北交所）' })
  @IsOptional()
  @IsString()
  @IsIn(['SSE', 'SZSE', 'BSE'])
  exchange?: string

  @ApiPropertyOptional({ description: '上市状态：L（上市）/ D（退市）/ P（暂停上市）', default: 'L' })
  @IsOptional()
  @IsString()
  @IsIn(['L', 'D', 'P'])
  list_status?: string = 'L'

  @ApiPropertyOptional({ description: '所属行业（模糊匹配）' })
  @IsOptional()
  @IsString()
  industry?: string
}
