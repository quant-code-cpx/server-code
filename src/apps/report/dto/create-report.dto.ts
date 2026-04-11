import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsBoolean, IsEnum, IsInt, IsObject, IsOptional, IsString, Max, Min, ValidateNested } from 'class-validator'
import { Type } from 'class-transformer'

export enum ReportFormatEnum {
  JSON = 'JSON',
  HTML = 'HTML',
  PDF = 'PDF',
}

export class CreateBacktestReportDto {
  @ApiProperty({ description: '回测运行 ID' })
  @IsString()
  runId: string

  @ApiPropertyOptional({ description: '报告标题（默认自动生成）' })
  @IsOptional()
  @IsString()
  title?: string

  @ApiPropertyOptional({
    enum: ReportFormatEnum,
    default: ReportFormatEnum.JSON,
  })
  @IsOptional()
  @IsEnum(ReportFormatEnum)
  format?: ReportFormatEnum = ReportFormatEnum.JSON
}

export class CreateStockReportDto {
  @ApiProperty({ description: '股票代码', example: '000001.SZ' })
  @IsString()
  tsCode: string

  @ApiPropertyOptional({ description: '报告标题' })
  @IsOptional()
  @IsString()
  title?: string

  @ApiPropertyOptional({
    enum: ReportFormatEnum,
    default: ReportFormatEnum.JSON,
  })
  @IsOptional()
  @IsEnum(ReportFormatEnum)
  format?: ReportFormatEnum = ReportFormatEnum.JSON
}

export class CreatePortfolioReportDto {
  @ApiProperty({ description: '组合 ID' })
  @IsString()
  portfolioId: string

  @ApiPropertyOptional({ description: '报告标题' })
  @IsOptional()
  @IsString()
  title?: string

  @ApiPropertyOptional({
    enum: ReportFormatEnum,
    default: ReportFormatEnum.JSON,
  })
  @IsOptional()
  @IsEnum(ReportFormatEnum)
  format?: ReportFormatEnum = ReportFormatEnum.JSON
}

export class StrategyResearchSectionsDto {
  @IsOptional()
  @IsBoolean()
  performance?: boolean = true

  @IsOptional()
  @IsBoolean()
  holdings?: boolean = true

  @IsOptional()
  @IsBoolean()
  riskAssessment?: boolean = true

  @IsOptional()
  @IsBoolean()
  tradeLog?: boolean = false
}

export class CreateStrategyResearchReportDto {
  @ApiProperty({ description: '回测运行 ID' })
  @IsString()
  backtestRunId: string

  @ApiPropertyOptional({ description: '关联策略 ID' })
  @IsOptional()
  @IsString()
  strategyId?: string

  @ApiPropertyOptional({ description: '关联组合 ID（填写后附带交易日志和持仓现状）' })
  @IsOptional()
  @IsString()
  portfolioId?: string

  @ApiPropertyOptional({ description: '报告标题' })
  @IsOptional()
  @IsString()
  title?: string

  @ApiPropertyOptional({ enum: ReportFormatEnum, default: ReportFormatEnum.JSON })
  @IsOptional()
  @IsEnum(ReportFormatEnum)
  format?: ReportFormatEnum = ReportFormatEnum.JSON

  @ApiPropertyOptional({ description: '报告章节开关', type: StrategyResearchSectionsDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => StrategyResearchSectionsDto)
  sections?: StrategyResearchSectionsDto
}

export class QueryReportsDto {
  @ApiPropertyOptional({ enum: ['BACKTEST', 'STOCK', 'PORTFOLIO', 'STRATEGY_RESEARCH'] })
  @IsOptional()
  @IsString()
  type?: string

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number = 1

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20
}
