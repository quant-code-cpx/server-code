import { Body, Controller, Post } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { MarketService } from './market.service'
import { MoneyFlowQueryDto } from './dto/money-flow-query.dto'
import { IndexTrendQueryDto } from './dto/index-trend-query.dto'
import { SectorRankingQueryDto } from './dto/sector-ranking-query.dto'
import { VolOverviewQueryDto } from './dto/vol-overview-query.dto'
import { SentimentTrendQueryDto } from './dto/sentiment-trend-query.dto'
import { ValuationTrendQueryDto } from './dto/valuation-trend-query.dto'
import { ApiSuccessResponse } from 'src/common/decorators/api-success-response.decorator'
import {
  ChangeDistributionResponseDto,
  HsgtFlowHistoryDto,
  IndexQuoteItemDto,
  IndexTrendResponseDto,
  MarketMoneyFlowItemDto,
  MarketSentimentDto,
  MarketValuationDto,
  SectorFlowDataDto,
  SectorRankingResponseDto,
  SentimentTrendResponseDto,
  ValuationTrendResponseDto,
  VolumeOverviewResponseDto,
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

  @Post('index-trend')
  @ApiOperation({ summary: '获取核心指数走势（收盘价/涨跌幅序列）' })
  @ApiSuccessResponse(IndexTrendResponseDto)
  getIndexTrend(@Body() query: IndexTrendQueryDto) {
    return this.marketService.getIndexTrend(query)
  }

  @Post('change-distribution')
  @ApiOperation({ summary: '获取全A股涨跌幅直方图分布' })
  @ApiSuccessResponse(ChangeDistributionResponseDto)
  getChangeDistribution(@Body() query: MoneyFlowQueryDto) {
    return this.marketService.getChangeDistribution(query)
  }

  @Post('sector-ranking')
  @ApiOperation({ summary: '获取行业板块涨跌排行（按涨跌幅或净流入排序）' })
  @ApiSuccessResponse(SectorRankingResponseDto)
  getSectorRanking(@Body() query: SectorRankingQueryDto) {
    return this.marketService.getSectorRanking(query)
  }

  @Post('volume-overview')
  @ApiOperation({ summary: '获取近N日市场成交额概况（全A/上证/深证）' })
  @ApiSuccessResponse(VolumeOverviewResponseDto)
  getVolumeOverview(@Body() query: VolOverviewQueryDto) {
    return this.marketService.getVolumeOverview(query)
  }

  @Post('sentiment-trend')
  @ApiOperation({ summary: '获取近N日涨跌家数趋势' })
  @ApiSuccessResponse(SentimentTrendResponseDto)
  getSentimentTrend(@Body() query: SentimentTrendQueryDto) {
    return this.marketService.getSentimentTrend(query)
  }

  @Post('valuation-trend')
  @ApiOperation({ summary: '获取全A市场PE/PB估值趋势' })
  @ApiSuccessResponse(ValuationTrendResponseDto)
  getValuationTrend(@Body() query: ValuationTrendQueryDto) {
    return this.marketService.getValuationTrend(query)
  }
}
