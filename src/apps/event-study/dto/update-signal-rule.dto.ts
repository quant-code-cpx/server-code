import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsIn, IsObject, IsOptional, IsString, MaxLength } from 'class-validator'
import { EventSignalRuleStatus } from '@prisma/client'

export class UpdateSignalRuleDto {
  @ApiPropertyOptional({ description: '规则名称' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  name?: string

  @ApiPropertyOptional({ description: '规则描述' })
  @IsOptional()
  @IsString()
  description?: string

  @ApiPropertyOptional({ description: '筛选条件 JSON' })
  @IsOptional()
  @IsObject()
  conditions?: Record<string, unknown>

  @ApiPropertyOptional({ enum: ['BUY', 'SELL', 'WATCH'] })
  @IsOptional()
  @IsIn(['BUY', 'SELL', 'WATCH'])
  signalType?: string

  @ApiPropertyOptional({ enum: ['ACTIVE', 'PAUSED'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'PAUSED'])
  status?: EventSignalRuleStatus
}
