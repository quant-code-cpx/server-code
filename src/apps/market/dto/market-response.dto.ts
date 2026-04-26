import { ApiProperty } from '@nestjs/swagger'

/**
 * 单一层级（超大/大/中/小单）或汇总组（主力/散户）的资金流向
 *
 * 注意：buyAmount / sellAmount 是按订单规模分类的买方 / 卖方成交额，
 * 并非「主动买入 / 主动卖出」。每笔成交同时计入买方和卖方，因此
 * 四层 buyAmount 之和 ≈ 四层 sellAmount 之和 ≈ 全市场单边总成交额。
 * netAmount（buy − sell）反映该规模订单的买卖方向偏压，是标准的
 * 「资金流向」展示口径。
 */
export class TierFlowDto {
  @ApiProperty({
    example: 317691000000,
    required: false,
    nullable: true,
    description: '买方订单成交额（元，按订单规模分类，非主动买入）',
  })
  buyAmount: number | null

  @ApiProperty({
    example: 326989000000,
    required: false,
    nullable: true,
    description: '卖方订单成交额（元，按订单规模分类，非主动卖出）',
  })
  sellAmount: number | null

  @ApiProperty({
    example: -9298000000,
    required: false,
    nullable: true,
    description: '净流入 = 买入 - 卖出（元，正=净流入，负=净流出）',
  })
  netAmount: number | null

  @ApiProperty({ example: 13.1, required: false, nullable: true, description: '买入额 / 全市场总成交（%）' })
  buyRate: number | null

  @ApiProperty({ example: 13.5, required: false, nullable: true, description: '卖出额 / 全市场总成交（%）' })
  sellRate: number | null

  @ApiProperty({ example: -0.38, required: false, nullable: true, description: '净流入 / 全市场总成交（%）' })
  netRate: number | null
}

/**
 * 大盘资金流向（单日，基于 THS 个股资金流向全市场汇总）
 *
 * 数据说明：
 * - THS moneyflow 按订单规模将每笔成交分别计入买方和卖方对应层级
 * - buyAmount / sellAmount 是订单规模分类后的成交额，非「主动买入/卖出」
 * - 四层 buyAmount 之和 ≈ 四层 sellAmount 之和 ≈ 全市场单边总成交额（totalAmount）
 * - netAmount = buy − sell：反映该规模订单的买卖方向偏压（正=净流入）
 * - netMfAmount 来自 Tushare 独立逐笔（主动买卖单）计算的净流入额，与分层 netAmount 非同一口径
 * - 数据起始日期 2026-01-15
 */
export class MarketMoneyFlowDto {
  @ApiProperty({ example: '2026-04-17' }) tradeDate: Date

  @ApiProperty({ example: 4051.43, required: false, nullable: true, description: '上证指数收盘点位' }) closeSh:
    | number
    | null
  @ApiProperty({ example: -0.1, required: false, nullable: true, description: '上证指数涨跌幅（%）' }) pctChangeSh:
    | number
    | null
  @ApiProperty({ example: 14885.42, required: false, nullable: true, description: '深证成指收盘点位' }) closeSz:
    | number
    | null
  @ApiProperty({ example: 0.6, required: false, nullable: true, description: '深证成指涨跌幅（%）' }) pctChangeSz:
    | number
    | null

  @ApiProperty({
    example: 2425382634900,
    required: false,
    nullable: true,
    description: '全市场单边总成交金额（元），等于四层买入之和，与 daily.amount 口径一致',
  })
  totalAmount: number | null

  @ApiProperty({
    example: -5833283680000,
    required: false,
    nullable: true,
    description:
      '全市场净流入汇总（元，来自 net_mf_amount 全市场求和；基于主动买卖单统计，与分层 netAmount 非同一口径）',
  })
  netMfAmount: number | null

  @ApiProperty({ type: () => TierFlowDto, description: '主力资金（超大单 + 大单）汇总' })
  main: TierFlowDto

  @ApiProperty({ type: () => TierFlowDto, description: '散户资金（中单 + 小单）汇总' })
  retail: TierFlowDto

  @ApiProperty({ type: () => TierFlowDto, description: '超大单（单笔成交 ≥ 100万元）' })
  elg: TierFlowDto

  @ApiProperty({ type: () => TierFlowDto, description: '大单（单笔 20~100万元）' })
  lg: TierFlowDto

  @ApiProperty({ type: () => TierFlowDto, description: '中单（单笔 4~20万元）' })
  md: TierFlowDto

  @ApiProperty({ type: () => TierFlowDto, description: '小单（单笔 < 4万元）' })
  sm: TierFlowDto
}

/** @deprecated 已替换为 MarketMoneyFlowDto，保留兼容 controller 引用 */
export class MarketMoneyFlowItemDto extends MarketMoneyFlowDto {}

export class SectorFlowItemDto {
  @ApiProperty() tradeDate: Date
  @ApiProperty() contentType: string
  @ApiProperty({ required: false, nullable: true }) name: string | null
  @ApiProperty({ required: false, nullable: true }) pctChange: number | null
  @ApiProperty({ required: false, nullable: true }) close: number | null
  @ApiProperty({ required: false, nullable: true, description: '净流入（元，来自 moneyflow_ind_dc）' }) netAmount:
    | number
    | null
  @ApiProperty({ required: false, nullable: true }) netAmountRate: number | null
  @ApiProperty({ required: false, nullable: true, description: '超大单净流入（元）' }) buyElgAmount: number | null
  @ApiProperty({ required: false, nullable: true, description: '大单净流入（元）' }) buyLgAmount: number | null
  @ApiProperty({ required: false, nullable: true, description: '中单净流入（元）' }) buyMdAmount: number | null
  @ApiProperty({ required: false, nullable: true, description: '小单净流入（元）' }) buySmAmount: number | null
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
  @ApiProperty({ required: false, nullable: true, description: '成交量（手）' }) vol: number | null
  @ApiProperty({ required: false, nullable: true, description: '成交额（千元）' }) amount: number | null
  @ApiProperty({ description: '基期（YYYYMMDD）' }) baseDate: string
  @ApiProperty({ description: '基点' }) basePoint: number
}

export class HsgtFlowDto {
  @ApiProperty({ required: false, nullable: true }) tradeDate: Date | null
  @ApiProperty({ description: '北向资金合计（沪股通+深股通）百万元', required: false, nullable: true }) northMoney:
    | number
    | null
  @ApiProperty({ description: '沪股通净流入（百万元）', required: false, nullable: true }) hgt: number | null
  @ApiProperty({ description: '深股通净流入（百万元）', required: false, nullable: true }) sgt: number | null
  @ApiProperty({ description: '南向资金合计（港股通）百万元', required: false, nullable: true }) southMoney:
    | number
    | null
  @ApiProperty({ description: '港股通（上海）百万元', required: false, nullable: true }) ggtSs: number | null
  @ApiProperty({ description: '港股通（深圳）百万元', required: false, nullable: true }) ggtSz: number | null
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
  @ApiProperty({ required: false, nullable: true, description: '成交量（手）' }) vol: number | null
  @ApiProperty({ required: false, nullable: true, description: '成交额（千元）' }) amount: number | null
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
  @ApiProperty({ description: '净流入金额（元，来自 moneyflow_ind_dc）', required: false, nullable: true }) netAmount:
    | number
    | null
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
  @ApiProperty({ description: '当日净流入（元，来自 moneyflow_mkt_dc）', required: false, nullable: true }) netAmount:
    | number
    | null
  @ApiProperty({ description: '累计净流入（从序列第 1 天开始累加，元）' }) cumulativeNet: number
  @ApiProperty({ description: '超大单净流入（元）', required: false, nullable: true }) buyElgAmount: number | null
  @ApiProperty({ description: '大单净流入（元）', required: false, nullable: true }) buyLgAmount: number | null
  @ApiProperty({ description: '中单净流入（元）', required: false, nullable: true }) buyMdAmount: number | null
  @ApiProperty({ description: '小单净流入（元）', required: false, nullable: true }) buySmAmount: number | null
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
  @ApiProperty({ description: '净流入（元，来自 moneyflow_ind_dc）', required: false, nullable: true }) netAmount:
    | number
    | null
  @ApiProperty({ description: '净流入率 %', required: false, nullable: true }) netAmountRate: number | null
  @ApiProperty({ description: '超大单净流入（元）', required: false, nullable: true }) buyElgAmount: number | null
  @ApiProperty({ description: '大单净流入（元）', required: false, nullable: true }) buyLgAmount: number | null
  @ApiProperty({ description: '中单净流入（元）', required: false, nullable: true }) buyMdAmount: number | null
  @ApiProperty({ description: '小单净流入（元）', required: false, nullable: true }) buySmAmount: number | null
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
  @ApiProperty({ description: '当日净流入（元，来自 moneyflow_ind_dc）', required: false, nullable: true }) netAmount:
    | number
    | null
  @ApiProperty({ description: '累计净流入（元）' }) cumulativeNet: number
}

export class SectorFlowTrendResponseDto {
  @ApiProperty() tsCode: string
  @ApiProperty({ required: false, nullable: true }) name: string | null
  @ApiProperty({ type: [SectorFlowTrendItemDto] }) data: SectorFlowTrendItemDto[]
}

// ─── hsgt-trend ───────────────────────────────────────────────────────────────

export class HsgtTrendItemDto {
  @ApiProperty({ description: '交易日期 YYYY-MM-DD' }) tradeDate: string
  @ApiProperty({ description: '北向当日净买入（百万元）', required: false, nullable: true }) northMoney: number | null
  @ApiProperty({ description: '南向当日净买入（百万元）', required: false, nullable: true }) southMoney: number | null
  @ApiProperty({ description: '沪股通（百万元）', required: false, nullable: true }) hgt: number | null
  @ApiProperty({ description: '深股通（百万元）', required: false, nullable: true }) sgt: number | null
  @ApiProperty({ description: '港股通（上海）百万元', required: false, nullable: true }) ggtSs: number | null
  @ApiProperty({ description: '港股通（深圳）百万元', required: false, nullable: true }) ggtSz: number | null
  @ApiProperty({ description: '累计北向净买入（百万元）' }) cumulativeNorth: number
  @ApiProperty({ description: '累计南向净买入（百万元）' }) cumulativeSouth: number
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
  @ApiProperty({ description: '当日成交额（千元）', required: false, nullable: true }) amount: number | null
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
  @ApiProperty({ required: false, nullable: true, description: '特大单买入（万元）' }) buyElgAmount: number | null
  @ApiProperty({ required: false, nullable: true, description: '特大单卖出（万元）' }) sellElgAmount: number | null
  @ApiProperty({ required: false, nullable: true, description: '大单买入（万元）' }) buyLgAmount: number | null
  @ApiProperty({ required: false, nullable: true, description: '大单卖出（万元）' }) sellLgAmount: number | null
  @ApiProperty({ required: false, nullable: true, description: '中单买入（万元）' }) buyMdAmount: number | null
  @ApiProperty({ required: false, nullable: true, description: '中单卖出（万元）' }) sellMdAmount: number | null
  @ApiProperty({ required: false, nullable: true, description: '小单买入（万元）' }) buySmAmount: number | null
  @ApiProperty({ required: false, nullable: true, description: '小单卖出（万元）' }) sellSmAmount: number | null
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

// ─── market-breadth ───────────────────────────────────────────────────────────

export class ConsecutiveLimitGroupDto {
  @ApiProperty({ description: '连板次数' }) board: number
  @ApiProperty({ description: '该连板梯队股票数量' }) count: number
}

export class MarketBreadthDto {
  @ApiProperty({ description: '交易日期' }) tradeDate: Date
  @ApiProperty({ description: '涨停家数（pct_chg ≥ 9.5）' }) limitUp: number
  @ApiProperty({ description: '跌停家数（pct_chg ≤ -9.5）' }) limitDown: number
  @ApiProperty({ description: '大涨家数（pct_chg ≥ 5%）' }) bigRise: number
  @ApiProperty({ description: '上涨家数（0.001% ≤ pct_chg < 5%）' }) rise: number
  @ApiProperty({ description: '平盘家数（pct_chg ≈ 0）' }) flat: number
  @ApiProperty({ description: '下跌家数（-5% < pct_chg < -0.001%）' }) fall: number
  @ApiProperty({ description: '大跌家数（pct_chg ≤ -5%）' }) bigFall: number
  @ApiProperty({ description: '当日有行情的 A 股总数' }) total: number
  @ApiProperty({ description: '炸板数（limit_list_d 中 limit=Z 的记录数）' }) limitUpBroken: number
  @ApiProperty({
    description: '连板分布（按 limit_times 分组，仅统计 limit=U 涨停板）',
    type: [ConsecutiveLimitGroupDto],
  })
  consecutiveLimitGroups: ConsecutiveLimitGroupDto[]
}

// ─── daily-narrative ──────────────────────────────────────────────────────────

export class DailyNarrativeKeyEventDto {
  @ApiProperty({
    description: '事件分类',
    enum: ['breadth', 'money_flow', 'northbound', 'sector', 'limit_up', 'valuation'],
  })
  category: 'breadth' | 'money_flow' | 'northbound' | 'sector' | 'limit_up' | 'valuation'

  @ApiProperty({ description: '事件标题' }) title: string
  @ApiProperty({ description: '关键数值', required: false, nullable: true }) value?: number
}

export class DailyNarrativeResponseDto {
  @ApiProperty({ description: '交易日期' }) tradeDate: Date
  @ApiProperty({
    description: '市场基调',
    enum: ['bullish', 'bearish', 'divergent', 'neutral'],
  })
  tone: 'bullish' | 'bearish' | 'divergent' | 'neutral'

  @ApiProperty({ description: '一句话摘要，如"全面普涨，成长风格占优"' }) headline: string
  @ApiProperty({ description: '3-5 条支撑证据', type: [String] }) bullets: string[]
  @ApiProperty({ description: '0–100 综合做多信心指数' }) score: number
  @ApiProperty({ description: '关键事件列表', type: [DailyNarrativeKeyEventDto] })
  keyEvents: DailyNarrativeKeyEventDto[]
}

// ─── top-movers ───────────────────────────────────────────────────────────────

export class TopMoverItemDto {
  @ApiProperty() tsCode: string
  @ApiProperty({ required: false, nullable: true }) name: string | null
  @ApiProperty({ required: false, nullable: true }) industry: string | null
  @ApiProperty({ description: '涨跌幅 %', required: false, nullable: true }) pctChg: number | null
  @ApiProperty({ description: '成交额（千元）', required: false, nullable: true }) amount: number | null
  @ApiProperty({ description: '换手率 %', required: false, nullable: true }) turnoverRate: number | null
  @ApiProperty({ description: '振幅 % = (high - low) / preClose * 100', required: false, nullable: true })
  amplitude: number | null
}

export class TopMoversResponseDto {
  @ApiProperty({ type: [TopMoverItemDto] }) data: TopMoverItemDto[]
}

// ─── index-quote-with-sparkline ───────────────────────────────────────────────

export class IndexQuoteWithSparklineItemDto {
  @ApiProperty({ description: '指数代码' }) tsCode: string
  @ApiProperty({ description: '指数名称' }) name: string
  @ApiProperty({ description: '交易日期' }) tradeDate: Date
  @ApiProperty({ required: false, nullable: true, description: '收盘价' }) close: number | null
  @ApiProperty({ required: false, nullable: true, description: '昨收价' }) preClose: number | null
  @ApiProperty({ required: false, nullable: true, description: '涨跌额' }) change: number | null
  @ApiProperty({ required: false, nullable: true, description: '涨跌幅（%）' }) pctChg: number | null
  @ApiProperty({ required: false, nullable: true, description: '成交量（手）' }) vol: number | null
  @ApiProperty({ required: false, nullable: true, description: '成交额（千元）' }) amount: number | null
  @ApiProperty({ description: '基期（YYYYMMDD）' }) baseDate: string
  @ApiProperty({ description: '基点' }) basePoint: number
  @ApiProperty({
    description: 'sparkline：近 N 交易日收盘价数组（升序），N 由 sparkline_period 决定',
    type: [Number],
  })
  sparkline: (number | null)[]
}

export class IndexQuoteWithSparklineResponseDto {
  @ApiProperty({ description: '查询日期' }) tradeDate: Date
  @ApiProperty({ description: 'sparkline 时间跨度' }) sparklinePeriod: string
  @ApiProperty({ type: [IndexQuoteWithSparklineItemDto] }) indices: IndexQuoteWithSparklineItemDto[]
}

// ─── sector-top-bottom ────────────────────────────────────────────────────────

export class SectorTopBottomItemDto {
  @ApiProperty() tsCode: string
  @ApiProperty({ required: false, nullable: true }) name: string | null
  @ApiProperty({ description: '涨跌幅 %', required: false, nullable: true }) pctChange: number | null
  @ApiProperty({ description: '主力净流入（元）', required: false, nullable: true }) netAmount: number | null
}

export class SectorTopBottomResponseDto {
  @ApiProperty({ description: '交易日期 YYYYMMDD', nullable: true }) tradeDate: string | null
  @ApiProperty({ type: [SectorTopBottomItemDto] }) pctGainers: SectorTopBottomItemDto[]
  @ApiProperty({ type: [SectorTopBottomItemDto] }) pctLosers: SectorTopBottomItemDto[]
  @ApiProperty({ type: [SectorTopBottomItemDto] }) flowGainers: SectorTopBottomItemDto[]
  @ApiProperty({ type: [SectorTopBottomItemDto] }) flowLosers: SectorTopBottomItemDto[]
  @ApiProperty() gainersCount: number
  @ApiProperty() losersCount: number
  @ApiProperty() flatCount: number
  @ApiProperty() totalCount: number
}

// ─── data-dates ───────────────────────────────────────────────────────────────

export class MarketDataDatesDto {
  @ApiProperty({ description: '日线最新交易日', nullable: true }) daily: string | null
  @ApiProperty({ description: '指数最新交易日', nullable: true }) index: string | null
  @ApiProperty({ description: '行业资金最新交易日', nullable: true }) sector: string | null
  @ApiProperty({ description: '个股资金流最新交易日', nullable: true }) moneyflow: string | null
  @ApiProperty({ description: '每日指标最新交易日', nullable: true }) dailyBasic: string | null
  @ApiProperty({ description: '沪深港通最新交易日', nullable: true }) hsgt: string | null
}
