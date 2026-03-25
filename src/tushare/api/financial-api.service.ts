import { Injectable } from '@nestjs/common'
import {
  TUSHARE_DIVIDEND_FIELDS,
  TUSHARE_EXPRESS_FIELDS,
  TUSHARE_FINA_INDICATOR_FIELDS,
  TUSHARE_INCOME_FIELDS,
  TUSHARE_TOP10_FLOAT_HOLDERS_FIELDS,
  TUSHARE_TOP10_HOLDERS_FIELDS,
  TushareApiName,
} from 'src/constant/tushare.constant'
import { TushareClient } from './tushare-client.service'

/** 财务数据 API：业绩快报、财务指标、分红、前十大股东 */
@Injectable()
export class FinancialApiService {
  constructor(private readonly client: TushareClient) {}

  /** 获取指定股票的全部利润表历史 */
  getIncomeByTsCode(tsCode: string) {
    return this.client.call({
      api_name: TushareApiName.INCOME,
      params: { ts_code: tsCode },
      fields: [...TUSHARE_INCOME_FIELDS],
    })
  }

  /** 按日期区间获取业绩快报 */
  getExpress(startDate: string, endDate: string) {
    return this.client.call({
      api_name: TushareApiName.EXPRESS,
      params: { start_date: startDate, end_date: endDate },
      fields: [...TUSHARE_EXPRESS_FIELDS],
    })
  }

  /** 获取指定股票的全部业绩快报历史 */
  getExpressByTsCode(tsCode: string) {
    return this.client.call({
      api_name: TushareApiName.EXPRESS,
      params: { ts_code: tsCode },
      fields: [...TUSHARE_EXPRESS_FIELDS],
    })
  }

  /** 按股票和报告期获取财务指标 */
  getFinaIndicatorByTsCodeAndPeriod(tsCode: string, period: string) {
    return this.client.call({
      api_name: TushareApiName.FINA_INDICATOR,
      params: { ts_code: tsCode, period },
      fields: [...TUSHARE_FINA_INDICATOR_FIELDS],
    })
  }

  /** 按股票和日期范围获取财务指标 */
  getFinaIndicatorByTsCodeAndDateRange(tsCode: string, startDate: string, endDate: string) {
    return this.client.call({
      api_name: TushareApiName.FINA_INDICATOR,
      params: { ts_code: tsCode, start_date: startDate, end_date: endDate },
      fields: [...TUSHARE_FINA_INDICATOR_FIELDS],
    })
  }

  /** 获取指定股票的所有分红记录 */
  getDividendByTsCode(tsCode: string) {
    return this.client.call({
      api_name: TushareApiName.DIVIDEND,
      params: { ts_code: tsCode },
      fields: [...TUSHARE_DIVIDEND_FIELDS],
    })
  }

  /** 按日期区间获取分红公告 */
  getDividendByDateRange(startDate: string, endDate: string) {
    return this.client.call({
      api_name: TushareApiName.DIVIDEND,
      params: { start_date: startDate, end_date: endDate },
      fields: [...TUSHARE_DIVIDEND_FIELDS],
    })
  }

  /** 按报告期获取全市场前十大股东 */
  getTop10HoldersByPeriod(period: string) {
    return this.client.call({
      api_name: TushareApiName.TOP10_HOLDERS,
      params: { period },
      fields: [...TUSHARE_TOP10_HOLDERS_FIELDS],
    })
  }

  /** 获取指定股票最近一段时间的前十大股东 */
  getTop10HoldersByTsCodeAndDateRange(tsCode: string, startDate: string, endDate: string) {
    return this.client.call({
      api_name: TushareApiName.TOP10_HOLDERS,
      params: { ts_code: tsCode, start_date: startDate, end_date: endDate },
      fields: [...TUSHARE_TOP10_HOLDERS_FIELDS],
    })
  }

  /** 按报告期获取全市场前十大流通股东 */
  getTop10FloatHoldersByPeriod(period: string) {
    return this.client.call({
      api_name: TushareApiName.TOP10_FLOAT_HOLDERS,
      params: { period },
      fields: [...TUSHARE_TOP10_FLOAT_HOLDERS_FIELDS],
    })
  }

  /** 获取指定股票最近一段时间的前十大流通股东 */
  getTop10FloatHoldersByTsCodeAndDateRange(tsCode: string, startDate: string, endDate: string) {
    return this.client.call({
      api_name: TushareApiName.TOP10_FLOAT_HOLDERS,
      params: { ts_code: tsCode, start_date: startDate, end_date: endDate },
      fields: [...TUSHARE_TOP10_FLOAT_HOLDERS_FIELDS],
    })
  }
}
