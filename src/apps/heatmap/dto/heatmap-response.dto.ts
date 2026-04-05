import { ApiProperty } from '@nestjs/swagger'

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
}
