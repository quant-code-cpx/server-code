import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

export class StockQuoteDto {
  @ApiPropertyOptional({ nullable: true }) close?: number | null
  @ApiPropertyOptional({ nullable: true }) pctChg?: number | null
  @ApiPropertyOptional({ nullable: true, description: '成交量（手）' }) vol?: number | null
  @ApiPropertyOptional({ nullable: true, description: '成交额（千元）' }) amount?: number | null
  @ApiPropertyOptional({ nullable: true, description: '总市值（万元）' }) totalMv?: number | null
}

export class WatchlistDto {
  @ApiProperty() id: number
  @ApiProperty() userId: number
  @ApiProperty() name: string
  @ApiPropertyOptional({ nullable: true }) description?: string | null
  @ApiProperty() isDefault: boolean
  @ApiProperty() sortOrder: number
  @ApiPropertyOptional({ description: '自选组内股票数量（仅部分接口返回）', nullable: true })
  stockCount?: number | null
  @ApiProperty() createdAt: Date
  @ApiProperty() updatedAt: Date
}

export class WatchlistStockDto {
  @ApiProperty() id: number
  @ApiProperty() watchlistId: number
  @ApiProperty() tsCode: string
  @ApiPropertyOptional({ nullable: true }) notes?: string | null
  @ApiProperty({ type: [String] }) tags: string[]
  @ApiPropertyOptional({ nullable: true }) targetPrice?: number | null
  @ApiProperty() sortOrder: number
  @ApiProperty() addedAt: Date
  @ApiProperty() updatedAt: Date
  @ApiPropertyOptional({ type: StockQuoteDto, nullable: true }) quote?: StockQuoteDto | null
}

export class WatchlistStocksResponseDto {
  @ApiProperty({ type: [WatchlistStockDto] }) stocks: WatchlistStockDto[]
}

export class BatchAddResponseDto {
  @ApiProperty() added: number
  @ApiProperty() skipped: number
}

export class BatchRemoveResponseDto {
  @ApiProperty() removed: number
}

export class WatchlistSummaryDto {
  @ApiProperty() stockCount: number
  @ApiProperty() upCount: number
  @ApiProperty() downCount: number
  @ApiProperty() flatCount: number
  @ApiProperty() avgPctChg: number
  @ApiProperty({ description: '组合总市值（万元）' }) totalMv: number
}

export class WatchlistOverviewResponseDto {
  @ApiProperty({ type: [WatchlistDto] }) watchlists: WatchlistDto[]
}

export class WatchlistMessageResponseDto {
  @ApiProperty() message: string
}
