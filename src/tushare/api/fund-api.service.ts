import { Injectable } from '@nestjs/common'
import {
  TUSHARE_FUND_BASIC_FIELDS,
  TUSHARE_FUND_DAILY_FIELDS,
  TUSHARE_FUND_NAV_FIELDS,
  TUSHARE_FUND_PORTFOLIO_FIELDS,
  TUSHARE_FUND_SHARE_FIELDS,
  TUSHARE_FUND_ADJ_FIELDS,
  TushareApiName,
} from 'src/constant/tushare.constant'
import { TushareClient } from './tushare-client.service'

/** 基金数据 API：基金列表 / 净值 / ETF 日线 / 持仓 / 份额 */
@Injectable()
export class FundApiService {
  constructor(private readonly client: TushareClient) {}

  /** 获取基金列表（E=场内 / O=场外） */
  getFundBasic(market: 'E' | 'O') {
    return this.client.call({
      api_name: TushareApiName.FUND_BASIC,
      params: { market },
      fields: [...TUSHARE_FUND_BASIC_FIELDS],
    })
  }

  /** 按基金代码获取净值 */
  getFundNavByTsCode(tsCode: string, startDate?: string, endDate?: string) {
    return this.client.call({
      api_name: TushareApiName.FUND_NAV,
      params: { ts_code: tsCode, start_date: startDate, end_date: endDate },
      fields: [...TUSHARE_FUND_NAV_FIELDS],
    })
  }

  /** 按交易日获取 ETF 日线行情 */
  getFundDailyByTradeDate(tradeDate: string) {
    return this.client.call({
      api_name: TushareApiName.FUND_DAILY,
      params: { trade_date: tradeDate },
      fields: [...TUSHARE_FUND_DAILY_FIELDS],
    })
  }

  /** 按基金代码获取季度持仓明细（可选日期范围） */
  getFundPortfolioByTsCode(tsCode: string, startDate?: string, endDate?: string) {
    return this.client.call({
      api_name: TushareApiName.FUND_PORTFOLIO,
      params: { ts_code: tsCode, start_date: startDate, end_date: endDate },
      fields: [...TUSHARE_FUND_PORTFOLIO_FIELDS],
    })
  }

  /** 按基金代码获取份额变动（可选日期范围） */
  getFundShareByTsCode(tsCode: string, startDate?: string, endDate?: string) {
    return this.client.call({
      api_name: TushareApiName.FUND_SHARE,
      params: { ts_code: tsCode, start_date: startDate, end_date: endDate },
      fields: [...TUSHARE_FUND_SHARE_FIELDS],
    })
  }

  /** 按基金代码获取复权因子 */
  getFundAdjByTsCode(tsCode: string, startDate?: string, endDate?: string) {
    return this.client.call({
      api_name: TushareApiName.FUND_ADJ,
      params: { ts_code: tsCode, start_date: startDate, end_date: endDate },
      fields: [...TUSHARE_FUND_ADJ_FIELDS],
    })
  }
}
