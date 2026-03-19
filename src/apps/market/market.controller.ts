import { Body, Controller, Post } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { MarketService } from './market.service'
import { MoneyFlowQueryDto } from './dto/money-flow-query.dto'

@ApiTags('Market - 市场与行业')
@Controller('market')
export class MarketController {
  constructor(private readonly marketService: MarketService) {}

  @Post('money-flow')
  @ApiOperation({ summary: '获取市场整体资金流入流出' })
  getMarketMoneyFlow(@Body() query: MoneyFlowQueryDto) {
    return this.marketService.getMarketMoneyFlow(query)
  }

  @Post('sector-flow')
  @ApiOperation({ summary: '获取行业板块涨跌及资金流向' })
  getSectorFlow(@Body() query: MoneyFlowQueryDto) {
    return this.marketService.getSectorFlow(query)
  }
}

