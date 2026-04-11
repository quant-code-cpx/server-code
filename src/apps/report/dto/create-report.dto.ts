import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator'

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

export class QueryReportsDto {
  @ApiPropertyOptional({ enum: ['BACKTEST', 'STOCK', 'PORTFOLIO'] })
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
