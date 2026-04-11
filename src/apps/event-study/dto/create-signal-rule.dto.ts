import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsEnum, IsIn, IsObject, IsOptional, IsString, MaxLength } from 'class-validator'
import { EventType } from '../event-type.registry'

export class CreateSignalRuleDto {
  @ApiProperty({ description: '规则名称', example: '业绩预增-买入信号' })
  @IsString()
  @MaxLength(128)
  name: string

  @ApiPropertyOptional({ description: '规则描述' })
  @IsOptional()
  @IsString()
  description?: string

  @ApiProperty({ enum: EventType, description: '事件类型' })
  @IsEnum(EventType)
  eventType: EventType

  @ApiPropertyOptional({
    description: '额外筛选条件（JSON），字段名须与事件数据字段匹配',
    example: { type: '预增', pChangeMin: { gte: 50 } },
  })
  @IsOptional()
  @IsObject()
  conditions?: Record<string, unknown>

  @ApiPropertyOptional({
    description: '信号方向',
    enum: ['BUY', 'SELL', 'WATCH'],
    default: 'WATCH',
  })
  @IsOptional()
  @IsIn(['BUY', 'SELL', 'WATCH'])
  signalType?: string = 'WATCH'
}
