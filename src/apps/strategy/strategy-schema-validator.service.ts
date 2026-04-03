import { Injectable } from '@nestjs/common'
import { BacktestStrategyRegistryService } from 'src/apps/backtest/services/backtest-strategy-registry.service'
import { BacktestStrategyType, BACKTEST_STRATEGY_TYPES } from 'src/apps/backtest/types/backtest-engine.types'

/** JSON Schema 7 minimal subset (for frontend form rendering) */
export interface StrategyJsonSchema {
  type: 'object'
  required?: string[]
  properties: Record<string, unknown>
  additionalProperties?: boolean
}

// ── 静态 JSON Schema 定义（供前端动态渲染表单使用） ────────────────────────────

const MA_CROSS_SINGLE_SCHEMA: StrategyJsonSchema = {
  type: 'object',
  required: ['tsCode'],
  properties: {
    tsCode: { type: 'string', pattern: '^\\d{6}\\.(SZ|SH|BJ)$', description: '股票代码，如 000001.SZ' },
    shortWindow: { type: 'integer', minimum: 1, maximum: 250, default: 5, description: '短期均线窗口（日）' },
    longWindow: { type: 'integer', minimum: 2, maximum: 500, default: 20, description: '长期均线窗口（日）' },
    priceField: { type: 'string', enum: ['close'], default: 'close', description: '价格字段（目前仅支持 close）' },
    allowFlat: { type: 'boolean', default: false, description: '均线下方是否允许空仓（非满仓）' },
  },
  additionalProperties: false,
}

const SCREENING_ROTATION_SCHEMA: StrategyJsonSchema = {
  type: 'object',
  properties: {
    rankBy: {
      type: 'string',
      enum: ['totalMv', 'peTtm', 'pb', 'dvTtm', 'turnoverRate', 'turnoverRateF'],
      default: 'totalMv',
      description: '排名依据字段',
    },
    rankOrder: { type: 'string', enum: ['asc', 'desc'], default: 'asc', description: '排序方向' },
    topN: { type: 'integer', minimum: 1, maximum: 200, default: 20, description: '持仓数量' },
    minDaysListed: { type: 'integer', minimum: 0, default: 60, description: '最低上市天数' },
  },
  additionalProperties: false,
}

const FACTOR_RANKING_SCHEMA: StrategyJsonSchema = {
  type: 'object',
  required: ['factorName'],
  properties: {
    factorName: {
      type: 'string',
      enum: [
        'pe_ttm',
        'pb',
        'total_mv',
        'turnover_rate_f',
        'dv_ttm',
        'turnover_rate',
        'roe',
        'roa',
        'revenue_yoy',
        'netprofit_yoy',
        'grossprofit_margin',
        'netprofit_margin',
      ],
      description: '排名因子',
    },
    rankOrder: { type: 'string', enum: ['asc', 'desc'], default: 'asc', description: '排序方向' },
    topN: { type: 'integer', minimum: 1, maximum: 200, default: 20, description: '持仓数量' },
    minDaysListed: { type: 'integer', minimum: 0, default: 60, description: '最低上市天数' },
    optionalFilters: {
      type: 'object',
      properties: {
        minTotalMv: { type: 'number', minimum: 0, description: '最小总市值过滤（亿元）' },
        minTurnoverRate: { type: 'number', minimum: 0, description: '最小换手率过滤' },
        maxPeTtm: { type: 'number', minimum: 0, description: '最大市盈率过滤' },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
}

const CUSTOM_POOL_REBALANCE_SCHEMA: StrategyJsonSchema = {
  type: 'object',
  required: ['tsCodes'],
  properties: {
    tsCodes: {
      type: 'array',
      items: { type: 'string', pattern: '^\\d{6}\\.(SZ|SH|BJ)$' },
      minItems: 1,
      maxItems: 100,
      description: '股票代码列表',
    },
    weightMode: { type: 'string', enum: ['EQUAL', 'CUSTOM'], default: 'EQUAL', description: '权重模式' },
    customWeights: {
      type: 'array',
      items: {
        type: 'object',
        required: ['tsCode', 'weight'],
        properties: {
          tsCode: { type: 'string', description: '股票代码' },
          weight: { type: 'number', minimum: 0, maximum: 1, description: '权重（0-1，所有权重之和必须为 1）' },
        },
      },
      description: 'weightMode=CUSTOM 时的权重配置',
    },
  },
  additionalProperties: false,
}

const FACTOR_SCREENING_ROTATION_SCHEMA: StrategyJsonSchema = {
  type: 'object',
  required: ['conditions'],
  properties: {
    conditions: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['factorName', 'operator'],
        properties: {
          factorName: { type: 'string', description: '因子名称' },
          operator: {
            type: 'string',
            enum: ['gt', 'gte', 'lt', 'lte', 'between', 'top_pct', 'bottom_pct'],
            description: '比较运算符',
          },
          value: { type: 'number', description: '比较值（单值运算符）' },
          min: { type: 'number', description: '区间下界（between 时使用）' },
          max: { type: 'number', description: '区间上界（between 时使用）' },
          percent: { type: 'number', minimum: 0, maximum: 100, description: '百分比（top_pct/bottom_pct 时使用）' },
        },
      },
      description: '因子筛选条件',
    },
    sortBy: { type: 'string', description: '排序因子名' },
    sortOrder: { type: 'string', enum: ['asc', 'desc'], default: 'desc', description: '排序方向' },
    topN: { type: 'integer', minimum: 1, maximum: 500, default: 20, description: '持仓数量' },
    weightMethod: {
      type: 'string',
      enum: ['equal_weight', 'factor_weight'],
      default: 'equal_weight',
      description: '权重分配方式',
    },
  },
  additionalProperties: false,
}

const SCHEMA_MAP: Record<BacktestStrategyType, StrategyJsonSchema> = {
  MA_CROSS_SINGLE: MA_CROSS_SINGLE_SCHEMA,
  SCREENING_ROTATION: SCREENING_ROTATION_SCHEMA,
  FACTOR_RANKING: FACTOR_RANKING_SCHEMA,
  CUSTOM_POOL_REBALANCE: CUSTOM_POOL_REBALANCE_SCHEMA,
  FACTOR_SCREENING_ROTATION: FACTOR_SCREENING_ROTATION_SCHEMA,
}

@Injectable()
export class StrategySchemaValidatorService {
  constructor(private readonly strategyRegistry: BacktestStrategyRegistryService) {}

  /**
   * 返回所有策略类型的 JSON Schema（供前端动态渲染表单）
   */
  getAllSchemas(): Record<string, StrategyJsonSchema> {
    return { ...SCHEMA_MAP }
  }

  /**
   * 返回指定策略类型的 JSON Schema
   */
  getSchema(strategyType: string): StrategyJsonSchema | undefined {
    return SCHEMA_MAP[strategyType as BacktestStrategyType]
  }

  /**
   * 返回所有合法的策略类型
   */
  getSupportedTypes(): readonly string[] {
    return BACKTEST_STRATEGY_TYPES
  }

  /**
   * 校验策略参数；校验失败时抛出 BusinessException (code 4001)
   * 返回规范化后的 strategyConfig
   */
  validate(strategyType: string, config: unknown): Record<string, unknown> {
    return this.strategyRegistry.validateStrategyConfig(strategyType as BacktestStrategyType, config) as Record<
      string,
      unknown
    >
  }
}
