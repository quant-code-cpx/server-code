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

  @ApiProperty({ enum: ['basic', 'market', 'financial', 'moneyflow'] })
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
