import { Injectable } from '@nestjs/common'
import {
  TUSHARE_HK_HOLD_FIELDS,
  TUSHARE_INDEX_WEIGHT_FIELDS,
  TUSHARE_STK_FACTOR_FIELDS,
  TUSHARE_STK_LIMIT_FIELDS,
  TUSHARE_STK_SURV_FIELDS,
  TUSHARE_SUSPEND_D_FIELDS,
  TushareApiName,
} from 'src/constant/tushare.constant'
import { TushareClient } from './tushare-client.service'

@Injectable()
export class FactorDataApiService {
  constructor(private readonly client: TushareClient) {}

  getStkLimitByTradeDate(tradeDate: string) {
    return this.client.call({
      api_name: TushareApiName.STK_LIMIT,
      params: { trade_date: tradeDate },
      fields: [...TUSHARE_STK_LIMIT_FIELDS],
    })
  }

  getSuspendDByTradeDate(tradeDate: string) {
    return this.client.call({
      api_name: TushareApiName.SUSPEND_D,
      params: { trade_date: tradeDate },
      fields: [...TUSHARE_SUSPEND_D_FIELDS],
    })
  }

  getIndexWeightByMonth(indexCode: string, startDate: string, endDate: string) {
    return this.client.call({
      api_name: TushareApiName.INDEX_WEIGHT,
      params: { index_code: indexCode, start_date: startDate, end_date: endDate },
      fields: [...TUSHARE_INDEX_WEIGHT_FIELDS],
    })
  }

  /** 按交易日获取沪深股通持股明细 */
  getHkHoldByTradeDate(tradeDate: string) {
    return this.client.call({
      api_name: TushareApiName.HK_HOLD,
      params: { trade_date: tradeDate },
      fields: [...TUSHARE_HK_HOLD_FIELDS],
    })
  }

  /**
   * 按交易日获取全市场技术因子
   * @param tradeDate 交易日（YYYYMMDD 字符串）
   */
  getStkFactorByTradeDate(tradeDate: string) {
    return this.client.call({
      api_name: TushareApiName.STK_FACTOR,
      params: { trade_date: tradeDate },
      fields: [...TUSHARE_STK_FACTOR_FIELDS],
    })
  }

  /**
   * 按股票代码获取技术因子历史
   * @param tsCode 股票代码
   * @param startDate 起始日期（YYYYMMDD）
   * @param endDate 截止日期（YYYYMMDD）
   */
  getStkFactorByCode(tsCode: string, startDate: string, endDate: string) {
    return this.client.call({
      api_name: TushareApiName.STK_FACTOR,
      params: { ts_code: tsCode, start_date: startDate, end_date: endDate },
      fields: [...TUSHARE_STK_FACTOR_FIELDS],
    })
  }

  /** 按交易日获取技术面因子 */
  getStkSurvByTradeDate(tradeDate: string) {
    return this.client.call({
      api_name: TushareApiName.STK_SURV,
      params: { trade_date: tradeDate },
      fields: [...TUSHARE_STK_SURV_FIELDS],
    })
  }
}
