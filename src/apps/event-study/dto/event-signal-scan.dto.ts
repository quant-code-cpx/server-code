import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator'

export class EventSignalScanDto {
  @ApiPropertyOptional({ description: '扫描交易日期，YYYYMMDD；不传则使用当前日期', example: '20240115' })
  @IsOptional()
  @Matches(/^\d{8}$/, { message: 'tradeDate 格式应为 YYYYMMDD，例如 20240115' })
  tradeDate?: string
}

export class EventSignalScanJobQueryDto {
  @ApiProperty({ description: 'BullMQ 任务 ID', example: '123' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  jobId: string
}
