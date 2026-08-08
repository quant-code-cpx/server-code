import { Type } from 'class-transformer'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator'
import { BacktestPositionQueryDto } from './backtest-position-query.dto'
import { BacktestTradeQueryDto } from './backtest-trade-query.dto'
import { RunMonteCarloDto } from './monte-carlo.dto'

export class BacktestRunIdDto {
  @ApiProperty({ description: '回测运行 ID' })
  @IsString()
  @IsNotEmpty()
  runId: string
}

export class BacktestTradeRequestDto extends BacktestTradeQueryDto {
  @ApiProperty({ description: '回测运行 ID' })
  @IsString()
  @IsNotEmpty()
  runId: string
}

export class BacktestPositionRequestDto extends BacktestPositionQueryDto {
  @ApiProperty({ description: '回测运行 ID' })
  @IsString()
  @IsNotEmpty()
  runId: string
}

export class BacktestMonteCarloRequestDto extends RunMonteCarloDto {
  @ApiProperty({ description: '回测运行 ID' })
  @IsString()
  @IsNotEmpty()
  runId: string
}

export class BacktestRenameRunDto extends BacktestRunIdDto {
  @ApiProperty({ description: '回测名称', maxLength: 128 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  name: string
}

export class BacktestArchiveRunDto extends BacktestRunIdDto {
  @ApiPropertyOptional({ description: '是否归档', default: true })
  @IsOptional()
  @IsBoolean()
  archived?: boolean
}

export class BacktestStarRunDto extends BacktestRunIdDto {
  @ApiPropertyOptional({ description: '是否标星', default: true })
  @IsOptional()
  @IsBoolean()
  starred?: boolean
}

export class BacktestWalkForwardRunIdDto {
  @ApiProperty({ description: 'Walk-Forward 运行 ID' })
  @IsString()
  @IsNotEmpty()
  wfRunId: string
}

export class BacktestComparisonGroupIdDto {
  @ApiProperty({ description: '对比组 ID' })
  @IsString()
  @IsNotEmpty()
  groupId: string
}

export class BacktestParamSensitivityResultDto {
  @ApiProperty({ description: '参数敏感性扫描 ID' })
  @IsString()
  @IsNotEmpty()
  sweepId: string
}

export class BacktestPaginationDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number = 1

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  pageSize?: number = 20
}

export class BacktestComparisonListDto extends BacktestPaginationDto {
  @ApiPropertyOptional({ description: '状态筛选', maxLength: 32 })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  status?: string

  @ApiPropertyOptional({ description: '名称关键词', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  keyword?: string
}
