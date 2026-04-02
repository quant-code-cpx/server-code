import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsEnum, IsIn, IsInt, IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator'
import { SubscriptionFrequency } from '@prisma/client'

export class CreateSubscriptionDto {
  @ApiProperty({ description: '订阅名称', maxLength: 50 })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  name: string

  @ApiPropertyOptional({ description: '关联已保存选股策略 ID（会自动复制 filters）' })
  @IsOptional()
  @IsInt()
  strategyId?: number

  @ApiPropertyOptional({ description: '直接传入选股条件（与 strategyId 二选一）' })
  @IsOptional()
  @IsObject()
  filters?: Record<string, unknown>

  @ApiPropertyOptional({ enum: SubscriptionFrequency, default: 'DAILY' })
  @IsOptional()
  @IsEnum(SubscriptionFrequency)
  frequency?: SubscriptionFrequency

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sortBy?: string

  @ApiPropertyOptional({ enum: ['asc', 'desc'] })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: string
}

export class UpdateSubscriptionDto {
  @ApiPropertyOptional({ maxLength: 50 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  name?: string

  @ApiPropertyOptional({ enum: SubscriptionFrequency })
  @IsOptional()
  @IsEnum(SubscriptionFrequency)
  frequency?: SubscriptionFrequency
}

export class SubscriptionLogsQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @IsInt()
  page?: number = 1

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 50 })
  @IsOptional()
  @IsInt()
  pageSize?: number = 20
}
