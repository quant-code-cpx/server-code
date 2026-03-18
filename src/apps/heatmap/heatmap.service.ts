import { Injectable } from '@nestjs/common'
import { HeatmapQueryDto } from './dto/heatmap-query.dto'

/**
 * HeatmapService
 *
 * 热力图数据服务：聚合全市场（或指定板块）股票的涨跌幅，
 * 以可供前端渲染热力图的格式返回。
 *
 * 待实现：
 *  - getHeatmap()  按市值 / 行业 / 涨跌幅分组，返回热力图节点数据
 */
@Injectable()
export class HeatmapService {
  getHeatmap(_query: HeatmapQueryDto) {
    // TODO: 查询数据库，聚合涨跌幅分布数据并按前端图表格式输出
    return []
  }
}
