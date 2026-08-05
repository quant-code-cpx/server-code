import { Injectable } from '@nestjs/common'
import { AGENT_TOOL_KEYS, type AgentToolKey } from '../contracts'
import type { FrozenWorkflowDefinition } from '../workflow/workflow.types'
import { hashStableJson } from './tool-json'
import { ToolRegistryService } from './tool-registry.service'

export const TOOL_CAPABILITY_PACK_KEYS = [
  'CORE_RESEARCH',
  'STOCK_FINANCIAL',
  'STOCK_TECHNICAL',
  'STOCK_DEEP',
  'MARKET_MULTI_ASSET',
  'EXTERNAL_EVENT',
  'DERIVATIVES',
  'PRIVATE_ANALYTICS',
] as const
export type ToolCapabilityPackKey = (typeof TOOL_CAPABILITY_PACK_KEYS)[number]

export interface ToolCapabilityDescriptor {
  key: AgentToolKey
  latestVersion: number
  pack: ToolCapabilityPackKey
  purpose: string
  positiveExamples: string[]
  negativeExamples: string[]
  requiresSecurityTypes: Array<'STOCK' | 'INDEX' | 'FUND' | 'OPTION' | 'CONVERTIBLE_BOND'>
  dataScope: 'PUBLIC' | 'USER_PRIVATE' | 'PUBLIC_WEB'
  costClass: 'LOW' | 'MEDIUM' | 'HIGH'
}

export interface ToolCapabilityCatalogSnapshot {
  version: 1 | 2 | 3 | 4
  hash: string
  descriptors: readonly ToolCapabilityDescriptor[]
}

const PACK_BY_KEY: Readonly<Record<AgentToolKey, ToolCapabilityPackKey>> = Object.freeze({
  resolve_security: 'CORE_RESEARCH',
  get_stock_price_history: 'CORE_RESEARCH',
  get_stock_overview: 'CORE_RESEARCH',
  get_data_availability: 'CORE_RESEARCH',
  get_financial_statements: 'STOCK_FINANCIAL',
  get_financial_indicators: 'STOCK_FINANCIAL',
  get_stock_moneyflow: 'STOCK_FINANCIAL',
  compute_valuation_percentile: 'STOCK_FINANCIAL',
  screen_stocks: 'STOCK_TECHNICAL',
  get_stock_technical_indicators: 'STOCK_TECHNICAL',
  get_stock_technical_signals: 'STOCK_TECHNICAL',
  get_stock_chip_profile: 'STOCK_DEEP',
  get_stock_margin_history: 'STOCK_DEEP',
  get_stock_relative_strength: 'STOCK_DEEP',
  get_stock_events: 'STOCK_DEEP',
  get_stock_shareholder_profile: 'STOCK_DEEP',
  get_market_snapshot: 'MARKET_MULTI_ASSET',
  get_sector_membership: 'MARKET_MULTI_ASSET',
  get_index_market_data: 'MARKET_MULTI_ASSET',
  get_fund_research: 'MARKET_MULTI_ASSET',
  get_industry_rotation: 'MARKET_MULTI_ASSET',
  get_factor_analysis: 'MARKET_MULTI_ASSET',
  get_macro_snapshot: 'MARKET_MULTI_ASSET',
  get_option_market: 'DERIVATIVES',
  get_convertible_bond_market: 'DERIVATIVES',
  run_event_study: 'EXTERNAL_EVENT',
  search_web: 'EXTERNAL_EVENT',
  fetch_web_page: 'EXTERNAL_EVENT',
  get_user_watchlist: 'PRIVATE_ANALYTICS',
  get_portfolio_risk: 'PRIVATE_ANALYTICS',
  get_backtest_result: 'PRIVATE_ANALYTICS',
  get_backtest_analytics: 'PRIVATE_ANALYTICS',
  get_portfolio_analytics: 'PRIVATE_ANALYTICS',
  compute_performance_metrics: 'PRIVATE_ANALYTICS',
  save_research_report: 'PRIVATE_ANALYTICS',
})

const PURPOSE_BY_KEY: Readonly<Record<AgentToolKey, string>> = Object.freeze({
  resolve_security: '把证券名称或代码解析为规范代码',
  get_stock_price_history: '查询单只股票历史行情',
  get_stock_overview: '查询单只股票基本概要',
  screen_stocks: '全市场条件筛选或信号排名',
  get_financial_statements: '查询财务三表',
  get_financial_indicators: '查询财务指标',
  get_stock_moneyflow: '查询个股资金流',
  get_market_snapshot: '查询市场快照',
  get_sector_membership: '查询行业归属与成分',
  get_user_watchlist: '读取用户自选股',
  get_portfolio_risk: '分析用户组合风险',
  get_backtest_result: '读取回测结果',
  get_backtest_analytics: '分析回测 Monte Carlo、归因、成本和已持久化高级结果',
  get_portfolio_analytics: '分析组合点时绩效、盈亏、漂移和交易事件',
  compute_performance_metrics: '计算收益和风险指标',
  compute_valuation_percentile: '计算估值历史分位',
  search_web: '搜索公开网页候选来源',
  fetch_web_page: '读取已搜索网页正文',
  save_research_report: '保存研究报告，需要确认',
  get_stock_technical_indicators: '查询单股 MACD、KDJ、RSI、BOLL 精确值',
  get_stock_technical_signals: '查询单股标准技术信号及事件',
  get_data_availability: '解释数据覆盖、水位线和缺失',
  get_stock_chip_profile: '查询筹码成本、获利盘与价位分布',
  get_stock_margin_history: '查询融资融券余额和趋势',
  get_stock_relative_strength: '计算个股相对指数表现',
  get_stock_events: '查询公司结构化事件',
  get_stock_shareholder_profile: '查询股东、增减持与质押',
  get_index_market_data: '查询指数行情、估值和成分权重',
  get_fund_research: '查询基金净值、价格、份额和持仓',
  get_industry_rotation: '查询 THS 行业轮动、资金和估值',
  get_factor_analysis: '分析内置因子值、IC、分组和相关性',
  get_macro_snapshot: '查询 CPI、PPI、GDP 和 SHIBOR',
  get_option_market: '查询期权合约和日线历史',
  get_convertible_bond_market: '查询可转债基本信息和日线历史',
  run_event_study: '计算固定企业事件前后的异常收益',
})

@Injectable()
export class ToolCapabilityCatalogService {
  constructor(private readonly registry: ToolRegistryService) {}

  snapshot(workflow: FrozenWorkflowDefinition): ToolCapabilityCatalogSnapshot {
    const version =
      workflow.capabilityCatalogVersion === 4
        ? 4
        : workflow.capabilityCatalogVersion === 3
          ? 3
          : workflow.capabilityCatalogVersion === 2
            ? 2
            : 1
    const enabled = new Map(this.registry.freezeSnapshot().entries.map((pin) => [pin.key, pin.version]))
    const descriptors = AGENT_TOOL_KEYS.flatMap((key) => {
      const latestVersion = enabled.get(key)
      if (!latestVersion || !workflow.toolAllowlist.includes(key)) return []
      const definition = this.registry.get(key, latestVersion)
      const pack = PACK_BY_KEY[key]
      const publicWeb = pack === 'EXTERNAL_EVENT'
      const privateData = pack === 'PRIVATE_ANALYTICS'
      return [
        Object.freeze({
          key,
          latestVersion,
          pack,
          purpose: PURPOSE_BY_KEY[key],
          positiveExamples: positiveExamples(key),
          negativeExamples: negativeExamples(key),
          requiresSecurityTypes: requiredSecurityTypes(key),
          dataScope: publicWeb
            ? ('PUBLIC_WEB' as const)
            : privateData
              ? ('USER_PRIVATE' as const)
              : ('PUBLIC' as const),
          costClass: definition.policy.costClass,
        }),
      ]
    })
    const frozen = Object.freeze(descriptors)
    return Object.freeze({ version, hash: hashStableJson(frozen), descriptors: frozen })
  }
}

function requiredSecurityTypes(key: AgentToolKey): ToolCapabilityDescriptor['requiresSecurityTypes'] {
  if (key === 'get_index_market_data') return ['INDEX']
  if (key === 'get_fund_research') return ['FUND']
  if (key === 'get_option_market') return ['OPTION']
  if (key === 'get_convertible_bond_market') return ['CONVERTIBLE_BOND']
  if (
    [
      'get_market_snapshot',
      'get_industry_rotation',
      'get_factor_analysis',
      'get_macro_snapshot',
      'get_user_watchlist',
      'get_portfolio_risk',
      'get_backtest_result',
      'get_backtest_analytics',
      'get_portfolio_analytics',
      'compute_performance_metrics',
      'search_web',
      'fetch_web_page',
      'save_research_report',
      'run_event_study',
    ].includes(key)
  ) {
    return []
  }
  return ['STOCK']
}

function positiveExamples(key: AgentToolKey): string[] {
  if (key === 'get_stock_events') return ['未来90天已公告事件', '近期回购和解禁']
  if (key === 'get_stock_chip_profile') return ['获利盘和中位成本']
  if (key === 'get_stock_margin_history') return ['融资余额近20日变化']
  if (key === 'get_stock_relative_strength') return ['近一年跑赢沪深300多少']
  if (key === 'get_stock_shareholder_profile') return ['最新股东人数和质押比例']
  if (key === 'get_index_market_data') return ['沪深300近一年走势、估值和成分权重']
  if (key === 'get_fund_research') return ['510300 的净值、场内价格、份额和持仓']
  if (key === 'get_industry_rotation') return ['最近20日行业动量和资金流排名']
  if (key === 'get_factor_analysis') return ['pe_ttm 因子过去一年 IC']
  if (key === 'get_macro_snapshot') return ['最新 CPI、PPI、GDP 和 Shibor']
  if (key === 'get_option_market') return ['查询某一期权合约详情和最近一年日线']
  if (key === 'get_convertible_bond_market') return ['查询某只可转债条款和真实覆盖历史']
  if (key === 'run_event_study') return ['统计回购公告后 20 个交易日的异常收益']
  if (key === 'get_backtest_analytics') return ['复盘回测的 Monte Carlo、归因和成本敏感度']
  if (key === 'get_portfolio_analytics') return ['查看组合真实历史绩效、盈亏和仓位漂移']
  return [PURPOSE_BY_KEY[key]]
}

function negativeExamples(key: AgentToolKey): string[] {
  if (key === 'screen_stocks') return ['单股精确技术指标或标准信号']
  if (key === 'get_stock_events') return ['事件后收益统计']
  if (key === 'get_data_availability') return ['代替业务数据查询']
  if (key === 'get_index_market_data') return ['单只股票行情']
  if (key === 'get_fund_research') return ['用户私有基金持仓']
  if (key === 'get_factor_analysis') return ['自定义 SQL 或因子表达式']
  if (key === 'get_macro_snapshot') return ['历史官方可得日回测']
  if (key === 'get_option_market') return ['隐含波动率、Greeks 或完整期权链']
  if (key === 'get_convertible_bond_market') return ['把缺失的早期历史补零']
  if (key === 'run_event_study') return ['查询原始事件明细或执行任意 SQL']
  if (key === 'get_backtest_analytics') return ['创建参数扫描、Walk Forward 或对比回测任务']
  if (key === 'get_portfolio_analytics') return ['修改持仓或生成调仓单']
  return []
}
