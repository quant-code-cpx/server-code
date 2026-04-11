import { IsIn, IsOptional, IsString } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

// ── Request DTO ───────────────────────────────────────────────────────────────

export class BrinsonAttributionDto {
  @ApiProperty({ description: '回测任务 ID' })
  @IsString()
  runId: string

  @ApiPropertyOptional({ description: '基准指数代码（不传时使用回测配置的 benchmarkTsCode）' })
  @IsOptional()
  @IsString()
  benchmarkTsCode?: string

  @ApiPropertyOptional({
    description: '行业分类级别：L1（申万一级）或 L2（申万二级）',
    enum: ['L1', 'L2'],
    default: 'L1',
  })
  @IsOptional()
  @IsIn(['L1', 'L2'])
  industryLevel?: 'L1' | 'L2'

  @ApiPropertyOptional({
    description: '归因粒度',
    enum: ['DAILY', 'WEEKLY', 'MONTHLY'],
    default: 'MONTHLY',
  })
  @IsOptional()
  @IsIn(['DAILY', 'WEEKLY', 'MONTHLY'])
  granularity?: 'DAILY' | 'WEEKLY' | 'MONTHLY'
}

// ── Sub-DTOs ──────────────────────────────────────────────────────────────────

export class BrinsonIndustryDetailDto {
  @ApiProperty({ description: '行业代码' })
  industryCode: string

  @ApiProperty({ description: '行业名称' })
  industryName: string

  @ApiProperty({ description: '组合在该行业的时均权重' })
  portfolioWeight: number

  @ApiProperty({ description: '基准在该行业的时均权重' })
  benchmarkWeight: number

  @ApiProperty({ description: '组合在该行业的加权平均收益率' })
  portfolioReturn: number

  @ApiProperty({ description: '基准在该行业的加权平均收益率' })
  benchmarkReturn: number

  @ApiProperty({ description: '资产配置效应（累计）' })
  allocationEffect: number

  @ApiProperty({ description: '个股选择效应（累计）' })
  selectionEffect: number

  @ApiProperty({ description: '交互效应（累计）' })
  interactionEffect: number

  @ApiProperty({ description: '该行业对超额收益的总贡献' })
  totalEffect: number
}

export class BrinsonPeriodDto {
  @ApiProperty({ description: '时段起始日 YYYY-MM-DD' })
  startDate: string

  @ApiProperty({ description: '时段结束日 YYYY-MM-DD' })
  endDate: string

  @ApiProperty({ description: '该时段组合收益（复利，decimal）' })
  portfolioReturn: number

  @ApiProperty({ description: '该时段基准收益（复利，decimal）' })
  benchmarkReturn: number

  @ApiProperty({ description: '资产配置效应' })
  allocationEffect: number

  @ApiProperty({ description: '个股选择效应' })
  selectionEffect: number

  @ApiProperty({ description: '交互效应' })
  interactionEffect: number

  @ApiProperty({ description: '超额收益' })
  excessReturn: number
}

// ── Response DTO ──────────────────────────────────────────────────────────────

export class BrinsonAttributionResponseDto {
  @ApiProperty({ description: '回测任务 ID' })
  runId: string

  @ApiProperty({ description: '基准指数代码' })
  benchmarkTsCode: string

  @ApiProperty({ description: '行业分类级别（L1 / L2）' })
  industryLevel: string

  @ApiProperty({ description: '归因粒度（DAILY / WEEKLY / MONTHLY）' })
  granularity: string

  @ApiProperty({ description: '回测起始日 YYYY-MM-DD' })
  startDate: string

  @ApiProperty({ description: '回测结束日 YYYY-MM-DD' })
  endDate: string

  @ApiProperty({ description: '组合总收益（复利，decimal）' })
  portfolioReturn: number

  @ApiProperty({ description: '基准总收益（复利，decimal）' })
  benchmarkReturn: number

  @ApiProperty({ description: '超额收益' })
  excessReturn: number

  @ApiProperty({ description: '资产配置效应合计' })
  totalAllocationEffect: number

  @ApiProperty({ description: '个股选择效应合计' })
  totalSelectionEffect: number

  @ApiProperty({ description: '交互效应合计' })
  totalInteractionEffect: number

  @ApiProperty({ type: [BrinsonIndustryDetailDto], description: '按行业的归因明细' })
  industries: BrinsonIndustryDetailDto[]

  @ApiProperty({ type: [BrinsonPeriodDto], description: '按时间段的归因序列' })
  periods: BrinsonPeriodDto[]
}
