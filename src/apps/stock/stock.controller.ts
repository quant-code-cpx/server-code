import { Body, Controller, Post } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { StockService } from './stock.service'
import { StockListQueryDto } from './dto/stock-list-query.dto'
import { StockDetailDto } from './dto/stock-detail.dto'
import { StockSearchDto } from './dto/stock-search.dto'
import { StockDetailChartDto } from './dto/stock-detail-chart.dto'
import { StockDetailMoneyFlowDto } from './dto/stock-detail-money-flow.dto'
import { StockDetailFinancialsDto } from './dto/stock-detail-financials.dto'
import { StockDetailShareholdersDto } from './dto/stock-detail-shareholders.dto'

@ApiTags('Stock - 股票')
@Controller('stock')
export class StockController {
  constructor(private readonly stockService: StockService) {}

  @Post('list')
  @ApiOperation({ summary: '股票列表（分页 + 多维筛选 + 排序）' })
  findAll(@Body() query: StockListQueryDto) {
    return this.stockService.findAll(query)
  }

  @Post('search')
  @ApiOperation({ summary: '股票搜索建议（联想词）' })
  search(@Body() dto: StockSearchDto) {
    return this.stockService.search(dto)
  }

  @Post('detail')
  @ApiOperation({ summary: '获取股票详情（旧接口，兼容保留）' })
  findOne(@Body() { code }: StockDetailDto) {
    return this.stockService.findOne(code)
  }

  @Post('detail/overview')
  @ApiOperation({ summary: '股票详情 - 总览（基本信息 + 公司简介 + 最新行情 + 估值）' })
  detailOverview(@Body() { code }: StockDetailDto) {
    return this.stockService.getDetailOverview(code)
  }

  @Post('detail/chart')
  @ApiOperation({ summary: '股票详情 - K 线图（支持日/周/月 + 前/后复权）' })
  detailChart(@Body() dto: StockDetailChartDto) {
    return this.stockService.getDetailChart(dto)
  }

  @Post('detail/money-flow')
  @ApiOperation({ summary: '股票详情 - 资金流（最近 N 日资金流向）' })
  detailMoneyFlow(@Body() dto: StockDetailMoneyFlowDto) {
    return this.stockService.getDetailMoneyFlow(dto)
  }

  @Post('detail/financials')
  @ApiOperation({ summary: '股票详情 - 财务指标（最近 N 个报告期）' })
  detailFinancials(@Body() dto: StockDetailFinancialsDto) {
    return this.stockService.getDetailFinancials(dto)
  }

  @Post('detail/shareholders')
  @ApiOperation({ summary: '股票详情 - 股东与分红（前十大 + 分红历史）' })
  detailShareholders(@Body() dto: StockDetailShareholdersDto) {
    return this.stockService.getDetailShareholders(dto)
  }
}
