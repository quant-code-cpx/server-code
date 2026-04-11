import { Injectable } from '@nestjs/common'
import {
  TUSHARE_CPI_FIELDS,
  TUSHARE_GDP_FIELDS,
  TUSHARE_PPI_FIELDS,
  TUSHARE_SHIBOR_FIELDS,
  TushareApiName,
} from 'src/constant/tushare.constant'
import { TushareClient } from './tushare-client.service'

/** 宏观经济 API：CPI / PPI / GDP / Shibor */
@Injectable()
export class MacroApiService {
  constructor(private readonly client: TushareClient) {}

  /** 获取 CPI 数据 */
  getCpi(startM?: string, endM?: string) {
    return this.client.call({
      api_name: TushareApiName.CN_CPI,
      params: { start_m: startM, end_m: endM },
      fields: [...TUSHARE_CPI_FIELDS],
    })
  }

  /** 获取 PPI 数据 */
  getPpi(startM?: string, endM?: string) {
    return this.client.call({
      api_name: TushareApiName.CN_PPI,
      params: { start_m: startM, end_m: endM },
      fields: [...TUSHARE_PPI_FIELDS],
    })
  }

  /** 获取 GDP 数据 */
  getGdp(startQ?: string, endQ?: string) {
    return this.client.call({
      api_name: TushareApiName.CN_GDP,
      params: { start_q: startQ, end_q: endQ },
      fields: [...TUSHARE_GDP_FIELDS],
    })
  }

  /** 获取 Shibor 利率数据 */
  getShibor(startDate?: string, endDate?: string) {
    return this.client.call({
      api_name: TushareApiName.SHIBOR,
      params: { start_date: startDate, end_date: endDate },
      fields: [...TUSHARE_SHIBOR_FIELDS],
    })
  }
}
