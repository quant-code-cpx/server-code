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
import { StockDetailShareCapitalDto } from './dto/stock-detail-share-capital.dto'
import { StockDetailFinancingDto } from './dto/stock-detail-financing.dto'
import { ApiSuccessResponse } from 'src/common/decorators/api-success-response.decorator'
import {
  StockChartDataDto,
  StockDetailLegacyDataDto,
  StockDetailOverviewDataDto,
  StockFinancialsDataDto,
  StockFinancingDataDto,
  StockListDataDto,
  StockMainMoneyFlowDataDto,
  StockMoneyFlowDataDto,
  StockSearchItemDto,
  StockShareCapitalDataDto,
  StockShareholdersDataDto,
} from './dto/stock-response.dto'

@ApiTags('Stock - 股票')
@Controller('stock')
export class StockController {
  constructor(private readonly stockService: StockService) {}

  @Post('list')
  @ApiOperation({ summary: '股票列表（分页 + 多维筛选 + 排序）' })
  @ApiSuccessResponse(StockListDataDto)
  findAll(@Body() query: StockListQueryDto) {
    return this.stockService.findAll(query)
  }

  @Post('search')
  @ApiOperation({ summary: '股票搜索建议（联想词）' })
  @ApiSuccessResponse(StockSearchItemDto, { isArray: true })
  search(@Body() dto: StockSearchDto) {
    return this.stockService.search(dto)
  }

  @Post('detail')
  @ApiOperation({ summary: '获取股票详情（旧接口，兼容保留）' })
  @ApiSuccessResponse(StockDetailLegacyDataDto)
  findOne(@Body() { code }: StockDetailDto) {
    return this.stockService.findOne(code)
  }

  @Post('detail/overview')
  @ApiOperation({ summary: '股票详情 - 总览（基本信息 + 公司简介 + 最新行情 + 估值）' })
  @ApiSuccessResponse(StockDetailOverviewDataDto)
  detailOverview(@Body() { code }: StockDetailDto) {
    return this.stockService.getDetailOverview(code)
  }

  @Post('detail/chart')
  @ApiOperation({ summary: '股票详情 - K 线图（支持日/周/月 + 前/后复权）' })
  @ApiSuccessResponse(StockChartDataDto)
  detailChart(@Body() dto: StockDetailChartDto) {
    return this.stockService.getDetailChart(dto)
  }

  @Post('detail/money-flow')
  @ApiOperation({ summary: '股票详情 - 资金流（最近 N 日资金流向）' })
  @ApiSuccessResponse(StockMoneyFlowDataDto)
  detailMoneyFlow(@Body() dto: StockDetailMoneyFlowDto) {
    return this.stockService.getDetailMoneyFlow(dto)
  }

  @Post('detail/financials')
  @ApiOperation({ summary: '股票详情 - 财务指标（最近 N 个报告期）' })
  @ApiSuccessResponse(StockFinancialsDataDto)
  detailFinancials(@Body() dto: StockDetailFinancialsDto) {
    return this.stockService.getDetailFinancials(dto)
  }

  @Post('detail/shareholders')
  @ApiOperation({ summary: '股票详情 - 股东与分红（前十大 + 分红历史）' })
  @ApiSuccessResponse(StockShareholdersDataDto)
  detailShareholders(@Body() dto: StockDetailShareholdersDto) {
    return this.stockService.getDetailShareholders(dto)
  }

  @Post('detail/main-money-flow')
  @ApiOperation({ summary: '股票详情 - 主力资金流向（超大单+大单净流入 vs 散户净流入）' })
  @ApiSuccessResponse(StockMainMoneyFlowDataDto)
  detailMainMoneyFlow(@Body() dto: StockDetailMoneyFlowDto) {
    return this.stockService.getDetailMainMoneyFlow(dto)
  }

  @Post('detail/share-capital')
  @ApiOperation({ summary: '股票详情 - 股本结构（总股本/流通股本/限售股 + 历史变化）' })
  @ApiSuccessResponse(StockShareCapitalDataDto)
  detailShareCapital(@Body() dto: StockDetailShareCapitalDto) {
    return this.stockService.getDetailShareCapital(dto)
  }

  @Post('detail/financing')
  @ApiOperation({ summary: '股票详情 - 融资记录（配股等历史融资事件）' })
  @ApiSuccessResponse(StockFinancingDataDto)
  detailFinancing(@Body() dto: StockDetailFinancingDto) {
    return this.stockService.getDetailFinancing(dto)
  }
}
