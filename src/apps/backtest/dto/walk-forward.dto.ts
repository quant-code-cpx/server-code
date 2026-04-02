import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import {
  IsEnum,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator'
import { Type } from 'class-transformer'
import { BacktestStrategyType, RebalanceFrequency, Universe } from '../types/backtest-engine.types'

/** 参数搜索空间中的单个参数定义 */
export class ParamSearchSpaceItemDto {
  @ApiProperty({ enum: ['range', 'enum'] })
  @IsEnum(['range', 'enum'])
  type: 'range' | 'enum'

  @ApiPropertyOptional({ description: 'type=range 时有效，最小值' })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  min?: number

  @ApiPropertyOptional({ description: 'type=range 时有效，最大值' })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  max?: number

  @ApiPropertyOptional({ description: 'type=range 时有效，步长' })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  step?: number

  @ApiPropertyOptional({ description: 'type=enum 时有效，枚举值列表' })
  @IsOptional()
  values?: (string | number | boolean)[]
}

export class CreateWalkForwardRunDto {
  @ApiPropertyOptional({ description: 'Walk-Forward 验证名称' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  name?: string

  @ApiProperty({ enum: ['MA_CROSS_SINGLE', 'SCREENING_ROTATION', 'FACTOR_RANKING', 'CUSTOM_POOL_REBALANCE'] })
  @IsEnum(['MA_CROSS_SINGLE', 'SCREENING_ROTATION', 'FACTOR_RANKING', 'CUSTOM_POOL_REBALANCE'])
  baseStrategyType: BacktestStrategyType

  @ApiProperty({ description: '策略基础配置（搜索空间外的固定参数）' })
  @IsObject()
  baseStrategyConfig: Record<string, unknown>

  @ApiProperty({ description: '参数搜索空间定义，key 对应 strategyConfig 参数名' })
  @IsObject()
  paramSearchSpace: Record<string, ParamSearchSpaceItemDto>

  @ApiProperty({ description: 'YYYYMMDD' })
  @IsString()
  @Matches(/^\d{8}$/)
  fullStartDate: string

  @ApiProperty({ description: 'YYYYMMDD' })
  @IsString()
  @Matches(/^\d{8}$/)
  fullEndDate: string

  @ApiProperty({ description: '样本内窗口天数（60~2520）' })
  @IsNumber()
  @Min(60)
  @Max(2520)
  @Type(() => Number)
  inSampleDays: number

  @ApiProperty({ description: '样本外窗口天数（20~504）' })
  @IsNumber()
  @Min(20)
  @Max(504)
  @Type(() => Number)
  outOfSampleDays: number

  @ApiProperty({ description: '滚动步长天数（20~504）' })
  @IsNumber()
  @Min(20)
  @Max(504)
  @Type(() => Number)
  stepDays: number

  @ApiPropertyOptional({
    default: 'sharpeRatio',
    description: '优化目标指标：totalReturn | sharpeRatio | sortinoRatio | calmarRatio',
  })
  @IsOptional()
  @IsString()
  optimizeMetric?: string = 'sharpeRatio'

  @ApiPropertyOptional({ default: '000300.SH' })
  @IsOptional()
  @IsString()
  benchmarkTsCode?: string = '000300.SH'

  @ApiPropertyOptional({ enum: ['ALL_A', 'HS300', 'CSI500', 'CSI1000', 'SSE50', 'CUSTOM'], default: 'ALL_A' })
  @IsOptional()
  @IsEnum(['ALL_A', 'HS300', 'CSI500', 'CSI1000', 'SSE50', 'CUSTOM'])
  universe?: Universe = 'ALL_A'

  @ApiProperty()
  @IsNumber()
  @Min(1000)
  @Type(() => Number)
  initialCapital: number

  @ApiPropertyOptional({ enum: ['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY'], default: 'MONTHLY' })
  @IsOptional()
  @IsEnum(['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY'])
  rebalanceFrequency?: RebalanceFrequency = 'MONTHLY'
}

export class WalkForwardWindowDto {
  @ApiProperty() windowIndex: number
  @ApiProperty() isStartDate: string
  @ApiProperty() isEndDate: string
  @ApiProperty() oosStartDate: string
  @ApiProperty() oosEndDate: string
  @ApiPropertyOptional({ nullable: true }) optimizedParams: Record<string, unknown> | null
  @ApiPropertyOptional({ nullable: true }) isReturn: number | null
  @ApiPropertyOptional({ nullable: true }) isSharpe: number | null
  @ApiPropertyOptional({ nullable: true }) oosReturn: number | null
  @ApiPropertyOptional({ nullable: true }) oosSharpe: number | null
  @ApiPropertyOptional({ nullable: true }) oosMaxDrawdown: number | null
}

export class WalkForwardRunDetailDto {
  @ApiProperty() wfRunId: string
  @ApiPropertyOptional({ nullable: true }) name: string | null
  @ApiProperty() baseStrategyType: string
  @ApiProperty() status: string
  @ApiProperty() progress: number
  @ApiPropertyOptional({ nullable: true }) failedReason: string | null
  @ApiProperty() fullStartDate: string
  @ApiProperty() fullEndDate: string
  @ApiProperty() inSampleDays: number
  @ApiProperty() outOfSampleDays: number
  @ApiProperty() stepDays: number
  @ApiProperty() optimizeMetric: string
  @ApiPropertyOptional({ nullable: true }) windowCount: number | null
  @ApiPropertyOptional({ nullable: true }) completedWindows: number | null
  @ApiPropertyOptional({ nullable: true }) oosAnnualizedReturn: number | null
  @ApiPropertyOptional({ nullable: true }) oosSharpeRatio: number | null
  @ApiPropertyOptional({ nullable: true }) oosMaxDrawdown: number | null
  @ApiPropertyOptional({ nullable: true }) isOosReturnVsIs: number | null
  @ApiProperty({ type: [WalkForwardWindowDto] }) windows: WalkForwardWindowDto[]
  @ApiProperty() createdAt: string
  @ApiPropertyOptional({ nullable: true }) completedAt: string | null
}

export class CreateWalkForwardRunResponseDto {
  @ApiProperty() wfRunId: string
  @ApiProperty() jobId: string
  @ApiProperty() status: string
}

export class WalkForwardRunSummaryDto {
  @ApiProperty() wfRunId: string
  @ApiPropertyOptional({ nullable: true }) name: string | null
  @ApiProperty() baseStrategyType: string
  @ApiProperty() status: string
  @ApiProperty() fullStartDate: string
  @ApiProperty() fullEndDate: string
  @ApiPropertyOptional({ nullable: true }) oosSharpeRatio: number | null
  @ApiPropertyOptional({ nullable: true }) oosAnnualizedReturn: number | null
  @ApiPropertyOptional({ nullable: true }) oosMaxDrawdown: number | null
  @ApiProperty() progress: number
  @ApiProperty() createdAt: string
  @ApiPropertyOptional({ nullable: true }) completedAt: string | null
}

export class WalkForwardRunListDto {
  @ApiProperty() page: number
  @ApiProperty() pageSize: number
  @ApiProperty() total: number
  @ApiProperty({ type: [WalkForwardRunSummaryDto] }) items: WalkForwardRunSummaryDto[]
}

export class WalkForwardEquityPointDto {
  @ApiProperty() tradeDate: string
  @ApiProperty() nav: number
  @ApiProperty() windowIndex: number
}

export class WalkForwardEquityDto {
  @ApiProperty({ type: [WalkForwardEquityPointDto] }) points: WalkForwardEquityPointDto[]
}
