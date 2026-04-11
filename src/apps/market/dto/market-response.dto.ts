import { ApiProperty } from '@nestjs/swagger'

export class MarketMoneyFlowItemDto {
  @ApiProperty({ example: '2024-03-20' }) tradeDate: Date
  @ApiProperty({ example: -523400, required: false, nullable: true, description: '净流入额（万元）' }) netAmount:
    | number
    | null
  @ApiProperty({ example: -0.0182, required: false, nullable: true }) netAmountRate: number | null
  @ApiProperty({ example: 125000, required: false, nullable: true }) buyElgAmount: number | null
  @ApiProperty({ example: 0.0043, required: false, nullable: true }) buyElgAmountRate: number | null
  @ApiProperty({ example: 890000, required: false, nullable: true }) buyLgAmount: number | null
  @ApiProperty({ example: 0.031, required: false, nullable: true }) buyLgAmountRate: number | null
  @ApiProperty({ example: 2340000, required: false, nullable: true }) buyMdAmount: number | null
  @ApiProperty({ example: 0.081, required: false, nullable: true }) buyMdAmountRate: number | null
  @ApiProperty({ example: 5670000, required: false, nullable: true }) buySmAmount: number | null
  @ApiProperty({ example: 0.197, required: false, nullable: true }) buySmAmountRate: number | null
  @ApiProperty({ description: '沪市收盘点位', example: 3050.23, required: false, nullable: true }) closeSh:
    | number
    | null
  @ApiProperty({ description: '沪市涨跌幅', example: 0.35, required: false, nullable: true }) pctChangeSh: number | null
  @ApiProperty({ description: '深市收盘点位', example: 9872.45, required: false, nullable: true }) closeSz:
    | number
    | null
  @ApiProperty({ description: '深市涨跌幅', example: 0.42, required: false, nullable: true }) pctChangeSz: number | null
}

export class SectorFlowItemDto {
  @ApiProperty() tradeDate: Date
  @ApiProperty() contentType: string
  @ApiProperty({ required: false, nullable: true }) name: string | null
  @ApiProperty({ required: false, nullable: true }) pctChange: number | null
  @ApiProperty({ required: false, nullable: true }) close: number | null
  @ApiProperty({ required: false, nullable: true }) netAmount: number | null
  @ApiProperty({ required: false, nullable: true }) netAmountRate: number | null
  @ApiProperty({ required: false, nullable: true }) buyElgAmount: number | null
  @ApiProperty({ required: false, nullable: true }) buyLgAmount: number | null
  @ApiProperty({ required: false, nullable: true }) buyMdAmount: number | null
  @ApiProperty({ required: false, nullable: true }) buySmAmount: number | null
  @ApiProperty({ required: false, nullable: true }) rank: number | null
}

export class SectorFlowDataDto {
  @ApiProperty({ required: false, nullable: true }) tradeDate: Date | null
  @ApiProperty({ type: [SectorFlowItemDto] }) industry: SectorFlowItemDto[]
  @ApiProperty({ type: [SectorFlowItemDto] }) concept: SectorFlowItemDto[]
  @ApiProperty({ type: [SectorFlowItemDto] }) region: SectorFlowItemDto[]
}

export class MarketSentimentDto {
  @ApiProperty() tradeDate: Date
  @ApiProperty({ description: '总股票数（仅当日有行情的 A 股）' }) total: number
  @ApiProperty({ description: '涨幅 ≥5% 数量' }) bigRise: number
  @ApiProperty({ description: '涨幅 0%~5% 数量' }) rise: number
  @ApiProperty({ description: '平盘（pct_chg=0）数量' }) flat: number
  @ApiProperty({ description: '跌幅 -5%~0% 数量' }) fall: number
  @ApiProperty({ description: '跌幅 ≤-5% 数量' }) bigFall: number
}

export class ValuationPercentileDto {
  @ApiProperty({ description: '近 1 年历史分位（0~100）', required: false, nullable: true }) oneYear: number | null
  @ApiProperty({ description: '近 3 年历史分位（0~100）', required: false, nullable: true }) threeYear: number | null
  @ApiProperty({ description: '近 5 年历史分位（0~100）', required: false, nullable: true }) fiveYear: number | null
}

export class MarketValuationDto {
  @ApiProperty({ required: false, nullable: true }) tradeDate: Date | null
  @ApiProperty({ description: '全市场 PE_TTM 中位数', required: false, nullable: true }) peTtmMedian: number | null
  @ApiProperty({ description: '全市场 PB 中位数', required: false, nullable: true }) pbMedian: number | null
  @ApiProperty({ type: ValuationPercentileDto }) peTtmPercentile: ValuationPercentileDto
  @ApiProperty({ type: ValuationPercentileDto }) pbPercentile: ValuationPercentileDto
}

export class IndexQuoteItemDto {
  @ApiProperty() tsCode: string
  @ApiProperty() tradeDate: Date
  @ApiProperty({ required: false, nullable: true }) close: number | null
  @ApiProperty({ required: false, nullable: true }) preClose: number | null
  @ApiProperty({ required: false, nullable: true }) change: number | null
  @ApiProperty({ required: false, nullable: true }) pctChg: number | null
  @ApiProperty({ required: false, nullable: true }) vol: number | null
  @ApiProperty({ required: false, nullable: true }) amount: number | null
}

export class HsgtFlowDto {
  @ApiProperty({ required: false, nullable: true }) tradeDate: Date | null
  @ApiProperty({ description: '北向资金合计（沪股通+深股通）亿元', required: false, nullable: true }) northMoney:
    | number
    | null
  @ApiProperty({ description: '沪股通净流入亿元', required: false, nullable: true }) hgt: number | null
  @ApiProperty({ description: '深股通净流入亿元', required: false, nullable: true }) sgt: number | null
  @ApiProperty({ description: '南向资金合计（港股通）亿元', required: false, nullable: true }) southMoney: number | null
  @ApiProperty({ description: '港股通（上海）亿元', required: false, nullable: true }) ggtSs: number | null
  @ApiProperty({ description: '港股通（深圳）亿元', required: false, nullable: true }) ggtSz: number | null
}

export class HsgtFlowHistoryDto {
  @ApiProperty({ required: false, nullable: true }) tradeDate: Date | null
  @ApiProperty({ type: [HsgtFlowDto] }) history: HsgtFlowDto[]
}

// ─── index-trend ─────────────────────────────────────────────────────────────

export class IndexTrendItemDto {
  @ApiProperty({ description: '交易日期 YYYY-MM-DD' }) tradeDate: string
  @ApiProperty({ required: false, nullable: true }) close: number | null
  @ApiProperty({ required: false, nullable: true }) pctChg: number | null
  @ApiProperty({ required: false, nullable: true }) vol: number | null
  @ApiProperty({ required: false, nullable: true }) amount: number | null
}

export class IndexTrendResponseDto {
  @ApiProperty() tsCode: string
  @ApiProperty() name: string
  @ApiProperty() period: string
  @ApiProperty({ type: [IndexTrendItemDto] }) data: IndexTrendItemDto[]
}

// ─── change-distribution ─────────────────────────────────────────────────────

export class ChangeDistributionBucketDto {
  @ApiProperty({ description: '涨跌幅区间标签，如 "-10~-9"' }) label: string
  @ApiProperty({ description: '该区间内股票数量' }) count: number
}

export class ChangeDistributionResponseDto {
  @ApiProperty({ description: '交易日期' }) tradeDate: Date
  @ApiProperty({ description: '涨停家数（pct_chg >= 9.5）' }) limitUp: number
  @ApiProperty({ description: '跌停家数（pct_chg <= -9.5）' }) limitDown: number
  @ApiProperty({ type: [ChangeDistributionBucketDto] }) distribution: ChangeDistributionBucketDto[]
}

// ─── sector-ranking ──────────────────────────────────────────────────────────

export class SectorRankingItemDto {
  @ApiProperty() tsCode: string
  @ApiProperty({ required: false, nullable: true }) name: string | null
  @ApiProperty({ description: '板块涨跌幅 %', required: false, nullable: true }) pctChange: number | null
  @ApiProperty({ description: '净流入金额（万元）', required: false, nullable: true }) netAmount: number | null
  @ApiProperty({ description: '净流入率 %', required: false, nullable: true }) netAmountRate: number | null
}

export class SectorRankingResponseDto {
  @ApiProperty({ description: '交易日期' }) tradeDate: Date
  @ApiProperty({ type: [SectorRankingItemDto] }) sectors: SectorRankingItemDto[]
}

// ─── volume-overview ─────────────────────────────────────────────────────────

export class VolumeOverviewItemDto {
  @ApiProperty({ description: '交易日期 YYYY-MM-DD' }) tradeDate: string
  @ApiProperty({ description: '全A股合计成交额（亿元）' }) totalAmount: number
  @ApiProperty({ description: '上证指数成交额（亿元）' }) shAmount: number
  @ApiProperty({ description: '深证成指成交额（亿元）' }) szAmount: number
}

export class VolumeOverviewResponseDto {
  @ApiProperty({ type: [VolumeOverviewItemDto] }) data: VolumeOverviewItemDto[]
}

// ─── sentiment-trend ─────────────────────────────────────────────────────────

export class SentimentTrendItemDto {
  @ApiProperty({ description: '交易日期 YYYY-MM-DD' }) tradeDate: string
  @ApiProperty({ description: '上涨家数' }) rise: number
  @ApiProperty({ description: '平盘家数' }) flat: number
  @ApiProperty({ description: '下跌家数' }) fall: number
  @ApiProperty({ description: '涨停家数（pct_chg >= 9.5）' }) limitUp: number
  @ApiProperty({ description: '跌停家数（pct_chg <= -9.5）' }) limitDown: number
}

export class SentimentTrendResponseDto {
  @ApiProperty({ type: [SentimentTrendItemDto] }) data: SentimentTrendItemDto[]
}

// ─── valuation-trend ─────────────────────────────────────────────────────────

export class ValuationTrendItemDto {
  @ApiProperty({ description: '交易日期 YYYY-MM-DD' }) tradeDate: string
  @ApiProperty({ description: '当日全A PE_TTM 中位数' }) peTtmMedian: number
  @ApiProperty({ description: '当日全A PB 中位数' }) pbMedian: number
}

export class ValuationTrendResponseDto {
  @ApiProperty({ description: '查询周期' }) period: string
  @ApiProperty({ type: [ValuationTrendItemDto] }) data: ValuationTrendItemDto[]
}

// ─── money-flow-trend ─────────────────────────────────────────────────────────

export class MoneyFlowTrendItemDto {
  @ApiProperty({ description: '交易日期 YYYY-MM-DD' }) tradeDate: string
  @ApiProperty({ description: '当日净流入（万元）', required: false, nullable: true }) netAmount: number | null
  @ApiProperty({ description: '累计净流入（从序列第 1 天开始累加）' }) cumulativeNet: number
  @ApiProperty({ description: '超大单净流入', required: false, nullable: true }) buyElgAmount: number | null
  @ApiProperty({ description: '大单净流入', required: false, nullable: true }) buyLgAmount: number | null
  @ApiProperty({ description: '中单净流入', required: false, nullable: true }) buyMdAmount: number | null
  @ApiProperty({ description: '小单净流入', required: false, nullable: true }) buySmAmount: number | null
}

export class MoneyFlowTrendResponseDto {
  @ApiProperty({ type: [MoneyFlowTrendItemDto] }) data: MoneyFlowTrendItemDto[]
}

// ─── sector-flow-ranking ──────────────────────────────────────────────────────

export class SectorFlowRankingItemDto {
  @ApiProperty() tsCode: string
  @ApiProperty({ required: false, nullable: true }) name: string | null
  @ApiProperty({ description: '板块涨跌幅 %', required: false, nullable: true }) pctChange: number | null
  @ApiProperty({ required: false, nullable: true }) close: number | null
  @ApiProperty({ description: '净流入（万元）', required: false, nullable: true }) netAmount: number | null
  @ApiProperty({ description: '净流入率 %', required: false, nullable: true }) netAmountRate: number | null
  @ApiProperty({ description: '超大单净流入', required: false, nullable: true }) buyElgAmount: number | null
  @ApiProperty({ description: '大单净流入', required: false, nullable: true }) buyLgAmount: number | null
  @ApiProperty({ description: '中单净流入', required: false, nullable: true }) buyMdAmount: number | null
  @ApiProperty({ description: '小单净流入', required: false, nullable: true }) buySmAmount: number | null
}

export class SectorFlowRankingResponseDto {
  @ApiProperty({ description: '交易日期' }) tradeDate: Date
  @ApiProperty({ description: '板块类型' }) contentType: string
  @ApiProperty({ type: [SectorFlowRankingItemDto] }) sectors: SectorFlowRankingItemDto[]
}

// ─── sector-flow-trend ────────────────────────────────────────────────────────

export class SectorFlowTrendItemDto {
  @ApiProperty({ description: '交易日期 YYYY-MM-DD' }) tradeDate: string
  @ApiProperty({ description: '板块涨跌幅 %', required: false, nullable: true }) pctChange: number | null
  @ApiProperty({ description: '当日净流入（万元）', required: false, nullable: true }) netAmount: number | null
  @ApiProperty({ description: '累计净流入' }) cumulativeNet: number
}

export class SectorFlowTrendResponseDto {
  @ApiProperty() tsCode: string
  @ApiProperty({ required: false, nullable: true }) name: string | null
  @ApiProperty({ type: [SectorFlowTrendItemDto] }) data: SectorFlowTrendItemDto[]
}

// ─── hsgt-trend ───────────────────────────────────────────────────────────────

export class HsgtTrendItemDto {
  @ApiProperty({ description: '交易日期 YYYY-MM-DD' }) tradeDate: string
  @ApiProperty({ description: '北向当日净买入（亿元）', required: false, nullable: true }) northMoney: number | null
  @ApiProperty({ description: '南向当日净买入（亿元）', required: false, nullable: true }) southMoney: number | null
  @ApiProperty({ description: '沪股通', required: false, nullable: true }) hgt: number | null
  @ApiProperty({ description: '深股通', required: false, nullable: true }) sgt: number | null
  @ApiProperty({ description: '港股通（上海）', required: false, nullable: true }) ggtSs: number | null
  @ApiProperty({ description: '港股通（深圳）', required: false, nullable: true }) ggtSz: number | null
  @ApiProperty({ description: '累计北向净买入（亿元）' }) cumulativeNorth: number
  @ApiProperty({ description: '累计南向净买入（亿元）' }) cumulativeSouth: number
}

export class HsgtTrendResponseDto {
  @ApiProperty({ description: '查询周期' }) period: string
  @ApiProperty({ type: [HsgtTrendItemDto] }) data: HsgtTrendItemDto[]
}

// ─── main-flow-ranking ────────────────────────────────────────────────────────

export class MainFlowRankingItemDto {
  @ApiProperty() tsCode: string
  @ApiProperty({ description: '股票名称', required: false, nullable: true }) name: string | null
  @ApiProperty({ description: '所属行业', required: false, nullable: true }) industry: string | null
  @ApiProperty({ description: '主力净流入 = 超大单净 + 大单净（万元）' }) mainNetInflow: number
  @ApiProperty({ description: '超大单净流入（万元）' }) elgNetInflow: number
  @ApiProperty({ description: '大单净流入（万元）' }) lgNetInflow: number
  @ApiProperty({ description: '当日涨跌幅 %', required: false, nullable: true }) pctChg: number | null
  @ApiProperty({ description: '当日成交额', required: false, nullable: true }) amount: number | null
}

export class MainFlowRankingResponseDto {
  @ApiProperty({ description: '交易日期' }) tradeDate: Date
  @ApiProperty({ type: [MainFlowRankingItemDto] }) data: MainFlowRankingItemDto[]
}

// ─── stock-flow-detail ────────────────────────────────────────────────────────

export class StockFlowDetailItemDto {
  @ApiProperty({ description: '交易日期 YYYY-MM-DD' }) tradeDate: string
  @ApiProperty({ description: '主力净流入 = 超大单净 + 大单净（万元）' }) mainNetInflow: number
  @ApiProperty({ description: '散户净流入 = 中单净 + 小单净（万元）' }) retailNetInflow: number
  @ApiProperty({ required: false, nullable: true }) buyElgAmount: number | null
  @ApiProperty({ required: false, nullable: true }) sellElgAmount: number | null
  @ApiProperty({ required: false, nullable: true }) buyLgAmount: number | null
  @ApiProperty({ required: false, nullable: true }) sellLgAmount: number | null
  @ApiProperty({ required: false, nullable: true }) buyMdAmount: number | null
  @ApiProperty({ required: false, nullable: true }) sellMdAmount: number | null
  @ApiProperty({ required: false, nullable: true }) buySmAmount: number | null
  @ApiProperty({ required: false, nullable: true }) sellSmAmount: number | null
  @ApiProperty({ description: '总净流入（万元）', required: false, nullable: true }) netMfAmount: number | null
}

export class StockFlowDetailResponseDto {
  @ApiProperty() tsCode: string
  @ApiProperty({ required: false, nullable: true }) name: string | null
  @ApiProperty({ type: [StockFlowDetailItemDto] }) data: StockFlowDetailItemDto[]
}

export class ConceptListItemDto {
  @ApiProperty() tsCode: string
  @ApiProperty() name: string
  @ApiProperty({ required: false, nullable: true }) count: number | null
  @ApiProperty({ required: false, nullable: true }) listDate: Date | null
}

export class ConceptListResponseDto {
  @ApiProperty() total: number
  @ApiProperty() page: number
  @ApiProperty() pageSize: number
  @ApiProperty({ type: [ConceptListItemDto] }) items: ConceptListItemDto[]
}

export class ConceptMemberItemDto {
  @ApiProperty() conCode: string
  @ApiProperty({ required: false, nullable: true }) conName: string | null
}

export class ConceptMembersResponseDto {
  @ApiProperty() tsCode: string
  @ApiProperty({ required: false, nullable: true }) name: string | null
  @ApiProperty() total: number
  @ApiProperty({ type: [ConceptMemberItemDto] }) items: ConceptMemberItemDto[]
}
