import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

// ── Holdings ──────────────────────────────────────────────────────────────────

export class FundHoldingItemDto {
  @ApiProperty({ description: '基金代码', example: '510300.SH' })
  ts_code: string

  @ApiPropertyOptional({ description: '基金名称', example: '华泰柏瑞沪深300ETF' })
  fund_name?: string | null

  @ApiProperty({ description: '报告期', example: '20231231' })
  end_date: string

  @ApiProperty({ description: '公告日期', example: '20240115' })
  ann_date: string

  @ApiProperty({ description: '持仓股票代码', example: '600519.SH' })
  symbol: string

  @ApiPropertyOptional({ description: '持有股票市值（元）' })
  mkv?: number | null

  @ApiPropertyOptional({ description: '持有股票数量（股）' })
  amount?: number | null

  @ApiPropertyOptional({ description: '占基金资产净值比例（%）' })
  stk_mkv_ratio?: number | null

  @ApiPropertyOptional({ description: '占股票流通股本比例（%）' })
  stk_float_ratio?: number | null
}

// ── Institutional Summary ─────────────────────────────────────────────────────

export class InstitutionalHolderDto {
  @ApiProperty({ example: '510300.SH' })
  ts_code: string

  @ApiPropertyOptional({ example: '华泰柏瑞沪深300ETF' })
  fund_name?: string | null

  @ApiPropertyOptional({ description: '持有市值（元）' })
  mkv?: number | null

  @ApiPropertyOptional({ description: '持有数量（股）' })
  amount?: number | null

  @ApiPropertyOptional({ description: '占基金净值比例（%）' })
  stk_mkv_ratio?: number | null

  @ApiPropertyOptional({ description: '占流通盘比例（%）' })
  stk_float_ratio?: number | null
}

export class FundInstitutionalSummaryItemDto {
  @ApiProperty({ description: '股票代码', example: '600519.SH' })
  symbol: string

  @ApiProperty({ description: '报告期', example: '20231231' })
  end_date: string

  @ApiProperty({ description: '持有该股票的基金数量' })
  fund_count: number

  @ApiPropertyOptional({ description: '机构合计持有市值（元）' })
  total_mkv?: number | null

  @ApiPropertyOptional({ description: '机构合计持有数量（股）' })
  total_amount?: number | null

  @ApiPropertyOptional({ description: '平均占流通盘比例（%）' })
  avg_stk_float_ratio?: number | null

  @ApiProperty({ description: '持仓基金明细列表', type: () => [InstitutionalHolderDto] })
  holders: InstitutionalHolderDto[]
}

// ── ETF Flow ──────────────────────────────────────────────────────────────────

export class FundEtfFlowItemDto {
  @ApiProperty({ description: 'ETF 基金代码', example: '510300.SH' })
  ts_code: string

  @ApiPropertyOptional({ description: 'ETF 名称', example: '华泰柏瑞沪深300ETF' })
  fund_name?: string | null

  @ApiProperty({ description: '交易日期', example: '20240101' })
  trade_date: string

  @ApiPropertyOptional({ description: '基金份额（万份）' })
  fd_share?: number | null

  @ApiPropertyOptional({ description: '较前一日份额变化（万份），正数为净申购、负数为净赎回' })
  share_delta?: number | null

  @ApiProperty({ description: '资金流向方向', enum: ['inflow', 'outflow', 'flat'] })
  flow_direction: 'inflow' | 'outflow' | 'flat'
}
