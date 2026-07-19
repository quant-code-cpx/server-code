# 确定性量化 Tool Schema

## 设计原则

模型不能自行计算需要精度和复现性的指标。计算 Tool 使用固定算法版本、有限输入、明确年化因子和无风险利率，输出含 `inputHash/outputHash/algorithmVersion`。缺失、重复日期、非有限数和序列过短必须显式失败或 warning。

## `compute_performance_metrics`

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["seriesType", "points", "annualizationFactor", "riskFreeRateAnnual"],
  "properties": {
    "seriesType": { "enum": ["EQUITY", "RETURN"] },
    "points": {
      "type": "array",
      "minItems": 2,
      "maxItems": 10000,
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["date", "value"],
        "properties": {
          "date": { "type": "string", "format": "date" },
          "value": { "type": "number" }
        }
      }
    },
    "annualizationFactor": { "type": "integer", "enum": [12, 52, 242, 252] },
    "riskFreeRateAnnual": { "type": "number", "minimum": -0.1, "maximum": 0.5 },
    "metrics": { "type": "array", "minItems": 1, "maxItems": 10, "uniqueItems": true, "items": { "enum": ["TOTAL_RETURN", "CAGR", "ANNUAL_VOLATILITY", "SHARPE", "SORTINO", "MAX_DRAWDOWN", "CALMAR", "WIN_RATE", "VAR_95", "CVAR_95"] } }
  }
}
```

程序先按日期升序去重（重复日期是错误），检查 equity 必须大于 0；return 值采用小数比例。输出每个指标的值、单位、样本数、起止日期和 warnings。

## `compute_valuation_percentile`

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["tsCode", "metric", "startDate", "endDate", "percentileMethod"],
  "properties": {
    "tsCode": { "type": "string", "maxLength": 12 },
    "metric": { "enum": ["PE_TTM", "PB", "PS_TTM", "DV_TTM"] },
    "startDate": { "type": "string", "format": "date" },
    "endDate": { "type": "string", "format": "date" },
    "asOfDate": { "type": "string", "format": "date" },
    "percentileMethod": { "enum": ["WEAK", "MEAN"] },
    "excludeNonPositive": { "type": "boolean", "default": true },
    "winsorize": { "enum": ["NONE", "P1_P99"] }
  }
}
```

数据来自真实 Prisma Model `DailyBasic`（物理表 `stock_daily_valuation_metrics`），查询最大十年，最少 60 个有效样本；输出当前值、percentile（0–1）、样本数、窗口、min/max/median、过滤数量和数据日期。比较多个股票时每个标的独立调用，避免不同上市时长被静默混合。

## 精度与口径测试

- 用手算小样本校验总收益、年化、波动、Sharpe 和最大回撤。
- 用固定 fixture 校验 0、负值、缺失、重复日期、单点、非有限数。
- 与现有回测服务相同输入做差异测试；差异必须解释口径而非放宽容差。
- 周/月收益 fixture 明确小数比例，防止复现现有 `pct_chg` 100 倍单位问题。
- 输出数值不在 Tool 内格式化成百分号字符串；前端依据 unit 展示。
