import { IsArray, IsBoolean, IsEnum, IsIn, IsNumber, IsOptional, IsString, Matches, Min } from 'class-validator'
import { Transform, Type } from 'class-transformer'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { MarketAnomalyType } from '@prisma/client'

export const ANOMALY_SORT_FIELDS = ['strength', 'value', 'scannedAt', 'tsCode', 'anomalyType'] as const
export type AnomalySortField = (typeof ANOMALY_SORT_FIELDS)[number]

export class MarketAnomalyQueryDto {
  @ApiPropertyOptional({ description: '交易日，格式 YYYYMMDD；不传则取最新' })
  @IsOptional()
  @Matches(/^\d{8}$/, { message: 'tradeDate 格式应为 YYYYMMDD' })
  tradeDate?: string

  @ApiPropertyOptional({ enum: MarketAnomalyType })
  @IsOptional()
  @IsEnum(MarketAnomalyType)
  type?: MarketAnomalyType

  @ApiPropertyOptional({ type: [String], enum: MarketAnomalyType, description: '异动类型多选，优先于 type' })
  @IsOptional()
  @IsArray()
  @IsEnum(MarketAnomalyType, { each: true })
  types?: MarketAnomalyType[]

  @ApiPropertyOptional({ description: '股票代码/名称关键词' })
  @IsOptional()
  @IsString()
  keyword?: string

  @ApiPropertyOptional({ enum: ['LOW', 'MEDIUM', 'HIGH'], description: '按异动强度粗分层过滤' })
  @IsOptional()
  @IsIn(['LOW', 'MEDIUM', 'HIGH'])
  severity?: 'LOW' | 'MEDIUM' | 'HIGH'

  @ApiPropertyOptional({ description: '仅返回同一股票多类型异动' })
  @IsOptional()
  @IsBoolean()
  multiTypeOnly?: boolean

  @ApiPropertyOptional({ description: '仅返回本轮扫描新出现记录（当前以最新扫描批次近似）' })
  @IsOptional()
  @IsBoolean()
  isNewOnly?: boolean

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  tsCode?: string

  @ApiPropertyOptional({ enum: ANOMALY_SORT_FIELDS, default: 'strength' })
  @IsOptional()
  @IsIn(ANOMALY_SORT_FIELDS)
  sortBy?: AnomalySortField = 'strength'

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc'

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Transform(({ value }: { value: number }) => Math.min(value, 100))
  pageSize?: number = 20
}

/** 异动监控 detail 字段（各类型共用，不适用的字段为 null） */
export class MarketAnomalyDetailDto {
  /** 扫描时交易日字符串，格式 YYYYMMDD */
  @ApiProperty({ required: false, nullable: true })
  tradeDateStr?: string | null

  // ── VOLUME_SURGE ──
  @ApiPropertyOptional({ description: '当日成交量（手）' })
  vol?: number | null

  @ApiPropertyOptional({ description: '20 日平均成交量（手）' })
  avg20Vol?: number | null

  // ── CONSECUTIVE_LIMIT_UP ──
  @ApiPropertyOptional({ description: '连续涨停天数' })
  consecutiveDays?: number | null

  // ── LARGE_NET_INFLOW ──
  @ApiPropertyOptional({ description: '超大单买入金额（万元）' })
  buyElgAmount?: number | null

  @ApiPropertyOptional({ description: '超大单卖出金额（万元）' })
  sellElgAmount?: number | null

  @ApiPropertyOptional({ description: '超大单净流入（万元）' })
  netElg?: number | null

  @ApiPropertyOptional({ description: '当日成交额（万元）' })
  amount?: number | null
}

export class MarketAnomalyDto {
  @ApiProperty()
  id: number

  @ApiProperty({ description: '交易日，格式 YYYYMMDD' })
  tradeDate: string

  @ApiProperty()
  tsCode: string

  @ApiPropertyOptional({ nullable: true })
  stockName: string | null

  @ApiProperty({ enum: MarketAnomalyType })
  anomalyType: MarketAnomalyType

  /** 异动指标原始值（各类型含义不同） */
  @ApiProperty()
  value: number

  /** 触发阈值 */
  @ApiProperty()
  threshold: number

  /** 强度 = value / threshold，用于跨类型对比排序 */
  @ApiProperty()
  strength: number

  @ApiProperty({ type: MarketAnomalyDetailDto })
  detail: MarketAnomalyDetailDto | null

  @ApiProperty()
  scannedAt: Date
}

/** 统计聚合结果 */
export class MarketAnomalyStatsDto {
  @ApiProperty({ description: '各异动类型记录数' })
  byType: Record<string, number>

  @ApiProperty()
  total: number
}

export class MarketAnomalyListResponseDto {
  @ApiProperty()
  page: number

  @ApiProperty()
  pageSize: number

  @ApiProperty()
  total: number

  @ApiProperty({ type: MarketAnomalyDto, isArray: true })
  items: MarketAnomalyDto[]

  @ApiProperty({ type: MarketAnomalyStatsDto })
  stats: MarketAnomalyStatsDto
}
