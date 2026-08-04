import { Injectable } from '@nestjs/common'
import { createHash } from 'node:crypto'
import { PrismaService } from 'src/shared/prisma.service'
import { stableRuleStringify } from '../rule'
import { SubscriptionMetricDefinition, SubscriptionMetricSource } from './metric-catalog.types'

const STOCK_METRICS: readonly SubscriptionMetricDefinition[] = [
  metric(
    'valuation.peTtm',
    '估值',
    '市盈率 TTM',
    '市盈率 TTM 下限筛选字段',
    'NUMBER',
    'MARKET_DAILY',
    undefined,
    'minPeTtm',
  ),
  metric('valuation.pb', '估值', '市净率 PB', '市净率 PB 下限筛选字段', 'NUMBER', 'MARKET_DAILY', undefined, 'minPb'),
  metric(
    'valuation.totalMv',
    '估值',
    '总市值',
    '总市值下限筛选字段',
    'NUMBER',
    'MARKET_DAILY',
    undefined,
    'minTotalMv',
  ),
  metric('market.pctChg', '行情', '涨跌幅', '日涨跌幅下限筛选字段', 'PERCENT', 'MARKET_DAILY', undefined, 'minPctChg'),
  metric(
    'financial.roe',
    '财务',
    'ROE',
    '公告日可见的 ROE 下限筛选字段',
    'PERCENT',
    'FINANCIAL_PIT',
    undefined,
    'minRoe',
  ),
  metric(
    'financial.revenueYoy',
    '成长',
    '营收同比',
    '公告日可见的营收同比下限筛选字段',
    'PERCENT',
    'FINANCIAL_PIT',
    undefined,
    'minRevenueYoy',
  ),
  metric(
    'financial.netprofitYoy',
    '成长',
    '净利润同比',
    '公告日可见的净利润同比下限筛选字段',
    'PERCENT',
    'FINANCIAL_PIT',
    undefined,
    'minNetprofitYoy',
  ),
  metric(
    'moneyflow.mainNetInflow5d',
    '资金',
    '近 5 日主力净流入',
    '近 5 个交易日主力净流入下限筛选字段',
    'NUMBER',
    'MONEYFLOW',
    undefined,
    'minMainNetInflow5d',
  ),
  metric('technical.rsi6', '技术', 'RSI(6)', 'RSI(6) 下限筛选字段', 'NUMBER', 'STK_FACTOR', undefined, 'minRsi6'),
  metric(
    'technical.macd',
    '技术',
    'MACD 状态',
    'MACD 金叉、死叉及零轴状态筛选字段',
    'ENUM',
    'STK_FACTOR',
    [
      { value: 'golden_cross', label: '金叉' },
      { value: 'death_cross', label: '死叉' },
      { value: 'above_zero', label: '零轴上方' },
      { value: 'below_zero', label: '零轴下方' },
    ],
    'macdSignal',
  ),
  metric(
    'technical.kdj',
    '技术',
    'KDJ 状态',
    'KDJ 金叉、死叉、超买及超卖筛选字段',
    'ENUM',
    'STK_FACTOR',
    [
      { value: 'golden_cross', label: '金叉' },
      { value: 'death_cross', label: '死叉' },
      { value: 'overbought', label: '超买' },
      { value: 'oversold', label: '超卖' },
    ],
    'kdjSignal',
  ),
  metric(
    'technical.boll',
    '技术',
    '布林带状态',
    '上轨突破、下轨跌破及缩口筛选字段',
    'ENUM',
    'STK_FACTOR',
    [
      { value: 'above_upper', label: '突破上轨' },
      { value: 'below_lower', label: '跌破下轨' },
      { value: 'squeeze', label: '缩口' },
    ],
    'bollSignal',
  ),
]

const SIGNAL_METRICS: readonly SubscriptionMetricDefinition[] = [
  metric(
    'signal.macd',
    '技术事件',
    'MACD 金叉/死叉',
    '日级全市场技术事件；使用统一 QFQ 技术指标语义。',
    'EVENT',
    'TECHNICAL_SIGNAL',
    undefined,
    undefined,
    'SIGNAL',
    'ENABLED',
    ['GOLDEN_CROSS', 'DEATH_CROSS'],
  ),
  metric(
    'signal.kdj',
    '技术事件',
    'KDJ 金叉/死叉',
    '日级全市场技术事件；使用统一 QFQ 技术指标语义。',
    'EVENT',
    'TECHNICAL_SIGNAL',
    undefined,
    undefined,
    'SIGNAL',
    'ENABLED',
    ['GOLDEN_CROSS', 'DEATH_CROSS'],
  ),
  metric(
    'signal.rsi6',
    '技术事件',
    'RSI6 超买/超卖进入',
    '日级全市场技术事件；使用统一 QFQ 技术指标语义。',
    'EVENT',
    'TECHNICAL_SIGNAL',
    undefined,
    undefined,
    'SIGNAL',
    'ENABLED',
    ['OVERSOLD_ENTER', 'OVERBOUGHT_ENTER'],
  ),
  metric(
    'signal.boll',
    '技术事件',
    '布林带突破',
    '日级全市场技术事件；使用统一 QFQ 技术指标语义。',
    'EVENT',
    'TECHNICAL_SIGNAL',
    undefined,
    undefined,
    'SIGNAL',
    'ENABLED',
    ['BREAK_UP', 'BREAK_DOWN'],
  ),
]

@Injectable()
export class MetricCatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async list(sources?: SubscriptionMetricSource[]) {
    const requested = sources?.length ? new Set(sources) : undefined
    const factorMetrics = !requested || requested.has('FACTOR') ? await this.listFactorMetrics() : []
    const metrics = [...STOCK_METRICS, ...factorMetrics, ...SIGNAL_METRICS]
      .filter((metric) => !requested || requested.has(metric.source))
      .sort(
        (left, right) =>
          left.source.localeCompare(right.source) ||
          left.category.localeCompare(right.category) ||
          left.id.localeCompare(right.id),
      )
    const catalogVersion = this.catalogVersion(metrics)
    return { catalogVersion, metrics }
  }

  private async listFactorMetrics(): Promise<SubscriptionMetricDefinition[]> {
    const factors = await this.prisma.factorDefinition.findMany({
      where: { isEnabled: true },
      select: { name: true, label: true, description: true, category: true },
      orderBy: [{ category: 'asc' }, { label: 'asc' }],
    })
    return factors.map((factor) => ({
      id: factor.name,
      version: 1,
      source: 'FACTOR' as const,
      category: factorCategoryLabel(factor.category),
      label: factor.label,
      description: factor.description ?? `${factor.label} 因子截面筛选`,
      valueType: 'NUMBER' as const,
      operators: ['GT', 'GTE', 'LT', 'LTE', 'BETWEEN', 'TOP_PERCENT', 'BOTTOM_PERCENT'],
      availability: 'ENABLED' as const,
      requiredDataSets: ['FACTOR_SNAPSHOT'],
      semanticsVersion: `factor.${factor.name}.v1`,
    }))
  }

  private catalogVersion(metrics: readonly SubscriptionMetricDefinition[]): string {
    const canonical = stableRuleStringify(
      metrics.map(({ id, version, availability, filterKey, semanticsVersion }) => ({
        id,
        version,
        availability,
        ...(filterKey ? { filterKey } : {}),
        semanticsVersion,
      })),
    )
    return `catalog-v1-${createHash('sha256').update(canonical).digest('hex').slice(0, 12)}`
  }
}

function factorCategoryLabel(category: string): string {
  const labels: Record<string, string> = {
    VALUATION: '估值',
    SIZE: '规模',
    MOMENTUM: '动量',
    VOLATILITY: '波动率',
    LIQUIDITY: '流动性',
    QUALITY: '质量',
    GROWTH: '成长',
    CAPITAL_FLOW: '资金流',
    TECHNICAL: '技术',
    LEVERAGE: '杠杆',
    DIVIDEND: '分红',
    CUSTOM: '自定义',
  }
  return labels[category] ?? category
}

function metric(
  id: string,
  category: string,
  label: string,
  description: string,
  valueType: SubscriptionMetricDefinition['valueType'],
  requiredDataSet: string,
  enumOptions?: Array<{ value: string; label: string }>,
  filterKey?: string,
  source: SubscriptionMetricSource = 'STOCK',
  availability: SubscriptionMetricDefinition['availability'] = 'ENABLED',
  operators?: string[],
): SubscriptionMetricDefinition {
  return {
    id,
    version: 1,
    source,
    category,
    label,
    description,
    valueType,
    operators: operators ?? (valueType === 'EVENT' ? ['EVENT'] : ['GT', 'GTE', 'LT', 'LTE', 'BETWEEN']),
    ...(enumOptions ? { enumOptions } : {}),
    ...(filterKey ? { filterKey } : {}),
    availability,
    requiredDataSets: [requiredDataSet],
    semanticsVersion: `${id}.v1`,
  }
}
