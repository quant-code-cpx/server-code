import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator'

// ─── 技术指标接口 DTO ─────────────────────────────────────────────────────────

export class StockTechnicalIndicatorsDto {
  @ApiProperty({ example: '000001.SZ', description: '股票代码（ts_code）' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(16)
  tsCode: string

  @ApiPropertyOptional({
    description: 'K线周期：D=日线, W=周线, M=月线',
    enum: ['D', 'W', 'M'],
    default: 'D',
  })
  @IsOptional()
  @IsIn(['D', 'W', 'M'])
  period?: string = 'D'

  @ApiPropertyOptional({
    description: '返回最近多少个交易日的历史序列，默认 120，最大 500',
    default: 120,
    minimum: 30,
    maximum: 500,
  })
  @IsOptional()
  @IsInt()
  @Min(30)
  @Max(500)
  days?: number = 120
}

// ─── 择时信号接口 DTO ─────────────────────────────────────────────────────────

export class StockTimingSignalsDto {
  @ApiProperty({ example: '000001.SZ', description: '股票代码（ts_code）' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(16)
  tsCode: string

  @ApiPropertyOptional({
    description: '回看天数，默认 60',
    default: 60,
    minimum: 20,
    maximum: 250,
  })
  @IsOptional()
  @IsInt()
  @Min(20)
  @Max(250)
  days?: number = 60
}

// ─── 筹码分布接口 DTO ─────────────────────────────────────────────────────────

export class StockChipDistributionDto {
  @ApiProperty({ example: '000001.SZ', description: '股票代码（ts_code）' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(16)
  tsCode: string

  @ApiPropertyOptional({
    description: '指定某个交易日的筹码分布（YYYYMMDD），不传则使用最新交易日',
    example: '20260101',
  })
  @IsOptional()
  @IsString()
  @MaxLength(8)
  tradeDate?: string
}

// ─── 融资融券接口 DTO ─────────────────────────────────────────────────────────

export class StockMarginQueryDto {
  @ApiProperty({ example: '000001.SZ', description: '股票代码（ts_code）' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(16)
  tsCode: string

  @ApiPropertyOptional({
    description: '回看天数，默认 60',
    default: 60,
    minimum: 20,
    maximum: 250,
  })
  @IsOptional()
  @IsInt()
  @Min(20)
  @Max(250)
  days?: number = 60
}

// ─── 相对强弱接口 DTO ─────────────────────────────────────────────────────────

export class StockRelativeStrengthDto {
  @ApiProperty({ example: '000001.SZ', description: '股票代码（ts_code）' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(16)
  tsCode: string

  @ApiPropertyOptional({
    description: '对比的指数代码，默认沪深300 000300.SH',
    default: '000300.SH',
    example: '000300.SH',
  })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  benchmarkCode?: string = '000300.SH'

  @ApiPropertyOptional({
    description: '回看天数，默认 120',
    default: 120,
    minimum: 20,
    maximum: 500,
  })
  @IsOptional()
  @IsInt()
  @Min(20)
  @Max(500)
  days?: number = 120
}

// ─── 技术因子查询 DTO ─────────────────────────────────────────────────────────

export class StockTechnicalFactorsQueryDto {
  @ApiProperty({ example: '000001.SZ', description: '股票代码（ts_code）' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(16)
  tsCode: string

  @ApiPropertyOptional({
    description: '返回最近多少个交易日，默认 120，最大 500',
    default: 120,
    minimum: 1,
    maximum: 500,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  days?: number = 120
}

export class StockLatestFactorsQueryDto {
  @ApiProperty({ example: '000001.SZ', description: '股票代码（ts_code）' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(16)
  tsCode: string
}
