import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

export class IndustryDictMappingItemDto {
  @ApiProperty({ description: '申万 L1 行业代码，如 801120.SI' })
  swCode: string

  @ApiProperty({ description: '申万 L1 行业名称，如 食品饮料' })
  swName: string

  @ApiPropertyOptional({ description: '东财行业板块完整代码，如 BK0438.DC（未匹配时为 null）', nullable: true })
  dcTsCode: string | null

  @ApiPropertyOptional({ description: '东财短代码，如 BK0438（未匹配时为 null）', nullable: true })
  dcBoardCode: string | null

  @ApiPropertyOptional({ description: '东财行业板块名称（未匹配时为 null）', nullable: true })
  dcName: string | null

  @ApiProperty({
    description: '匹配类型',
    enum: ['exact', 'override', 'candidate', 'none'],
  })
  matchType: 'exact' | 'override' | 'candidate' | 'none'

  @ApiProperty({ description: '匹配置信度，精确匹配为 1' })
  confidence: number
}

export class IndustryDictMappingCoverageDto {
  @ApiProperty({ description: '申万 L1 行业总数' })
  total: number

  @ApiProperty({ description: '已匹配数量' })
  matched: number

  @ApiProperty({ description: '未匹配数量' })
  unmatched: number

  @ApiProperty({ description: '匹配率（matched / total）' })
  matchRate: number

  @ApiProperty({ description: '上市股票总数' })
  listedStockCount: number

  @ApiProperty({ description: '已映射到申万 L1 的上市股票数' })
  listedStockMappedCount: number

  @ApiProperty({ description: '上市股票映射率' })
  listedStockMappedRate: number
}

export class IndustryDictMappingResponseDto {
  @ApiProperty({ description: '源字典', enum: ['sw_l1'] })
  source: 'sw_l1'

  @ApiProperty({ description: '目标字典', enum: ['dc_industry'] })
  target: 'dc_industry'

  @ApiPropertyOptional({ description: '申万版本标识，如 SW2021', nullable: true })
  version: string | null

  @ApiPropertyOptional({ description: '东财最新交易日（YYYYMMDD）', nullable: true })
  tradeDate: string | null

  @ApiProperty({ description: '覆盖率统计' })
  coverage: IndustryDictMappingCoverageDto

  @ApiProperty({ description: '映射条目列表', type: [IndustryDictMappingItemDto] })
  items: IndustryDictMappingItemDto[]
}
