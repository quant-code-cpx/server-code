import { IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'

export class ConceptMembersDto {
  @ApiProperty({ description: '板块代码，如 "885835.TI"' })
  @IsString()
  @IsNotEmpty()
  tsCode: string

  @ApiPropertyOptional({ description: '页码，从 1 开始', default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1

  @ApiPropertyOptional({ description: '每页条数', default: 100, minimum: 1, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number = 100
}
