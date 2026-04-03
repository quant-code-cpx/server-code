import { ApiPropertyOptional } from '@nestjs/swagger'
import { TushareSyncStatus } from '@prisma/client'
import { IsEnum, IsInt, IsISO8601, IsOptional, Max, Min } from 'class-validator'
import { TushareSyncTaskName } from 'src/constant/tushare.constant'

export class SyncLogQueryDto {
  @ApiPropertyOptional({ enum: TushareSyncTaskName, description: '按任务类型过滤' })
  @IsOptional()
  @IsEnum(TushareSyncTaskName)
  task?: TushareSyncTaskName

  @ApiPropertyOptional({ enum: TushareSyncStatus, description: '按状态过滤' })
  @IsOptional()
  @IsEnum(TushareSyncStatus)
  status?: TushareSyncStatus

  @ApiPropertyOptional({ description: '起始时间（ISO 8601）' })
  @IsOptional()
  @IsISO8601()
  startDate?: string

  @ApiPropertyOptional({ description: '结束时间（ISO 8601）' })
  @IsOptional()
  @IsISO8601()
  endDate?: string

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number
}
