import {
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ArrayMaxSize,
} from 'class-validator'
import { ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'

export enum StockSortBy {
  TOTAL_MV = 'totalMv',
  PCT_CHG = 'pctChg',
  TURNOVER_RATE = 'turnoverRate',
  AMOUNT = 'amount',
  PE_TTM = 'peTtm',
  PB = 'pb',
  DV_TTM = 'dvTtm',
  LIST_DATE = 'listDate',
}

export class StockListQueryDto {
  @ApiPropertyOptional({ description: '页码，从 1 开始', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  page?: number = 1

  @ApiPropertyOptional({ description: '每页条数', default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20

  @ApiPropertyOptional({ description: '关键词搜索：股票代码 / 名称 / 拼音缩写' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  keyword?: string

  @ApiPropertyOptional({ description: '交易所：SSE（上交所）/ SZSE（深交所）/ BSE（北交所）' })
  @IsOptional()
  @IsString()
  @IsIn(['SSE', 'SZSE', 'BSE'])
  exchange?: string

  @ApiPropertyOptional({ description: '上市状态：L（上市）/ D（退市）/ P（暂停）', default: 'L' })
  @IsOptional()
  @IsString()
  @IsIn(['L', 'D', 'P'])
  listStatus?: string = 'L'

  @ApiPropertyOptional({ description: '所属行业（模糊匹配）' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  industry?: string

  @ApiPropertyOptional({ description: '行业（多选精确匹配，与 industry 单选互斥，优先生效）', type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  industries?: string[]

  @ApiPropertyOptional({ description: '地域（模糊匹配，如：广东、上海）' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  area?: string

  @ApiPropertyOptional({ description: '地域（多选精确匹配，与 area 单选互斥，优先生效）', type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  areas?: string[]

  @ApiPropertyOptional({ description: '市场板块（主板 / 创业板 / 科创板 等，模糊匹配）' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  market?: string

  @ApiPropertyOptional({ description: '是否沪深港通标的：N / H / S' })
  @IsOptional()
  @IsString()
  @IsIn(['N', 'H', 'S'])
  isHs?: string

  @ApiPropertyOptional({ description: '概念板块代码（多选，从 /stock/screener/concepts 获取）', type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  conceptCodes?: string[]

  @ApiPropertyOptional({ description: '最小总市值（万元）' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minTotalMv?: number

  @ApiPropertyOptional({ description: '最大总市值（万元）' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxTotalMv?: number

  @ApiPropertyOptional({ description: '最小市盈率 TTM' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  minPeTtm?: number

  @ApiPropertyOptional({ description: '最大市盈率 TTM' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  maxPeTtm?: number

  @ApiPropertyOptional({ description: '最小市净率 PB' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  minPb?: number

  @ApiPropertyOptional({ description: '最大市净率 PB' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  maxPb?: number

  @ApiPropertyOptional({ description: '最小股息率 TTM（%）' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minDvTtm?: number

  @ApiPropertyOptional({ description: '最小换手率（%）' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  minTurnoverRate?: number

  @ApiPropertyOptional({ description: '最大换手率（%）' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  maxTurnoverRate?: number

  @ApiPropertyOptional({ description: '最小涨跌幅（%）' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  minPctChg?: number

  @ApiPropertyOptional({ description: '最大涨跌幅（%）' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  maxPctChg?: number

  @ApiPropertyOptional({ description: '最小成交额（千元）' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minAmount?: number

  @ApiPropertyOptional({ description: '最大成交额（千元）' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxAmount?: number

  @ApiPropertyOptional({ enum: StockSortBy, description: '排序字段', default: StockSortBy.TOTAL_MV })
  @IsOptional()
  @IsEnum(StockSortBy)
  sortBy?: StockSortBy = StockSortBy.TOTAL_MV

  @ApiPropertyOptional({ enum: ['asc', 'desc'], description: '排序方向', default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc'
}
