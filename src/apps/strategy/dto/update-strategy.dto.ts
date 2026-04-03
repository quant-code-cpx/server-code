import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsArray, IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator'

export class UpdateStrategyDto {
  @ApiProperty({ description: '策略 ID' })
  @IsString()
  id: string

  @ApiPropertyOptional({ description: '策略名称', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string

  @ApiPropertyOptional({ description: '策略描述', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string

  @ApiPropertyOptional({ description: '策略参数（更新后触发版本号自增）' })
  @IsOptional()
  @IsObject()
  strategyConfig?: Record<string, unknown>

  @ApiPropertyOptional({ description: '回测默认参数' })
  @IsOptional()
  @IsObject()
  backtestDefaults?: Record<string, unknown>

  @ApiPropertyOptional({ description: '标签列表（最多 10 个，每个不超过 30 字）', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(30, { each: true })
  tags?: string[]
}
