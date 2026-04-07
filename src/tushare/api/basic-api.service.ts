import { Injectable } from '@nestjs/common'
import {
  StockExchange,
  StockListStatus,
  TUSHARE_CB_BASIC_FIELDS,
  TUSHARE_INDEX_CLASSIFY_FIELDS,
  TUSHARE_INDEX_MEMBER_ALL_FIELDS,
  TUSHARE_STOCK_BASIC_FIELDS,
  TUSHARE_STOCK_COMPANY_FIELDS,
  TUSHARE_TRADE_CAL_FIELDS,
  TushareApiName,
} from 'src/constant/tushare.constant'
import { TushareClient } from './tushare-client.service'

/** 基础数据 API：股票列表、上市公司信息、交易日历 */
@Injectable()
export class BasicApiService {
  constructor(private readonly client: TushareClient) {}

  getStockBasic(listStatus: StockListStatus) {
    return this.client.call({
      api_name: TushareApiName.STOCK_BASIC,
      params: { list_status: listStatus },
      fields: [...TUSHARE_STOCK_BASIC_FIELDS],
    })
  }

  getStockCompany(exchange: StockExchange) {
    return this.client.call({
      api_name: TushareApiName.STOCK_COMPANY,
      params: { exchange },
      fields: [...TUSHARE_STOCK_COMPANY_FIELDS],
    })
  }

  getTradeCalendar(exchange: StockExchange, startDate: string, endDate: string) {
    return this.client.call({
      api_name: TushareApiName.TRADE_CAL,
      params: { exchange, start_date: startDate, end_date: endDate },
      fields: [...TUSHARE_TRADE_CAL_FIELDS],
    })
  }

  /** 获取申万行业分类目录（按 level 和 src 筛选） */
  getIndexClassify(level: string, src = 'SW2021') {
    return this.client.call({
      api_name: TushareApiName.INDEX_CLASSIFY,
      params: { level, src },
      fields: [...TUSHARE_INDEX_CLASSIFY_FIELDS],
    })
  }

  /** 按一级行业代码获取申万行业成分 */
  getIndexMemberAllByL1Code(l1Code: string) {
    return this.client.call({
      api_name: TushareApiName.INDEX_MEMBER_ALL,
      params: { l1_code: l1Code },
      fields: [...TUSHARE_INDEX_MEMBER_ALL_FIELDS],
    })
  }

  /** 获取全部可转债基础信息 */
  getCbBasicAll() {
    return this.client.call({
      api_name: TushareApiName.CB_BASIC,
      params: {},
      fields: [...TUSHARE_CB_BASIC_FIELDS],
    })
  }
}
