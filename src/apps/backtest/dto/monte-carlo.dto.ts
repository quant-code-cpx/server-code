import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsNumber, IsOptional, Max, Min } from 'class-validator'
import { Type } from 'class-transformer'

export class RunMonteCarloDto {
  @ApiPropertyOptional({ default: 1000, description: '模拟次数（100~10000）' })
  @IsOptional()
  @IsNumber()
  @Min(100)
  @Max(10000)
  @Type(() => Number)
  numSimulations?: number = 1000

  @ApiPropertyOptional({ description: '随机种子（用于结果复现）' })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  seed?: number
}

export class MonteCarloFinalNavDistributionDto {
  @ApiProperty() mean: number
  @ApiProperty() median: number
  @ApiProperty() std: number
  @ApiProperty({ type: Object }) percentiles: Record<string, number>
  @ApiProperty() positiveReturnProbability: number
}

export class MonteCarloDrawdownDistributionDto {
  @ApiProperty() mean: number
  @ApiProperty() median: number
  @ApiProperty() percentile95: number
}

export class MonteCarloReturnDistributionDto {
  @ApiProperty() mean: number
  @ApiProperty() median: number
  @ApiProperty() std: number
  @ApiProperty({ type: Object }) percentiles: Record<string, number>
}

export class MonteCarloTimeSeriesPointDto {
  @ApiProperty() dayIndex: number
  @ApiProperty({ type: Object }) percentiles: Record<string, number>
}

export class MonteCarloResultDto {
  @ApiProperty() numSimulations: number
  @ApiProperty() originalFinalNav: number
  @ApiProperty() originalTotalReturn: number
  @ApiProperty({ type: MonteCarloFinalNavDistributionDto }) finalNavDistribution: MonteCarloFinalNavDistributionDto
  @ApiProperty({ type: MonteCarloDrawdownDistributionDto }) maxDrawdownDistribution: MonteCarloDrawdownDistributionDto
  @ApiProperty({ type: MonteCarloReturnDistributionDto })
  annualizedReturnDistribution: MonteCarloReturnDistributionDto
  @ApiProperty({ type: [MonteCarloTimeSeriesPointDto] }) timeSeries: MonteCarloTimeSeriesPointDto[]
}
