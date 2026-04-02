import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { TushareSyncTaskName } from 'src/constant/tushare.constant'
import { TUSHARE_SYNC_MODES, TushareSyncCategory, TushareSyncTrigger } from 'src/tushare/sync/sync-plan.types'

export class TushareSyncScheduleDto {
  @ApiProperty()
  cron!: string

  @ApiProperty()
  timeZone!: string

  @ApiProperty()
  description!: string

  @ApiProperty()
  tradingDayOnly!: boolean
}

export class TushareSyncPlanDto {
  @ApiProperty({ enum: TushareSyncTaskName })
  task!: TushareSyncTaskName

  @ApiProperty()
  label!: string

  @ApiProperty({ enum: ['basic', 'market', 'financial', 'moneyflow', 'factor', 'alternative'] })
  category!: TushareSyncCategory

  @ApiProperty()
  bootstrapEnabled!: boolean

  @ApiProperty()
  supportsManual!: boolean

  @ApiProperty()
  supportsFullSync!: boolean

  @ApiProperty()
  requiresTradeDate!: boolean

  @ApiPropertyOptional({ type: TushareSyncScheduleDto, nullable: true })
  schedule!: TushareSyncScheduleDto | null
}

export class ManualSyncResultDto {
  @ApiProperty({ enum: ['bootstrap', 'schedule', 'manual'] })
  trigger!: TushareSyncTrigger

  @ApiProperty({ enum: TUSHARE_SYNC_MODES })
  mode!: (typeof TUSHARE_SYNC_MODES)[number]

  @ApiProperty({ enum: TushareSyncTaskName, isArray: true })
  executedTasks!: TushareSyncTaskName[]

  @ApiProperty({ enum: TushareSyncTaskName, isArray: true })
  skippedTasks!: TushareSyncTaskName[]

  @ApiProperty({ enum: TushareSyncTaskName, isArray: true })
  failedTasks!: TushareSyncTaskName[]

  @ApiPropertyOptional({ nullable: true })
  targetTradeDate!: string | null

  @ApiProperty()
  elapsedSeconds!: number
}

export class CacheNamespaceMetricsDto {
  @ApiProperty()
  namespace!: string

  @ApiProperty()
  keyCount!: number

  @ApiProperty()
  hits!: number

  @ApiProperty()
  misses!: number

  @ApiProperty()
  writes!: number

  @ApiProperty()
  invalidations!: number

  @ApiPropertyOptional({ nullable: true, description: '命中率（%）' })
  hitRate!: number | null

  @ApiPropertyOptional({ nullable: true })
  lastHitAt!: string | null

  @ApiPropertyOptional({ nullable: true })
  lastMissAt!: string | null

  @ApiPropertyOptional({ nullable: true })
  lastWriteAt!: string | null

  @ApiPropertyOptional({ nullable: true })
  lastInvalidatedAt!: string | null
}

export class CacheMetricsDataDto {
  @ApiProperty({ description: '统计生成时间（ISO 字符串）' })
  generatedAt!: string

  @ApiProperty({ type: [CacheNamespaceMetricsDto] })
  namespaces!: CacheNamespaceMetricsDto[]
}
