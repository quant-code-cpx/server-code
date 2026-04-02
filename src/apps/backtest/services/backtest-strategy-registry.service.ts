import { Injectable } from '@nestjs/common'
import { BusinessException } from 'src/common/exceptions/business.exception'
import { ErrorEnum } from 'src/constant/response-code.constant'
import {
  BacktestStrategyConfigMap,
  BacktestStrategyType,
  CustomPoolRebalanceStrategyConfig,
  FACTOR_RANKING_FACTOR_NAMES,
  FactorRankingStrategyConfig,
  FactorScreeningRotationStrategyConfig,
  MaCrossSingleStrategyConfig,
  ScreeningRotationStrategyConfig,
  SCREENING_ROTATION_RANK_FIELDS,
} from '../types/backtest-engine.types'
import { StrategyTemplateDto } from '../dto/backtest-response.dto'
import { IBacktestStrategy } from '../strategies/backtest-strategy.interface'
import { MaCrossSingleStrategy } from '../strategies/ma-cross-single.strategy'
import { ScreeningRotationStrategy } from '../strategies/screening-rotation.strategy'
import { FactorRankingStrategy } from '../strategies/factor-ranking.strategy'
import { CustomPoolRebalanceStrategy } from '../strategies/custom-pool-rebalance.strategy'
import { FactorScreeningRotationStrategy } from '../strategies/factor-screening-rotation.strategy'

@Injectable()
export class BacktestStrategyRegistryService {
  getStrategy<T extends BacktestStrategyType>(strategyType: T): IBacktestStrategy<T> {
    switch (strategyType) {
      case 'MA_CROSS_SINGLE':
        return new MaCrossSingleStrategy() as IBacktestStrategy<T>
      case 'SCREENING_ROTATION':
        return new ScreeningRotationStrategy() as IBacktestStrategy<T>
      case 'FACTOR_RANKING':
        return new FactorRankingStrategy() as IBacktestStrategy<T>
      case 'CUSTOM_POOL_REBALANCE':
        return new CustomPoolRebalanceStrategy() as IBacktestStrategy<T>
      case 'FACTOR_SCREENING_ROTATION':
        return new FactorScreeningRotationStrategy() as IBacktestStrategy<T>
      default:
        throw new BusinessException(ErrorEnum.BACKTEST_UNKNOWN_STRATEGY)
    }
  }

  validateStrategyConfig<T extends BacktestStrategyType>(
    strategyType: T,
    strategyConfig: unknown,
  ): BacktestStrategyConfigMap[T] {
    switch (strategyType) {
      case 'MA_CROSS_SINGLE':
        return this.validateMaCrossSingleConfig(strategyConfig) as BacktestStrategyConfigMap[T]
      case 'SCREENING_ROTATION':
        return this.validateScreeningRotationConfig(strategyConfig) as BacktestStrategyConfigMap[T]
      case 'FACTOR_RANKING':
        return this.validateFactorRankingConfig(strategyConfig) as BacktestStrategyConfigMap[T]
      case 'CUSTOM_POOL_REBALANCE':
        return this.validateCustomPoolConfig(strategyConfig) as BacktestStrategyConfigMap[T]
      case 'FACTOR_SCREENING_ROTATION':
        return this.validateFactorScreeningRotationConfig(strategyConfig) as BacktestStrategyConfigMap[T]
      default:
        throw new BusinessException(ErrorEnum.BACKTEST_UNKNOWN_STRATEGY)
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
        {
          id: 'FACTOR_SCREENING_ROTATION',
          name: '因子选股轮动（多条件）',
          description: '基于多因子筛选条件组合选股，定期轮动持有 TopN 股票。由因子模块 /factor/backtest/submit 端点触发。',
          category: 'FACTOR',
          parameterSchema: [
            {
              field: 'conditions',
              label: '因子筛选条件',
              type: 'json',
              required: true,
              helpText: '因子条件数组，格式与 /factor/screening 一致',
            },
            {
              field: 'sortBy',
              label: '排序因子',
              type: 'string',
              required: false,
              helpText: '用于 TopN 排序的因子名',
            },
            {
              field: 'sortOrder',
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
              required: false,
              defaultValue: 20,
            },
            {
              field: 'weightMethod',
              label: '权重方式',
              type: 'select',
              required: false,
              defaultValue: 'equal_weight',
              options: [
                { label: '等权', value: 'equal_weight' },
                { label: '因子值加权', value: 'factor_weight' },
              ],
            },
          ],
        },
      ],
    }
  }

  private validateMaCrossSingleConfig(strategyConfig: unknown): MaCrossSingleStrategyConfig {
    const config = this.assertObject(strategyConfig)
    const tsCode = this.assertNonEmptyString(config.tsCode, 'strategyConfig.tsCode')
    const shortWindow = this.toPositiveInteger(config.shortWindow, 'strategyConfig.shortWindow', 5, 250)
    const longWindow = this.toPositiveInteger(config.longWindow, 'strategyConfig.longWindow', 20, 500)

    if (shortWindow >= longWindow) {
      throw this.invalidStrategyConfig('strategyConfig.shortWindow 必须小于 longWindow')
    }

    if (config.priceField !== undefined && config.priceField !== 'close') {
      throw this.invalidStrategyConfig('strategyConfig.priceField 目前仅支持 close')
    }

    if (config.allowFlat !== undefined && typeof config.allowFlat !== 'boolean') {
      throw this.invalidStrategyConfig('strategyConfig.allowFlat 必须为布尔值')
    }

    return {
      tsCode,
      shortWindow,
      longWindow,
      ...(config.priceField === 'close' ? { priceField: 'close' as const } : {}),
      ...(typeof config.allowFlat === 'boolean' ? { allowFlat: config.allowFlat } : {}),
    }
  }

  private validateScreeningRotationConfig(strategyConfig: unknown): ScreeningRotationStrategyConfig {
    const config = this.assertObject(strategyConfig)
    const rankBy =
      config.rankBy === undefined
        ? 'totalMv'
        : this.assertStringLiteral(config.rankBy, SCREENING_ROTATION_RANK_FIELDS, 'strategyConfig.rankBy')
    const rankOrder =
      config.rankOrder === undefined
        ? 'desc'
        : this.assertStringLiteral(config.rankOrder, ['asc', 'desc'] as const, 'strategyConfig.rankOrder')
    const topN = this.toPositiveInteger(config.topN, 'strategyConfig.topN', 20, 500)
    const minDaysListed = this.toNonNegativeInteger(config.minDaysListed, 'strategyConfig.minDaysListed', 60, 5000)

    return { rankBy, rankOrder, topN, minDaysListed }
  }

  private validateFactorRankingConfig(strategyConfig: unknown): FactorRankingStrategyConfig {
    const config = this.assertObject(strategyConfig)
    const factorName = this.assertStringLiteral(
      config.factorName,
      FACTOR_RANKING_FACTOR_NAMES,
      'strategyConfig.factorName',
    )
    const rankOrder =
      config.rankOrder === undefined
        ? 'desc'
        : this.assertStringLiteral(config.rankOrder, ['asc', 'desc'] as const, 'strategyConfig.rankOrder')
    const topN = this.toPositiveInteger(config.topN, 'strategyConfig.topN', 20, 500)
    const minDaysListed = this.toNonNegativeInteger(config.minDaysListed, 'strategyConfig.minDaysListed', 60, 5000)

    let optionalFilters: FactorRankingStrategyConfig['optionalFilters'] | undefined
    if (config.optionalFilters !== undefined) {
      const rawFilters = this.assertObject(config.optionalFilters, 'strategyConfig.optionalFilters')
      optionalFilters = {
        ...(rawFilters.minTotalMv !== undefined
          ? { minTotalMv: this.toNonNegativeNumber(rawFilters.minTotalMv, 'strategyConfig.optionalFilters.minTotalMv') }
          : {}),
        ...(rawFilters.minTurnoverRate !== undefined
          ? {
              minTurnoverRate: this.toNonNegativeNumber(
                rawFilters.minTurnoverRate,
                'strategyConfig.optionalFilters.minTurnoverRate',
              ),
            }
          : {}),
        ...(rawFilters.maxPeTtm !== undefined
          ? { maxPeTtm: this.toNonNegativeNumber(rawFilters.maxPeTtm, 'strategyConfig.optionalFilters.maxPeTtm') }
          : {}),
      }
    }

    return {
      factorName,
      rankOrder,
      topN,
      minDaysListed,
      ...(optionalFilters ? { optionalFilters } : {}),
    }
  }

  private validateCustomPoolConfig(strategyConfig: unknown): CustomPoolRebalanceStrategyConfig {
    const config = this.assertObject(strategyConfig)
    const tsCodes = this.assertStringArray(config.tsCodes, 'strategyConfig.tsCodes', true)
    const uniqueTsCodes = Array.from(new Set(tsCodes.map((tsCode) => tsCode.trim()).filter(Boolean)))

    if (uniqueTsCodes.length === 0) {
      throw this.invalidStrategyConfig('strategyConfig.tsCodes 不能为空')
    }

    const weightMode =
      config.weightMode === undefined
        ? 'EQUAL'
        : this.assertStringLiteral(config.weightMode, ['EQUAL', 'CUSTOM'] as const, 'strategyConfig.weightMode')

    let customWeights: CustomPoolRebalanceStrategyConfig['customWeights'] | undefined
    if (config.customWeights !== undefined) {
      if (!Array.isArray(config.customWeights)) {
        throw this.invalidStrategyConfig('strategyConfig.customWeights 必须为数组')
      }

      customWeights = config.customWeights.map((item, index) => {
        const record = this.assertObject(item, `strategyConfig.customWeights[${index}]`)
        const tsCode = this.assertNonEmptyString(record.tsCode, `strategyConfig.customWeights[${index}].tsCode`)
        const weight = this.toPositiveNumber(record.weight, `strategyConfig.customWeights[${index}].weight`, 1)
        if (weight > 1) {
          throw this.invalidStrategyConfig(`strategyConfig.customWeights[${index}].weight 不能大于 1`)
        }
        return { tsCode, weight }
      })
    }

    if (weightMode === 'CUSTOM') {
      if (!customWeights?.length) {
        throw this.invalidStrategyConfig('strategyConfig.weightMode=CUSTOM 时必须提供 customWeights')
      }

      const weightSum = customWeights.reduce((sum, item) => sum + item.weight, 0)
      if (Math.abs(weightSum - 1) > 0.001) {
        throw this.invalidStrategyConfig('strategyConfig.customWeights 权重和必须为 1')
      }

      const allowedTsCodes = new Set(uniqueTsCodes)
      const invalidWeightCode = customWeights.find((item) => !allowedTsCodes.has(item.tsCode))
      if (invalidWeightCode) {
        throw this.invalidStrategyConfig('strategyConfig.customWeights 中存在不属于 tsCodes 的股票代码')
      }
    }

    return {
      tsCodes: uniqueTsCodes,
      weightMode,
      ...(customWeights ? { customWeights } : {}),
    }
  }

  private validateFactorScreeningRotationConfig(strategyConfig: unknown): FactorScreeningRotationStrategyConfig {
    const config = this.assertObject(strategyConfig)
    if (!Array.isArray(config.conditions) || config.conditions.length === 0) {
      throw this.invalidStrategyConfig('strategyConfig.conditions 必须为非空数组')
    }

    const conditions = config.conditions.map((c, i) => {
      const cond = this.assertObject(c, `strategyConfig.conditions[${i}]`)
      const factorName = this.assertNonEmptyString(cond.factorName, `strategyConfig.conditions[${i}].factorName`)
      const operator = this.assertStringLiteral(
        cond.operator,
        ['gt', 'gte', 'lt', 'lte', 'between', 'top_pct', 'bottom_pct'] as const,
        `strategyConfig.conditions[${i}].operator`,
      )
      return {
        factorName,
        operator,
        ...(cond.value !== undefined ? { value: Number(cond.value) } : {}),
        ...(cond.min !== undefined ? { min: Number(cond.min) } : {}),
        ...(cond.max !== undefined ? { max: Number(cond.max) } : {}),
        ...(cond.percent !== undefined ? { percent: Number(cond.percent) } : {}),
      }
    })

    const sortBy = config.sortBy !== undefined ? this.assertNonEmptyString(config.sortBy, 'strategyConfig.sortBy') : undefined
    const sortOrder =
      config.sortOrder === undefined
        ? 'desc'
        : this.assertStringLiteral(config.sortOrder, ['asc', 'desc'] as const, 'strategyConfig.sortOrder')
    const topN = this.toPositiveInteger(config.topN, 'strategyConfig.topN', 20, 200)
    const weightMethod =
      config.weightMethod === undefined
        ? 'equal_weight'
        : this.assertStringLiteral(config.weightMethod, ['equal_weight', 'factor_weight'] as const, 'strategyConfig.weightMethod')

    return { conditions, sortBy, sortOrder, topN, weightMethod }
  }

  private assertObject(value: unknown, field = 'strategyConfig'): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw this.invalidStrategyConfig(`${field} 必须为对象`)
    }

    return value as Record<string, unknown>
  }

  private assertNonEmptyString(value: unknown, field: string): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw this.invalidStrategyConfig(`${field} 必须为非空字符串`)
    }

    return value.trim()
  }

  private assertStringArray(value: unknown, field: string, requireNonEmpty = false): string[] {
    if (!Array.isArray(value)) {
      throw this.invalidStrategyConfig(`${field} 必须为字符串数组`)
    }

    const normalized = value.map((item, index) => this.assertNonEmptyString(item, `${field}[${index}]`))
    if (requireNonEmpty && normalized.length === 0) {
      throw this.invalidStrategyConfig(`${field} 不能为空数组`)
    }

    return normalized
  }

  private assertStringLiteral<const T extends readonly string[]>(
    value: unknown,
    candidates: T,
    field: string,
  ): T[number] {
    if (typeof value !== 'string' || !candidates.includes(value)) {
      throw this.invalidStrategyConfig(`${field} 取值不合法`)
    }

    return value as T[number]
  }

  private toPositiveInteger(value: unknown, field: string, defaultValue: number, maxValue?: number): number {
    const resolved = value === undefined ? defaultValue : this.toNumber(value, field)
    if (!Number.isInteger(resolved) || resolved <= 0) {
      throw this.invalidStrategyConfig(`${field} 必须为正整数`)
    }
    if (maxValue !== undefined && resolved > maxValue) {
      throw this.invalidStrategyConfig(`${field} 不能大于 ${maxValue}`)
    }
    return resolved
  }

  private toNonNegativeInteger(value: unknown, field: string, defaultValue: number, maxValue?: number): number {
    const resolved = value === undefined ? defaultValue : this.toNumber(value, field)
    if (!Number.isInteger(resolved) || resolved < 0) {
      throw this.invalidStrategyConfig(`${field} 必须为非负整数`)
    }
    if (maxValue !== undefined && resolved > maxValue) {
      throw this.invalidStrategyConfig(`${field} 不能大于 ${maxValue}`)
    }
    return resolved
  }

  private toNonNegativeNumber(value: unknown, field: string): number {
    const resolved = this.toNumber(value, field)
    if (resolved < 0) {
      throw this.invalidStrategyConfig(`${field} 不能小于 0`)
    }
    return resolved
  }

  private toPositiveNumber(value: unknown, field: string, defaultValue?: number): number {
    const resolved = value === undefined && defaultValue !== undefined ? defaultValue : this.toNumber(value, field)
    if (resolved <= 0) {
      throw this.invalidStrategyConfig(`${field} 必须大于 0`)
    }
    return resolved
  }

  private toNumber(value: unknown, field: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw this.invalidStrategyConfig(`${field} 必须为有效数字`)
    }
    return value
  }

  private invalidStrategyConfig(message: string) {
    const [code] = ErrorEnum.BACKTEST_INVALID_STRATEGY_CONFIG.split(':')
    return new BusinessException(`${code}:${message}`)
  }
}
