import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

// ─── 组合 CRUD ───────────────────────────────────────────────────────────────

export class PortfolioCreatedDto {
  @ApiProperty({ example: 'clz1a2b3c4d5e6f7g8h9i0j1', description: '组合 ID' }) id: string
  @ApiProperty({ example: '科技成长组合' }) name: string
  @ApiProperty({ example: 100000, description: '初始资金（元）' }) initialCash: unknown
  @ApiPropertyOptional({ example: '专注半导体+AI方向', nullable: true }) description: string | null
  @ApiProperty({ example: '2024-01-15T08:00:00.000Z' }) createdAt: Date
}

export class PortfolioListItemDto {
  @ApiProperty({ example: 'clz1a2b3c4d5e6f7g8h9i0j1' }) id: string
  @ApiProperty({ example: '科技成长组合' }) name: string
  @ApiPropertyOptional({ example: '专注半导体+AI方向', nullable: true }) description: string | null
  @ApiProperty({ example: 100000 }) initialCash: unknown
  @ApiProperty({ example: 3, description: '持仓股票数量' }) holdingCount: number
  @ApiProperty({ example: '2024-01-15T08:00:00.000Z' }) createdAt: Date
  @ApiProperty({ example: '2024-03-20T10:30:00.000Z' }) updatedAt: Date
}

export class PortfolioUpdatedDto {
  @ApiProperty({ example: 'clz1a2b3c4d5e6f7g8h9i0j1' }) id: string
  @ApiProperty({ example: '科技成长组合（重命名）' }) name: string
  @ApiPropertyOptional({ example: '更新后的描述', nullable: true }) description: string | null
  @ApiProperty({ example: '2024-03-20T10:30:00.000Z' }) updatedAt: Date
}

export class SuccessDto {
  @ApiProperty({ example: true }) success: boolean
}

// ─── 持仓 ─────────────────────────────────────────────────────────────────────

export class HoldingItemDto {
  @ApiProperty({ example: 'cld1abc123', description: '持仓记录 ID' }) id: string
  @ApiProperty({ example: '000001.SZ' }) tsCode: string
  @ApiProperty({ example: '平安银行' }) stockName: string
  @ApiProperty({ example: 1000, description: '持仓股数' }) quantity: number
  @ApiProperty({ example: 12.5, description: '平均成本（元）' }) avgCost: unknown
  @ApiProperty({ example: '2024-03-20T10:30:00.000Z' }) updatedAt: Date
}

export class HoldingDetailItemDto {
  @ApiProperty({ example: '000001.SZ' }) tsCode: string
  @ApiProperty({ example: '平安银行' }) stockName: string
  @ApiProperty({ example: 1000 }) quantity: number
  @ApiProperty({ example: 12.5 }) avgCost: number
  @ApiPropertyOptional({ example: 13.2, nullable: true }) currentPrice: number | null
  @ApiPropertyOptional({ example: 13200, nullable: true }) marketValue: number | null
  @ApiPropertyOptional({ example: 700, nullable: true }) unrealizedPnl: number | null
  @ApiPropertyOptional({ example: 0.056, nullable: true }) pnlPct: number | null
  @ApiPropertyOptional({ example: 0.22, nullable: true, description: '仓位权重（0~1）' }) weight: number | null
  @ApiPropertyOptional({ example: '银行', nullable: true }) industry: string | null
}

export class PortfolioSummaryDto {
  @ApiProperty({ example: 12500, description: '持仓总成本（元）' }) totalCost: number
  @ApiProperty({ example: 13200, description: '当前总市值（元）' }) totalMarketValue: number
  @ApiProperty({ example: 700, description: '总浮动盈亏（元）' }) totalUnrealizedPnl: number
  @ApiProperty({ example: 0.056, description: '总浮动盈亏率' }) totalPnlPct: number
  @ApiProperty({ example: 87500, description: '剩余现金（元）' }) cashBalance: number
}

export class PortfolioDetailDto {
  @ApiProperty({ type: PortfolioCreatedDto }) portfolio: PortfolioCreatedDto
  @ApiProperty({ type: [HoldingDetailItemDto] }) holdings: HoldingDetailItemDto[]
  @ApiProperty({ type: PortfolioSummaryDto }) summary: PortfolioSummaryDto
}

// ─── 盈亏分析 ─────────────────────────────────────────────────────────────────

export class PnlByHoldingItemDto {
  @ApiProperty({ example: '000001.SZ' }) tsCode: string
  @ApiProperty({ example: '平安银行' }) stockName: string
  @ApiPropertyOptional({ example: 1.23, nullable: true, description: '今日涨跌幅（%）' }) pctChg: number | null
  @ApiPropertyOptional({ example: 150.6, nullable: true, description: '今日盈亏（元）' }) todayPnl: number | null
}

export class PnlTodayDto {
  @ApiPropertyOptional({ example: '2024-03-20', nullable: true }) tradeDate: Date | null
  @ApiProperty({ example: 320.5, description: '今日总盈亏（元）' }) todayPnl: number
  @ApiProperty({ example: 0.0243, description: '今日总盈亏率' }) todayPnlPct: number
  @ApiProperty({ type: [PnlByHoldingItemDto] }) byHolding: PnlByHoldingItemDto[]
}

export class PnlHistoryItemDto {
  @ApiProperty({ example: '2024-03-20T00:00:00.000Z' }) date: Date
  @ApiProperty({ example: 13200, description: '当日市值（元）' }) marketValue: number
  @ApiProperty({ example: 12500, description: '当日成本基础（元）' }) costBasis: number
  @ApiPropertyOptional({ example: 1.056, nullable: true, description: '净值（市值/成本）' }) nav: number | null
}

// ─── 风险分析 ─────────────────────────────────────────────────────────────────

export class IndustryDistributionItemDto {
  @ApiProperty({ example: '银行' }) industry: string
  @ApiProperty({ example: 2 }) stockCount: number
  @ApiPropertyOptional({ example: 26400, nullable: true }) totalMarketValue: number | null
  @ApiPropertyOptional({ example: 0.44, nullable: true, description: '行业权重（0~1）' }) weight: number | null
}

export class IndustryDistributionDto {
  @ApiPropertyOptional({ example: '2024-03-20', nullable: true }) tradeDate: string | null
  @ApiProperty({ type: [IndustryDistributionItemDto] }) industries: IndustryDistributionItemDto[]
}

export class PositionItemDto {
  @ApiProperty({ example: '000001.SZ' }) tsCode: string
  @ApiProperty({ example: '平安银行' }) stockName: string
  @ApiPropertyOptional({ example: 13200, nullable: true }) marketValue: number | null
  @ApiPropertyOptional({ example: 0.22, nullable: true }) weight: number | null
}

export class ConcentrationDto {
  @ApiProperty({ example: 0.1234, description: 'HHI 赫芬达尔指数' }) hhi: number
  @ApiProperty({ example: 0.22 }) top1Weight: number
  @ApiProperty({ example: 0.55 }) top3Weight: number
  @ApiProperty({ example: 0.78 }) top5Weight: number
}

export class PositionConcentrationDto {
  @ApiPropertyOptional({ example: '2024-03-20', nullable: true }) tradeDate: string | null
  @ApiProperty({ type: [PositionItemDto] }) positions: PositionItemDto[]
  @ApiProperty({ type: ConcentrationDto }) concentration: ConcentrationDto
}

export class MarketCapBucketDto {
  @ApiProperty({ example: '大盘（> 1000亿）' }) label: string
  @ApiProperty({ example: 2 }) count: number
  @ApiPropertyOptional({ example: 0.44, nullable: true }) weight: number | null
}

export class MarketCapDistributionDto {
  @ApiPropertyOptional({ example: '2024-03-20', nullable: true }) tradeDate: string | null
  @ApiProperty({ type: [MarketCapBucketDto] }) buckets: MarketCapBucketDto[]
}

export class BetaHoldingItemDto {
  @ApiProperty({ example: '000001.SZ' }) tsCode: string
  @ApiProperty({ example: '平安银行' }) stockName: string
  @ApiPropertyOptional({ example: 0.85, nullable: true }) beta: number | null
  @ApiPropertyOptional({ example: 0.22, nullable: true }) weight: number | null
}

export class BetaAnalysisDto {
  @ApiPropertyOptional({ example: '2024-03-20', nullable: true }) tradeDate: string | null
  @ApiPropertyOptional({ example: 0.91, nullable: true, description: '组合加权 Beta' }) portfolioBeta: number | null
  @ApiProperty({ type: [BetaHoldingItemDto] }) holdings: BetaHoldingItemDto[]
}

// ─── 风控规则 ─────────────────────────────────────────────────────────────────

export class RiskRuleDto {
  @ApiProperty({ example: 'cld1abc123' }) id: string
  @ApiProperty({ example: 'clz1a2b3c4d5e6f7g8h9i0j1' }) portfolioId: string
  @ApiProperty({ example: 'SINGLE_POSITION_LIMIT', description: '规则类型' }) ruleType: string
  @ApiProperty({ example: 0.3, description: '阈值' }) threshold: number
  @ApiProperty({ example: true }) isEnabled: boolean
  @ApiProperty({ example: '2024-01-15T08:00:00.000Z' }) createdAt: Date
  @ApiProperty({ example: '2024-03-20T10:30:00.000Z' }) updatedAt: Date
}

// ─── 风险检测 ─────────────────────────────────────────────────────────────────

export class ViolationItemDto {
  @ApiProperty({ example: 'SINGLE_POSITION_LIMIT' }) ruleType: string
  @ApiPropertyOptional({ example: '000001.SZ', nullable: true }) tsCode: string | null
  @ApiPropertyOptional({ example: '平安银行', nullable: true }) stockName: string | null
  @ApiProperty({ example: 0.22, description: '当前值' }) currentValue: number
  @ApiProperty({ example: 0.2, description: '规则阈值' }) threshold: number
  @ApiProperty({ example: '单票仓位 22% 超过阈值 20%' }) message: string
}

export class RiskCheckResultDto {
  @ApiProperty({ example: 'clz1a2b3c4d5e6f7g8h9i0j1' }) portfolioId: string
  @ApiProperty({ type: [ViolationItemDto] }) violations: ViolationItemDto[]
  @ApiProperty({ example: '2024-03-20T10:30:00.000Z' }) checkedAt: Date
}

export class ViolationRecordDto {
  @ApiProperty({ example: 'cld1abc123' }) id: string
  @ApiProperty({ example: 'clz1a2b3c4d5e6f7g8h9i0j1' }) portfolioId: string
  @ApiProperty({ example: 'SINGLE_POSITION_LIMIT' }) ruleType: string
  @ApiPropertyOptional({ example: '000001.SZ', nullable: true }) tsCode: string | null
  @ApiProperty({ example: 0.22 }) currentValue: number
  @ApiProperty({ example: 0.2 }) threshold: number
  @ApiProperty({ example: '单票仓位 22% 超过阈值 20%' }) message: string
  @ApiProperty({ example: '2024-03-20T10:30:00.000Z' }) detectedAt: Date
}
