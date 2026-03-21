/**
 * TushareDebugController — 仅用于开发调试，不入库，直接返回原始 API 数据。
 *
 * 所有端点均为 GET 请求，标记 @Public() 跳过 JWT 鉴权。
 * ⚠️ 生产环境请勿暴露此控制器（通过 NODE_ENV 或路由守卫限制）。
 *
 * 端点列表（全部挂载在 /tushare/debug/ 前缀下）：
 *   GET /tushare/debug/stock-basic?list_status=L
 *   GET /tushare/debug/stock-company?exchange=SSE
 *   GET /tushare/debug/trade-cal?exchange=SSE&start_date=20240101&end_date=20240131
 *   GET /tushare/debug/daily?trade_date=20240101
 *   GET /tushare/debug/weekly?trade_date=20240101
 *   GET /tushare/debug/monthly?trade_date=20240101
 *   GET /tushare/debug/adj-factor?trade_date=20240101
 *   GET /tushare/debug/daily-basic?trade_date=20240101
 *   GET /tushare/debug/moneyflow-dc?trade_date=20240101
 *   GET /tushare/debug/moneyflow-ind-dc?trade_date=20240101&content_type=行业
 *   GET /tushare/debug/moneyflow-mkt-dc?trade_date=20240101
 *   GET /tushare/debug/express?start_date=20240101&end_date=20240131
 */
import { Controller, Get, Logger, Query } from '@nestjs/common'
import { Public } from 'src/common/decorators/public.decorator'
import { MoneyflowContentType, StockExchange, StockListStatus } from 'src/constant/tushare.constant'
import { TushareApiService } from './tushare-api.service'

@Public()
@Controller('tushare/debug')
export class TushareDebugController {
  private readonly logger = new Logger(TushareDebugController.name)

  constructor(private readonly tushareApiService: TushareApiService) {}

  @Get('stock-basic')
  async stockBasic(@Query('list_status') listStatus: string = 'L') {
    const data = await this.tushareApiService.getStockBasic(listStatus as StockListStatus, 1)
    this.logger.log(`[stock-basic] list_status=${listStatus}, returned ${data.length} records`)
    console.log('[DEBUG stock-basic] record:', JSON.stringify(data[0] ?? null, null, 2))
    console.log('[DEBUG stock-basic] keys:', data[0] ? Object.keys(data[0]) : [])
    return { total: data.length, record: data[0] ?? null }
  }

  @Get('stock-company')
  async stockCompany(@Query('exchange') exchange: string = 'SSE') {
    const data = await this.tushareApiService.getStockCompany(exchange as StockExchange, 1)
    this.logger.log(`[stock-company] exchange=${exchange}, returned ${data.length} records`)
    console.log('[DEBUG stock-company] record:', JSON.stringify(data[0] ?? null, null, 2))
    console.log('[DEBUG stock-company] keys:', data[0] ? Object.keys(data[0]) : [])
    return { total: data.length, record: data[0] ?? null }
  }

  @Get('trade-cal')
  async tradeCal(
    @Query('exchange') exchange: string = 'SSE',
    @Query('start_date') startDate: string = '20240101',
    @Query('end_date') endDate: string = '20240131',
  ) {
    const data = await this.tushareApiService.getTradeCalendar(exchange as StockExchange, startDate, endDate, 1)
    this.logger.log(`[trade-cal] exchange=${exchange} ${startDate}~${endDate}, returned ${data.length} records`)
    console.log('[DEBUG trade-cal] record:', JSON.stringify(data[0] ?? null, null, 2))
    console.log('[DEBUG trade-cal] keys:', data[0] ? Object.keys(data[0]) : [])
    return { total: data.length, record: data[0] ?? null }
  }

  @Get('daily')
  async daily(@Query('trade_date') tradeDate: string) {
    this.assertTradeDate(tradeDate, 'daily')
    const data = await this.tushareApiService.getDailyByTradeDate(tradeDate, 1)
    this.logger.log(`[daily] trade_date=${tradeDate}, returned ${data.length} records`)
    console.log('[DEBUG daily] record:', JSON.stringify(data[0] ?? null, null, 2))
    console.log('[DEBUG daily] keys:', data[0] ? Object.keys(data[0]) : [])
    return { total: data.length, record: data[0] ?? null }
  }

  @Get('weekly')
  async weekly(@Query('trade_date') tradeDate: string) {
    this.assertTradeDate(tradeDate, 'weekly')
    const data = await this.tushareApiService.getWeeklyByTradeDate(tradeDate, 1)
    this.logger.log(`[weekly] trade_date=${tradeDate}, returned ${data.length} records`)
    console.log('[DEBUG weekly] record:', JSON.stringify(data[0] ?? null, null, 2))
    console.log('[DEBUG weekly] keys:', data[0] ? Object.keys(data[0]) : [])
    return { total: data.length, record: data[0] ?? null }
  }

  @Get('monthly')
  async monthly(@Query('trade_date') tradeDate: string) {
    this.assertTradeDate(tradeDate, 'monthly')
    const data = await this.tushareApiService.getMonthlyByTradeDate(tradeDate, 1)
    this.logger.log(`[monthly] trade_date=${tradeDate}, returned ${data.length} records`)
    console.log('[DEBUG monthly] record:', JSON.stringify(data[0] ?? null, null, 2))
    console.log('[DEBUG monthly] keys:', data[0] ? Object.keys(data[0]) : [])
    return { total: data.length, record: data[0] ?? null }
  }

  @Get('adj-factor')
  async adjFactor(@Query('trade_date') tradeDate: string) {
    this.assertTradeDate(tradeDate, 'adj-factor')
    const data = await this.tushareApiService.getAdjFactorByTradeDate(tradeDate, 1)
    this.logger.log(`[adj-factor] trade_date=${tradeDate}, returned ${data.length} records`)
    console.log('[DEBUG adj-factor] record:', JSON.stringify(data[0] ?? null, null, 2))
    console.log('[DEBUG adj-factor] keys:', data[0] ? Object.keys(data[0]) : [])
    return { total: data.length, record: data[0] ?? null }
  }

  @Get('daily-basic')
  async dailyBasic(@Query('trade_date') tradeDate: string) {
    this.assertTradeDate(tradeDate, 'daily-basic')
    const data = await this.tushareApiService.getDailyBasicByTradeDate(tradeDate, 1)
    this.logger.log(`[daily-basic] trade_date=${tradeDate}, returned ${data.length} records`)
    console.log('[DEBUG daily-basic] record:', JSON.stringify(data[0] ?? null, null, 2))
    console.log('[DEBUG daily-basic] keys:', data[0] ? Object.keys(data[0]) : [])
    return { total: data.length, record: data[0] ?? null }
  }

  @Get('moneyflow-dc')
  async moneyflowDc(@Query('trade_date') tradeDate: string) {
    this.assertTradeDate(tradeDate, 'moneyflow-dc')
    const data = await this.tushareApiService.getMoneyflowDcByTradeDate(tradeDate, 1)
    this.logger.log(`[moneyflow-dc] trade_date=${tradeDate}, returned ${data.length} records`)
    console.log('[DEBUG moneyflow-dc] record:', JSON.stringify(data[0] ?? null, null, 2))
    console.log('[DEBUG moneyflow-dc] keys:', data[0] ? Object.keys(data[0]) : [])
    return { total: data.length, record: data[0] ?? null }
  }

  @Get('moneyflow-ind-dc')
  async moneyflowIndDc(@Query('trade_date') tradeDate: string, @Query('content_type') contentType: string = '行业') {
    this.assertTradeDate(tradeDate, 'moneyflow-ind-dc')
    const data = await this.tushareApiService.getMoneyflowIndDcByTradeDate(
      tradeDate,
      contentType as MoneyflowContentType,
      1,
    )
    this.logger.log(
      `[moneyflow-ind-dc] trade_date=${tradeDate} content_type=${contentType}, returned ${data.length} records`,
    )
    console.log('[DEBUG moneyflow-ind-dc] record:', JSON.stringify(data[0] ?? null, null, 2))
    console.log('[DEBUG moneyflow-ind-dc] keys:', data[0] ? Object.keys(data[0]) : [])
    return { total: data.length, record: data[0] ?? null }
  }

  @Get('moneyflow-mkt-dc')
  async moneyflowMktDc(@Query('trade_date') tradeDate: string) {
    this.assertTradeDate(tradeDate, 'moneyflow-mkt-dc')
    const data = await this.tushareApiService.getMoneyflowMktDcByTradeDate(tradeDate, 1)
    this.logger.log(`[moneyflow-mkt-dc] trade_date=${tradeDate}, returned ${data.length} records`)
    console.log('[DEBUG moneyflow-mkt-dc] record:', JSON.stringify(data[0] ?? null, null, 2))
    console.log('[DEBUG moneyflow-mkt-dc] keys:', data[0] ? Object.keys(data[0]) : [])
    return { total: data.length, record: data[0] ?? null }
  }

  @Get('express')
  async express(@Query('start_date') startDate: string = '20240101', @Query('end_date') endDate: string = '20240131') {
    const data = await this.tushareApiService.getExpress(startDate, endDate, 1)
    this.logger.log(`[express] ${startDate}~${endDate}, returned ${data.length} records`)
    console.log('[DEBUG express] record:', JSON.stringify(data[0] ?? null, null, 2))
    console.log('[DEBUG express] keys:', data[0] ? Object.keys(data[0]) : [])
    return { total: data.length, record: data[0] ?? null }
  }

  private assertTradeDate(tradeDate: string, endpoint: string): void {
    if (!tradeDate || !/^\d{8}$/.test(tradeDate)) {
      throw new Error(`[${endpoint}] trade_date 参数缺失或格式错误，应为 YYYYMMDD，实际值：${tradeDate}`)
    }
  }
}
