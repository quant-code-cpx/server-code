import { Injectable } from '@nestjs/common'
import {
  MoneyflowContentType,
  StockExchange,
  StockListStatus,
  TUSHARE_ADJ_FACTOR_FIELDS,
  TUSHARE_DAILY_BASIC_FIELDS,
  TUSHARE_DIVIDEND_FIELDS,
  TUSHARE_EXPRESS_FIELDS,
  TUSHARE_FINA_INDICATOR_FIELDS,
  TUSHARE_MONEYFLOW_DC_FIELDS,
  TUSHARE_MONEYFLOW_IND_DC_FIELDS,
  TUSHARE_MONEYFLOW_MKT_DC_FIELDS,
  TUSHARE_OHLCV_FIELDS,
  TUSHARE_STOCK_BASIC_FIELDS,
  TUSHARE_STOCK_COMPANY_FIELDS,
  TUSHARE_TOP10_FLOAT_HOLDERS_FIELDS,
  TUSHARE_TOP10_HOLDERS_FIELDS,
  TUSHARE_TRADE_CAL_FIELDS,
  TushareApiName,
} from 'src/constant/tushare.constant'
import { TushareService } from './tushare.service'

/**
 * TushareApiService
 *
 * 在底层 HTTP 封装之上，进一步提供“按业务含义命名”的接口方法；
 * 这样同步服务只关心“同步什么数据”，无需重复书写 api_name / fields。
 */
@Injectable()
export class TushareApiService {
  constructor(private readonly tushareService: TushareService) {}

  getStockBasic(listStatus: StockListStatus, limit?: number) {
    return this.tushareService.call({
      api_name: TushareApiName.STOCK_BASIC,
      params: { list_status: listStatus },
      fields: [...TUSHARE_STOCK_BASIC_FIELDS],
      limit,
    })
  }

  getStockCompany(exchange: StockExchange, limit?: number) {
    return this.tushareService.call({
      api_name: TushareApiName.STOCK_COMPANY,
      params: { exchange },
      fields: [...TUSHARE_STOCK_COMPANY_FIELDS],
      limit,
    })
  }

  getTradeCalendar(exchange: StockExchange, startDate: string, endDate: string, limit?: number) {
    return this.tushareService.call({
      api_name: TushareApiName.TRADE_CAL,
      params: {
        exchange,
        start_date: startDate,
        end_date: endDate,
      },
      fields: [...TUSHARE_TRADE_CAL_FIELDS],
      limit,
    })
  }

  /**
   * 按交易日获取全市场日线。
   *
   * 这不是“单只股票”的日线，而是指定 `trade_date` 下全市场股票的日线快照；
   * 因此配合同步层按交易日遍历，就可以覆盖“所有股票全部历史日线”。
   */
  getDailyByTradeDate(tradeDate: string, limit?: number) {
    return this.tushareService.call({
      api_name: TushareApiName.DAILY,
      params: { trade_date: tradeDate },
      fields: [...TUSHARE_OHLCV_FIELDS],
      limit,
    })
  }

  /**
   * 按周末交易日获取全市场周线。
   *
   * 同步层会先根据交易日历解析出每周最后一个交易日，再在这里取回该周对应的周线快照。
   */
  getWeeklyByTradeDate(tradeDate: string, limit?: number) {
    return this.tushareService.call({
      api_name: TushareApiName.WEEKLY,
      params: { trade_date: tradeDate },
      fields: [...TUSHARE_OHLCV_FIELDS],
      limit,
    })
  }

  /**
   * 按月末交易日获取全市场月线。
   *
   * 同步层会先根据交易日历解析出每月最后一个交易日，再在这里取回该月对应的月线快照。
   */
  getMonthlyByTradeDate(tradeDate: string, limit?: number) {
    return this.tushareService.call({
      api_name: TushareApiName.MONTHLY,
      params: { trade_date: tradeDate },
      fields: [...TUSHARE_OHLCV_FIELDS],
      limit,
    })
  }

  /** 按交易日获取全市场复权因子。 */
  getAdjFactorByTradeDate(tradeDate: string, limit?: number) {
    return this.tushareService.call({
      api_name: TushareApiName.ADJ_FACTOR,
      params: { trade_date: tradeDate },
      fields: [...TUSHARE_ADJ_FACTOR_FIELDS],
      limit,
    })
  }

  /** 按交易日获取全市场每日估值/换手等指标。 */
  getDailyBasicByTradeDate(tradeDate: string, limit?: number) {
    return this.tushareService.call({
      api_name: TushareApiName.DAILY_BASIC,
      params: { trade_date: tradeDate },
      fields: [...TUSHARE_DAILY_BASIC_FIELDS],
      limit,
    })
  }

  getMoneyflowDcByTradeDate(tradeDate: string, limit?: number) {
    return this.tushareService.call({
      api_name: TushareApiName.MONEYFLOW_DC,
      params: { trade_date: tradeDate },
      fields: [...TUSHARE_MONEYFLOW_DC_FIELDS],
      limit,
    })
  }

  getMoneyflowIndDcByTradeDate(tradeDate: string, contentType: MoneyflowContentType, limit?: number) {
    return this.tushareService.call({
      api_name: TushareApiName.MONEYFLOW_IND_DC,
      params: {
        trade_date: tradeDate,
        content_type: contentType,
      },
      fields: [...TUSHARE_MONEYFLOW_IND_DC_FIELDS],
      limit,
    })
  }

  getMoneyflowMktDcByTradeDate(tradeDate: string, limit?: number) {
    return this.tushareService.call({
      api_name: TushareApiName.MONEYFLOW_MKT_DC,
      params: { trade_date: tradeDate },
      fields: [...TUSHARE_MONEYFLOW_MKT_DC_FIELDS],
      limit,
    })
  }

  getExpress(startDate: string, endDate: string, limit?: number) {
    return this.tushareService.call({
      api_name: TushareApiName.EXPRESS,
      params: {
        start_date: startDate,
        end_date: endDate,
      },
      fields: [...TUSHARE_EXPRESS_FIELDS],
      limit,
    })
  }

  /** 获取某个报告期所有股票的财务指标（按季度/年度 end_date 查询） */
  getFinaIndicatorByPeriod(period: string, limit?: number) {
    return this.tushareService.call({
      api_name: TushareApiName.FINA_INDICATOR,
      params: { period },
      fields: [...TUSHARE_FINA_INDICATOR_FIELDS],
      limit,
    })
  }

  /** 获取指定股票的所有历史财务指标（用于初始全量补数） */
  getFinaIndicatorByTsCode(tsCode: string, limit?: number) {
    return this.tushareService.call({
      api_name: TushareApiName.FINA_INDICATOR,
      params: { ts_code: tsCode },
      fields: [...TUSHARE_FINA_INDICATOR_FIELDS],
      limit,
    })
  }

  /** 获取指定股票的所有分红记录 */
  getDividendByTsCode(tsCode: string, limit?: number) {
    return this.tushareService.call({
      api_name: TushareApiName.DIVIDEND,
      params: { ts_code: tsCode },
      fields: [...TUSHARE_DIVIDEND_FIELDS],
      limit,
    })
  }

  /** 获取指定公告日的全市场分红公告 */
  getDividendByAnnDate(annDate: string, limit?: number) {
    return this.tushareService.call({
      api_name: TushareApiName.DIVIDEND,
      params: { ann_date: annDate },
      fields: [...TUSHARE_DIVIDEND_FIELDS],
      limit,
    })
  }

  /** 获取指定公告日期区间的全市场分红公告 */
  getDividendByDateRange(startDate: string, endDate: string, limit?: number) {
    return this.tushareService.call({
      api_name: TushareApiName.DIVIDEND,
      params: {
        start_date: startDate,
        end_date: endDate,
      },
      fields: [...TUSHARE_DIVIDEND_FIELDS],
      limit,
    })
  }

  /** 获取某报告期所有股票的前十大股东 */
  getTop10HoldersByPeriod(period: string, limit?: number) {
    return this.tushareService.call({
      api_name: TushareApiName.TOP10_HOLDERS,
      params: { period },
      fields: [...TUSHARE_TOP10_HOLDERS_FIELDS],
      limit,
    })
  }

  /** 获取指定股票某报告期的前十大股东（用于按需查询） */
  getTop10HoldersByTsCode(tsCode: string, limit?: number) {
    return this.tushareService.call({
      api_name: TushareApiName.TOP10_HOLDERS,
      params: { ts_code: tsCode },
      fields: [...TUSHARE_TOP10_HOLDERS_FIELDS],
      limit,
    })
  }

  /** 获取某报告期所有股票的前十大流通股东 */
  getTop10FloatHoldersByPeriod(period: string, limit?: number) {
    return this.tushareService.call({
      api_name: TushareApiName.TOP10_FLOAT_HOLDERS,
      params: { period },
      fields: [...TUSHARE_TOP10_FLOAT_HOLDERS_FIELDS],
      limit,
    })
  }

  /** 获取指定股票所有报告期的前十大流通股东（用于按需查询） */
  getTop10FloatHoldersByTsCode(tsCode: string, limit?: number) {
    return this.tushareService.call({
      api_name: TushareApiName.TOP10_FLOAT_HOLDERS,
      params: { ts_code: tsCode },
      fields: [...TUSHARE_TOP10_FLOAT_HOLDERS_FIELDS],
      limit,
    })
  }
}
