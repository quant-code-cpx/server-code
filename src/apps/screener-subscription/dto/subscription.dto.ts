import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator'
import { SubscriptionFrequency, SubscriptionHitKind, SubscriptionStatus } from '@prisma/client'
import { SubscriptionMetricSource } from '../metric-catalog'

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

  @ApiPropertyOptional({ description: '规则协议 v1。新客户端必须使用该字段，不能与 filters/strategyId 同传。' })
  @IsOptional()
  @IsObject()
  ruleSpec?: Record<string, unknown>

  @ApiPropertyOptional({ description: '触发协议。省略时使用规则类型默认值。' })
  @IsOptional()
  @IsObject()
  triggerSpec?: Record<string, unknown>

  @ApiPropertyOptional({ description: '通知配置' })
  @IsOptional()
  @IsObject()
  notificationSpec?: Record<string, unknown>

  @ApiPropertyOptional({ enum: SubscriptionFrequency, default: 'DAILY' })
  @IsOptional()
  @IsEnum(SubscriptionFrequency)
  frequency?: SubscriptionFrequency

  @ApiPropertyOptional({ enum: [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAUSED], default: 'ACTIVE' })
  @IsOptional()
  @IsIn([SubscriptionStatus.ACTIVE, SubscriptionStatus.PAUSED])
  status?: Extract<SubscriptionStatus, 'ACTIVE' | 'PAUSED'>

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

  @ApiPropertyOptional({ enum: [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAUSED] })
  @IsOptional()
  @IsIn([SubscriptionStatus.ACTIVE, SubscriptionStatus.PAUSED])
  status?: Extract<SubscriptionStatus, 'ACTIVE' | 'PAUSED'>

  @ApiPropertyOptional({ description: '更新关联策略 ID（传 null 取消关联）' })
  @IsOptional()
  @IsInt()
  strategyId?: number | null

  @ApiPropertyOptional({ description: '更新选股条件' })
  @IsOptional()
  @IsObject()
  filters?: Record<string, unknown>

  @ApiPropertyOptional({ description: '规则协议 v1。与 filters/strategyId 互斥。' })
  @IsOptional()
  @IsObject()
  ruleSpec?: Record<string, unknown>

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  triggerSpec?: Record<string, unknown>

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  notificationSpec?: Record<string, unknown>

  @ApiPropertyOptional({ description: '详情接口返回的 updatedAt；用于防止双页面覆盖。' })
  @IsOptional()
  @IsString()
  expectedUpdatedAt?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sortBy?: string | null

  @ApiPropertyOptional({ enum: ['asc', 'desc'], nullable: true })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: string | null
}

export class ValidateSubscriptionDto {
  @ApiPropertyOptional({ description: '当前订阅 ID（编辑时传入，排除自身）' })
  @IsOptional()
  @IsInt()
  id?: number

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  filters?: Record<string, unknown>

  @ApiPropertyOptional({ description: '规则协议 v1。与 filters/strategyId 互斥。' })
  @IsOptional()
  @IsObject()
  ruleSpec?: Record<string, unknown>

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  strategyId?: number
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

export class SubscriptionIdDto {
  @ApiProperty({ description: '订阅 ID' })
  @IsInt()
  id: number
}

export class UpdateSubscriptionBodyDto extends UpdateSubscriptionDto {
  @ApiProperty({ description: '订阅 ID' })
  @IsInt()
  id: number
}

export class SubscriptionLogsBodyDto extends SubscriptionLogsQueryDto {
  @ApiProperty({ description: '订阅 ID' })
  @IsInt()
  id: number
}

export class SubscriptionMetricsDto {
  @ApiPropertyOptional({ enum: ['STOCK', 'FACTOR', 'SIGNAL'], isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @IsEnum(['STOCK', 'FACTOR', 'SIGNAL'], { each: true })
  sources?: SubscriptionMetricSource[]

  @ApiPropertyOptional({ description: '客户端当前目录版本；不一致时响应仍返回新目录。' })
  @IsOptional()
  @IsString()
  catalogVersion?: string
}

export class PreviewSubscriptionDto {
  @ApiProperty({ description: '待预览规则协议 v1' })
  @IsObject()
  ruleSpec: Record<string, unknown>

  @ApiPropertyOptional({ description: '触发协议；仅用于校验和返回默认值。' })
  @IsOptional()
  @IsObject()
  triggerSpec?: Record<string, unknown>

  @ApiPropertyOptional({ description: '数据截止交易日，YYYYMMDD；省略时取最近开市日。' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{8}$/)
  tradeDate?: string

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number
}

export class SubscriptionHitsDto {
  @ApiProperty({ description: '订阅 ID' })
  @IsInt()
  id: number

  @ApiProperty({ description: '运行日志 ID' })
  @IsInt()
  logId: number

  @ApiPropertyOptional({ enum: SubscriptionHitKind })
  @IsOptional()
  @IsEnum(SubscriptionHitKind)
  kind?: SubscriptionHitKind

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number = 1

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20
}

export class SubscriptionRunStatusDto {
  @ApiProperty({ description: 'manual run 返回的 BullMQ jobId' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  jobId: string
}
