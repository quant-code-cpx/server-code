import { Body, Controller, Post } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { StockService } from './stock.service'
import { StockListQueryDto } from './dto/stock-list-query.dto'
import { StockDetailDto } from './dto/stock-detail.dto'
import { StockSearchDto } from './dto/stock-search.dto'

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
  @ApiOperation({ summary: '获取股票详情' })
  findOne(@Body() { code }: StockDetailDto) {
    return this.stockService.findOne(code)
  }
}
