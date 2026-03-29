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
  @ApiProperty({ description: '5日净流入额（万元）' }) netMfAmount5d: number
  @ApiProperty({ description: '20日净流入额（万元）' }) netMfAmount20d: number
  @ApiProperty({ description: '60日净流入额（万元）' }) netMfAmount60d: number
}

export class StockMoneyFlowItemDto {
  @ApiProperty() tradeDate: Date
  @ApiProperty({ required: false, nullable: true, description: '收盘价' }) close: number | null
  @ApiProperty({ required: false, nullable: true, description: '涨跌幅（%）' }) pctChg: number | null
  @ApiProperty({ required: false, nullable: true, description: '净流入额（万元）' }) netMfAmount: number | null
  @ApiProperty({ required: false, nullable: true, description: '特大单买入（万元）' }) buyElgAmount: number | null
  @ApiProperty({ required: false, nullable: true, description: '特大单卖出（万元）' }) sellElgAmount: number | null
  @ApiProperty({ required: false, nullable: true, description: '大单买入（万元）' }) buyLgAmount: number | null
  @ApiProperty({ required: false, nullable: true, description: '大单卖出（万元）' }) sellLgAmount: number | null
  @ApiProperty({ required: false, nullable: true, description: '中单买入（万元）' }) buyMdAmount: number | null
  @ApiProperty({ required: false, nullable: true, description: '中单卖出（万元）' }) sellMdAmount: number | null
  @ApiProperty({ required: false, nullable: true, description: '小单买入（万元）' }) buySmAmount: number | null
  @ApiProperty({ required: false, nullable: true, description: '小单卖出（万元）' }) sellSmAmount: number | null
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

export class StockHolderItemDto {
  @ApiProperty() holderName: string
  @ApiProperty({ required: false, nullable: true, description: '持股数量（股）' }) holdAmount: number | null
  @ApiProperty({ required: false, nullable: true, description: '持股比例（%）' }) holdRatio: number | null
  @ApiProperty({ required: false, nullable: true, description: '占流通股比例（%）' }) holdFloatRatio: number | null
  @ApiProperty({ required: false, nullable: true, description: '持股变动（股）' }) holdChange: number | null
  @ApiProperty({ required: false, nullable: true, description: '股东类型' }) holderType: string | null
  @ApiProperty({ required: false, nullable: true, description: '公告日' }) annDate: Date | null
}

export class StockHolderGroupDto {
  @ApiProperty({ required: false, nullable: true, description: '报告期' }) endDate: Date | null
  @ApiProperty({ type: [StockHolderItemDto] }) holders: StockHolderItemDto[]
}

export class StockShareholdersDataDto {
  @ApiProperty() tsCode: string
  @ApiProperty({ type: StockHolderGroupDto }) top10Holders: StockHolderGroupDto
  @ApiProperty({ type: StockHolderGroupDto }) top10FloatHolders: StockHolderGroupDto
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

// ─── 今日资金流（分级别） ─────────────────────────────────────────────────────

export class MoneyFlowTierDto {
  @ApiProperty({ required: false, nullable: true, description: '买入额（万元）' }) buyAmount: number | null
  @ApiProperty({ required: false, nullable: true, description: '卖出额（万元）' }) sellAmount: number | null
  @ApiProperty({ required: false, nullable: true, description: '净流入额（万元）' }) netAmount: number | null
}

export class StockTodayFlowDataDto {
  @ApiProperty() tsCode: string
  @ApiProperty() tradeDate: Date
  @ApiProperty({ type: MoneyFlowTierDto, description: '特大单（≥100万元）' }) superLarge: MoneyFlowTierDto
  @ApiProperty({ type: MoneyFlowTierDto, description: '大单（20~100万元）' }) large: MoneyFlowTierDto
  @ApiProperty({ type: MoneyFlowTierDto, description: '中单（5~20万元）' }) medium: MoneyFlowTierDto
  @ApiProperty({ type: MoneyFlowTierDto, description: '小单（<5万元）' }) small: MoneyFlowTierDto
  @ApiProperty({ type: MoneyFlowTierDto, description: '主力合计（特大单 + 大单）' }) mainForce: MoneyFlowTierDto
  @ApiProperty({ required: false, nullable: true, description: '全市场净流入额（万元，Tushare net_mf_amount）' })
  netMfAmount: number | null
}

// ─── 三大财务报表（利润表 / 资产负债表 / 现金流量表） ──────────────────────────

export class IncomeStatementItemDto {
  @ApiProperty({ description: '报告期' }) endDate: Date
  @ApiProperty({ required: false, nullable: true }) annDate: Date | null
  @ApiProperty({ required: false, nullable: true }) reportType: string | null
  @ApiProperty({ required: false, nullable: true, description: '营业总收入' }) totalRevenue: number | null
  @ApiProperty({ required: false, nullable: true, description: '营业收入' }) revenue: number | null
  @ApiProperty({ required: false, nullable: true, description: '营业利润' }) operateProfit: number | null
  @ApiProperty({ required: false, nullable: true, description: '利润总额' }) totalProfit: number | null
  @ApiProperty({ required: false, nullable: true, description: '净利润（含少数股东损益）' }) nIncome: number | null
  @ApiProperty({ required: false, nullable: true, description: '净利润（不含少数股东损益）' }) nIncomeAttrP:
    | number
    | null
  @ApiProperty({ required: false, nullable: true, description: '基本每股收益' }) basicEps: number | null
  @ApiProperty({ required: false, nullable: true, description: '销售费用' }) sellExp: number | null
  @ApiProperty({ required: false, nullable: true, description: '管理费用' }) adminExp: number | null
  @ApiProperty({ required: false, nullable: true, description: '财务费用' }) finExp: number | null
  @ApiProperty({ required: false, nullable: true, description: '研发费用' }) rdExp: number | null
  @ApiProperty({ required: false, nullable: true, description: '息税前利润' }) ebit: number | null
  @ApiProperty({ required: false, nullable: true, description: '息税折旧摊销前利润' }) ebitda: number | null
  @ApiProperty({ required: false, nullable: true, description: '营业总收入同比（%）' }) totalRevenueYoy: number | null
  @ApiProperty({ required: false, nullable: true, description: '净利润同比（%）' }) nIncomeYoy: number | null
  @ApiProperty({ required: false, nullable: true, description: '营业利润同比（%）' }) operateProfitYoy: number | null
}

export class BalanceSheetItemDto {
  @ApiProperty({ description: '报告期' }) endDate: Date
  @ApiProperty({ required: false, nullable: true }) annDate: Date | null
  @ApiProperty({ required: false, nullable: true }) reportType: string | null
  @ApiProperty({ required: false, nullable: true, description: '资产总计' }) totalAssets: number | null
  @ApiProperty({ required: false, nullable: true, description: '流动资产合计' }) totalCurAssets: number | null
  @ApiProperty({ required: false, nullable: true, description: '非流动资产合计' }) totalNca: number | null
  @ApiProperty({ required: false, nullable: true, description: '货币资金' }) moneyCap: number | null
  @ApiProperty({ required: false, nullable: true, description: '存货' }) inventories: number | null
  @ApiProperty({ required: false, nullable: true, description: '应收账款' }) accountsReceiv: number | null
  @ApiProperty({ required: false, nullable: true, description: '负债合计' }) totalLiab: number | null
  @ApiProperty({ required: false, nullable: true, description: '流动负债合计' }) totalCurLiab: number | null
  @ApiProperty({ required: false, nullable: true, description: '非流动负债合计' }) totalNcl: number | null
  @ApiProperty({ required: false, nullable: true, description: '短期借款' }) stBorr: number | null
  @ApiProperty({ required: false, nullable: true, description: '长期借款' }) ltBorr: number | null
  @ApiProperty({ required: false, nullable: true, description: '股东权益合计（不含少数股东权益）' })
  totalHldrEqyExcMinInt: number | null
  @ApiProperty({ required: false, nullable: true, description: '股东权益合计（含少数股东权益）' })
  totalHldrEqyIncMinInt: number | null
  @ApiProperty({ required: false, nullable: true, description: '资产总计同比（%）' }) totalAssetsYoy: number | null
  @ApiProperty({ required: false, nullable: true, description: '股东权益同比（%）' }) equityYoy: number | null
}

export class CashflowItemDto {
  @ApiProperty({ description: '报告期' }) endDate: Date
  @ApiProperty({ required: false, nullable: true }) annDate: Date | null
  @ApiProperty({ required: false, nullable: true }) reportType: string | null
  @ApiProperty({ required: false, nullable: true, description: '经营活动产生的现金流量净额' }) nCashflowAct:
    | number
    | null
  @ApiProperty({ required: false, nullable: true, description: '投资活动产生的现金流量净额' }) nCashflowInvAct:
    | number
    | null
  @ApiProperty({ required: false, nullable: true, description: '筹资活动产生的现金流量净额' }) nCashFlowsFncAct:
    | number
    | null
  @ApiProperty({ required: false, nullable: true, description: '企业自由现金流量' }) freeCashflow: number | null
  @ApiProperty({ required: false, nullable: true, description: '现金及现金等价物净增加额' }) nIncrCashCashEqu:
    | number
    | null
  @ApiProperty({ required: false, nullable: true, description: '销售商品、提供劳务收到的现金' }) cFrSaleSg:
    | number
    | null
  @ApiProperty({ required: false, nullable: true, description: '购买商品、接受劳务支付的现金' }) cPaidGoodsS:
    | number
    | null
  @ApiProperty({ required: false, nullable: true, description: '经营活动净现金流同比（%）' }) nCashflowActYoy:
    | number
    | null
  @ApiProperty({ required: false, nullable: true, description: '自由现金流同比（%）' }) freeCashflowYoy: number | null
}

export class StockFinancialStatementsDataDto {
  @ApiProperty() tsCode: string
  @ApiProperty({ type: [IncomeStatementItemDto] }) income: IncomeStatementItemDto[]
  @ApiProperty({ type: [BalanceSheetItemDto] }) balanceSheet: BalanceSheetItemDto[]
  @ApiProperty({ type: [CashflowItemDto] }) cashflow: CashflowItemDto[]
}
