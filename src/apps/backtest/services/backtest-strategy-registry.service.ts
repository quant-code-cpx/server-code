import { Injectable } from '@nestjs/common'
import { BacktestStrategyType } from '../types/backtest-engine.types'
import { StrategyTemplateDto } from '../dto/backtest-response.dto'
import { IBacktestStrategy } from '../strategies/backtest-strategy.interface'
import { MaCrossSingleStrategy } from '../strategies/ma-cross-single.strategy'
import { ScreeningRotationStrategy } from '../strategies/screening-rotation.strategy'
import { FactorRankingStrategy } from '../strategies/factor-ranking.strategy'
import { CustomPoolRebalanceStrategy } from '../strategies/custom-pool-rebalance.strategy'

@Injectable()
export class BacktestStrategyRegistryService {
  getStrategy(strategyType: BacktestStrategyType): IBacktestStrategy {
    switch (strategyType) {
      case 'MA_CROSS_SINGLE':
        return new MaCrossSingleStrategy()
      case 'SCREENING_ROTATION':
        return new ScreeningRotationStrategy()
      case 'FACTOR_RANKING':
        return new FactorRankingStrategy()
      case 'CUSTOM_POOL_REBALANCE':
        return new CustomPoolRebalanceStrategy()
      default:
        throw new Error(`Unknown strategy type: ${strategyType}`)
    }
  }

  getTemplates(): { templates: StrategyTemplateDto[] } {
    return {
      templates: [
        {
          id: 'MA_CROSS_SINGLE',
          name: '均线择时（单股票）',
          description: '基于短期均线与长期均线交叉的单股票择时策略，适合验证回测引擎基础功能',
          category: 'TECHNICAL',
          parameterSchema: [
            {
              field: 'tsCode',
              label: '股票代码',
              type: 'string',
              required: true,
              placeholder: '如 000001.SZ',
              helpText: '单只股票的 Tushare ts_code',
            },
            {
              field: 'shortWindow',
              label: '短期均线窗口',
              type: 'number',
              required: false,
              defaultValue: 5,
              helpText: '短期均线天数（默认5日）',
            },
            {
              field: 'longWindow',
              label: '长期均线窗口',
              type: 'number',
              required: false,
              defaultValue: 20,
              helpText: '长期均线天数（默认20日）',
            },
          ],
        },
        {
          id: 'SCREENING_ROTATION',
          name: '选股器轮动',
          description: '基于每日基本面指标筛选并排序，定期轮动持有Top N股票',
          category: 'SCREENING',
          parameterSchema: [
            {
              field: 'rankBy',
              label: '排序字段',
              type: 'select',
              required: false,
              defaultValue: 'totalMv',
              options: [
                { label: '总市值', value: 'totalMv' },
                { label: '市盈率(TTM)', value: 'peTtm' },
                { label: '市净率', value: 'pb' },
                { label: '股息率(TTM)', value: 'dvTtm' },
                { label: '换手率(自由流通)', value: 'turnoverRateF' },
              ],
              helpText: '用于排名的指标字段',
            },
            {
              field: 'rankOrder',
              label: '排序方向',
              type: 'select',
              required: false,
              defaultValue: 'desc',
              options: [
                { label: '从大到小', value: 'desc' },
                { label: '从小到大', value: 'asc' },
              ],
            },
            {
              field: 'topN',
              label: '持仓数量',
              type: 'number',
              required: true,
              defaultValue: 20,
              helpText: '每次调仓持有的最多股票数',
            },
            {
              field: 'minDaysListed',
              label: '最小上市天数',
              type: 'number',
              required: false,
              defaultValue: 60,
              helpText: '过滤掉上市不足N天的新股',
            },
          ],
        },
        {
          id: 'FACTOR_RANKING',
          name: '因子排名轮动',
          description: '基于单因子（市场/财务）对股票池排名，定期轮动持有Top N',
          category: 'FACTOR',
          parameterSchema: [
            {
              field: 'factorName',
              label: '因子名称',
              type: 'select',
              required: true,
              options: [
                { label: '市盈率(TTM)', value: 'pe_ttm' },
                { label: '市净率', value: 'pb' },
                { label: '总市值', value: 'total_mv' },
                { label: '换手率(自由流通)', value: 'turnover_rate_f' },
                { label: '股息率(TTM)', value: 'dv_ttm' },
                { label: '净资产收益率(ROE)', value: 'roe' },
                { label: '总资产报酬率(ROA)', value: 'roa' },
                { label: '营收同比增长率', value: 'revenue_yoy' },
                { label: '净利润同比增长率', value: 'netprofit_yoy' },
              ],
            },
            {
              field: 'rankOrder',
              label: '排序方向',
              type: 'select',
              required: false,
              defaultValue: 'desc',
              options: [
                { label: '从大到小（高因子值优先）', value: 'desc' },
                { label: '从小到大（低因子值优先）', value: 'asc' },
              ],
            },
            {
              field: 'topN',
              label: '持仓数量',
              type: 'number',
              required: false,
              defaultValue: 20,
            },
            {
              field: 'minDaysListed',
              label: '最小上市天数',
              type: 'number',
              required: false,
              defaultValue: 60,
            },
          ],
        },
        {
          id: 'CUSTOM_POOL_REBALANCE',
          name: '自定义股票池再平衡',
          description: '固定股票池，定期调仓至目标权重（等权或自定义权重）',
          category: 'CUSTOM',
          parameterSchema: [
            {
              field: 'tsCodes',
              label: '股票代码列表',
              type: 'multiselect',
              required: true,
              helpText: '自定义股票池，如 ["000001.SZ","600036.SH"]',
            },
            {
              field: 'weightMode',
              label: '权重模式',
              type: 'select',
              required: false,
              defaultValue: 'EQUAL',
              options: [
                { label: '等权', value: 'EQUAL' },
                { label: '自定义权重', value: 'CUSTOM' },
              ],
            },
            {
              field: 'customWeights',
              label: '自定义权重',
              type: 'json',
              required: false,
              helpText: 'weightMode=CUSTOM时有效，格式：[{"tsCode":"000001.SZ","weight":0.3}]',
            },
          ],
        },
      ],
    }
  }
}
