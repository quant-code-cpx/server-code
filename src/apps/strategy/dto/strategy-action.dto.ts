import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator'
import { Type } from 'class-transformer'

export class StrategyIdDto {
  @ApiProperty({ description: '策略 ID' })
  @IsString()
  @IsNotEmpty()
  id: string
}

export class DeleteStrategyDto extends StrategyIdDto {
  @ApiPropertyOptional({ description: '是否强制删除', default: false })
  @IsOptional()
  @IsBoolean()
  force?: boolean
}

export class CloneStrategyDto extends StrategyIdDto {
  @ApiPropertyOptional({ description: '新策略名称' })
  @IsOptional()
  @IsString()
  name?: string
}

export class StrategyPerformanceQueryDto {
  @ApiPropertyOptional({ description: '策略 ID' })
  @IsOptional()
  @IsString()
  strategyId?: string

  @ApiPropertyOptional({ description: '返回数量', default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number
}
