import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsCompactTradeDate } from 'src/common/decorators/is-compact-trade-date.decorator'

export enum TechnicalSignalPeriod {
  ONE_YEAR = '1Y',
  THREE_YEARS = '3Y',
  CUSTOM = 'CUSTOM',
}

export enum TechnicalSignalEntryMode {
  SIGNAL_CLOSE = 'SIGNAL_CLOSE',
  NEXT_OPEN = 'NEXT_OPEN',
}

const TS_CODE_RE = /^\d{6}\.(SH|SZ|BJ)$/
const SIGNAL_KEY_RE = /^[a-z][a-z0-9.-]{1,95}$/
const SEMANTICS_VERSION_RE = /^[a-z][a-z0-9.-]{1,63}$/

export const TECHNICAL_SIGNAL_OUTCOME_QUALITY_STATUSES = ['VALID', 'IMMATURE', 'MISSING'] as const
export type TechnicalSignalOutcomeQualityStatus = (typeof TECHNICAL_SIGNAL_OUTCOME_QUALITY_STATUSES)[number]

export class TechnicalSignalSelectorDto {
  @ApiProperty({ example: 'macd.golden-cross', description: '标准技术信号 key' })
  @IsString()
  @Matches(SIGNAL_KEY_RE, { message: 'signalKey 格式无效' })
  signalKey: string

  @ApiPropertyOptional({ example: 'macd.v1', description: '语义版本；缺省解析当前 stable 版本' })
  @IsOptional()
  @IsString()
  @Matches(SEMANTICS_VERSION_RE, { message: 'semanticsVersion 格式无效' })
  semanticsVersion?: string
}

export class TechnicalSignalDefinitionListRequestDto {
  @ApiPropertyOptional({ type: [String], maxItems: 14, description: '需要查询的 signalKey；缺省返回完整标准目录' })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(14)
  @IsString({ each: true })
  @Matches(SIGNAL_KEY_RE, { each: true, message: 'signalKeys 含无效 key' })
  signalKeys?: string[]

  @ApiPropertyOptional({ default: false, description: '是否返回已废弃定义' })
  @IsOptional()
  @IsBoolean()
  includeDeprecated?: boolean = false
}

export class TechnicalSignalStatisticsRequestDto {
  @ApiProperty({ example: '000001.SZ', description: 'A 股 ts_code' })
  @IsString()
  @Matches(TS_CODE_RE, { message: 'tsCode 格式应为 000001.SZ' })
  tsCode: string

  @ApiPropertyOptional({
    type: [TechnicalSignalSelectorDto],
    maxItems: 14,
    description: '信号定义；缺省为全部 14 个稳定定义',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(14)
  @ValidateNested({ each: true })
  @Type(() => TechnicalSignalSelectorDto)
  signals?: TechnicalSignalSelectorDto[]

  @ApiPropertyOptional({
    enum: TechnicalSignalPeriod,
    isArray: true,
    default: [TechnicalSignalPeriod.ONE_YEAR, TechnicalSignalPeriod.THREE_YEARS],
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @IsEnum(TechnicalSignalPeriod, { each: true })
  periods?: TechnicalSignalPeriod[]

  @ApiPropertyOptional({ example: '20240101', description: 'CUSTOM 起始日期，YYYYMMDD' })
  @IsOptional()
  @IsCompactTradeDate()
  customStartDate?: string

  @ApiPropertyOptional({ example: '20261231', description: 'CUSTOM 截止日期，YYYYMMDD；缺省为 dataAsOf' })
  @IsOptional()
  @IsCompactTradeDate()
  customEndDate?: string

  @ApiPropertyOptional({ type: [Number], default: [1, 3, 5, 10, 20], minimum: 1, maximum: 60, maxItems: 10 })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(60, { each: true })
  horizons?: number[]

  @ApiPropertyOptional({ example: '20260731', description: '数据截止交易日 YYYYMMDD；缺省取共同 READY 日' })
  @IsOptional()
  @IsCompactTradeDate()
  asOfTradeDate?: string

  @ApiPropertyOptional({ enum: TechnicalSignalEntryMode, default: TechnicalSignalEntryMode.SIGNAL_CLOSE })
  @IsOptional()
  @IsEnum(TechnicalSignalEntryMode)
  entryMode?: TechnicalSignalEntryMode = TechnicalSignalEntryMode.SIGNAL_CLOSE

  @ApiPropertyOptional({ default: false, description: '是否计算沪深 300 超额收益；基准全历史未就绪时返回 409' })
  @IsOptional()
  @IsBoolean()
  includeBenchmark?: boolean = false

  @ApiPropertyOptional({ example: '000300.SH', description: '基准代码；v1 仅支持沪深 300' })
  @IsOptional()
  @IsString()
  @Matches(/^000300\.SH$/, { message: 'v1 仅支持基准 000300.SH' })
  benchmarkTsCode?: string
}

export class TechnicalSignalOccurrenceListRequestDto {
  @ApiProperty({ example: '000001.SZ', description: 'A 股 ts_code' })
  @IsString()
  @Matches(TS_CODE_RE, { message: 'tsCode 格式应为 000001.SZ' })
  tsCode: string

  @ApiProperty({ example: 'macd.golden-cross', description: '标准技术信号 key' })
  @IsString()
  @Matches(SIGNAL_KEY_RE, { message: 'signalKey 格式无效' })
  signalKey: string

  @ApiPropertyOptional({ example: 'macd.v1', description: '语义版本；缺省解析当前 stable 版本' })
  @IsOptional()
  @IsString()
  @Matches(SEMANTICS_VERSION_RE, { message: 'semanticsVersion 格式无效' })
  semanticsVersion?: string

  @ApiProperty({ example: '20240101', description: '信号日期窗口起始，YYYYMMDD' })
  @IsCompactTradeDate()
  startDate: string

  @ApiProperty({ example: '20261231', description: '信号日期窗口截止，YYYYMMDD' })
  @IsCompactTradeDate()
  endDate: string

  @ApiPropertyOptional({ type: [Number], default: [1], minimum: 1, maximum: 60, maxItems: 10 })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(60, { each: true })
  horizons?: number[]

  @ApiPropertyOptional({ example: '20260731', description: '数据截止交易日 YYYYMMDD；缺省取共同 READY 日' })
  @IsOptional()
  @IsCompactTradeDate()
  asOfTradeDate?: string

  @ApiPropertyOptional({ enum: TechnicalSignalEntryMode, default: TechnicalSignalEntryMode.SIGNAL_CLOSE })
  @IsOptional()
  @IsEnum(TechnicalSignalEntryMode)
  entryMode?: TechnicalSignalEntryMode = TechnicalSignalEntryMode.SIGNAL_CLOSE

  @ApiPropertyOptional({ default: false, description: '是否计算沪深 300 超额收益' })
  @IsOptional()
  @IsBoolean()
  includeBenchmark?: boolean = false

  @ApiPropertyOptional({ example: '000300.SH', description: '基准代码；v1 仅支持沪深 300' })
  @IsOptional()
  @IsString()
  @Matches(/^000300\.SH$/, { message: 'v1 仅支持基准 000300.SH' })
  benchmarkTsCode?: string

  @ApiPropertyOptional({
    type: [String],
    enum: ['VALID', 'IMMATURE', 'MISSING'],
    description: '只返回含指定质量状态的 occurrence',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @IsIn(TECHNICAL_SIGNAL_OUTCOME_QUALITY_STATUSES, { each: true, message: 'qualityStatuses 含无效状态' })
  qualityStatuses?: TechnicalSignalOutcomeQualityStatus[]

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20
}
