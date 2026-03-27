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

// ─── 主力资金流向 ─────────────────────────────────────────────────────────────

export class StockMainMoneyFlowSummaryDto {
  @ApiProperty({ description: '5日主力净流入（万元）' }) mainNetAmount5d: number
  @ApiProperty({ description: '10日主力净流入（万元）' }) mainNetAmount10d: number
  @ApiProperty({ description: '20日主力净流入（万元）' }) mainNetAmount20d: number
}

export class StockMainMoneyFlowItemDto {
  @ApiProperty() tradeDate: Date
  @ApiProperty({ required: false, nullable: true }) close: number | null
  @ApiProperty({ required: false, nullable: true, description: '主力净流入（万元）' }) mainNetAmount: number | null
  @ApiProperty({ required: false, nullable: true, description: '主力净流入占比（%）' })
  mainNetAmountRate: number | null
  @ApiProperty({ required: false, nullable: true, description: '散户净流入（万元）' }) retailNetAmount: number | null
}

export class StockMainMoneyFlowDataDto {
  @ApiProperty() tsCode: string
  @ApiProperty({ type: StockMainMoneyFlowSummaryDto }) summary: StockMainMoneyFlowSummaryDto
  @ApiProperty({ type: [StockMainMoneyFlowItemDto] }) items: StockMainMoneyFlowItemDto[]
}

// ─── 股本结构 ─────────────────────────────────────────────────────────────────

export class StockShareCapitalLatestDto {
  @ApiProperty({ description: '总股本（万股）' }) totalShare: number
  @ApiProperty({ description: '流通股本（万股）' }) floatShare: number
  @ApiProperty({ description: '自由流通股（万股）' }) freeShare: number
  @ApiProperty({ description: '限售股（万股）' }) restrictedShare: number
  @ApiProperty({ description: '数据日期' }) announceDate: Date
}

export class StockShareCapitalHistoryItemDto {
  @ApiProperty() changeDate: Date
  @ApiProperty({ required: false, nullable: true }) totalShare: number | null
  @ApiProperty({ required: false, nullable: true }) floatShare: number | null
  @ApiProperty() changeReason: string
}

export class StockShareCapitalDataDto {
  @ApiProperty() tsCode: string
  @ApiProperty({ type: StockShareCapitalLatestDto, nullable: true }) latest: StockShareCapitalLatestDto | null
  @ApiProperty({ type: [StockShareCapitalHistoryItemDto] }) history: StockShareCapitalHistoryItemDto[]
}

// ─── 融资记录 ─────────────────────────────────────────────────────────────────

export class StockFinancingItemDto {
  @ApiProperty({ description: '融资类型，如"配股"' }) eventType: string
  @ApiProperty({ required: false, nullable: true, description: '公告日' }) announceDate: Date | null
  @ApiProperty({ required: false, nullable: true, description: '融资金额（元）' }) amount: number | null
  @ApiProperty({ required: false, nullable: true, description: '发行价（元）' }) price: number | null
  @ApiProperty({ required: false, nullable: true, description: '发行股数（万股）' }) shares: number | null
  @ApiProperty({ required: false, nullable: true, description: '状态描述' }) status: string | null
}

export class StockFinancingDataDto {
  @ApiProperty() tsCode: string
  @ApiProperty({ type: [StockFinancingItemDto] }) items: StockFinancingItemDto[]
}
