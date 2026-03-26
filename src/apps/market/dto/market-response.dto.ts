import { ApiProperty } from '@nestjs/swagger'

export class MarketMoneyFlowItemDto {
  @ApiProperty() tradeDate: Date
  @ApiProperty({ required: false, nullable: true }) netAmount: number | null
  @ApiProperty({ required: false, nullable: true }) buyAmount: number | null
  @ApiProperty({ required: false, nullable: true }) sellAmount: number | null
}

export class SectorFlowItemDto {
  @ApiProperty() tradeDate: Date
  @ApiProperty() contentType: string
  @ApiProperty({ required: false, nullable: true }) name: string | null
  @ApiProperty({ required: false, nullable: true }) netAmount: number | null
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
