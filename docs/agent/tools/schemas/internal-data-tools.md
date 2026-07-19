# 内部数据 Tool JSON Schema

以下为输入 schema；均隐式 `additionalProperties: false`，输出套用 [公共 `ToolResult`](./common-types.md)。实现时以 TypeScript 常量生成 provider schema 和 OpenAPI 类型，避免手写两套定义。

## `resolve_security`

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["query"],
  "properties": {
    "query": { "type": "string", "minLength": 1, "maxLength": 64 },
    "securityTypes": { "type": "array", "maxItems": 4, "items": { "enum": ["STOCK", "INDEX", "FUND", "OPTION"] } },
    "includeDelisted": { "type": "boolean", "default": false }
  }
}
```

返回至多 20 个候选：`tsCode/name/securityType/exchange/listStatus/listDate/delistDate/matchScore`。多候选且分数接近时 workflow 要求用户澄清，不能自行挑选。

## `get_stock_price_history`

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["tsCode", "startDate", "endDate", "frequency", "adjustment"],
  "properties": {
    "tsCode": { "type": "string", "maxLength": 12 },
    "startDate": { "type": "string", "format": "date" },
    "endDate": { "type": "string", "format": "date" },
    "frequency": { "enum": ["DAILY", "WEEKLY", "MONTHLY"] },
    "adjustment": { "enum": ["NONE", "FORWARD", "BACKWARD"] },
    "fields": { "type": "array", "minItems": 1, "maxItems": 10, "uniqueItems": true, "items": { "enum": ["open", "high", "low", "close", "preClose", "pctChange", "volume", "amount", "turnoverRate", "peTtm"] } },
    "limit": { "type": "integer", "minimum": 1, "maximum": 5000, "default": 1000 }
  }
}
```

输出稳定按交易日升序。周/月 `pctChange` 修复 gate 未通过时该字段不可返回；OHLC 可由程序重算收益并给 warning。

## `get_stock_overview`

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["tsCodes"],
  "properties": {
    "tsCodes": { "type": "array", "minItems": 1, "maxItems": 20, "uniqueItems": true, "items": { "type": "string", "maxLength": 12 } },
    "asOfDate": { "type": "string", "format": "date" },
    "sections": { "type": "array", "maxItems": 6, "uniqueItems": true, "items": { "enum": ["BASIC", "QUOTE", "VALUATION", "INDUSTRY", "SHARE_CAPITAL", "DATA_DATES"] } }
  }
}
```

## `get_financial_statements`

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["tsCode", "statementTypes", "periodType", "limit"],
  "properties": {
    "tsCode": { "type": "string", "maxLength": 12 },
    "statementTypes": { "type": "array", "minItems": 1, "maxItems": 3, "uniqueItems": true, "items": { "enum": ["INCOME", "BALANCE_SHEET", "CASH_FLOW"] } },
    "periodType": { "enum": ["QUARTERLY", "ANNUAL"] },
    "startReportPeriod": { "type": "string", "format": "date" },
    "endReportPeriod": { "type": "string", "format": "date" },
    "availableAt": { "type": "string", "format": "date-time" },
    "limit": { "type": "integer", "minimum": 1, "maximum": 12 }
  }
}
```

`availableAt` 用于回测/历史研究的当时可知过滤；返回必须区分累计值与单季派生值。

## `get_financial_indicators`

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["tsCode", "indicators", "limit"],
  "properties": {
    "tsCode": { "type": "string", "maxLength": 12 },
    "indicators": { "type": "array", "minItems": 1, "maxItems": 30, "uniqueItems": true, "items": { "type": "string", "pattern": "^[a-z][a-z0-9_]{1,40}$" } },
    "startReportPeriod": { "type": "string", "format": "date" },
    "endReportPeriod": { "type": "string", "format": "date" },
    "availableAt": { "type": "string", "format": "date-time" },
    "limit": { "type": "integer", "minimum": 1, "maximum": 20 }
  }
}
```

指标 key 必须由服务端 allowlist 映射到真实字段，不把字段名直接传入 Prisma。

## `get_stock_moneyflow`

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["tsCode", "startDate", "endDate"],
  "properties": {
    "tsCode": { "type": "string", "maxLength": 12 },
    "startDate": { "type": "string", "format": "date" },
    "endDate": { "type": "string", "format": "date" },
    "includeOrderBuckets": { "type": "boolean", "default": true },
    "limit": { "type": "integer", "minimum": 1, "maximum": 250, "default": 60 }
  }
}
```

## `get_market_snapshot`

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["sections"],
  "properties": {
    "tradeDate": { "type": "string", "format": "date" },
    "sections": { "type": "array", "minItems": 1, "maxItems": 8, "uniqueItems": true, "items": { "enum": ["INDEX_QUOTES", "BREADTH", "VALUATION", "SENTIMENT", "MONEY_FLOW", "HSGT", "SECTOR_RANKING", "DATA_DATES"] } },
    "sectorType": { "enum": ["INDUSTRY", "CONCEPT"] },
    "topN": { "type": "integer", "minimum": 1, "maximum": 50, "default": 10 }
  }
}
```

不同 section 的数据日期可能不同，输出按 section 单独给 `asOf`，禁止用一个日期掩盖部分未更新。

## `get_sector_membership`

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["mode"],
  "properties": {
    "mode": { "enum": ["SECTORS_FOR_SECURITY", "MEMBERS_FOR_SECTOR"] },
    "tsCode": { "type": "string", "maxLength": 12 },
    "sectorCode": { "type": "string", "maxLength": 40 },
    "sectorType": { "enum": ["INDUSTRY", "CONCEPT", "INDEX"] },
    "effectiveDate": { "type": "string", "format": "date" },
    "limit": { "type": "integer", "minimum": 1, "maximum": 500, "default": 100 }
  },
  "oneOf": [
    { "required": ["tsCode"] },
    { "required": ["sectorCode", "sectorType"] }
  ]
}
```

## 用户私有查询

`get_user_watchlist`：

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "watchlistId": { "type": "integer", "minimum": 1 },
    "includeLatestQuote": { "type": "boolean", "default": false },
    "limit": { "type": "integer", "minimum": 1, "maximum": 200, "default": 100 }
  }
}
```

`get_portfolio_risk`：

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["portfolioId", "asOfDate", "sections"],
  "properties": {
    "portfolioId": { "type": "string", "minLength": 1, "maxLength": 64 },
    "asOfDate": { "type": "string", "format": "date" },
    "sections": { "type": "array", "minItems": 1, "maxItems": 6, "uniqueItems": true, "items": { "enum": ["HOLDINGS", "CONCENTRATION", "INDUSTRY", "MARKET_CAP", "BETA", "VIOLATIONS"] } }
  }
}
```

`get_backtest_result`：

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["backtestRunId", "sections"],
  "properties": {
    "backtestRunId": { "type": "string", "minLength": 1, "maxLength": 64 },
    "sections": { "type": "array", "minItems": 1, "maxItems": 6, "uniqueItems": true, "items": { "enum": ["CONFIG", "STATUS", "METRICS", "EQUITY", "TRADES_SUMMARY", "ATTRIBUTION"] } },
    "maxEquityPoints": { "type": "integer", "minimum": 10, "maximum": 2000, "default": 500 }
  }
}
```

三者的 `userId` 都不在 schema；由 `ToolAccessContext` 注入，Facade 必须在查询条件中校验所有权。
