import { ApiProperty } from '@nestjs/swagger'

// ─── return-comparison ──────────────────────────────────────────────────────

export class ReturnComparisonIndustryDto {
  @ApiProperty() tsCode: string
  @ApiProperty() name: string
  @ApiProperty({ description: '各窗口收益率 %，key 为天数' }) returns: Record<number, number | null>
  @ApiProperty({ required: false, nullable: true }) latestPctChange: number | null
  @ApiProperty({ required: false, nullable: true }) latestClose: number | null
}

export class ReturnComparisonResponseDto {
  @ApiProperty() tradeDate: string
  @ApiProperty({ type: [ReturnComparisonIndustryDto] }) industries: ReturnComparisonIndustryDto[]
}

// ─── momentum-ranking ───────────────────────────────────────────────────────

export class MomentumRankingIndustryDto {
  @ApiProperty() tsCode: string
  @ApiProperty() name: string
  @ApiProperty({ description: '综合动量评分' }) momentumScore: number
  @ApiProperty({ required: false, nullable: true }) return5d: number | null
  @ApiProperty({ required: false, nullable: true }) return20d: number | null
  @ApiProperty({ required: false, nullable: true }) return60d: number | null
  @ApiProperty({ required: false, nullable: true }) latestPctChange: number | null
  @ApiProperty({ description: '排名（1 = 最强）' }) rank: number
}

export class MomentumRankingResponseDto {
  @ApiProperty() tradeDate: string
  @ApiProperty() method: string
  @ApiProperty({ type: [MomentumRankingIndustryDto] }) industries: MomentumRankingIndustryDto[]
}

// ─── flow-analysis ──────────────────────────────────────────────────────────

export class FlowAnalysisIndustryDto {
  @ApiProperty() tsCode: string
  @ApiProperty() name: string
  @ApiProperty({ description: '区间累计净流入（万元）' }) cumulativeNetAmount: number
  @ApiProperty({ description: '日均净流入（万元）' }) avgDailyNetAmount: number
  @ApiProperty({ description: '区间累计涨跌幅 %', required: false, nullable: true }) cumulativeReturn: number | null
  @ApiProperty({ description: '资金流动量（万元）' }) flowMomentum: number
  @ApiProperty({ description: '资金流加速度', required: false, nullable: true }) flowAcceleration: number | null
  @ApiProperty({ description: '超大单累计净流入（万元）' }) cumulativeBuyElg: number
  @ApiProperty({ description: '大单累计净流入（万元）' }) cumulativeBuyLg: number
  @ApiProperty({ description: '主力占比', required: false, nullable: true }) mainForceRatio: number | null
  @ApiProperty({ description: '最新一日净流入排名', required: false, nullable: true }) latestDayRank: number | null
}

export class FlowAnalysisSummaryDto {
  @ApiProperty({ description: '净流入行业数' }) inflowCount: number
  @ApiProperty({ description: '净流出行业数' }) outflowCount: number
  @ApiProperty({ description: '净流入前 5 行业名称', type: [String] }) topInflowNames: string[]
  @ApiProperty({ description: '净流出前 5 行业名称', type: [String] }) topOutflowNames: string[]
}

export class FlowAnalysisResponseDto {
  @ApiProperty() tradeDate: string
  @ApiProperty() days: number
  @ApiProperty({ type: [FlowAnalysisIndustryDto] }) industries: FlowAnalysisIndustryDto[]
  @ApiProperty({ type: FlowAnalysisSummaryDto }) summary: FlowAnalysisSummaryDto
}

// ─── valuation ──────────────────────────────────────────────────────────────

export class IndustryValuationItemDto {
  @ApiProperty({ description: '行业名称' }) industry: string
  @ApiProperty({ description: '行业内上市公司数量' }) stockCount: number
  @ApiProperty({ required: false, nullable: true }) peTtmMedian: number | null
  @ApiProperty({ required: false, nullable: true }) pbMedian: number | null
  @ApiProperty({ description: 'PE_TTM 在 1 年历史中的百分位（0-100）', required: false, nullable: true })
  peTtmPercentile1y: number | null
  @ApiProperty({ description: 'PE_TTM 在 3 年历史中的百分位（0-100）', required: false, nullable: true })
  peTtmPercentile3y: number | null
  @ApiProperty({ description: 'PB 在 1 年历史中的百分位（0-100）', required: false, nullable: true })
  pbPercentile1y: number | null
  @ApiProperty({ description: 'PB 在 3 年历史中的百分位（0-100）', required: false, nullable: true })
  pbPercentile3y: number | null
  @ApiProperty({ description: '估值状态标签', enum: ['低估', '适中', '偏高', '高估'] })
  valuationLabel: string
}

export class IndustryValuationResponseDto {
  @ApiProperty() tradeDate: string
  @ApiProperty({ type: [IndustryValuationItemDto] }) industries: IndustryValuationItemDto[]
}

// ─── overview ───────────────────────────────────────────────────────────────

export class NameValueDto {
  @ApiProperty() name: string
  @ApiProperty() value: number
}

export class RotationOverviewReturnSnapshotDto {
  @ApiProperty({ type: [NameValueDto] }) topGainers: NameValueDto[]
  @ApiProperty({ type: [NameValueDto] }) topLosers: NameValueDto[]
}

export class RotationOverviewMomentumSnapshotDto {
  @ApiProperty({ type: [NameValueDto] }) leaders: NameValueDto[]
  @ApiProperty({ type: [NameValueDto] }) laggards: NameValueDto[]
}

export class RotationOverviewFlowSnapshotDto {
  @ApiProperty({ type: [NameValueDto] }) topInflow: NameValueDto[]
  @ApiProperty({ type: [NameValueDto] }) topOutflow: NameValueDto[]
}

export class RotationOverviewValuationSnapshotDto {
  @ApiProperty({ type: [NameValueDto] }) undervalued: NameValueDto[]
  @ApiProperty({ type: [NameValueDto] }) overvalued: NameValueDto[]
}

export class RotationOverviewResponseDto {
  @ApiProperty() tradeDate: string
  @ApiProperty({ type: RotationOverviewReturnSnapshotDto }) returnSnapshot: RotationOverviewReturnSnapshotDto
  @ApiProperty({ type: RotationOverviewMomentumSnapshotDto }) momentumSnapshot: RotationOverviewMomentumSnapshotDto
  @ApiProperty({ type: RotationOverviewFlowSnapshotDto }) flowSnapshot: RotationOverviewFlowSnapshotDto
  @ApiProperty({ type: RotationOverviewValuationSnapshotDto })
  valuationSnapshot: RotationOverviewValuationSnapshotDto
}

// ─── detail ─────────────────────────────────────────────────────────────────

export class ReturnTrendPointDto {
  @ApiProperty() tradeDate: string
  @ApiProperty() close: number
  @ApiProperty() pctChange: number
  @ApiProperty() cumulativeReturn: number
}

export class FlowTrendPointDto {
  @ApiProperty() tradeDate: string
  @ApiProperty() netAmount: number
  @ApiProperty() cumulativeNet: number
  @ApiProperty() buyElgAmount: number
  @ApiProperty() buyLgAmount: number
}

export class IndustryDetailValuationDto {
  @ApiProperty({ required: false, nullable: true }) peTtmMedian: number | null
  @ApiProperty({ required: false, nullable: true }) pbMedian: number | null
  @ApiProperty({ required: false, nullable: true }) peTtmPercentile1y: number | null
  @ApiProperty({ required: false, nullable: true }) pbPercentile1y: number | null
  @ApiProperty({ required: false, nullable: true }) valuationLabel: string | null
}

export class TopStockDto {
  @ApiProperty() tsCode: string
  @ApiProperty() name: string
  @ApiProperty({ required: false, nullable: true }) pctChg: number | null
  @ApiProperty({ required: false, nullable: true }) peTtm: number | null
  @ApiProperty({ required: false, nullable: true }) pb: number | null
  @ApiProperty({ required: false, nullable: true, description: '总市值（万元）' }) totalMv: number | null
}

export class IndustryDetailResponseDto {
  @ApiProperty() industry: string
  @ApiProperty({ required: false, nullable: true }) tsCode: string | null
  @ApiProperty({ type: [ReturnTrendPointDto] }) returnTrend: ReturnTrendPointDto[]
  @ApiProperty({ type: [FlowTrendPointDto] }) flowTrend: FlowTrendPointDto[]
  @ApiProperty({ type: IndustryDetailValuationDto, required: false, nullable: true })
  valuation: IndustryDetailValuationDto | null
  @ApiProperty({ type: [TopStockDto] }) topStocks: TopStockDto[]
}

// ─── heatmap ────────────────────────────────────────────────────────────────

export class HeatmapIndustryDto {
  @ApiProperty() tsCode: string
  @ApiProperty() name: string
  @ApiProperty({ description: '各窗口收益率矩阵，key = 天数' }) returns: Record<number, number | null>
}

export class RotationHeatmapResponseDto {
  @ApiProperty() tradeDate: string
  @ApiProperty({ type: [Number] }) periods: number[]
  @ApiProperty({ type: [HeatmapIndustryDto] }) industries: HeatmapIndustryDto[]
}
