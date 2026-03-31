import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger'
import { Transform, Type } from 'class-transformer'
import { IsEnum, IsIn, IsObject, IsOptional, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator'
import { ScreenerFiltersDto, ScreenerSortBy, type ScreenerSortOrder } from './stock-screener-query.dto'

const trimString = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value)

export class CreateScreenerStrategyDto {
  @ApiProperty({ description: '策略名称', maxLength: 50 })
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  name: string

  @ApiPropertyOptional({ description: '策略描述', maxLength: 200 })
  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string

  @ApiProperty({ type: ScreenerFiltersDto, description: '选股过滤条件（不含分页与排序字段）' })
  @IsObject()
  @ValidateNested()
  @Type(() => ScreenerFiltersDto)
  filters: ScreenerFiltersDto

  @ApiPropertyOptional({ enum: ScreenerSortBy, description: '默认排序字段' })
  @IsOptional()
  @IsEnum(ScreenerSortBy)
  sortBy?: ScreenerSortBy

  @ApiPropertyOptional({ enum: ['asc', 'desc'], description: '默认排序方向' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: ScreenerSortOrder
}

export class UpdateScreenerStrategyDto extends PartialType(CreateScreenerStrategyDto) {}
