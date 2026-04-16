import { Injectable } from '@nestjs/common'
import {
  CORE_INDEX_CODES,
  TUSHARE_ADJ_FACTOR_FIELDS,
  TUSHARE_CB_DAILY_FIELDS,
  TUSHARE_CYQ_CHIPS_FIELDS,
  TUSHARE_CYQ_PERF_FIELDS,
  TUSHARE_DAILY_BASIC_FIELDS,
  TUSHARE_DAILY_INFO_FIELDS,
  TUSHARE_INDEX_DAILY_FIELDS,
  TUSHARE_INDEX_DAILYBASIC_FIELDS,
  TUSHARE_OHLCV_FIELDS,
  TUSHARE_STK_MINS_FIELDS,
  TUSHARE_THS_DAILY_FIELDS,
  TushareApiName,
} from 'src/constant/tushare.constant'
import { TushareClient } from './tushare-client.service'

/** 行情数据 API：日线、周线、月线、复权因子、每日指标、指数日线 */
@Injectable()
export class MarketApiService {
  constructor(private readonly client: TushareClient) {}

  /** 按交易日获取全市场日线 */
  getDailyByTradeDate(tradeDate: string) {
    return this.client.call({
      api_name: TushareApiName.DAILY,
      params: { trade_date: tradeDate },
      fields: [...TUSHARE_OHLCV_FIELDS],
    })
  }

  /** 按周末交易日获取全市场周线 */
  getWeeklyByTradeDate(tradeDate: string) {
    return this.client.call({
      api_name: TushareApiName.WEEKLY,
      params: { trade_date: tradeDate },
      fields: [...TUSHARE_OHLCV_FIELDS],
    })
  }

  /** 按月末交易日获取全市场月线 */
  getMonthlyByTradeDate(tradeDate: string) {
    return this.client.call({
      api_name: TushareApiName.MONTHLY,
      params: { trade_date: tradeDate },
      fields: [...TUSHARE_OHLCV_FIELDS],
    })
  }

  /** 按交易日获取全市场复权因子 */
  getAdjFactorByTradeDate(tradeDate: string) {
    return this.client.call({
      api_name: TushareApiName.ADJ_FACTOR,
      params: { trade_date: tradeDate },
      fields: [...TUSHARE_ADJ_FACTOR_FIELDS],
    })
  }

  /** 按交易日获取全市场每日指标（估值、换手率等） */
  getDailyBasicByTradeDate(tradeDate: string) {
    return this.client.call({
      api_name: TushareApiName.DAILY_BASIC,
      params: { trade_date: tradeDate },
      fields: [...TUSHARE_DAILY_BASIC_FIELDS],
    })
  }

  /** 按核心指数代码 + 交易日获取指数日线（单个指数） */
  getIndexDailyByTsCodeAndDate(tsCode: string, tradeDate: string) {
    return this.client.call({
      api_name: TushareApiName.INDEX_DAILY,
      params: { ts_code: tsCode, trade_date: tradeDate },
      fields: [...TUSHARE_INDEX_DAILY_FIELDS],
    })
  }

  /** 获取所有核心指数在指定交易日的行情（逐只调用后合并） */
  async getCoreIndexDailyByTradeDate(tradeDate: string) {
    const allRows: Record<string, unknown>[] = []
    for (const tsCode of CORE_INDEX_CODES) {
      const rows = await this.getIndexDailyByTsCodeAndDate(tsCode, tradeDate)
      allRows.push(...rows)
    }
    return allRows
  }

  /** 按交易日获取融资融券明细（需 Tushare 2000 积分） */
  getMarginDetailByTradeDate(tradeDate: string) {
    return this.client.call({
      api_name: 'margin_detail',
      params: { trade_date: tradeDate },
      fields: [
        'ts_code',
        'trade_date',
        'rzye',
        'rzmre',
        'rzche',
        'rzjmre',
        'rqye',
        'rqmcl',
        'rqchl',
        'rqyl',
        'rzrqye',
        'rzrqyl',
      ],
    })
  }

  /** 按交易日获取大盘指数每日指标（估值、换手率等） */
  getIndexDailyBasicByTradeDate(tradeDate: string) {
    return this.client.call({
      api_name: TushareApiName.INDEX_DAILY_BASIC,
      params: { trade_date: tradeDate },
      fields: [...TUSHARE_INDEX_DAILYBASIC_FIELDS],
    })
  }

  /** 按交易日获取全市场可转债日行情 */
  getCbDailyByTradeDate(tradeDate: string) {
    return this.client.call({
      api_name: TushareApiName.CB_DAILY,
      params: { trade_date: tradeDate },
      fields: [...TUSHARE_CB_DAILY_FIELDS],
    })
  }

  /** 按交易日获取各市场全景统计（SSE / SZSE 合计两条记录） */
  getDailyInfoByTradeDate(tradeDate: string) {
    return this.client.call({
      api_name: TushareApiName.DAILY_INFO,
      params: { trade_date: tradeDate },
      fields: [...TUSHARE_DAILY_INFO_FIELDS],
    })
  }

  /** 按交易日获取全市场筹码获利比例 */
  getCyqPerfByTradeDate(tradeDate: string) {
    return this.client.call({
      api_name: TushareApiName.CYQ_PERF,
      params: { trade_date: tradeDate },
      fields: [...TUSHARE_CYQ_PERF_FIELDS],
    })
  }

  /** 按股票代码 + 交易日获取筹码分布 */
  getCyqChipsByTsCode(tsCode: string, tradeDate: string) {
    return this.client.call({
      api_name: TushareApiName.CYQ_CHIPS,
      params: { ts_code: tsCode, trade_date: tradeDate },
      fields: [...TUSHARE_CYQ_CHIPS_FIELDS],
    })
  }

  /** 按股票代码获取分钟级行情 */
  getStkMinsByTsCode(tsCode: string, freq: string, startDate: string, endDate: string) {
    return this.client.call({
      api_name: TushareApiName.STK_MINS,
      params: { ts_code: tsCode, freq, start_date: startDate, end_date: endDate },
      fields: [...TUSHARE_STK_MINS_FIELDS],
    })
  }

  /** 按交易日获取同花顺板块指数日线 */
  getThsDailyByTradeDate(tradeDate: string) {
    return this.client.call({
      api_name: TushareApiName.THS_DAILY,
      params: { trade_date: tradeDate },
      fields: [...TUSHARE_THS_DAILY_FIELDS],
    })
  }
}
