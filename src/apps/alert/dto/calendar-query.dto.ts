import { IsArray, IsEnum, IsInt, IsOptional, IsString, Matches } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform, Type } from 'class-transformer'

export enum CalendarEventType {
  DISCLOSURE = 'DISCLOSURE',
  FLOAT = 'FLOAT',
  DIVIDEND = 'DIVIDEND',
  FORECAST = 'FORECAST',
  IPO = 'IPO',
  CONVERTIBLE = 'CONVERTIBLE',
  SHAREHOLDER = 'SHAREHOLDER',
}

export enum CalendarScope {
  ALL = 'ALL',
  WATCHLIST = 'WATCHLIST',
  PORTFOLIO = 'PORTFOLIO',
}

export enum ImpactLevel {
  HIGH = 'HIGH',
  MEDIUM = 'MEDIUM',
  LOW = 'LOW',
}

/** 市值分桶（单位：亿元）：SMALL<20, MID 20-100, LARGE 100-500, MEGA>500 */
export enum MarketCapBucket {
  SMALL = 'SMALL',
  MID = 'MID',
  LARGE = 'LARGE',
  MEGA = 'MEGA',
}

export class CalendarQueryDto {
  @Matches(/^\d{8}$/, { message: 'startDate 格式应为 YYYYMMDD' })
  startDate: string

  @Matches(/^\d{8}$/, { message: 'endDate 格式应为 YYYYMMDD' })
  endDate: string

  @IsOptional()
  @IsString()
  tsCode?: string

  @IsOptional()
  @IsArray()
  @IsEnum(CalendarEventType, { each: true })
  @Transform(({ value }) => (typeof value === 'string' ? [value] : value))
  types?: CalendarEventType[]

  @IsOptional()
  @IsString()
  keyword?: string

  @ApiPropertyOptional({ enum: CalendarScope, default: CalendarScope.ALL })
  @IsOptional()
  @IsEnum(CalendarScope)
  scope?: CalendarScope

  @ApiPropertyOptional({ description: '自选股组 ID；省略时使用当前用户全部自选股组' })
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  watchlistId?: number

  @ApiPropertyOptional({ description: '投资组合 ID；省略时使用当前用户全部组合' })
  @IsOptional()
  @IsString()
  portfolioId?: string

  @IsOptional()
  @IsArray()
  @IsEnum(ImpactLevel, { each: true })
  @Transform(({ value }) => (typeof value === 'string' ? [value] : value))
  impactLevels?: ImpactLevel[]

  @ApiPropertyOptional({
    enum: MarketCapBucket,
    isArray: true,
    description: '市值分桶过滤：SMALL<20亿 MID 20-100亿 LARGE 100-500亿 MEGA>500亿',
  })
  @IsOptional()
  @IsArray()
  @IsEnum(MarketCapBucket, { each: true })
  @Transform(({ value }) => (typeof value === 'string' ? [value] : value))
  marketCapBuckets?: MarketCapBucket[]
}

export class CalendarHistoryTrendQueryDto {
  @ApiProperty({ description: '股票代码', example: '000001.SZ' })
  @IsString()
  tsCode: string

  @ApiProperty({ enum: CalendarEventType, description: '事件类型' })
  @IsEnum(CalendarEventType)
  type: CalendarEventType

  @ApiPropertyOptional({ description: '事件日期范围起始（YYYYMMDD）', example: '20240101' })
  @IsOptional()
  @Matches(/^\d{8}$/, { message: 'startDate 格式应为 YYYYMMDD' })
  startDate?: string

  @ApiPropertyOptional({ description: '事件日期范围截止（YYYYMMDD）', example: '20260523' })
  @IsOptional()
  @Matches(/^\d{8}$/, { message: 'endDate 格式应为 YYYYMMDD' })
  endDate?: string

  @ApiPropertyOptional({ description: '事件子类型（如股东增持 IN / 减持 DE）' })
  @IsOptional()
  @IsString()
  subType?: string
}
