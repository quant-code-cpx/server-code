import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

/** 热力图单个股票节点 */
export class HeatmapItemDto {
  @ApiProperty({ description: '股票代码，例如 000001.SZ' })
  tsCode: string

  @ApiProperty({ required: false, nullable: true, description: '股票简称' })
  name: string | null

  @ApiProperty({ required: false, nullable: true, description: '所属分组名称（行业/指数/概念板块）' })
  groupName: string | null

  /** 保留 industry 字段向后兼容，group_by=industry 时等同于 groupName */
  @ApiProperty({ required: false, nullable: true, description: '行业名称（兼容旧字段）' })
  industry: string | null

  @ApiProperty({ required: false, nullable: true, description: '当日涨跌幅（%）' })
  pctChg: number | null

  @ApiProperty({ required: false, nullable: true, description: '总市值（万元）' })
  totalMv: number | null

  @ApiProperty({ required: false, nullable: true, description: '当日成交额（千元）' })
  amount: number | null

  // ── 以下字段仅在 industry_source=sw_l1 且 include_mapping=true 时返回 ──

  @ApiPropertyOptional({ required: false, nullable: true, description: '申万 L1 行业代码（如 801120.SI）' })
  swCode?: string | null

  @ApiPropertyOptional({ required: false, nullable: true, description: '申万 L1 行业名称' })
  swName?: string | null

  @ApiPropertyOptional({ required: false, nullable: true, description: '东财行业板块完整代码（如 BK0438.DC）' })
  dcTsCode?: string | null

  @ApiPropertyOptional({ required: false, nullable: true, description: '东财短代码（如 BK0438）' })
  dcBoardCode?: string | null

  @ApiPropertyOptional({ required: false, nullable: true, description: '东财行业板块名称' })
  dcName?: string | null
}
