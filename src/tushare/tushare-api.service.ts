import { Injectable } from '@nestjs/common'
import {
  MoneyflowContentType,
  StockExchange,
  StockListStatus,
  TUSHARE_ADJ_FACTOR_FIELDS,
  TUSHARE_DAILY_BASIC_FIELDS,
  TUSHARE_EXPRESS_FIELDS,
  TUSHARE_MONEYFLOW_DC_FIELDS,
  TUSHARE_MONEYFLOW_IND_DC_FIELDS,
  TUSHARE_MONEYFLOW_MKT_DC_FIELDS,
  TUSHARE_OHLCV_FIELDS,
  TUSHARE_STOCK_BASIC_FIELDS,
  TUSHARE_STOCK_COMPANY_FIELDS,
  TUSHARE_TRADE_CAL_FIELDS,
  TushareApiName,
} from 'src/constant/tushare.constant'
import { TushareService } from './tushare.service'

/**
 * TushareApiService
 *
 * 在底层 HTTP 封装之上，进一步提供“按业务含义命名”的接口方法；
 * 这样同步服务只关心“同步什么数据”，无需重复书写 api_name / fields。
 */
@Injectable()
export class TushareApiService {
  constructor(private readonly tushareService: TushareService) {}

  getStockBasic(listStatus: StockListStatus, limit?: number) {
    return this.tushareService.call({
      api_name: TushareApiName.STOCK_BASIC,
      params: { list_status: listStatus },
      fields: [...TUSHARE_STOCK_BASIC_FIELDS],
      limit,
    })
  }

  getStockCompany(exchange: StockExchange, limit?: number) {
    return this.tushareService.call({
      api_name: TushareApiName.STOCK_COMPANY,
      params: { exchange },
      fields: [...TUSHARE_STOCK_COMPANY_FIELDS],
      limit,
    })
  }

  getTradeCalendar(exchange: StockExchange, startDate: string, endDate: string, limit?: number) {
    return this.tushareService.call({
      api_name: TushareApiName.TRADE_CAL,
      params: {
        exchange,
        start_date: startDate,
        end_date: endDate,
      },
      fields: [...TUSHARE_TRADE_CAL_FIELDS],
      limit,
    })
  }

  getDailyByTradeDate(tradeDate: string, limit?: number) {
    return this.tushareService.call({
      api_name: TushareApiName.DAILY,
      params: { trade_date: tradeDate },
      fields: [...TUSHARE_OHLCV_FIELDS],
      limit,
    })
  }

  getWeeklyByTradeDate(tradeDate: string, limit?: number) {
    return this.tushareService.call({
      api_name: TushareApiName.WEEKLY,
      params: { trade_date: tradeDate },
      fields: [...TUSHARE_OHLCV_FIELDS],
      limit,
    })
  }

  getMonthlyByTradeDate(tradeDate: string, limit?: number) {
    return this.tushareService.call({
      api_name: TushareApiName.MONTHLY,
      params: { trade_date: tradeDate },
      fields: [...TUSHARE_OHLCV_FIELDS],
      limit,
    })
  }

  getAdjFactorByTradeDate(tradeDate: string, limit?: number) {
    return this.tushareService.call({
      api_name: TushareApiName.ADJ_FACTOR,
      params: { trade_date: tradeDate },
      fields: [...TUSHARE_ADJ_FACTOR_FIELDS],
      limit,
    })
  }

  getDailyBasicByTradeDate(tradeDate: string, limit?: number) {
    return this.tushareService.call({
      api_name: TushareApiName.DAILY_BASIC,
      params: { trade_date: tradeDate },
      fields: [...TUSHARE_DAILY_BASIC_FIELDS],
      limit,
    })
  }

  getMoneyflowDcByTradeDate(tradeDate: string, limit?: number) {
    return this.tushareService.call({
      api_name: TushareApiName.MONEYFLOW_DC,
      params: { trade_date: tradeDate },
      fields: [...TUSHARE_MONEYFLOW_DC_FIELDS],
      limit,
    })
  }

  getMoneyflowIndDcByTradeDate(tradeDate: string, contentType: MoneyflowContentType, limit?: number) {
    return this.tushareService.call({
      api_name: TushareApiName.MONEYFLOW_IND_DC,
      params: {
        trade_date: tradeDate,
        content_type: contentType,
      },
      fields: [...TUSHARE_MONEYFLOW_IND_DC_FIELDS],
      limit,
    })
  }

  getMoneyflowMktDcByTradeDate(tradeDate: string, limit?: number) {
    return this.tushareService.call({
      api_name: TushareApiName.MONEYFLOW_MKT_DC,
      params: { trade_date: tradeDate },
      fields: [...TUSHARE_MONEYFLOW_MKT_DC_FIELDS],
      limit,
    })
  }

  getExpress(startDate: string, endDate: string, limit?: number) {
    return this.tushareService.call({
      api_name: TushareApiName.EXPRESS,
      params: {
        start_date: startDate,
        end_date: endDate,
      },
      fields: [...TUSHARE_EXPRESS_FIELDS],
      limit,
    })
  }
}
