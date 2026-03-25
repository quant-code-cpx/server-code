import { Injectable } from '@nestjs/common'
import {
  TUSHARE_ADJ_FACTOR_FIELDS,
  TUSHARE_DAILY_BASIC_FIELDS,
  TUSHARE_OHLCV_FIELDS,
  TushareApiName,
} from 'src/constant/tushare.constant'
import { TushareClient } from './tushare-client.service'

/** 行情数据 API：日线、周线、月线、复权因子、每日指标 */
@Injectable()
export class MarketApiService {
  constructor(private readonly client: TushareClient) {}

  /** 按交易日获取全市场日线 */
  getDailyByTradeDate(tradeDate: string) {
    return this.client.call({
      api_name: TushareApiName.DAILY,
      params: { trade_date: tradeDate },
      fields: [...TUSHARE_OHLCV_FIELDS],
    })
  }

  /** 按周末交易日获取全市场周线 */
  getWeeklyByTradeDate(tradeDate: string) {
    return this.client.call({
      api_name: TushareApiName.WEEKLY,
      params: { trade_date: tradeDate },
      fields: [...TUSHARE_OHLCV_FIELDS],
    })
  }

  /** 按月末交易日获取全市场月线 */
  getMonthlyByTradeDate(tradeDate: string) {
    return this.client.call({
      api_name: TushareApiName.MONTHLY,
      params: { trade_date: tradeDate },
      fields: [...TUSHARE_OHLCV_FIELDS],
    })
  }

  /** 按交易日获取全市场复权因子 */
  getAdjFactorByTradeDate(tradeDate: string) {
    return this.client.call({
      api_name: TushareApiName.ADJ_FACTOR,
      params: { trade_date: tradeDate },
      fields: [...TUSHARE_ADJ_FACTOR_FIELDS],
    })
  }

  /** 按交易日获取全市场每日指标（估值、换手率等） */
  getDailyBasicByTradeDate(tradeDate: string) {
    return this.client.call({
      api_name: TushareApiName.DAILY_BASIC,
      params: { trade_date: tradeDate },
      fields: [...TUSHARE_DAILY_BASIC_FIELDS],
    })
  }
}
