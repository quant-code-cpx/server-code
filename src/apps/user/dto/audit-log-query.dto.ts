import { AuditAction } from '@prisma/client'
import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsEnum, IsInt, IsISO8601, IsOptional, Max, Min } from 'class-validator'
import { Type } from 'class-transformer'

export class AuditLogQueryDto {
  @ApiPropertyOptional({ description: '页码，从1开始', default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  @IsOptional()
  page: number = 1

  @ApiPropertyOptional({ description: '每页条数', default: 20 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  pageSize: number = 20

  @ApiPropertyOptional({ description: '操作者用户 ID' })
  @Type(() => Number)
  @IsInt()
  @IsOptional()
  operatorId?: number

  @ApiPropertyOptional({ description: '被操作目标用户 ID' })
  @Type(() => Number)
  @IsInt()
  @IsOptional()
  targetId?: number

  @ApiPropertyOptional({ enum: AuditAction, description: '操作类型筛选' })
  @IsEnum(AuditAction)
  @IsOptional()
  action?: AuditAction

  @ApiPropertyOptional({ description: '开始时间（ISO 8601，如 2026-01-01T00:00:00Z）' })
  @IsISO8601()
  @IsOptional()
  startDate?: string

  @ApiPropertyOptional({ description: '结束时间（ISO 8601，如 2026-12-31T23:59:59Z）' })
  @IsISO8601()
  @IsOptional()
  endDate?: string
}
