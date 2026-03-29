import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

export enum ChartPeriod {
  DAILY = 'D',
  WEEKLY = 'W',
  MONTHLY = 'M',
}

export enum AdjustType {
  NONE = 'none',
  QFQ = 'qfq', // 前复权
  HFQ = 'hfq', // 后复权
}

export class StockDetailChartDto {
  @ApiProperty({ example: '000001.SZ', description: '股票代码（ts_code）' })
  @IsString()
  @MaxLength(16)
  tsCode: string

  @ApiPropertyOptional({
    enum: ChartPeriod,
    description: '周期：D（日）/ W（周）/ M（月）',
    default: ChartPeriod.DAILY,
  })
  @IsOptional()
  @IsEnum(ChartPeriod)
  period?: ChartPeriod = ChartPeriod.DAILY

  @ApiPropertyOptional({
    enum: AdjustType,
    description: '复权方式：none（不复权）/ qfq（前复权）/ hfq（后复权）',
    default: AdjustType.QFQ,
  })
  @IsOptional()
  @IsEnum(AdjustType)
  adjustType?: AdjustType = AdjustType.QFQ

  @ApiPropertyOptional({ description: '开始日期（YYYYMMDD）', example: '20240101' })
  @IsOptional()
  @IsString()
  @MaxLength(8)
  startDate?: string

  @ApiPropertyOptional({ description: '结束日期（YYYYMMDD）', example: '20260321' })
  @IsOptional()
  @IsString()
  @MaxLength(8)
  endDate?: string

  @ApiPropertyOptional({
    description: '返回条数上限（按 tradeDate 倒序截取最新 N 条）。传入时启用分页模式，响应包含 hasMore 字段。',
    example: 150,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  limit?: number
}
