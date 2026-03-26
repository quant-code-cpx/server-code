import { Body, Controller, Post } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { MarketService } from './market.service'
import { MoneyFlowQueryDto } from './dto/money-flow-query.dto'
import { ApiSuccessResponse } from 'src/common/decorators/api-success-response.decorator'
import {
  HsgtFlowHistoryDto,
  IndexQuoteItemDto,
  MarketMoneyFlowItemDto,
  MarketSentimentDto,
  MarketValuationDto,
  SectorFlowDataDto,
} from './dto/market-response.dto'

@ApiTags('Market - 市场与行业')
@Controller('market')
export class MarketController {
  constructor(private readonly marketService: MarketService) {}

  @Post('money-flow')
  @ApiOperation({ summary: '获取市场整体资金流入流出' })
  @ApiSuccessResponse(MarketMoneyFlowItemDto, { isArray: true })
  getMarketMoneyFlow(@Body() query: MoneyFlowQueryDto) {
    return this.marketService.getMarketMoneyFlow(query)
  }

  @Post('sector-flow')
  @ApiOperation({ summary: '获取行业板块涨跌及资金流向' })
  @ApiSuccessResponse(SectorFlowDataDto)
  getSectorFlow(@Body() query: MoneyFlowQueryDto) {
    return this.marketService.getSectorFlow(query)
  }

  @Post('sentiment')
  @ApiOperation({ summary: '获取市场情绪（涨跌家数统计，按 pct_chg 分桶）' })
  @ApiSuccessResponse(MarketSentimentDto)
  getMarketSentiment(@Body() query: MoneyFlowQueryDto) {
    return this.marketService.getMarketSentiment(query)
  }

  @Post('valuation')
  @ApiOperation({ summary: '获取全市场整体 PE_TTM / PB 中位数及历史分位' })
  @ApiSuccessResponse(MarketValuationDto)
  getMarketValuation(@Body() query: MoneyFlowQueryDto) {
    return this.marketService.getMarketValuation(query)
  }

  @Post('index-quote')
  @ApiOperation({ summary: '获取核心指数行情（上证指数、深证成指、创业板指、沪深300、中证500等）' })
  @ApiSuccessResponse(IndexQuoteItemDto, { isArray: true })
  getIndexQuote(@Body() query: MoneyFlowQueryDto) {
    return this.marketService.getIndexQuote(query)
  }

  @Post('hsgt-flow')
  @ApiOperation({ summary: '获取沪深港通北向/南向资金流向（近 20 日趋势）' })
  @ApiSuccessResponse(HsgtFlowHistoryDto)
  getHsgtFlow(@Body() query: MoneyFlowQueryDto) {
    return this.marketService.getHsgtFlow(query)
  }
}
