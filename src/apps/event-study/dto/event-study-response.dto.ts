import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

/** 单个事件样本的超额收益序列 */
export class EventSampleDto {
  @ApiProperty({ description: '股票代码' })
  tsCode: string

  @ApiPropertyOptional({ description: '股票名称' })
  name: string | null

  @ApiProperty({ description: '事件日期（YYYY-MM-DD）' })
  eventDate: string

  @ApiProperty({ description: '累计超额收益 CAR（%）' })
  car: number

  @ApiProperty({ description: '逐日超额收益 AR 序列', type: [Number] })
  arSeries: number[]
}

/** 聚合统计结果 */
export class EventStudyResultDto {
  @ApiProperty({ description: '事件类型' })
  eventType: string

  @ApiProperty({ description: '事件类型中文名' })
  eventLabel: string

  @ApiProperty({ description: '有效样本数' })
  sampleCount: number

  @ApiProperty({ description: '事件窗口范围', example: '[-5, +20]' })
  window: string

  @ApiProperty({ description: '基准指数' })
  benchmark: string

  @ApiProperty({
    description: '逐日平均超额收益 AAR 序列（%），索引 0 对应 T-preDays',
    type: [Number],
  })
  aarSeries: number[]

  @ApiProperty({
    description: '逐日累计平均超额收益 CAAR 序列（%）',
    type: [Number],
  })
  caarSeries: number[]

  @ApiProperty({ description: '最终 CAAR 值（%）' })
  caar: number

  @ApiProperty({ description: 'CAAR 的 t 统计量' })
  tStatistic: number

  @ApiProperty({ description: 'p 值（双侧检验）' })
  pValue: number

  @ApiPropertyOptional({ description: '超额收益 CAR 最高的 10 个样本', type: [EventSampleDto] })
  topSamples?: EventSampleDto[]

  @ApiPropertyOptional({ description: '超额收益 CAR 最低的 10 个样本', type: [EventSampleDto] })
  bottomSamples?: EventSampleDto[]
}
