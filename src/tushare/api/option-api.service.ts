import { Injectable } from '@nestjs/common'
import { TUSHARE_OPT_BASIC_FIELDS, TUSHARE_OPT_DAILY_FIELDS, TushareApiName } from 'src/constant/tushare.constant'
import { TushareClient } from './tushare-client.service'

/** 期权数据 API：合约信息 / 日线行情 */
@Injectable()
export class OptionApiService {
  constructor(private readonly client: TushareClient) {}

  /** 按交易所获取期权合约信息 */
  getOptBasic(exchange: string) {
    return this.client.call({
      api_name: TushareApiName.OPT_BASIC,
      params: { exchange },
      fields: [...TUSHARE_OPT_BASIC_FIELDS],
    })
  }

  /** 按交易日获取期权日线行情 */
  getOptDailyByTradeDate(tradeDate: string) {
    return this.client.call({
      api_name: TushareApiName.OPT_DAILY,
      params: { trade_date: tradeDate },
      fields: [...TUSHARE_OPT_DAILY_FIELDS],
    })
  }
}
