import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsArray, IsEnum, IsNumber, IsOptional, IsString, Max, Min, ValidateNested } from 'class-validator'

// ─── 枚举 ─────────────────────────────────────────────────────────────────────

export enum OmitAction {
  SELL = 'SELL', // 未指定持仓全部卖出（默认）
  HOLD = 'HOLD', // 未指定持仓保持不动
}

// ─── 请求 DTO ─────────────────────────────────────────────────────────────────

export class TargetItemDto {
  @ApiProperty({ example: '000001.SZ', description: '股票代码' })
  @IsString()
  tsCode: string

  @ApiProperty({ example: 0.15, minimum: 0, maximum: 1, description: '目标权重（0~1，相对 totalValue）' })
  @IsNumber()
  @Min(0)
  @Max(1)
  targetWeight: number
}

export class RebalancePlanDto {
  @ApiProperty({ example: 'clz1a2b3c4d5', description: '基准组合 ID' })
  @IsString()
  portfolioId: string

  @ApiProperty({ type: [TargetItemDto], description: '目标权重列表' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TargetItemDto)
  targets: TargetItemDto[]

  @ApiPropertyOptional({
    enum: OmitAction,
    default: OmitAction.SELL,
    description: '未出现在 targets 中的持仓处理方式（SELL=全清 / HOLD=保留）',
  })
  @IsOptional()
  @IsEnum(OmitAction)
  omitUnspecified?: OmitAction

  @ApiPropertyOptional({
    example: 500000,
    description: '组合总市值（元）；不传则自动用最新价估算',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  totalValue?: number

  @ApiPropertyOptional({ example: 0.00025, description: '佣金率，默认万分之二点五' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  commissionRate?: number

  @ApiPropertyOptional({ example: 0.001, description: '印花税率（卖出），默认千分之一' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  stampDutyRate?: number

  @ApiPropertyOptional({ example: 5, description: '每笔最低佣金（元），默认 5 元' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  minCommission?: number
}

// ─── 响应 DTO ─────────────────────────────────────────────────────────────────

export class RebalancePlanItemDto {
  @ApiProperty({ example: '000001.SZ' }) tsCode: string
  @ApiProperty({ example: '平安银行' }) stockName: string

  // 当前状态
  @ApiProperty({ example: 1000, description: '当前持仓股数' }) currentShares: number
  @ApiPropertyOptional({ example: 12.5, nullable: true, description: '最新收盘价（元）' })
  currentPrice: number | null
  @ApiPropertyOptional({ example: 12500, nullable: true, description: '当前市值（元）' })
  currentMarketValue: number | null
  @ApiPropertyOptional({ example: 0.25, nullable: true, description: '当前权重（相对 totalValue）' })
  currentWeight: number | null

  // 目标状态
  @ApiProperty({ example: 0.15, description: '输入的目标权重' }) targetWeight: number
  @ApiProperty({ example: 600, description: '整手处理后的目标股数' }) targetShares: number
  @ApiPropertyOptional({ example: 7500, nullable: true, description: '目标市值（元）' })
  targetMarketValue: number | null

  // 差异与动作
  @ApiProperty({ enum: ['BUY', 'SELL', 'ADJUST', 'HOLD', 'SKIP'] })
  action: 'BUY' | 'SELL' | 'ADJUST' | 'HOLD' | 'SKIP'
  @ApiPropertyOptional({ enum: ['SUSPENDED', 'NO_PRICE', 'LOT_SIZE'], nullable: true })
  skipReason?: 'SUSPENDED' | 'NO_PRICE' | 'LOT_SIZE'

  @ApiProperty({ example: -400, description: '需操作股数（正=买入 负=卖出 0=不变）' }) deltaShares: number
  @ApiPropertyOptional({ example: 5000, nullable: true, description: '操作金额（元，始终为正）' })
  deltaAmount: number | null
  @ApiProperty({ example: 6.25, description: '预估交易成本（元）' }) estimatedTradingCost: number
}

export class RebalancePlanSummaryDto {
  @ApiProperty({ example: 50000, description: '买入总金额（元）' }) totalBuyAmount: number
  @ApiProperty({ example: 30000, description: '卖出总金额（元，税费前）' }) totalSellProceeds: number
  @ApiProperty({ example: 87.5, description: '所有交易预估成本之和（元）' }) totalTradingCost: number
  @ApiProperty({ example: 3 }) buyCount: number
  @ApiProperty({ example: 2 }) sellCount: number
  @ApiProperty({ example: 1 }) adjustCount: number
  @ApiProperty({ example: 2 }) holdCount: number
  @ApiProperty({ example: 1 }) skipCount: number
  @ApiProperty({ example: 20000, description: '调仓前现金余额（元）' }) cashBefore: number
  @ApiProperty({ example: 3000, description: '调仓后现金余额（元）' }) cashAfter: number
  @ApiProperty({ example: true, description: '现金是否充足（cashAfter >= 0）' }) isFeasible: boolean
}

export class RebalancePlanResponseDto {
  @ApiProperty({ example: 'clz1a2b3c4d5', description: '组合 ID' }) portfolioId: string
  @ApiProperty({ example: '科技成长组合', description: '组合名称' }) portfolioName: string
  @ApiProperty({ example: '2024-12-31', description: '参考定价日期（YYYY-MM-DD）' }) refDate: string
  @ApiProperty({ example: 500000, description: '使用的组合总市值（元）' }) totalValue: number
  @ApiProperty({ type: [RebalancePlanItemDto] }) items: RebalancePlanItemDto[]
  @ApiProperty({ type: RebalancePlanSummaryDto }) summary: RebalancePlanSummaryDto
}
