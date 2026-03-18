import { Injectable } from '@nestjs/common'
import { MoneyFlowQueryDto } from './dto/money-flow-query.dto'

/**
 * MarketService
 *
 * 市场与行业涨跌、资金流入流出分析服务。
 * 数据来源：本地数据库（由 TushareSyncService 同步自 Tushare）。
 *
 * 待实现：
 *  - getMarketMoneyFlow()  大盘整体资金流向
 *  - getSectorFlow()       行业板块涨跌及净流入排名
 */
@Injectable()
export class MarketService {
  getMarketMoneyFlow(_query: MoneyFlowQueryDto) {
    // TODO: 查询数据库，返回指定日期的大盘资金流向汇总
    return []
  }

  getSectorFlow(_query: MoneyFlowQueryDto) {
    // TODO: 查询数据库，返回行业板块的涨跌幅 + 净流入排名
    return []
  }
}
