import { Transform, Type } from 'class-transformer'
import { IsDateString, IsEnum, IsOptional, IsString, Matches, MaxLength, ValidateNested } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

export enum AgentPageEntityType {
  STOCK = 'STOCK',
  INDEX = 'INDEX',
  PORTFOLIO = 'PORTFOLIO',
  BACKTEST = 'BACKTEST',
  REPORT = 'REPORT',
}

export class AgentPageRangeDto {
  @ApiProperty({ example: '2021-01-01' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  start: string

  @ApiProperty({ example: '2026-07-17' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  end: string
}

export class AgentPageContextDto {
  @ApiProperty({ example: '/stock/detail' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(300)
  @Matches(/^\/(?!\/)[A-Za-z0-9_./+-]*(?:\?[A-Za-z0-9_=&%+.-]*)?$/)
  route: string

  @ApiPropertyOptional({ enum: AgentPageEntityType })
  @IsOptional()
  @IsEnum(AgentPageEntityType)
  entityType?: AgentPageEntityType

  @ApiPropertyOptional({ example: '600519.SH' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(128)
  @Matches(/^[A-Za-z0-9._:-]+$/)
  entityId?: string

  @ApiPropertyOptional({ type: AgentPageRangeDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => AgentPageRangeDto)
  selectedRange?: AgentPageRangeDto

  @ApiPropertyOptional({ example: '2026-07-17' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  visibleDataAsOf?: string
}
