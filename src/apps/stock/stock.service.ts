import { Injectable } from '@nestjs/common'
import { StockListQueryDto } from './dto/stock-list-query.dto'

/**
 * StockService
 *
 * 股票管理服务：负责股票列表查询与股票详情查询。
 * 数据来源：本地数据库（由 TushareSyncService 定期同步自 Tushare）。
 *
 * 待实现：
 *  - findAll()  分页 / 筛选股票列表
 *  - findOne()  单支股票基础信息 + 最新行情
 */
@Injectable()
export class StockService {
  // TODO: 注入 PrismaService，从数据库读取股票数据
  findAll(_query: StockListQueryDto) {
    // TODO: 实现分页筛选逻辑
    return []
  }

  findOne(_code: string) {
    // TODO: 查询股票基础信息及最新行情
    return null
  }
}
