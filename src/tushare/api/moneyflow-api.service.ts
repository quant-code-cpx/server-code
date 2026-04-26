import { Injectable } from '@nestjs/common'
import {
  MoneyflowContentType,
  TUSHARE_GGT_DAILY_FIELDS,
  TUSHARE_MONEYFLOW_FIELDS,
  TUSHARE_MONEYFLOW_HSGT_FIELDS,
  TUSHARE_MONEYFLOW_IND_DC_FIELDS,
  TUSHARE_MONEYFLOW_MKT_DC_FIELDS,
  TushareApiName,
} from 'src/constant/tushare.constant'
import { TushareClient } from './tushare-client.service'

/** 资金流向 API：个股、行业/概念/地域、大盘、沪深港通 */
@Injectable()
export class MoneyflowApiService {
  constructor(private readonly client: TushareClient) {}

  /** 按交易日获取个股资金流向 */
  getMoneyflowByTradeDate(tradeDate: string) {
    return this.client.call({
      api_name: TushareApiName.MONEYFLOW,
      params: { trade_date: tradeDate },
      fields: [...TUSHARE_MONEYFLOW_FIELDS],
    })
  }

  /** 按交易日获取行业/概念/地域资金流向 */
  getMoneyflowIndDcByTradeDate(tradeDate: string, contentType: MoneyflowContentType) {
    return this.client.call({
      api_name: TushareApiName.MONEYFLOW_IND_DC,
      params: { trade_date: tradeDate, content_type: contentType },
      fields: [...TUSHARE_MONEYFLOW_IND_DC_FIELDS],
    })
  }

  /** 按交易日获取大盘资金流向 */
  getMoneyflowMktDcByTradeDate(tradeDate: string) {
    return this.client.call({
      api_name: TushareApiName.MONEYFLOW_MKT_DC,
      params: { trade_date: tradeDate },
      fields: [...TUSHARE_MONEYFLOW_MKT_DC_FIELDS],
    })
  }

  /** 按日期区间获取沪深港通资金流向（北向/南向）*/
  getMoneyflowHsgtByDateRange(startDate: string, endDate: string) {
    return this.client.call({
      api_name: TushareApiName.MONEYFLOW_HSGT,
      params: { start_date: startDate, end_date: endDate },
      fields: [...TUSHARE_MONEYFLOW_HSGT_FIELDS],
    })
  }

  /** 按日期区间获取港股通每日成交 */
  getGgtDailyByDateRange(startDate: string, endDate: string) {
    return this.client.call({
      api_name: TushareApiName.GGT_DAILY,
      params: { start_date: startDate, end_date: endDate },
      fields: [...TUSHARE_GGT_DAILY_FIELDS],
    })
  }
}
