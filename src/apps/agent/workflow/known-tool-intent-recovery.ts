import type { AgentToolKey } from '../contracts'

export interface KnownToolIntentRecovery {
  toolKeys: AgentToolKey[]
  reason: string
}

export function detectKnownToolIntent(userText: string): KnownToolIntentRecovery | null {
  const text = userText.replace(/\s+/g, '').toLowerCase()
  const broadStockScope = /(板块|行业|全市场|科创板|创业板|排行|排名|筛选|选股|哪些股票)/.test(text)

  if (/(数据|因子|行情|财务).*(覆盖|水位|更新到|更新至|缺失|可用性|完整度)|(?:覆盖|水位).*(数据|因子)/.test(text)) {
    return recovery(['get_data_availability'], '数据覆盖与水位查询')
  }
  if (/回测/.test(text) && /(蒙特卡洛|稳健|归因|成本敏感|参数扫描|walk.?forward|对比)/.test(text)) {
    return recovery(['get_backtest_result', 'get_backtest_analytics'], '已有回测稳健性分析')
  }
  if (/(我的|本人|当前).*(组合|持仓)/.test(text) && /(过去|历史|表现|收益|盈亏|漂移|交易事件)/.test(text)) {
    return recovery(['get_portfolio_analytics'], '本人组合点时分析')
  }
  if (/(我的|本人|当前).*(组合|持仓)/.test(text) && /(风险|集中度|beta|敞口)/.test(text)) {
    return recovery(['get_portfolio_risk'], '本人组合风险分析')
  }
  if (/(公告|事件).*(后|前).*(异常收益|涨|跌|表现)|(?:异常收益|通常涨|通常跌).*(公告|事件)/.test(text)) {
    return recovery(['run_event_study'], '固定事件研究')
  }
  if (/(已公告事件|未来.*事件|近期.*(?:回购|解禁|分红|停牌|复牌)|股东.*事件)/.test(text)) {
    return recovery(['get_stock_events'], '单股结构化事件查询')
  }
  if (!broadStockScope && /(?:标准|技术|买入|卖出).{0,8}信号|有没有.{0,8}信号/.test(text)) {
    return recovery(['get_stock_technical_signals'], '单股标准技术信号查询')
  }
  if (!broadStockScope && /(macd|rsi|kdj|boll|布林|技术指标)/.test(text)) {
    return recovery(['get_stock_technical_indicators'], '单股技术指标查询')
  }
  if (/行业轮动|行业.*(?:动量|资金).*(?:排名|排行)|(?:排名|排行).*(?:行业动量|行业资金)/.test(text)) {
    return recovery(['get_industry_rotation'], '行业轮动分析')
  }
  if (/因子.*(?:ic|五分组|分组|衰减|相关性|分布)|(?:ic|五分组).*(?:因子)/.test(text)) {
    return recovery(['get_factor_analysis'], '内置因子分析')
  }
  if (/(cpi|ppi|gdp|shibor|宏观快照)/.test(text)) {
    return recovery(['get_macro_snapshot'], '宏观数据快照')
  }
  if (
    /(?:基金|etf|lof).*(?:净值|场内价格|份额|基金持仓)|(?:净值|场内价格|份额).*(?:基金|etf|lof)|\d{6}.*(?:基金|etf|lof|净值)/.test(
      text,
    )
  ) {
    return recovery(['get_fund_research'], '基金研究')
  }
  if (/(沪深300|中证\d+|上证指数|深证成指)|指数.*(?:走势|估值|成分|权重|行情)/.test(text)) {
    return recovery(['get_index_market_data'], '指数研究')
  }
  return null
}

function recovery(toolKeys: AgentToolKey[], reason: string): KnownToolIntentRecovery {
  return { toolKeys, reason }
}
