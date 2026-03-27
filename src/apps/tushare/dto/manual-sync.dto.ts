import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsArray, IsEnum, IsIn, IsOptional } from 'class-validator'
import { TushareSyncTaskName } from 'src/constant/tushare.constant'
import { TUSHARE_SYNC_MODES, TushareSyncMode } from 'src/tushare/sync/sync-plan.types'

export class ManualSyncDto {
  @ApiProperty({
    enum: TUSHARE_SYNC_MODES,
    description: '同步模式：incremental 增量，full 全量',
  })
  @IsIn(TUSHARE_SYNC_MODES)
  mode!: TushareSyncMode

  @ApiPropertyOptional({
    enum: TushareSyncTaskName,
    isArray: true,
    description: '指定要执行的同步任务；不传则执行全部支持手动同步的任务',
  })
  @IsOptional()
  @IsArray()
  @IsEnum(TushareSyncTaskName, { each: true })
  tasks?: TushareSyncTaskName[]
}
