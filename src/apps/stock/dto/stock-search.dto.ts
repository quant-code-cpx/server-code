import { IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'

export class StockSearchDto {
  @ApiProperty({ description: '搜索关键词（代码 / 名称 / 拼音缩写）', example: '平安' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  keyword: string

  @ApiPropertyOptional({ description: '返回条数上限', default: 10, maximum: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  limit?: number = 10
}
