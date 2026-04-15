import { ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsEnum, IsIn, IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator'

export enum ScreenerSortBy {
  TOTAL_MV = 'totalMv',
  CIRC_MV = 'circMv',
  PE_TTM = 'peTtm',
  PB = 'pb',
  DV_TTM = 'dvTtm',
  PCT_CHG = 'pctChg',
  TURNOVER_RATE = 'turnoverRate',
  AMOUNT = 'amount',
  ROE = 'roe',
  REVENUE_YOY = 'revenueYoy',
  NETPROFIT_YOY = 'netprofitYoy',
  GROSS_MARGIN = 'grossMargin',
  NET_MARGIN = 'netMargin',
  DEBT_TO_ASSETS = 'debtToAssets',
  MAIN_NET_INFLOW_5D = 'mainNetInflow5d',
  LIST_DATE = 'listDate',
}

export type ScreenerSortOrder = 'asc' | 'desc'

export class ScreenerFiltersDto {
  // ─── 基本面筛选 ───
  @ApiPropertyOptional({ description: '交易所：SSE / SZSE / BSE' })
  @IsOptional()
  @IsString()
  @IsIn(['SSE', 'SZSE', 'BSE'])
  exchange?: string

  @ApiPropertyOptional({ description: '市场板块（主板 / 创业板 / 科创板 等，精确匹配）' })
  @IsOptional()
  @IsString()
  market?: string

  @ApiPropertyOptional({ description: '行业（精确匹配，从 /stock/industries 返回的列表中选择）' })
  @IsOptional()
  @IsString()
  industry?: string

  @ApiPropertyOptional({ description: '地域（精确匹配，从 /stock/areas 返回的列表中选择）' })
  @IsOptional()
  @IsString()
  area?: string

  @ApiPropertyOptional({ description: '是否沪深港通标的：N / H / S' })
  @IsOptional()
  @IsString()
  @IsIn(['N', 'H', 'S'])
  isHs?: string

  // ─── 估值维度 ───
  @ApiPropertyOptional({ description: '最小市盈率 TTM' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  minPeTtm?: number

  @ApiPropertyOptional({ description: '最大市盈率 TTM' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  maxPeTtm?: number

  @ApiPropertyOptional({ description: '最小市净率 PB' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  minPb?: number

  @ApiPropertyOptional({ description: '最大市净率 PB' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  maxPb?: number

  @ApiPropertyOptional({ description: '最小股息率 TTM（%）' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minDvTtm?: number

  @ApiPropertyOptional({ description: '最小总市值（万元）' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minTotalMv?: number

  @ApiPropertyOptional({ description: '最大总市值（万元）' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxTotalMv?: number

  @ApiPropertyOptional({ description: '最小流通市值（万元）' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minCircMv?: number

  @ApiPropertyOptional({ description: '最大流通市值（万元）' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxCircMv?: number

  // ─── 行情维度 ───
  @ApiPropertyOptional({ description: '最小涨跌幅（%）' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  minPctChg?: number

  @ApiPropertyOptional({ description: '最大涨跌幅（%）' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  maxPctChg?: number

  @ApiPropertyOptional({ description: '最小换手率（%）' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minTurnoverRate?: number

  @ApiPropertyOptional({ description: '最大换手率（%）' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxTurnoverRate?: number

  @ApiPropertyOptional({ description: '最小成交额（千元）' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minAmount?: number

  @ApiPropertyOptional({ description: '最大成交额（千元）' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxAmount?: number

  // ─── 成长维度（基于最新 fina_indicator） ───
  @ApiPropertyOptional({ description: '最小营收同比增长（%）' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  minRevenueYoy?: number

  @ApiPropertyOptional({ description: '最大营收同比增长（%）' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  maxRevenueYoy?: number

  @ApiPropertyOptional({ description: '最小净利润同比增长（%）' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  minNetprofitYoy?: number

  @ApiPropertyOptional({ description: '最大净利润同比增长（%）' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  maxNetprofitYoy?: number

  // ─── 盈利维度 ───
  @ApiPropertyOptional({ description: '最小 ROE（%）' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  minRoe?: number

  @ApiPropertyOptional({ description: '最大 ROE（%）' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  maxRoe?: number

  @ApiPropertyOptional({ description: '最小毛利率（%）' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  minGrossMargin?: number

  @ApiPropertyOptional({ description: '最大毛利率（%）' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  maxGrossMargin?: number

  @ApiPropertyOptional({ description: '最小净利率（%）' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  minNetMargin?: number

  @ApiPropertyOptional({ description: '最大净利率（%）' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  maxNetMargin?: number

  // ─── 财务健康 ───
  @ApiPropertyOptional({ description: '最大资产负债率（%）' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxDebtToAssets?: number

  @ApiPropertyOptional({ description: '最小流动比率' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minCurrentRatio?: number

  @ApiPropertyOptional({ description: '最小速动比率' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minQuickRatio?: number

  // ─── 现金流 ───
  @ApiPropertyOptional({ description: '最小经营现金流/净利润比率（如 0.8 表示 80%）' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  minOcfToNetprofit?: number

  // ─── 资金流向 ───
  @ApiPropertyOptional({ description: '近5日主力净流入最小值（万元）' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  minMainNetInflow5d?: number

  @ApiPropertyOptional({ description: '近20日主力净流入最小值（万元）' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  minMainNetInflow20d?: number

  // ─── 技术指标维度 ───
  @ApiPropertyOptional({
    description: 'MACD 信号筛选',
    enum: ['golden_cross', 'death_cross', 'above_zero', 'below_zero'],
  })
  @IsOptional()
  @IsIn(['golden_cross', 'death_cross', 'above_zero', 'below_zero'])
  macdSignal?: string

  @ApiPropertyOptional({
    description: 'KDJ 信号筛选',
    enum: ['golden_cross', 'death_cross', 'overbought', 'oversold'],
  })
  @IsOptional()
  @IsIn(['golden_cross', 'death_cross', 'overbought', 'oversold'])
  kdjSignal?: string

  @ApiPropertyOptional({ description: 'RSI 超买超卖', enum: ['overbought', 'oversold'] })
  @IsOptional()
  @IsIn(['overbought', 'oversold'])
  rsiSignal?: string

  @ApiPropertyOptional({ description: '最小 RSI 6 日值（0-100）' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  minRsi6?: number

  @ApiPropertyOptional({ description: '最大 RSI 6 日值（0-100）' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  maxRsi6?: number
}

export class StockScreenerQueryDto extends ScreenerFiltersDto {
  // ─── 分页 ───
  @ApiPropertyOptional({ description: '页码，从 1 开始', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  page?: number = 1

  @ApiPropertyOptional({ description: '每页条数', default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20

  // ─── 排序 ───
  @ApiPropertyOptional({ enum: ScreenerSortBy, description: '排序字段', default: ScreenerSortBy.TOTAL_MV })
  @IsOptional()
  @IsEnum(ScreenerSortBy)
  sortBy?: ScreenerSortBy = ScreenerSortBy.TOTAL_MV

  @ApiPropertyOptional({ enum: ['asc', 'desc'], description: '排序方向', default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: ScreenerSortOrder = 'desc'
}
