import { IsArray, IsNumber, IsOptional, IsString } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

// ── Request DTOs ──────────────────────────────────────────────────────────────

export class ListVersionsDto {
  @ApiProperty({ description: '策略 ID' })
  @IsString()
  strategyId: string
}

export class CompareVersionsDto {
  @ApiProperty({ description: '策略 ID' })
  @IsString()
  strategyId: string

  @ApiProperty({ description: '版本 A（历史配置，需 < 版本 B）' })
  @IsNumber()
  versionA: number

  @ApiProperty({ description: '版本 B（较新配置，需 > 版本 A）' })
  @IsNumber()
  versionB: number
}

// ── Response DTOs ─────────────────────────────────────────────────────────────

export class StrategyVersionItemDto {
  @ApiProperty({ description: '版本号' })
  version: number

  @ApiProperty({ description: '策略配置快照' })
  strategyConfig: Record<string, unknown>

  @ApiPropertyOptional({ description: '回测默认参数快照' })
  backtestDefaults: Record<string, unknown> | null

  @ApiPropertyOptional({ description: '变更说明' })
  changelog: string | null

  @ApiProperty({ description: '快照创建时间' })
  createdAt: Date

  @ApiProperty({ description: '是否为当前版本' })
  isCurrent: boolean
}

export class ConfigDiffItem {
  @ApiProperty({ description: '参数键名' })
  path: string

  @ApiPropertyOptional({ description: '旧值' })
  oldValue: unknown

  @ApiPropertyOptional({ description: '新值' })
  newValue: unknown

  @ApiProperty({ description: '变更类型', enum: ['ADDED', 'REMOVED', 'CHANGED'] })
  changeType: 'ADDED' | 'REMOVED' | 'CHANGED'
}

export class VersionMetrics {
  @ApiPropertyOptional() totalReturn: number | null
  @ApiPropertyOptional() annualizedReturn: number | null
  @ApiPropertyOptional() sharpeRatio: number | null
  @ApiPropertyOptional() maxDrawdown: number | null
  @ApiPropertyOptional() sortinoRatio: number | null
  @ApiPropertyOptional() runId: string | null
}

export class CompareVersionsResponseDto {
  @ApiProperty({ description: '策略 ID' })
  strategyId: string

  @ApiProperty({ description: '版本 A' })
  versionA: number

  @ApiProperty({ description: '版本 B' })
  versionB: number

  @ApiProperty({ description: '版本 A 策略配置' })
  configA: Record<string, unknown>

  @ApiProperty({ description: '版本 B 策略配置' })
  configB: Record<string, unknown>

  @ApiProperty({ description: '配置差异列表', type: [ConfigDiffItem] })
  diff: ConfigDiffItem[]

  @ApiPropertyOptional({ description: '版本 A 最近一次回测指标' })
  metricsA: VersionMetrics | null

  @ApiPropertyOptional({ description: '版本 B 最近一次回测指标' })
  metricsB: VersionMetrics | null
}
