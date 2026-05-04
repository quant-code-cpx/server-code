import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsArray, IsIn, IsNotEmpty, IsOptional, IsString, Matches, ValidateNested, ArrayMaxSize } from 'class-validator'
import { FactorScreeningDto } from 'src/apps/factor/dto/factor-screening.dto'
import { StockListQueryDto } from 'src/apps/stock/dto/stock-list-query.dto'

export class ExportBacktestTradesDto {
  @ApiProperty({ description: '回测运行 ID' })
  @IsString()
  @IsNotEmpty()
  runId: string
}

export class ExportFactorValuesDto {
  @ApiProperty({ description: '因子名称' })
  @IsString()
  @IsNotEmpty()
  factorId: string

  @ApiPropertyOptional({ description: '开始日期，格式 YYYYMMDD' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{8}$/, { message: 'startDate 格式应为 YYYYMMDD，例如 20240101' })
  startDate?: string

  @ApiPropertyOptional({ description: '结束日期，格式 YYYYMMDD' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{8}$/, { message: 'endDate 格式应为 YYYYMMDD，例如 20240101' })
  endDate?: string
}

export class ExportPortfolioHoldingsDto {
  @ApiProperty({ description: '投资组合 ID' })
  @IsString()
  @IsNotEmpty()
  portfolioId: string
}

// 列名白名单，防止任意字段名注入 CSV 列
const STOCK_LIST_VALID_COLUMNS = [
  'tsCode',
  'symbol',
  'name',
  'fullname',
  'exchange',
  'market',
  'industry',
  'area',
  'listStatus',
  'listDate',
  'latestTradeDate',
  'peTtm',
  'pb',
  'dvTtm',
  'totalMv',
  'circMv',
  'turnoverRate',
  'pctChg',
  'amount',
  'close',
  'vol',
] as const

export type StockListColumn = (typeof STOCK_LIST_VALID_COLUMNS)[number]

/** 默认导出列（全量）*/
export const DEFAULT_STOCK_LIST_COLUMNS: StockListColumn[] = [...STOCK_LIST_VALID_COLUMNS]

export class ExportStockListDto {
  @ApiPropertyOptional({
    description: '筛选条件（与 /api/stock/list 入参一致）',
    type: () => StockListQueryDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => StockListQueryDto)
  filters?: StockListQueryDto

  @ApiPropertyOptional({
    description: '导出列（不传则导出全部列）',
    type: [String],
    example: ['tsCode', 'name', 'peTtm', 'totalMv'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(25)
  @IsString({ each: true })
  @IsIn(STOCK_LIST_VALID_COLUMNS, { each: true })
  columns?: StockListColumn[]

  @ApiPropertyOptional({ description: '导出标注，用于文件名（如: screened_stocks）' })
  @IsOptional()
  @IsString()
  scope?: string
}

export class ExportAlertAnomaliesDto {
  @ApiPropertyOptional({ description: '交易日，格式 YYYYMMDD；不传则取最新' })
  @IsOptional()
  @Matches(/^\d{8}$/, { message: 'tradeDate 格式应为 YYYYMMDD' })
  tradeDate?: string
}

export class ExportFactorScreeningDto extends FactorScreeningDto {
  @ApiPropertyOptional({
    description: '导出列；基础列支持 tsCode/name/industry，因子列使用 factorName，不传则导出基础列 + 条件因子',
    type: [String],
    example: ['tsCode', 'name', 'industry', 'pe_ttm', 'pb'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @IsString({ each: true })
  columns?: string[]
}
