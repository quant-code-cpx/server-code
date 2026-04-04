import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

// ─── 行业收益对比 ─────────────────────────────────────────────────────────────

export class ReturnComparisonIndustryItemDto {
  @ApiProperty({ description: '东财板块代码', example: 'BK0475' })
  tsCode: string

  @ApiProperty({ description: '行业名称', example: '银行' })
  name: string

  @ApiProperty({
    description: '各窗口收益率，key 为天数',
    type: 'object',
    additionalProperties: { type: 'number', nullable: true },
  })
  returns: Record<number, number | null>

  @ApiPropertyOptional({ description: '最新一日涨跌幅 %', nullable: true })
  latestPctChange: number | null

  @ApiPropertyOptional({ description: '最新收盘价（板块指数）', nullable: true })
  latestClose: number | null
}

export class ReturnComparisonResponseDto {
  @ApiProperty({ description: '交易日期' })
  tradeDate: string

  @ApiProperty({ type: [ReturnComparisonIndustryItemDto] })
  industries: ReturnComparisonIndustryItemDto[]
}

// ─── 行业动量排名 ─────────────────────────────────────────────────────────────

export class MomentumIndustryItemDto {
  @ApiProperty({ description: '东财板块代码' })
  tsCode: string

  @ApiProperty({ description: '行业名称' })
  name: string

  @ApiProperty({ description: '综合动量评分' })
  momentumScore: number

  @ApiPropertyOptional({ description: '5 日收益率 %', nullable: true })
  return5d: number | null

  @ApiPropertyOptional({ description: '20 日收益率 %', nullable: true })
  return20d: number | null

  @ApiPropertyOptional({ description: '60 日收益率 %', nullable: true })
  return60d: number | null

  @ApiPropertyOptional({ description: '最新一日涨跌幅 %', nullable: true })
  latestPctChange: number | null

  @ApiProperty({ description: '排名（1 = 最强）' })
  rank: number
}

export class MomentumRankingResponseDto {
  @ApiProperty({ description: '交易日期' })
  tradeDate: string

  @ApiProperty({ enum: ['weighted', 'simple'] })
  method: 'weighted' | 'simple'

  @ApiProperty({ type: [MomentumIndustryItemDto] })
  industries: MomentumIndustryItemDto[]
}

// ─── 行业资金流转分析 ─────────────────────────────────────────────────────────

export class FlowIndustryItemDto {
  @ApiProperty({ description: '东财板块代码' })
  tsCode: string

  @ApiProperty({ description: '行业名称' })
  name: string

  @ApiProperty({ description: '区间累计净流入（万元）' })
  cumulativeNetAmount: number

  @ApiProperty({ description: '日均净流入（万元）' })
  avgDailyNetAmount: number

  @ApiPropertyOptional({ description: '区间累计涨跌幅 %', nullable: true })
  cumulativeReturn: number | null

  @ApiProperty({ description: '资金流动量（万元）' })
  flowMomentum: number

  @ApiPropertyOptional({ description: '资金流加速度（万元）', nullable: true })
  flowAcceleration: number | null

  @ApiProperty({ description: '超大单累计净流入（万元）' })
  cumulativeBuyElg: number

  @ApiProperty({ description: '大单累计净流入（万元）' })
  cumulativeBuyLg: number

  @ApiPropertyOptional({ description: '主力占比', nullable: true })
  mainForceRatio: number | null

  @ApiPropertyOptional({ description: '最新一日净流入排名', nullable: true })
  latestDayRank: number | null
}

export class FlowSummaryDto {
  @ApiProperty({ description: '净流入行业数' })
  inflowCount: number

  @ApiProperty({ description: '净流出行业数' })
  outflowCount: number

  @ApiProperty({ type: [String], description: '净流入前 5 行业名称' })
  topInflowNames: string[]

  @ApiProperty({ type: [String], description: '净流出前 5 行业名称' })
  topOutflowNames: string[]
}

export class FlowAnalysisResponseDto {
  @ApiProperty({ description: '交易日期' })
  tradeDate: string

  @ApiProperty({ description: '分析天数' })
  days: number

  @ApiProperty({ type: [FlowIndustryItemDto] })
  industries: FlowIndustryItemDto[]

  @ApiProperty({ type: FlowSummaryDto })
  summary: FlowSummaryDto
}

// ─── 行业估值分位 ─────────────────────────────────────────────────────────────

export class IndustryValuationItemDto {
  @ApiProperty({ description: '行业名称' })
  industry: string

  @ApiProperty({ description: '行业内上市公司数量' })
  stockCount: number

  @ApiPropertyOptional({ description: '当日行业 PE_TTM 中位数', nullable: true })
  peTtmMedian: number | null

  @ApiPropertyOptional({ description: '当日行业 PB 中位数', nullable: true })
  pbMedian: number | null

  @ApiPropertyOptional({ description: 'PE_TTM 在 1 年历史中的百分位（0-100）', nullable: true })
  peTtmPercentile1y: number | null

  @ApiPropertyOptional({ description: 'PE_TTM 在 3 年历史中的百分位（0-100）', nullable: true })
  peTtmPercentile3y: number | null

  @ApiPropertyOptional({ description: 'PB 在 1 年历史中的百分位（0-100）', nullable: true })
  pbPercentile1y: number | null

  @ApiPropertyOptional({ description: 'PB 在 3 年历史中的百分位（0-100）', nullable: true })
  pbPercentile3y: number | null

  @ApiProperty({ description: '估值状态标签', enum: ['低估', '适中', '偏高', '高估'] })
  valuationLabel: '低估' | '适中' | '偏高' | '高估'
}

export class IndustryValuationResponseDto {
  @ApiProperty({ description: '交易日期' })
  tradeDate: string

  @ApiProperty({ type: [IndustryValuationItemDto] })
  industries: IndustryValuationItemDto[]
}

// ─── 行业轮动总览 ─────────────────────────────────────────────────────────────

export class ReturnSnapshotItemDto {
  @ApiProperty()
  name: string

  @ApiProperty()
  return20d: number
}

export class MomentumSnapshotItemDto {
  @ApiProperty()
  name: string

  @ApiProperty()
  momentumScore: number
}

export class FlowSnapshotItemDto {
  @ApiProperty()
  name: string

  @ApiProperty()
  cumulativeNetAmount: number
}

export class ValuationSnapshotItemDto {
  @ApiProperty()
  name: string

  @ApiPropertyOptional({ nullable: true })
  peTtmPercentile1y: number | null
}

export class ReturnSnapshotDto {
  @ApiProperty({ type: [ReturnSnapshotItemDto] })
  topGainers: ReturnSnapshotItemDto[]

  @ApiProperty({ type: [ReturnSnapshotItemDto] })
  topLosers: ReturnSnapshotItemDto[]
}

export class MomentumSnapshotDto {
  @ApiProperty({ type: [MomentumSnapshotItemDto] })
  leaders: MomentumSnapshotItemDto[]

  @ApiProperty({ type: [MomentumSnapshotItemDto] })
  laggards: MomentumSnapshotItemDto[]
}

export class FlowSnapshotDto {
  @ApiProperty({ type: [FlowSnapshotItemDto] })
  topInflow: FlowSnapshotItemDto[]

  @ApiProperty({ type: [FlowSnapshotItemDto] })
  topOutflow: FlowSnapshotItemDto[]
}

export class ValuationSnapshotDto {
  @ApiProperty({ type: [ValuationSnapshotItemDto] })
  undervalued: ValuationSnapshotItemDto[]

  @ApiProperty({ type: [ValuationSnapshotItemDto] })
  overvalued: ValuationSnapshotItemDto[]
}

export class RotationOverviewResponseDto {
  @ApiProperty({ description: '交易日期' })
  tradeDate: string

  @ApiProperty({ type: ReturnSnapshotDto })
  returnSnapshot: ReturnSnapshotDto

  @ApiProperty({ type: MomentumSnapshotDto })
  momentumSnapshot: MomentumSnapshotDto

  @ApiProperty({ type: FlowSnapshotDto })
  flowSnapshot: FlowSnapshotDto

  @ApiProperty({ type: ValuationSnapshotDto })
  valuationSnapshot: ValuationSnapshotDto
}

// ─── 单行业详情 ───────────────────────────────────────────────────────────────

export class ReturnTrendItemDto {
  @ApiProperty()
  tradeDate: string

  @ApiProperty()
  close: number

  @ApiProperty()
  pctChange: number

  @ApiProperty()
  cumulativeReturn: number
}

export class FlowTrendItemDto {
  @ApiProperty()
  tradeDate: string

  @ApiProperty()
  netAmount: number

  @ApiProperty()
  cumulativeNet: number

  @ApiProperty()
  buyElgAmount: number

  @ApiProperty()
  buyLgAmount: number
}

export class IndustryValuationSnapshotDto {
  @ApiPropertyOptional({ nullable: true })
  peTtmMedian: number | null

  @ApiPropertyOptional({ nullable: true })
  pbMedian: number | null

  @ApiPropertyOptional({ nullable: true })
  peTtmPercentile1y: number | null

  @ApiPropertyOptional({ nullable: true })
  pbPercentile1y: number | null

  @ApiProperty()
  valuationLabel: string
}

export class TopStockItemDto {
  @ApiProperty()
  tsCode: string

  @ApiProperty()
  name: string

  @ApiPropertyOptional({ nullable: true })
  pctChg: number | null

  @ApiPropertyOptional({ nullable: true })
  peTtm: number | null

  @ApiPropertyOptional({ nullable: true })
  pb: number | null

  @ApiPropertyOptional({ nullable: true })
  totalMv: number | null
}

export class IndustryDetailResponseDto {
  @ApiProperty()
  industry: string

  @ApiPropertyOptional({ nullable: true })
  tsCode: string | null

  @ApiProperty({ type: [ReturnTrendItemDto] })
  returnTrend: ReturnTrendItemDto[]

  @ApiProperty({ type: [FlowTrendItemDto] })
  flowTrend: FlowTrendItemDto[]

  @ApiPropertyOptional({ type: IndustryValuationSnapshotDto, nullable: true })
  valuation: IndustryValuationSnapshotDto | null

  @ApiProperty({ type: [TopStockItemDto] })
  topStocks: TopStockItemDto[]
}

// ─── 行业轮动热力图 ───────────────────────────────────────────────────────────

export class RotationHeatmapIndustryItemDto {
  @ApiProperty()
  tsCode: string

  @ApiProperty()
  name: string

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'number', nullable: true },
    description: '各窗口收益率矩阵，key = 天数',
  })
  returns: Record<number, number | null>
}

export class RotationHeatmapResponseDto {
  @ApiProperty()
  tradeDate: string

  @ApiProperty({ type: [Number] })
  periods: number[]

  @ApiProperty({ type: [RotationHeatmapIndustryItemDto] })
  industries: RotationHeatmapIndustryItemDto[]
}
