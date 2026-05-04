import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

export class StockQuoteDto {
  @ApiPropertyOptional({ nullable: true }) close?: number | null
  @ApiPropertyOptional({ nullable: true }) pctChg?: number | null
  @ApiPropertyOptional({ nullable: true, description: '成交量（手）' }) vol?: number | null
  @ApiPropertyOptional({ nullable: true, description: '成交额（千元）' }) amount?: number | null
  @ApiPropertyOptional({ nullable: true, description: '总市值（万元）' }) totalMv?: number | null
  @ApiPropertyOptional({ nullable: true, description: '市盈率（TTM）' }) pe?: number | null
  @ApiPropertyOptional({ nullable: true, description: '市净率' }) pb?: number | null
  @ApiPropertyOptional({ nullable: true, description: '最新行情交易日，YYYYMMDD' }) tradeDate?: string | null
  @ApiPropertyOptional({ enum: ['LIVE', 'STALE', 'MISSING'], nullable: true, description: '行情新鲜度' }) quoteStatus?:
    | string
    | null
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
  @ApiPropertyOptional({ nullable: true, description: '股票名称' }) stockName?: string | null
  @ApiPropertyOptional({ nullable: true, description: '行业' }) industry?: string | null
  @ApiPropertyOptional({ nullable: true, description: '地区' }) area?: string | null
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
  @ApiPropertyOptional({ type: [String], description: '因重复等原因跳过的股票代码' }) skippedCodes?: string[]
}

export class BatchRemoveResponseDto {
  @ApiProperty() removed: number
}

export class WatchlistOverviewSummaryDto {
  @ApiProperty() stockCount: number
  @ApiProperty() upCount: number
  @ApiProperty() downCount: number
  @ApiProperty() flatCount: number
  @ApiPropertyOptional({ nullable: true }) avgPctChg?: number | null
  @ApiPropertyOptional({ nullable: true, description: '组合总市值（万元）' }) totalMv?: number | null
  @ApiPropertyOptional({ nullable: true, description: '最新行情交易日 YYYYMMDD' }) latestTradeDate?: string | null
  @ApiProperty({ description: '行情数据陈旧或缺失的股票数量' }) staleCount: number
}

export class WatchlistOverviewItemDto {
  @ApiProperty() id: number
  @ApiProperty() name: string
  @ApiPropertyOptional({ nullable: true }) description?: string | null
  @ApiProperty() isDefault: boolean
  @ApiProperty() sortOrder: number
  @ApiProperty() stockCount: number
  @ApiPropertyOptional({ type: WatchlistOverviewSummaryDto, nullable: true })
  summary?: WatchlistOverviewSummaryDto | null
}

export class WatchlistOverviewResponseDto {
  @ApiProperty({ type: [WatchlistOverviewItemDto] }) watchlists: WatchlistOverviewItemDto[]
}

export class WatchlistMessageResponseDto {
  @ApiProperty() message: string
}
