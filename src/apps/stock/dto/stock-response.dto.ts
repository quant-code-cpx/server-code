import { ApiProperty } from '@nestjs/swagger'

export class StockListItemDto {
  @ApiProperty() tsCode: string
  @ApiProperty({ required: false, nullable: true }) symbol: string | null
  @ApiProperty({ required: false, nullable: true }) name: string | null
  @ApiProperty({ required: false, nullable: true }) fullname: string | null
  @ApiProperty({ required: false, nullable: true }) exchange: string | null
  @ApiProperty({ required: false, nullable: true }) currType: string | null
  @ApiProperty({ required: false, nullable: true }) market: string | null
  @ApiProperty({ required: false, nullable: true }) industry: string | null
  @ApiProperty({ required: false, nullable: true }) area: string | null
  @ApiProperty({ required: false, nullable: true }) listStatus: string | null
  @ApiProperty({ required: false, nullable: true }) listDate: Date | null
  @ApiProperty({ required: false, nullable: true }) latestTradeDate: Date | null
  @ApiProperty({ required: false, nullable: true }) peTtm: number | null
  @ApiProperty({ required: false, nullable: true }) pb: number | null
  @ApiProperty({ required: false, nullable: true }) dvTtm: number | null
  @ApiProperty({ required: false, nullable: true }) totalMv: number | null
  @ApiProperty({ required: false, nullable: true }) circMv: number | null
  @ApiProperty({ required: false, nullable: true }) turnoverRate: number | null
  @ApiProperty({ required: false, nullable: true }) pctChg: number | null
  @ApiProperty({ required: false, nullable: true }) amount: number | null
  @ApiProperty({ required: false, nullable: true }) close: number | null
}

export class StockListDataDto {
  @ApiProperty() page: number
  @ApiProperty() pageSize: number
  @ApiProperty() total: number
  @ApiProperty({ type: [StockListItemDto] })
  items: StockListItemDto[]
}

export class StockSearchItemDto {
  @ApiProperty() tsCode: string
  @ApiProperty({ required: false, nullable: true }) symbol: string | null
  @ApiProperty({ required: false, nullable: true }) name: string | null
  @ApiProperty({ required: false, nullable: true }) exchange: string | null
  @ApiProperty({ required: false, nullable: true }) market: string | null
  @ApiProperty({ required: false, nullable: true }) industry: string | null
}

export class StockDetailOverviewDataDto {
  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true }) basic: Record<string, unknown> | null
  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true }) company: Record<string, unknown> | null
  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true }) latestQuote: Record<
    string,
    unknown
  > | null
  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true }) latestValuation: Record<
    string,
    unknown
  > | null
  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true }) latestExpress: Record<
    string,
    unknown
  > | null
}

export class StockChartItemDto {
  @ApiProperty() tradeDate: Date
  @ApiProperty({ required: false, nullable: true }) open: number | null
  @ApiProperty({ required: false, nullable: true }) high: number | null
  @ApiProperty({ required: false, nullable: true }) low: number | null
  @ApiProperty({ required: false, nullable: true }) close: number | null
  @ApiProperty({ required: false, nullable: true }) vol: number | null
  @ApiProperty({ required: false, nullable: true }) amount: number | null
  @ApiProperty({ required: false, nullable: true }) pctChg: number | null
  @ApiProperty({ required: false, nullable: true }) ma5: number | null
  @ApiProperty({ required: false, nullable: true }) ma10: number | null
  @ApiProperty({ required: false, nullable: true }) ma20: number | null
}

export class StockChartDataDto {
  @ApiProperty() tsCode: string
  @ApiProperty() period: string
  @ApiProperty() adjustType: string
  @ApiProperty({ type: [StockChartItemDto] }) items: StockChartItemDto[]
}

export class StockMoneyFlowSummaryDto {
  @ApiProperty() netAmount5d: number
  @ApiProperty() netAmount20d: number
  @ApiProperty() netAmount60d: number
}

export class StockMoneyFlowItemDto {
  @ApiProperty() tradeDate: Date
  @ApiProperty({ required: false, nullable: true }) close: number | null
  @ApiProperty({ required: false, nullable: true }) pctChange: number | null
  @ApiProperty({ required: false, nullable: true }) netAmount: number | null
  @ApiProperty({ required: false, nullable: true }) netAmountRate: number | null
}

export class StockMoneyFlowDataDto {
  @ApiProperty() tsCode: string
  @ApiProperty({ type: StockMoneyFlowSummaryDto }) summary: StockMoneyFlowSummaryDto
  @ApiProperty({ type: [StockMoneyFlowItemDto] }) items: StockMoneyFlowItemDto[]
}

export class StockFinancialsDataDto {
  @ApiProperty() tsCode: string
  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true }) latest: Record<string, unknown> | null
  @ApiProperty({ type: 'array', items: { type: 'object', additionalProperties: true } }) history: Record<
    string,
    unknown
  >[]
  @ApiProperty({ type: 'array', items: { type: 'object', additionalProperties: true } }) recentExpress: Record<
    string,
    unknown
  >[]
}

export class StockShareholdersDataDto {
  @ApiProperty() tsCode: string
  @ApiProperty({ type: 'array', items: { type: 'object', additionalProperties: true } }) dividendHistory: Record<
    string,
    unknown
  >[]
  @ApiProperty({ type: 'object', additionalProperties: true }) top10Holders: Record<string, unknown>
  @ApiProperty({ type: 'object', additionalProperties: true }) top10FloatHolders: Record<string, unknown>
}

export class StockDetailLegacyDataDto {
  @ApiProperty({ type: 'object', additionalProperties: true }) stock: Record<string, unknown>
  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true }) company: Record<string, unknown> | null
  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true }) latestDaily: Record<
    string,
    unknown
  > | null
  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true }) latestDailyBasic: Record<
    string,
    unknown
  > | null
  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true }) latestAdjFactor: Record<
    string,
    unknown
  > | null
}
