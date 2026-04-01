import { IsDateString, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

export class SubmitBacktestingDto {
  @ApiProperty({ example: 'ma_cross', description: '策略标识' })
  @IsString()
  @IsNotEmpty()
  strategyId: string

  @ApiProperty({ example: '2023-01-01', description: '回测开始日期' })
  @IsDateString()
  startDate: string

  @ApiProperty({ example: '2024-01-01', description: '回测结束日期' })
  @IsDateString()
  endDate: string

  @ApiProperty({ example: 100000, description: '初始资金' })
  @IsNumber()
  @Min(1)
  initialCapital: number

  @ApiPropertyOptional({ description: '策略参数', type: 'object', additionalProperties: true })
  @IsOptional()
  params?: Record<string, unknown>
}
