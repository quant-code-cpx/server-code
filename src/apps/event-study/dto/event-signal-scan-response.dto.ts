import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

export class EventSignalScanAsyncResponseDto {
  @ApiProperty({ description: 'BullMQ 任务 ID', example: '123' })
  jobId: string

  @ApiProperty({ description: '任务状态', example: 'QUEUED' })
  status: string

  @ApiProperty({ description: '扫描交易日期，YYYYMMDD', example: '20240115' })
  tradeDate: string
}

export class EventSignalScanResultDto {
  @ApiProperty({ description: '扫描交易日期，YYYYMMDD', example: '20240115' })
  tradeDate: string

  @ApiProperty({ description: '生成的事件信号数量', example: 12 })
  signalsGenerated: number

  @ApiProperty({ description: '任务完成时间 ISO 字符串', example: '2026-07-08T10:00:00.000Z' })
  completedAt: string
}

export class EventSignalScanJobStatusResponseDto {
  @ApiProperty({ description: 'BullMQ 任务 ID', example: '123' })
  jobId: string

  @ApiProperty({ description: '业务归一化状态', example: 'COMPLETED' })
  status: string

  @ApiProperty({ description: 'BullMQ 原始状态', example: 'completed' })
  state: string

  @ApiProperty({ description: '扫描交易日期，YYYYMMDD', example: '20240115' })
  tradeDate: string

  @ApiProperty({ description: '任务进度，0-100', example: 100 })
  progress: number

  @ApiPropertyOptional({ description: '完成结果', type: EventSignalScanResultDto, nullable: true })
  result: EventSignalScanResultDto | null

  @ApiPropertyOptional({ description: '失败原因', nullable: true })
  failedReason: string | null

  @ApiPropertyOptional({ description: '任务创建时间 ISO 字符串', nullable: true })
  createdAt: string | null

  @ApiPropertyOptional({ description: '任务开始处理时间 ISO 字符串', nullable: true })
  processedAt: string | null

  @ApiPropertyOptional({ description: '任务结束时间 ISO 字符串', nullable: true })
  finishedAt: string | null
}
