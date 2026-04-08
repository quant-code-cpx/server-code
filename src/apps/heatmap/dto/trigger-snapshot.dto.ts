import { IsOptional, Matches } from 'class-validator'
import { ApiPropertyOptional } from '@nestjs/swagger'

export class TriggerSnapshotDto {
  @ApiPropertyOptional({
    description: '目标交易日（YYYYMMDD），留空时取最新交易日',
    example: '20260404',
  })
  @IsOptional()
  @Matches(/^\d{8}$/, { message: 'trade_date 格式应为 YYYYMMDD，例如 20240101' })
  trade_date?: string
}
