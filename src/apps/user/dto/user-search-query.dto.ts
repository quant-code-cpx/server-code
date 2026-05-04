import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'

export class UserSearchQueryDto {
  @ApiProperty({ description: '账号或昵称关键词' })
  @IsString()
  @MaxLength(64)
  keyword: string

  @ApiPropertyOptional({ description: '最多返回条数，默认 20', default: 20 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  @IsOptional()
  limit?: number
}
