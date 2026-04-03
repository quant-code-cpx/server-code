import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

export class StrategyResponseDto {
  @ApiProperty()
  id: string

  @ApiProperty()
  userId: number

  @ApiProperty()
  name: string

  @ApiPropertyOptional()
  description?: string | null

  @ApiProperty()
  strategyType: string

  @ApiProperty()
  strategyConfig: Record<string, unknown>

  @ApiPropertyOptional()
  backtestDefaults?: Record<string, unknown> | null

  @ApiProperty({ type: [String] })
  tags: string[]

  @ApiProperty()
  version: number

  @ApiProperty()
  isPublic: boolean

  @ApiProperty()
  createdAt: Date

  @ApiProperty()
  updatedAt: Date
}

export class StrategyListResponseDto {
  @ApiProperty({ type: [StrategyResponseDto] })
  strategies: StrategyResponseDto[]

  @ApiProperty()
  total: number

  @ApiProperty()
  page: number

  @ApiProperty()
  pageSize: number
}
