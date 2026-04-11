import { IsArray, IsBoolean, IsInt, IsNumber, IsOptional, IsString, Min, Max, IsEnum } from 'class-validator'
import { Type } from 'class-transformer'

export enum OptimizationMode {
  MVO = 'MVO', // 均值-方差最优（最大化 Sharpe）
  MIN_VARIANCE = 'MIN_VARIANCE', // 最小方差
  RISK_PARITY = 'RISK_PARITY', // 风险平价
  MAX_DIVERSIFICATION = 'MAX_DIVERSIFICATION', // 最大分散化
}

export class FactorOptimizationDto {
  @IsArray()
  @IsString({ each: true })
  tsCodes: string[]

  @IsEnum(OptimizationMode)
  mode: OptimizationMode

  /** 用于估计收益与协方差的历史回看天数（默认 252） */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(30)
  @Max(1260)
  lookbackDays?: number

  /** MVO 模式下的风险厌恶系数（默认 1） */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  @Max(100)
  riskAversionLambda?: number

  /** 单票最大权重（默认 1，即不限制；0~1） */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  maxWeight?: number

  /** 单票最小权重（默认 0） */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  minWeight?: number

  /** 最大迭代次数（默认 500） */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(50)
  @Max(5000)
  maxIterations?: number

  /** Ledoit-Wolf 收缩目标（'identity'=单位阵 | 'constant_correlation'=常关联，默认 'identity'） */
  @IsOptional()
  @IsString()
  shrinkageTarget?: 'identity' | 'constant_correlation'

  /** 截止日期（YYYYMMDD，用来确定回望区间结尾，默认取数据库最新交易日） */
  @IsOptional()
  @IsString()
  endDate?: string

  /** 是否保存为策略模板 */
  @IsOptional()
  @IsBoolean()
  saveAsStrategy?: boolean

  /** 策略名称（saveAsStrategy 为 true 时可填） */
  @IsOptional()
  @IsString()
  strategyName?: string
}
