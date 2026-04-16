import { ApiProperty } from '@nestjs/swagger'
import { ScreenerSortBy } from './stock-screener-query.dto'

export class StockListItemDto {
  @ApiProperty({ example: '000001.SZ' }) tsCode: string
  @ApiProperty({ example: '000001', required: false, nullable: true }) symbol: string | null
  @ApiProperty({ example: '平安银行', required: false, nullable: true }) name: string | null
  @ApiProperty({ example: '平安银行股份有限公司', required: false, nullable: true }) fullname: string | null
  @ApiProperty({ example: 'SZSE', required: false, nullable: true }) exchange: string | null
  @ApiProperty({ example: 'CNY', required: false, nullable: true }) currType: string | null
  @ApiProperty({ example: '主板', required: false, nullable: true }) market: string | null
  @ApiProperty({ example: '银行', required: false, nullable: true }) industry: string | null
  @ApiProperty({ example: '广东', required: false, nullable: true }) area: string | null
  @ApiProperty({ example: 'L', required: false, nullable: true }) listStatus: string | null
  @ApiProperty({ example: '1991-04-03', required: false, nullable: true }) listDate: Date | null
  @ApiProperty({ example: '2024-03-20', required: false, nullable: true }) latestTradeDate: Date | null
  @ApiProperty({ example: 5.8, required: false, nullable: true, description: 'TTM 市盈率' }) peTtm: number | null
  @ApiProperty({ example: 0.62, required: false, nullable: true, description: '市净率' }) pb: number | null
  @ApiProperty({ example: 5.2, required: false, nullable: true, description: 'TTM 股息率（%）' }) dvTtm: number | null
  @ApiProperty({ example: 2880000, required: false, nullable: true, description: '总市值（万元）' }) totalMv:
    | number
    | null
  @ApiProperty({ example: 1920000, required: false, nullable: true, description: '流通市值（万元）' }) circMv:
    | number
    | null
  @ApiProperty({ example: 1.23, required: false, nullable: true, description: '换手率（%）' }) turnoverRate:
    | number
    | null
  @ApiProperty({ example: 1.5, required: false, nullable: true, description: '涨跌幅（%）' }) pctChg: number | null
  @ApiProperty({ example: 980000, required: false, nullable: true, description: '成交额（千元）' }) amount:
    | number
    | null
  @ApiProperty({ example: 13.2, required: false, nullable: true, description: '收盘价（元）' }) close: number | null
}

export class StockListDataDto {
  @ApiProperty({ example: 1 }) page: number
  @ApiProperty({ example: 20 }) pageSize: number
  @ApiProperty({ example: 5372, description: '符合条件的总股票数' }) total: number
  @ApiProperty({ type: [StockListItemDto] })
  items: StockListItemDto[]
}

export class StockSearchItemDto {
  @ApiProperty({ example: '000001.SZ' }) tsCode: string
  @ApiProperty({ example: '000001', required: false, nullable: true }) symbol: string | null
  @ApiProperty({ example: '平安银行', required: false, nullable: true }) name: string | null
  @ApiProperty({ example: 'SZSE', required: false, nullable: true }) exchange: string | null
  @ApiProperty({ example: '主板', required: false, nullable: true }) market: string | null
  @ApiProperty({ example: '银行', required: false, nullable: true }) industry: string | null
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
  @ApiProperty({ example: '2024-03-20' }) tradeDate: Date
  @ApiProperty({ example: 12.8, required: false, nullable: true }) open: number | null
  @ApiProperty({ example: 13.5, required: false, nullable: true }) high: number | null
  @ApiProperty({ example: 12.75, required: false, nullable: true }) low: number | null
  @ApiProperty({ example: 13.2, required: false, nullable: true }) close: number | null
  @ApiProperty({ example: 1234567, required: false, nullable: true, description: '成交量（手）' }) vol: number | null
  @ApiProperty({ example: 980000, required: false, nullable: true, description: '成交额（千元）' }) amount:
    | number
    | null
  @ApiProperty({ example: 1.5, required: false, nullable: true, description: '涨跌幅（%）' }) pctChg: number | null
  @ApiProperty({ example: 12.9, required: false, nullable: true, description: '5日均线' }) ma5: number | null
  @ApiProperty({ example: 12.6, required: false, nullable: true, description: '10日均线' }) ma10: number | null
  @ApiProperty({ example: 12.3, required: false, nullable: true, description: '20日均线' }) ma20: number | null
}

export class StockChartDataDto {
  @ApiProperty({ example: '000001.SZ' }) tsCode: string
  @ApiProperty({ example: 'daily', description: 'daily | weekly | monthly' }) period: string
  @ApiProperty({ example: 'qfq', description: 'none | qfq | hfq' }) adjustType: string
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
  @ApiProperty({ required: false, nullable: true, description: '总股本（万股）' }) totalShare: number | null
  @ApiProperty({ required: false, nullable: true, description: '流通股本（万股）' }) floatShare: number | null
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
  @ApiProperty({ required: false, nullable: true, description: '营业总收入（元）' }) totalRevenue: number | null
  @ApiProperty({ required: false, nullable: true, description: '营业收入（元）' }) revenue: number | null
  @ApiProperty({ required: false, nullable: true, description: '营业利润（元）' }) operateProfit: number | null
  @ApiProperty({ required: false, nullable: true, description: '利润总额（元）' }) totalProfit: number | null
  @ApiProperty({ required: false, nullable: true, description: '净利润（含少数股东损益，元）' }) nIncome: number | null
  @ApiProperty({ required: false, nullable: true, description: '净利润（不含少数股东损益，元）' }) nIncomeAttrP:
    | number
    | null
  @ApiProperty({ required: false, nullable: true, description: '基本每股收益（元/股）' }) basicEps: number | null
  @ApiProperty({ required: false, nullable: true, description: '销售费用（元）' }) sellExp: number | null
  @ApiProperty({ required: false, nullable: true, description: '管理费用（元）' }) adminExp: number | null
  @ApiProperty({ required: false, nullable: true, description: '财务费用（元）' }) finExp: number | null
  @ApiProperty({ required: false, nullable: true, description: '研发费用（元）' }) rdExp: number | null
  @ApiProperty({ required: false, nullable: true, description: '息税前利润（元）' }) ebit: number | null
  @ApiProperty({ required: false, nullable: true, description: '息税折旧摊销前利润（元）' }) ebitda: number | null
  @ApiProperty({ required: false, nullable: true, description: '营业总收入同比（%）' }) totalRevenueYoy: number | null
  @ApiProperty({ required: false, nullable: true, description: '净利润同比（%）' }) nIncomeYoy: number | null
  @ApiProperty({ required: false, nullable: true, description: '营业利润同比（%）' }) operateProfitYoy: number | null
}

export class BalanceSheetItemDto {
  @ApiProperty({ description: '报告期' }) endDate: Date
  @ApiProperty({ required: false, nullable: true }) annDate: Date | null
  @ApiProperty({ required: false, nullable: true }) reportType: string | null
  @ApiProperty({ required: false, nullable: true, description: '资产总计（元）' }) totalAssets: number | null
  @ApiProperty({ required: false, nullable: true, description: '流动资产合计（元）' }) totalCurAssets: number | null
  @ApiProperty({ required: false, nullable: true, description: '非流动资产合计（元）' }) totalNca: number | null
  @ApiProperty({ required: false, nullable: true, description: '货币资金（元）' }) moneyCap: number | null
  @ApiProperty({ required: false, nullable: true, description: '存货（元）' }) inventories: number | null
  @ApiProperty({ required: false, nullable: true, description: '应收账款（元）' }) accountsReceiv: number | null
  @ApiProperty({ required: false, nullable: true, description: '负债合计（元）' }) totalLiab: number | null
  @ApiProperty({ required: false, nullable: true, description: '流动负债合计（元）' }) totalCurLiab: number | null
  @ApiProperty({ required: false, nullable: true, description: '非流动负债合计（元）' }) totalNcl: number | null
  @ApiProperty({ required: false, nullable: true, description: '短期借款（元）' }) stBorr: number | null
  @ApiProperty({ required: false, nullable: true, description: '长期借款（元）' }) ltBorr: number | null
  @ApiProperty({ required: false, nullable: true, description: '股东权益合计（不含少数股东权益，元）' })
  totalHldrEqyExcMinInt: number | null
  @ApiProperty({ required: false, nullable: true, description: '股东权益合计（含少数股东权益，元）' })
  totalHldrEqyIncMinInt: number | null
  @ApiProperty({ required: false, nullable: true, description: '资产总计同比（%）' }) totalAssetsYoy: number | null
  @ApiProperty({ required: false, nullable: true, description: '股东权益同比（%）' }) equityYoy: number | null
}

export class CashflowItemDto {
  @ApiProperty({ description: '报告期' }) endDate: Date
  @ApiProperty({ required: false, nullable: true }) annDate: Date | null
  @ApiProperty({ required: false, nullable: true }) reportType: string | null
  @ApiProperty({ required: false, nullable: true, description: '经营活动产生的现金流量净额（元）' }) nCashflowAct:
    | number
    | null
  @ApiProperty({ required: false, nullable: true, description: '投资活动产生的现金流量净额（元）' }) nCashflowInvAct:
    | number
    | null
  @ApiProperty({ required: false, nullable: true, description: '筹资活动产生的现金流量净额（元）' }) nCashFlowsFncAct:
    | number
    | null
  @ApiProperty({ required: false, nullable: true, description: '企业自由现金流量（元）' }) freeCashflow: number | null
  @ApiProperty({ required: false, nullable: true, description: '现金及现金等价物净增加额（元）' }) nIncrCashCashEqu:
    | number
    | null
  @ApiProperty({ required: false, nullable: true, description: '销售商品、提供劳务收到的现金（元）' }) cFrSaleSg:
    | number
    | null
  @ApiProperty({ required: false, nullable: true, description: '购买商品、接受劳务支付的现金（元）' }) cPaidGoodsS:
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

// ─── 选股器 ───────────────────────────────────────────────────────────────────

export class StockScreenerItemDto {
  @ApiProperty() tsCode: string
  @ApiProperty({ required: false, nullable: true }) name: string | null
  @ApiProperty({ required: false, nullable: true }) industry: string | null
  @ApiProperty({ required: false, nullable: true }) market: string | null
  @ApiProperty({ required: false, nullable: true }) listDate: string | null

  @ApiProperty({ required: false, nullable: true, description: '收盘价' }) close: number | null
  @ApiProperty({ required: false, nullable: true, description: '涨跌幅（%）' }) pctChg: number | null
  @ApiProperty({ required: false, nullable: true, description: '成交额（千元）' }) amount: number | null
  @ApiProperty({ required: false, nullable: true, description: '换手率（%）' }) turnoverRate: number | null

  @ApiProperty({ required: false, nullable: true, description: '市盈率 TTM' }) peTtm: number | null
  @ApiProperty({ required: false, nullable: true, description: '市净率 PB' }) pb: number | null
  @ApiProperty({ required: false, nullable: true, description: '股息率 TTM（%）' }) dvTtm: number | null
  @ApiProperty({ required: false, nullable: true, description: '总市值（万元）' }) totalMv: number | null
  @ApiProperty({ required: false, nullable: true, description: '流通市值（万元）' }) circMv: number | null

  @ApiProperty({ required: false, nullable: true, description: '营收同比增速（%）' }) revenueYoy: number | null
  @ApiProperty({ required: false, nullable: true, description: '净利润同比增速（%）' }) netprofitYoy: number | null

  @ApiProperty({ required: false, nullable: true, description: 'ROE（%）' }) roe: number | null
  @ApiProperty({ required: false, nullable: true, description: '毛利率（%）' }) grossMargin: number | null
  @ApiProperty({ required: false, nullable: true, description: '净利率（%）' }) netMargin: number | null

  @ApiProperty({ required: false, nullable: true, description: '资产负债率（%）' }) debtToAssets: number | null
  @ApiProperty({ required: false, nullable: true, description: '流动比率' }) currentRatio: number | null
  @ApiProperty({ required: false, nullable: true, description: '速动比率' }) quickRatio: number | null

  @ApiProperty({ required: false, nullable: true, description: '经营现金流/净利润' }) ocfToNetprofit: number | null

  @ApiProperty({ required: false, nullable: true, description: '近5日主力净流入（万元）' }) mainNetInflow5d:
    | number
    | null
  @ApiProperty({ required: false, nullable: true, description: '近20日主力净流入（万元）' }) mainNetInflow20d:
    | number
    | null

  @ApiProperty({ required: false, nullable: true, description: '最新财报期（如 2025-09-30）' }) latestFinDate:
    | string
    | null
}

export class StockScreenerDataDto {
  @ApiProperty() page: number
  @ApiProperty() pageSize: number
  @ApiProperty() total: number
  @ApiProperty({ type: [StockScreenerItemDto] }) items: StockScreenerItemDto[]
}

export class IndustryItemDto {
  @ApiProperty({ description: '行业名称' }) name: string
  @ApiProperty({ description: '该行业上市股票数' }) count: number
}

export class IndustryListDataDto {
  @ApiProperty({ type: [IndustryItemDto] }) industries: IndustryItemDto[]
}

export class AreaItemDto {
  @ApiProperty({ description: '地域名称' }) name: string
  @ApiProperty({ description: '该地域上市股票数' }) count: number
}

export class AreaListDataDto {
  @ApiProperty({ type: [AreaItemDto] }) areas: AreaItemDto[]
}

export class ScreenerPresetFilterDto {
  @ApiProperty({ type: 'object', additionalProperties: true }) filters: Record<string, unknown>
}

export class ScreenerPresetItemDto {
  @ApiProperty() id: string
  @ApiProperty() name: string
  @ApiProperty() description: string
  @ApiProperty({ type: 'object', additionalProperties: true }) filters: Record<string, unknown>
  @ApiProperty({ enum: ['builtin'], description: '策略类型：内置预设' }) type: 'builtin'
}

export class ScreenerPresetDataDto {
  @ApiProperty({ type: [ScreenerPresetItemDto] }) presets: ScreenerPresetItemDto[]
}

export class ScreenerStrategyDto {
  @ApiProperty() id: number
  @ApiProperty() name: string
  @ApiProperty({ required: false, nullable: true }) description: string | null
  @ApiProperty({ type: 'object', additionalProperties: true }) filters: Record<string, unknown>
  @ApiProperty({ required: false, nullable: true, enum: ScreenerSortBy }) sortBy: ScreenerSortBy | null
  @ApiProperty({ required: false, nullable: true, enum: ['asc', 'desc'] }) sortOrder: 'asc' | 'desc' | null
  @ApiProperty({ description: '创建时间（ISO 8601）' }) createdAt: string
  @ApiProperty({ description: '更新时间（ISO 8601）' }) updatedAt: string
}

export class ScreenerStrategyListItemDto extends ScreenerStrategyDto {
  @ApiProperty({ enum: ['user'], description: '策略类型：用户自定义策略' }) type: 'user'
}

export class ScreenerStrategyDataDto extends ScreenerStrategyDto {}

export class ScreenerStrategyListDataDto {
  @ApiProperty({ type: [ScreenerStrategyListItemDto] }) strategies: ScreenerStrategyListItemDto[]
}

export class ScreenerStrategyDeleteDataDto {
  @ApiProperty() message: string
}

// ─── 分析 Tab — 技术指标 ──────────────────────────────────────────────────────

export class TechnicalDataPointDto {
  @ApiProperty() tradeDate: string
  @ApiProperty({ required: false, nullable: true }) open: number | null
  @ApiProperty({ required: false, nullable: true }) high: number | null
  @ApiProperty({ required: false, nullable: true }) low: number | null
  @ApiProperty({ required: false, nullable: true }) close: number | null
  @ApiProperty({ required: false, nullable: true, description: '成交量（手）' }) vol: number | null
  @ApiProperty({ required: false, nullable: true, description: '成交额（千元）' }) amount: number | null
  @ApiProperty({ required: false, nullable: true }) pctChg: number | null

  // 均线
  @ApiProperty({ required: false, nullable: true }) ma5: number | null
  @ApiProperty({ required: false, nullable: true }) ma10: number | null
  @ApiProperty({ required: false, nullable: true }) ma20: number | null
  @ApiProperty({ required: false, nullable: true }) ma60: number | null
  @ApiProperty({ required: false, nullable: true }) ma120: number | null
  @ApiProperty({ required: false, nullable: true }) ma250: number | null
  @ApiProperty({ required: false, nullable: true }) ema12: number | null
  @ApiProperty({ required: false, nullable: true }) ema26: number | null

  // MACD
  @ApiProperty({ required: false, nullable: true }) macdDif: number | null
  @ApiProperty({ required: false, nullable: true }) macdDea: number | null
  @ApiProperty({ required: false, nullable: true }) macdHist: number | null

  // KDJ
  @ApiProperty({ required: false, nullable: true }) kdjK: number | null
  @ApiProperty({ required: false, nullable: true }) kdjD: number | null
  @ApiProperty({ required: false, nullable: true }) kdjJ: number | null

  // RSI
  @ApiProperty({ required: false, nullable: true }) rsi6: number | null
  @ApiProperty({ required: false, nullable: true }) rsi12: number | null
  @ApiProperty({ required: false, nullable: true }) rsi24: number | null

  // BOLL
  @ApiProperty({ required: false, nullable: true }) bollUpper: number | null
  @ApiProperty({ required: false, nullable: true }) bollMid: number | null
  @ApiProperty({ required: false, nullable: true }) bollLower: number | null

  // WR
  @ApiProperty({ required: false, nullable: true }) wr6: number | null
  @ApiProperty({ required: false, nullable: true }) wr10: number | null

  // CCI
  @ApiProperty({ required: false, nullable: true }) cci: number | null

  // DMI
  @ApiProperty({ required: false, nullable: true }) dmiPdi: number | null
  @ApiProperty({ required: false, nullable: true }) dmiMdi: number | null
  @ApiProperty({ required: false, nullable: true }) dmiAdx: number | null
  @ApiProperty({ required: false, nullable: true }) dmiAdxr: number | null

  // TRIX
  @ApiProperty({ required: false, nullable: true }) trix: number | null
  @ApiProperty({ required: false, nullable: true }) trixMa: number | null

  // DMA
  @ApiProperty({ required: false, nullable: true }) dma: number | null
  @ApiProperty({ required: false, nullable: true }) dmaMa: number | null

  // BIAS
  @ApiProperty({ required: false, nullable: true }) bias6: number | null
  @ApiProperty({ required: false, nullable: true }) bias12: number | null
  @ApiProperty({ required: false, nullable: true }) bias24: number | null

  // OBV
  @ApiProperty({ required: false, nullable: true }) obv: number | null
  @ApiProperty({ required: false, nullable: true }) obvMa: number | null

  // VR
  @ApiProperty({ required: false, nullable: true }) vr: number | null

  // EMV
  @ApiProperty({ required: false, nullable: true }) emv: number | null
  @ApiProperty({ required: false, nullable: true }) emvMa: number | null

  // ROC
  @ApiProperty({ required: false, nullable: true }) roc: number | null
  @ApiProperty({ required: false, nullable: true }) rocMa: number | null

  // PSY
  @ApiProperty({ required: false, nullable: true }) psy: number | null
  @ApiProperty({ required: false, nullable: true }) psyMa: number | null

  // BRAR
  @ApiProperty({ required: false, nullable: true }) br: number | null
  @ApiProperty({ required: false, nullable: true }) ar: number | null

  // CR
  @ApiProperty({ required: false, nullable: true }) cr: number | null

  // SAR
  @ApiProperty({ required: false, nullable: true }) sar: number | null
  @ApiProperty({ required: false, nullable: true }) sarBullish: boolean | null

  // 量价
  @ApiProperty({ required: false, nullable: true }) volMa5: number | null
  @ApiProperty({ required: false, nullable: true }) volMa10: number | null
  @ApiProperty({ required: false, nullable: true }) volMa20: number | null
  @ApiProperty({ required: false, nullable: true }) volumeRatio: number | null

  // 波动率
  @ApiProperty({ required: false, nullable: true }) atr14: number | null
  @ApiProperty({ required: false, nullable: true }) hv20: number | null
}

export class MaStatusSummaryDto {
  @ApiProperty({ required: false, nullable: true, description: 'MA5>MA10>MA20>MA60 多头排列' }) bullishAlign:
    | boolean
    | null
  @ApiProperty({ required: false, nullable: true, description: 'MA5<MA10<MA20<MA60 空头排列' }) bearishAlign:
    | boolean
    | null
  @ApiProperty({ required: false, nullable: true, description: '价格站上 MA20' }) aboveMa20: boolean | null
  @ApiProperty({ required: false, nullable: true, description: '价格站上 MA60' }) aboveMa60: boolean | null
  @ApiProperty({ required: false, nullable: true, description: '价格站上 MA250（年线）' }) aboveMa250: boolean | null
  @ApiProperty({ required: false, nullable: true, description: '最近均线金叉/死叉事件' }) latestCross: string | null
}

export class SignalSummaryDto {
  @ApiProperty({ required: false, nullable: true }) macd: string | null
  @ApiProperty({ required: false, nullable: true }) kdj: string | null
  @ApiProperty({ required: false, nullable: true }) rsi: string | null
  @ApiProperty({ required: false, nullable: true }) boll: string | null
  @ApiProperty({ required: false, nullable: true }) wr: string | null
  @ApiProperty({ required: false, nullable: true }) cci: string | null
  @ApiProperty({ required: false, nullable: true }) dmi: string | null
  @ApiProperty({ required: false, nullable: true }) sar: string | null
  @ApiProperty({ required: false, nullable: true }) volumePrice: string | null
}

export class StockTechnicalDataDto {
  @ApiProperty() tsCode: string
  @ApiProperty() period: string
  @ApiProperty({ required: false, nullable: true }) dataDate: string | null
  @ApiProperty({ type: MaStatusSummaryDto }) maStatus: MaStatusSummaryDto
  @ApiProperty({ type: SignalSummaryDto }) signals: SignalSummaryDto
  @ApiProperty({ type: [TechnicalDataPointDto] }) history: TechnicalDataPointDto[]
}

// ─── 分析 Tab — 择时信号 ──────────────────────────────────────────────────────

export class TimingSignalItemDto {
  @ApiProperty() tradeDate: string
  @ApiProperty({ enum: ['buy', 'sell', 'warning'] }) type: string
  @ApiProperty({ description: '信号强度 1-5' }) strength: number
  @ApiProperty({ description: '信号来源指标' }) source: string
  @ApiProperty({ description: '信号描述（中文）' }) description: string
  @ApiProperty({ required: false, nullable: true }) closePrice: number | null
}

export class TimingScoreDetailDto {
  @ApiProperty() indicator: string
  @ApiProperty({ enum: ['bullish', 'bearish', 'neutral'] }) signal: string
  @ApiProperty({ description: '分数 0-100' }) score: number
  @ApiProperty() reason: string
}

export class TimingScoreSummaryDto {
  @ApiProperty({ description: '综合择时评分 0-100' }) score: number
  @ApiProperty({ description: '评级' }) rating: string
  @ApiProperty() bullishCount: number
  @ApiProperty() bearishCount: number
  @ApiProperty() neutralCount: number
  @ApiProperty({ type: [TimingScoreDetailDto] }) details: TimingScoreDetailDto[]
}

export class StockTimingSignalsDataDto {
  @ApiProperty() tsCode: string
  @ApiProperty({ type: TimingScoreSummaryDto }) scoreSummary: TimingScoreSummaryDto
  @ApiProperty({ type: [TimingSignalItemDto] }) signals: TimingSignalItemDto[]
}

// ─── 分析 Tab — 筹码分布 ──────────────────────────────────────────────────────

export class ChipConcentrationDto {
  @ApiProperty({ required: false, nullable: true }) range90Low: number | null
  @ApiProperty({ required: false, nullable: true }) range90High: number | null
  @ApiProperty({ required: false, nullable: true }) range70Low: number | null
  @ApiProperty({ required: false, nullable: true }) range70High: number | null
  @ApiProperty({ required: false, nullable: true, description: '集中度评分 0-100' }) score: number | null
  @ApiProperty({ required: false, nullable: true, description: '获利比例 (%)' }) profitRatio: number | null
  @ApiProperty({ required: false, nullable: true, description: '平均成本' }) avgCost: number | null
}

export class ChipDistributionBinDto {
  @ApiProperty() priceLow: number
  @ApiProperty() priceHigh: number
  @ApiProperty({ description: '筹码占比 (0-100%)' }) percent: number
  @ApiProperty({ description: '是否在当前价格之下（获利盘）' }) isProfit: boolean
}

export class ChipKeyLevelsDto {
  @ApiProperty({ required: false, nullable: true }) peakPrice: number | null
  @ApiProperty({ required: false, nullable: true }) resistanceHigh: number | null
  @ApiProperty({ required: false, nullable: true }) resistanceLow: number | null
  @ApiProperty({ required: false, nullable: true }) supportHigh: number | null
  @ApiProperty({ required: false, nullable: true }) supportLow: number | null
}

export class ChipDistributionDataDto {
  @ApiProperty() tsCode: string
  @ApiProperty() tradeDate: string
  @ApiProperty({ required: false, nullable: true }) currentPrice: number | null
  @ApiProperty({ type: ChipConcentrationDto }) concentration: ChipConcentrationDto
  @ApiProperty({ type: [ChipDistributionBinDto] }) distribution: ChipDistributionBinDto[]
  @ApiProperty({ type: ChipKeyLevelsDto }) keyLevels: ChipKeyLevelsDto
  @ApiProperty({ description: '是否为估算数据（非 Tushare cyq 真实数据）' }) isEstimated: boolean
}

// ─── 分析 Tab — 融资融券 ──────────────────────────────────────────────────────

export class MarginDailyItemDto {
  @ApiProperty() tradeDate: string
  @ApiProperty({ required: false, nullable: true, description: '融资余额（元）' }) rzye: number | null
  @ApiProperty({ required: false, nullable: true, description: '融资买入额（元）' }) rzmre: number | null
  @ApiProperty({ required: false, nullable: true, description: '融资偿还额（元）' }) rzche: number | null
  @ApiProperty({ required: false, nullable: true, description: '融资净买入（元）' }) rzjmre: number | null
  @ApiProperty({ required: false, nullable: true, description: '融券余额（元）' }) rqye: number | null
  @ApiProperty({ required: false, nullable: true, description: '融券卖出量（股）' }) rqmcl: number | null
  @ApiProperty({ required: false, nullable: true, description: '融券偿还量（股）' }) rqchl: number | null
  @ApiProperty({ required: false, nullable: true, description: '融资融券余额合计（元）' }) rzrqye: number | null
  @ApiProperty({ required: false, nullable: true, description: '收盘价' }) close: number | null
}

export class MarginSummaryDto {
  @ApiProperty({ required: false, nullable: true }) latestRzye: number | null
  @ApiProperty({ required: false, nullable: true }) latestRqye: number | null
  @ApiProperty({ required: false, nullable: true }) latestRzrqye: number | null
  @ApiProperty({ required: false, nullable: true, description: '5日融资净买入累计（元）' }) rzNetBuy5d: number | null
  @ApiProperty({ required: false, nullable: true, description: '20日融资净买入累计（元）' }) rzNetBuy20d: number | null
  @ApiProperty({ required: false, nullable: true, description: '融资余额5日变化率(%)' }) rzye5dChgPct: number | null
  @ApiProperty({ required: false, nullable: true, description: '融资余额20日变化率(%)' }) rzye20dChgPct: number | null
  @ApiProperty({ enum: ['increasing', 'decreasing', 'stable'] }) trend: string
}

export class StockMarginDataResponseDto {
  @ApiProperty() tsCode: string
  @ApiProperty({ type: MarginSummaryDto }) summary: MarginSummaryDto
  @ApiProperty({ type: [MarginDailyItemDto] }) history: MarginDailyItemDto[]
  @ApiProperty({ description: '数据是否可用（Tushare 积分不足时为 false）' }) available: boolean
}

// ─── 分析 Tab — 相对强弱 ──────────────────────────────────────────────────────

export class RelativeStrengthPointDto {
  @ApiProperty() tradeDate: string
  @ApiProperty({ description: '个股累计涨跌幅 (%)' }) stockCumReturn: number
  @ApiProperty({ description: '基准指数累计涨跌幅 (%)' }) benchmarkCumReturn: number
  @ApiProperty({ description: '超额收益 = stock - benchmark' }) excessReturn: number
  @ApiProperty({ description: '相对强弱比率（归一化）' }) rsRatio: number
}

export class RelativeStrengthSummaryDto {
  @ApiProperty({ required: false, nullable: true, description: '期间个股累计涨跌幅 (%)' }) stockTotalReturn:
    | number
    | null
  @ApiProperty({ required: false, nullable: true, description: '期间基准累计涨跌幅 (%)' }) benchmarkTotalReturn:
    | number
    | null
  @ApiProperty({ required: false, nullable: true, description: '超额收益 (%)' }) excessReturn: number | null
  @ApiProperty({ required: false, nullable: true, description: '最近20日超额收益 (%)' }) excess20d: number | null
  @ApiProperty({ required: false, nullable: true, description: '年化波动率 (%)' }) annualizedVol: number | null
  @ApiProperty({ required: false, nullable: true, description: '最大回撤 (%)' }) maxDrawdown: number | null
  @ApiProperty({ required: false, nullable: true, description: 'Beta（相对基准）' }) beta: number | null
  @ApiProperty({ required: false, nullable: true, description: '信息比率' }) informationRatio: number | null
}

export class StockRelativeStrengthDataDto {
  @ApiProperty() tsCode: string
  @ApiProperty() benchmarkCode: string
  @ApiProperty() benchmarkName: string
  @ApiProperty({ type: RelativeStrengthSummaryDto }) summary: RelativeStrengthSummaryDto
  @ApiProperty({ type: [RelativeStrengthPointDto] }) history: RelativeStrengthPointDto[]
}

export class StockConceptItemDto {
  @ApiProperty() tsCode: string
  @ApiProperty() name: string
}

export class StockConceptsDataDto {
  @ApiProperty() tsCode: string
  @ApiProperty({ required: false, nullable: true }) name: string | null
  @ApiProperty({ type: [StockConceptItemDto] }) concepts: StockConceptItemDto[]
}

// ─── 技术因子（预计算）响应 DTO ───────────────────────────────────────────────

export class StkFactorDataPointDto {
  @ApiProperty() tradeDate: string
  @ApiProperty({ required: false, nullable: true }) close: number | null

  // ── MACD ──
  @ApiProperty({ required: false, nullable: true }) macdDif: number | null
  @ApiProperty({ required: false, nullable: true }) macdDea: number | null
  @ApiProperty({ required: false, nullable: true }) macd: number | null

  // ── KDJ ──
  @ApiProperty({ required: false, nullable: true }) kdjK: number | null
  @ApiProperty({ required: false, nullable: true }) kdjD: number | null
  @ApiProperty({ required: false, nullable: true }) kdjJ: number | null

  // ── RSI ──
  @ApiProperty({ required: false, nullable: true }) rsi6: number | null
  @ApiProperty({ required: false, nullable: true }) rsi12: number | null
  @ApiProperty({ required: false, nullable: true }) rsi24: number | null

  // ── 布林带 ──
  @ApiProperty({ required: false, nullable: true }) bollUpper: number | null
  @ApiProperty({ required: false, nullable: true }) bollMid: number | null
  @ApiProperty({ required: false, nullable: true }) bollLower: number | null

  // ── CCI ──
  @ApiProperty({ required: false, nullable: true }) cci14: number | null
  @ApiProperty({ required: false, nullable: true }) cci20: number | null

  // ── ATR / 波动率 ──
  @ApiProperty({ required: false, nullable: true }) atr14: number | null
  @ApiProperty({ required: false, nullable: true }) atr20: number | null

  // ── VR ──
  @ApiProperty({ required: false, nullable: true }) vr26: number | null
}

export class StockTechnicalFactorsDataDto {
  @ApiProperty() tsCode: string
  @ApiProperty() count: number
  @ApiProperty({ type: [StkFactorDataPointDto] }) items: StkFactorDataPointDto[]
}

export class StockLatestFactorsDataDto {
  @ApiProperty() tsCode: string
  @ApiProperty({ required: false, nullable: true }) tradeDate: string | null
  @ApiProperty({ required: false, nullable: true }) close: number | null

  @ApiProperty({
    required: false,
    nullable: true,
    enum: ['golden_cross', 'death_cross', 'above_zero', 'below_zero'],
  })
  macdSignal: string | null

  @ApiProperty({
    required: false,
    nullable: true,
    enum: ['golden_cross', 'death_cross', 'overbought', 'oversold'],
  })
  kdjSignal: string | null

  @ApiProperty({ required: false, nullable: true, enum: ['overbought', 'oversold', 'neutral'] })
  rsiSignal: string | null

  @ApiProperty({
    required: false,
    nullable: true,
    enum: ['above_upper', 'near_upper', 'middle', 'near_lower', 'below_lower'],
  })
  bollPosition: string | null

  @ApiProperty({ type: StkFactorDataPointDto, required: false, nullable: true })
  raw: StkFactorDataPointDto | null
}
