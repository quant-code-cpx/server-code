import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator'

export enum ApplyMode {
  REPLACE = 'REPLACE',
  MERGE = 'MERGE',
}

export class ApplyBacktestDto {
  @ApiProperty({ example: 'clz1a2b3c4d5e6f7g8h9', description: '回测任务 ID' })
  @IsString()
  backtestRunId: string

  @ApiPropertyOptional({
    example: 'clz1a2b3c4d5e6f7g8h9',
    description: '目标组合 ID（不传则自动创建新组合）',
  })
  @IsOptional()
  @IsString()
  portfolioId?: string

  @ApiPropertyOptional({
    example: '回测导入-价值策略',
    description: '新建组合时的名称（不传则自动命名为 回测导入-{回测名}）',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  portfolioName?: string

  @ApiPropertyOptional({
    enum: ApplyMode,
    default: ApplyMode.REPLACE,
    description: '导入模式：REPLACE=清空替换 | MERGE=合并加仓',
  })
  @IsOptional()
  @IsEnum(ApplyMode)
  mode?: ApplyMode
}

export class RebalanceActionDto {
  @ApiProperty({ example: '000001.SZ', description: '股票代码' }) tsCode: string
  @ApiProperty({ example: '平安银行', description: '股票名称' }) stockName: string
  @ApiProperty({
    enum: ['BUY', 'SELL', 'ADJUST', 'HOLD'],
    description: 'BUY=新增 SELL=清仓 ADJUST=调整 HOLD=不变',
  })
  action: 'BUY' | 'SELL' | 'ADJUST' | 'HOLD'

  @ApiProperty({ example: 0, description: '变动前数量（0=新增）' }) previousQuantity: number
  @ApiProperty({ example: 0, description: '变动前成本价（元）' }) previousAvgCost: number

  @ApiProperty({ example: 1000, description: '变动后数量（0=清仓）' }) targetQuantity: number
  @ApiProperty({ example: 12.5, description: '变动后成本价（元）' }) targetAvgCost: number

  @ApiProperty({ example: 1000, description: '变动量（正=加仓 负=减仓）' }) deltaQuantity: number
}

export class ApplyBacktestSummaryDto {
  @ApiProperty({ example: 3, description: '新增持仓数' }) added: number
  @ApiProperty({ example: 2, description: '更新持仓数' }) updated: number
  @ApiProperty({ example: 1, description: '清除持仓数（仅 REPLACE 模式）' }) removed: number
  @ApiProperty({ example: 0, description: '未变动持仓数（仅 MERGE 模式）' }) unchanged: number
  @ApiProperty({ example: 5, description: '最终总持仓数' }) totalHoldings: number
}

export class ApplyBacktestResponseDto {
  @ApiProperty({ example: 'clz1a2b3c4d5e6f7g8h9', description: '目标组合 ID（新建或已有）' })
  portfolioId: string

  @ApiProperty({ example: '回测导入-价值策略', description: '组合名称' })
  portfolioName: string

  @ApiProperty({ example: 'clz1a2b3c4d5e6f7g8h9', description: '来源回测任务 ID' })
  backtestRunId: string

  @ApiProperty({ enum: ApplyMode, description: '实际使用的导入模式' })
  mode: ApplyMode

  @ApiProperty({ example: '2024-12-31', description: '回测末日持仓日期 (YYYY-MM-DD)' })
  snapshotDate: string

  @ApiProperty({ type: [RebalanceActionDto], description: '调仓动作明细' })
  changes: RebalanceActionDto[]

  @ApiProperty({ type: ApplyBacktestSummaryDto, description: '汇总统计' })
  summary: ApplyBacktestSummaryDto
}
