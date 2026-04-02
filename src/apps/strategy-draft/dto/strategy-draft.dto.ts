import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator'

export class CreateStrategyDraftDto {
  @ApiProperty({ description: '草稿名称', maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string

  @ApiProperty({ description: '回测配置快照（与 CreateBacktestRunDto 字段对齐，可不完整）' })
  @IsObject()
  config: Record<string, unknown>
}

export class UpdateStrategyDraftDto {
  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string

  @ApiPropertyOptional({ description: '回测配置快照（增量更新）' })
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>
}

export class SubmitDraftDto {
  @ApiPropertyOptional({ description: '回测任务名称（不传则用草稿名称）', maxLength: 128 })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  name?: string
}
