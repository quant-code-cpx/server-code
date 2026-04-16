import { ApiProperty } from '@nestjs/swagger'

export class IndexInfoDto {
  @ApiProperty({ description: '指数代码', example: '000001.SH' })
  tsCode: string

  @ApiProperty({ description: '指数名称', example: '上证指数' })
  name: string
}

export class IndexDailyItemDto {
  @ApiProperty({ description: '交易日期 YYYY-MM-DD' })
  tradeDate: string

  @ApiProperty({ required: false, nullable: true })
  open: number | null

  @ApiProperty({ required: false, nullable: true })
  high: number | null

  @ApiProperty({ required: false, nullable: true })
  low: number | null

  @ApiProperty({ required: false, nullable: true })
  close: number | null

  @ApiProperty({ required: false, nullable: true })
  preClose: number | null

  @ApiProperty({ required: false, nullable: true })
  change: number | null

  @ApiProperty({ required: false, nullable: true })
  pctChg: number | null

  @ApiProperty({ required: false, nullable: true, description: '成交量（手）' })
  vol: number | null

  @ApiProperty({ required: false, nullable: true, description: '成交额（千元）' })
  amount: number | null
}

export class IndexDailyResponseDto {
  @ApiProperty({ description: '指数代码' })
  tsCode: string

  @ApiProperty({ description: '指数名称' })
  name: string

  @ApiProperty({ type: [IndexDailyItemDto] })
  data: IndexDailyItemDto[]
}

export class IndexConstituentItemDto {
  @ApiProperty({ description: '成分股代码', example: '600519.SH' })
  conCode: string

  @ApiProperty({ description: '成分股名称', required: false, nullable: true })
  name: string | null

  @ApiProperty({ description: '权重（%）', required: false, nullable: true })
  weight: number | null

  @ApiProperty({ description: '数据日期' })
  tradeDate: string
}

export class IndexConstituentsResponseDto {
  @ApiProperty({ description: '指数代码' })
  indexCode: string

  @ApiProperty({ description: '指数名称' })
  indexName: string

  @ApiProperty({ description: '数据日期' })
  tradeDate: string

  @ApiProperty({ description: '成分股总数' })
  total: number

  @ApiProperty({ type: [IndexConstituentItemDto] })
  constituents: IndexConstituentItemDto[]
}
