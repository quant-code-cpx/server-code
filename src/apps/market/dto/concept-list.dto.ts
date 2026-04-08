import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator'
import { ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'

export class ConceptListDto {
  @ApiPropertyOptional({ description: '按板块名称模糊搜索，如"机器人"' })
  @IsOptional()
  @IsString()
  keyword?: string

  @ApiPropertyOptional({ description: '页码，从 1 开始', default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1

  @ApiPropertyOptional({ description: '每页条数', default: 50, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 50
}
