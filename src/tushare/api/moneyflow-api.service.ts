import { Injectable } from '@nestjs/common'
import {
  MoneyflowContentType,
  TUSHARE_MONEYFLOW_DC_FIELDS,
  TUSHARE_MONEYFLOW_IND_DC_FIELDS,
  TUSHARE_MONEYFLOW_MKT_DC_FIELDS,
  TushareApiName,
} from 'src/constant/tushare.constant'
import { TushareClient } from './tushare-client.service'

/** 资金流向 API：个股、行业/概念/地域、大盘 */
@Injectable()
export class MoneyflowApiService {
  constructor(private readonly client: TushareClient) {}

  /** 按交易日获取个股资金流向 */
  getMoneyflowDcByTradeDate(tradeDate: string) {
    return this.client.call({
      api_name: TushareApiName.MONEYFLOW_DC,
      params: { trade_date: tradeDate },
      fields: [...TUSHARE_MONEYFLOW_DC_FIELDS],
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
}
