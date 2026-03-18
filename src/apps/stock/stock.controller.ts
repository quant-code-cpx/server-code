import { Controller, Get, Param, Query } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { StockService } from './stock.service'
import { StockListQueryDto } from './dto/stock-list-query.dto'

@ApiTags('Stock - 股票')
@Controller('stock')
export class StockController {
  constructor(private readonly stockService: StockService) {}

  @Get()
  @ApiOperation({ summary: '获取股票列表' })
  findAll(@Query() query: StockListQueryDto) {
    return this.stockService.findAll(query)
  }

  @Get(':code')
  @ApiOperation({ summary: '获取股票详情' })
  findOne(@Param('code') code: string) {
    return this.stockService.findOne(code)
  }
}
