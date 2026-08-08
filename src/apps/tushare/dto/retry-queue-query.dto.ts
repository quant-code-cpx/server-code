import { ApiPropertyOptional } from '@nestjs/swagger'
import { TushareSyncRetryStatus } from '@prisma/client'
import { IsEnum, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator'

export class RetryQueueQueryDto {
  @ApiPropertyOptional({ enum: TushareSyncRetryStatus, description: '按重试状态过滤' })
  @IsOptional()
  @IsEnum(TushareSyncRetryStatus)
  status?: TushareSyncRetryStatus

  @ApiPropertyOptional({ description: '按任务名包含匹配，不区分大小写' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  task?: string

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @IsInt()
  @Min(1)
  pageSize?: number
}
