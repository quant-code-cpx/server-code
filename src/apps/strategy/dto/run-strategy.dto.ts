import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsBoolean, IsNumber, IsOptional, IsString, Matches, Max, Min } from 'class-validator'
import { Type } from 'class-transformer'

export class RunStrategyDto {
  @ApiProperty({ description: '策略 ID' })
  @IsString()
  strategyId: string

  @ApiProperty({ description: '回测开始日期 YYYYMMDD' })
  @IsString()
  @Matches(/^\d{8}$/, { message: 'startDate 格式应为 YYYYMMDD，例如 20240101' })
  startDate: string

  @ApiProperty({ description: '回测结束日期 YYYYMMDD' })
  @IsString()
  @Matches(/^\d{8}$/, { message: 'endDate 格式应为 YYYYMMDD，例如 20240101' })
  endDate: string

  @ApiProperty({ description: '初始资金（元）', minimum: 1000 })
  @IsNumber()
  @Min(1000)
  @Type(() => Number)
  initialCapital: number

  @ApiPropertyOptional({ description: '回测名称' })
  @IsOptional()
  @IsString()
  name?: string

  @ApiPropertyOptional({ description: '基准指数代码', default: '000300.SH' })
  @IsOptional()
  @IsString()
  benchmarkTsCode?: string

  @ApiPropertyOptional({ description: '股票池', enum: ['ALL_A', 'HS300', 'CSI500', 'CSI1000', 'SSE50', 'CUSTOM'] })
  @IsOptional()
  @IsString()
  universe?: string

  @ApiPropertyOptional({ description: '再平衡频率', enum: ['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY'] })
  @IsOptional()
  @IsString()
  rebalanceFrequency?: string

  @ApiPropertyOptional({ description: '成交价格模式', enum: ['NEXT_OPEN', 'NEXT_CLOSE'] })
  @IsOptional()
  @IsString()
  priceMode?: string

  @ApiPropertyOptional({ description: '手续费率', default: 0.0003 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  commissionRate?: number

  @ApiPropertyOptional({ description: '印花税率', default: 0.0005 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  stampDutyRate?: number

  @ApiPropertyOptional({ description: '最低手续费（元）', default: 5 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  minCommission?: number

  @ApiPropertyOptional({ description: '滑点（bps）', default: 5 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  slippageBps?: number

  @ApiPropertyOptional({ description: '最大持仓数量', default: 20 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(500)
  @Type(() => Number)
  maxPositions?: number

  @ApiPropertyOptional({ description: '单股最大权重', default: 0.1 })
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  @Max(1)
  @Type(() => Number)
  maxWeightPerStock?: number

  @ApiPropertyOptional({ description: '最低上市天数要求', default: 60 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  minDaysListed?: number

  @ApiPropertyOptional({ description: '是否启用涨跌停限制', default: true })
  @IsOptional()
  @IsBoolean()
  enableTradeConstraints?: boolean

  @ApiPropertyOptional({ description: '是否启用 T+1 限制', default: true })
  @IsOptional()
  @IsBoolean()
  enableT1Restriction?: boolean

  @ApiPropertyOptional({ description: '资金不足时是否允许部分成交', default: true })
  @IsOptional()
  @IsBoolean()
  partialFillEnabled?: boolean
}
