import { Injectable } from '@nestjs/common'
import {
  TUSHARE_BALANCE_SHEET_FIELDS,
  TUSHARE_CASHFLOW_FIELDS,
  TUSHARE_DISCLOSURE_DATE_FIELDS,
  TUSHARE_DIVIDEND_FIELDS,
  TUSHARE_EXPRESS_FIELDS,
  TUSHARE_FINA_AUDIT_FIELDS,
  TUSHARE_FINA_INDICATOR_FIELDS,
  TUSHARE_FINA_MAINBZ_FIELDS,
  TUSHARE_FORECAST_FIELDS,
  TUSHARE_INCOME_FIELDS,
  TUSHARE_PLEDGE_STAT_FIELDS,
  TUSHARE_REPURCHASE_FIELDS,
  TUSHARE_STK_HOLDERNUMBER_FIELDS,
  TUSHARE_STK_HOLDERTRADE_FIELDS,
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

  /** 获取指定股票的全部资产负债表历史 */
  getBalanceSheetByTsCode(tsCode: string) {
    return this.client.call({
      api_name: TushareApiName.BALANCE_SHEET,
      params: { ts_code: tsCode },
      fields: [...TUSHARE_BALANCE_SHEET_FIELDS],
    })
  }

  /** 获取指定股票的全部现金流量表历史 */
  getCashflowByTsCode(tsCode: string) {
    return this.client.call({
      api_name: TushareApiName.CASHFLOW,
      params: { ts_code: tsCode },
      fields: [...TUSHARE_CASHFLOW_FIELDS],
    })
  }

  /** 按报告期获取全市场业绩预告（forecast_vip，需 5000+ 积分） */
  getForecastByPeriod(period: string) {
    return this.client.call({
      api_name: TushareApiName.FORECAST,
      params: { period },
      fields: [...TUSHARE_FORECAST_FIELDS],
    })
  }

  /** 按公告日期获取全市场股东人数 */
  getStkHolderNumberByAnnDate(annDate: string) {
    return this.client.call({
      api_name: TushareApiName.STK_HOLDER_NUMBER,
      params: { ann_date: annDate },
      fields: [...TUSHARE_STK_HOLDERNUMBER_FIELDS],
    })
  }

  /** 按公告日期范围获取股东人数（用于回补） */
  getStkHolderNumberByDateRange(startDate: string, endDate: string) {
    return this.client.call({
      api_name: TushareApiName.STK_HOLDER_NUMBER,
      params: { start_date: startDate, end_date: endDate },
      fields: [...TUSHARE_STK_HOLDERNUMBER_FIELDS],
    })
  }

  /** 按公告日获取当日全市场股东增减持公告 */
  getStkHolderTradeByAnnDate(annDate: string) {
    return this.client.call({
      api_name: TushareApiName.STK_HOLDER_TRADE,
      params: { ann_date: annDate },
      fields: [...TUSHARE_STK_HOLDERTRADE_FIELDS],
    })
  }

  /** 按日期范围获取股东增减持（用于回补） */
  getStkHolderTradeByDateRange(startDate: string, endDate: string) {
    return this.client.call({
      api_name: TushareApiName.STK_HOLDER_TRADE,
      params: { start_date: startDate, end_date: endDate },
      fields: [...TUSHARE_STK_HOLDERTRADE_FIELDS],
    })
  }

  /** 获取指定股票的全部股权质押统计 */
  getPledgeStatByTsCode(tsCode: string) {
    return this.client.call({
      api_name: TushareApiName.PLEDGE_STAT,
      params: { ts_code: tsCode },
      fields: [...TUSHARE_PLEDGE_STAT_FIELDS],
    })
  }

  /** 获取指定股票的全部财务审计意见历史 */
  getFinaAuditByTsCode(tsCode: string) {
    return this.client.call({
      api_name: TushareApiName.FINA_AUDIT,
      params: { ts_code: tsCode },
      fields: [...TUSHARE_FINA_AUDIT_FIELDS],
    })
  }

  /** 按报告期获取全市场财报披露计划 */
  getDisclosureDateByPeriod(period: string) {
    return this.client.call({
      api_name: TushareApiName.DISCLOSURE_DATE,
      params: { end_date: period },
      fields: [...TUSHARE_DISCLOSURE_DATE_FIELDS],
    })
  }

  /** 按股票代码获取主营业务构成 */
  getFinaMainbzByTsCode(tsCode: string) {
    return this.client.call({
      api_name: TushareApiName.FINA_MAINBZ,
      params: { ts_code: tsCode, type: 'P' },
      fields: [...TUSHARE_FINA_MAINBZ_FIELDS],
    })
  }

  /** 按公告日获取当日回购公告 */
  getRepurchaseByAnnDate(annDate: string) {
    return this.client.call({
      api_name: TushareApiName.REPURCHASE,
      params: { ann_date: annDate },
      fields: [...TUSHARE_REPURCHASE_FIELDS],
    })
  }

  /** 按日期范围获取回购公告（用于回补） */
  getRepurchaseByDateRange(startDate: string, endDate: string) {
    return this.client.call({
      api_name: TushareApiName.REPURCHASE,
      params: { start_date: startDate, end_date: endDate },
      fields: [...TUSHARE_REPURCHASE_FIELDS],
    })
  }
}
