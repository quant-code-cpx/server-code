import { Injectable } from '@nestjs/common'
import {
  TUSHARE_BLOCK_TRADE_FIELDS,
  TUSHARE_SHARE_FLOAT_FIELDS,
  TUSHARE_TOP_INST_FIELDS,
  TUSHARE_TOP_LIST_FIELDS,
  TushareApiName,
} from 'src/constant/tushare.constant'
import { TushareClient } from './tushare-client.service'

@Injectable()
export class AlternativeDataApiService {
  constructor(private readonly client: TushareClient) {}

  getTopListByTradeDate(tradeDate: string) {
    return this.client.call({
      api_name: TushareApiName.TOP_LIST,
      params: { trade_date: tradeDate },
      fields: [...TUSHARE_TOP_LIST_FIELDS],
    })
  }

  getTopInstByTradeDate(tradeDate: string) {
    return this.client.call({
      api_name: TushareApiName.TOP_INST,
      params: { trade_date: tradeDate },
      fields: [...TUSHARE_TOP_INST_FIELDS],
    })
  }

  getBlockTradeByTradeDate(tradeDate: string) {
    return this.client.call({
      api_name: TushareApiName.BLOCK_TRADE,
      params: { trade_date: tradeDate },
      fields: [...TUSHARE_BLOCK_TRADE_FIELDS],
    })
  }

  getShareFloat(tsCode: string) {
    return this.client.call({
      api_name: TushareApiName.SHARE_FLOAT,
      params: { ts_code: tsCode },
      fields: [...TUSHARE_SHARE_FLOAT_FIELDS],
    })
  }
}
