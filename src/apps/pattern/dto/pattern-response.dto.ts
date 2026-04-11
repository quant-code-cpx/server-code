import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

/** 单条匹配结果 */
export class PatternMatchDto {
  @ApiProperty({ description: '股票代码' })
  tsCode: string

  @ApiPropertyOptional({ description: '股票名称' })
  name: string | null

  @ApiProperty({ description: '匹配片段起始日期（YYYYMMDD）' })
  startDate: string

  @ApiProperty({ description: '匹配片段截止日期（YYYYMMDD）' })
  endDate: string

  @ApiProperty({ description: '相似度距离（越小越相似）' })
  distance: number

  @ApiProperty({ description: '相似度百分比（0–100，越高越相似）' })
  similarity: number

  @ApiProperty({
    description: '匹配片段结束后第 5 / 10 / 20 交易日的累计涨跌幅（%），可能少于 3 个值',
    type: [Number],
  })
  futureReturns: number[]

  @ApiProperty({ description: '匹配片段的归一化价格序列 [0,1]', type: [Number] })
  normalizedSeries: number[]
}

/** 搜索汇总结果 */
export class PatternSearchResultDto {
  @ApiProperty({ description: '查询形态长度（交易日数）' })
  patternLength: number

  @ApiProperty({ description: '使用的算法（NED / DTW）' })
  algorithm: string

  @ApiProperty({ description: '候选股票池数量' })
  candidateCount: number

  @ApiProperty({ description: '搜索耗时（ms）' })
  elapsedMs: number

  @ApiProperty({ description: '查询形态的归一化序列 [0,1]', type: [Number] })
  querySeries: number[]

  @ApiProperty({ description: '匹配结果列表（按相似度升序）', type: [PatternMatchDto] })
  matches: PatternMatchDto[]
}
