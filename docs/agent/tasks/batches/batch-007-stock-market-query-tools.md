---
batch: 7
status: completed
type: backend
depends_on: ['batch-000-platform-data-readiness', 'batch-006-tool-registry-and-policy']
blocks: ['batch-011-agent-orchestrator-workflow']
parallel_with:
  [
    'batch-008-financial-fund-flow-tools',
    'batch-009-deterministic-quant-tools',
    'batch-010-web-search-and-citations',
    'batch-015-frontend-stream-client-and-contracts',
    'batch-016-frontend-chat-shell',
  ]
recommended_executor: backend-coding-agent
recommended_reasoning_level: high
estimated_scope: large
---

# Batch 007：股票、市场与自选股查询 Tool

## 1. 批次目标

通过只读领域 Facade 注册 `resolve_security`、`get_stock_price_history`、`get_stock_overview`、`get_market_snapshot`、`get_sector_membership`、`get_user_watchlist` 六个 Tool。

## 2. 业务价值

让 Agent 用真实股票、行情、市场和用户自选数据回答问题，同时保持代码映射、数据时点、行数和租户权限可控。

## 3. 前置依赖

- Batch 000 数据门禁 green。
- Batch 006 Registry/Policy/Executor 可用。

## 4. 执行范围

- 为 Stock/Market/Industry/Index/Watchlist 建最小只读 Tool Facade 并从原 Module export。
- 实现六个 adapter、JSON Schema、provenance、分页/截断和 dataAsOf。
- 用现有 Service contract 与实库 fixture 验证，不经内部 HTTP。

## 5. 不在本批次范围内

- 不查询三张财务报表或个股资金流；Batch 008 负责。
- 不计算绩效/估值分位或读取组合/回测；Batch 009 负责。
- 不改现有 Controller 返回结构。

## 6. 涉及的现有文件

- `src/apps/stock/stock.service.ts`、`stock-detail.service.ts`、`stock.module.ts`
- `src/apps/market/market.service.ts`、`market.module.ts`
- `src/apps/index/index.service.ts`、`src/apps/industry/`、`src/apps/industry-rotation/`
- `src/apps/watchlist/watchlist.service.ts`、`watchlist.module.ts`

## 7. 需要新增的文件

- `src/apps/stock/stock-tool.facade.ts`
- `src/apps/market/market-tool.facade.ts`
- `src/apps/industry/sector-tool.facade.ts`
- `src/apps/watchlist/watchlist-tool.facade.ts`
- `src/apps/agent/tools/adapters/stock-market-tools.ts`
- `src/apps/agent/tools/adapters/test/stock-market-tools.spec.ts`

## 8. 需要修改的文件

- 上述领域 Module 只 export 新 Facade，不大面积 export 内部 Service
- `src/apps/agent/agent.module.ts` 注册六个 Tool definitions

## 9. 数据库变更

不新增表/索引。查询必须命中现有复合索引；千万级行情查询用 `EXPLAIN (ANALYZE, BUFFERS)` 验证日期范围计划。

## 10. API 变更

不新增 REST。Tool schema 严格采用 `docs/agent/tools/schemas/internal-data-tools.md`。

## 11. 后端实现任务

- 证券解析返回歧义候选，不自动挑选。
- 行情强制 frequency/adjustment/日期上限；QFQ 修复 gate 未 green 时拒绝对应请求。
- 市场 snapshot 每个 section 独立 dataAsOf。
- Watchlist userId 从 ToolAccessContext 注入并在 Facade 查询条件中复验。

## 12. 前端实现任务

不涉及；Batch 017 使用 Tool 结果 fixture 渲染。

## 13. Tool 或工作流变更

- 注册六个 READ/idempotent Tool；最大 bars 5,000、overview 标的 20、sector members 500、watchlist 200。
- 输出 sourceServices/sourceModels/asOf/timezone/unit/adjustment/warnings/truncated。

## 14. 详细执行步骤

- 为每个现有模块定义只读 Facade DTO，避免 Controller DTO 和 Agent contract 耦合。
- 实现稳定排序、代码/日期/字段 allowlist、所有权检查。
- 编写 Tool adapter 和 registry definition；验证 output schema/provenance。
- 用已知股票、停牌、退市、歧义名称、空市场日期和跨租户自选 fixture 测试。
- 对行情/市场关键查询执行 explain，记录基线。

## 15. 核心数据结构

- `SecurityResolution`、`PriceBar`、`StockOverview`、`MarketSectionResult`、`SectorMembership`、`WatchlistSnapshot`。
- 所有 price/percent/volume/amount 字段附单位，不用展示字符串替代 number/null。

## 16. 关键接口定义

- `StockToolFacade.resolve(query, filters)`
- `StockToolFacade.priceHistory(command)`
- `MarketToolFacade.snapshot(command)`
- `SectorToolFacade.membership(command)`
- `WatchlistToolFacade.read(userId, command)`

## 17. 配置和环境变量

- 复用缓存配置；新增 `AGENT_TOOL_PRICE_MAX_BARS=5000`、`AGENT_TOOL_MARKET_CACHE_TTL_SECONDS`，给安全默认值。

## 18. 异常和边缘场景

- 名称同音/曾用名、多交易所代码、退市、停牌、日期无交易、最新不同步、成分历史有效期、空自选组。
- 缓存不得跨 userId 复用私有结果。

## 19. 安全要求

- 所有 Facade 固定 select 字段；禁止接收 Prisma orderBy/where/field 名。
- Watchlist 查询跨租户统一返回 not found；日志不记录完整自选内容。

## 20. 日志和可观测性要求

- 每 Tool 记录 duration/rows/cacheHit/dataLag/truncated/errorClass；查询计划基线附文档。
- data lag 超阈值返回 warning 并计数。

## 21. 测试要求

- 六个 Tool schema/adapter/Facade 单元和集成测试。
- 跨租户、歧义代码、日期/行数边界、周月单位 gate、QFQ gate。
- 现有 Stock/Market/Watchlist 回归 spec 通过。

## 22. 执行命令

- `pnpm test -- src/apps/agent/tools/adapters/test/stock-market-tools.spec.ts`
- `pnpm test -- src/apps/stock/test src/apps/market/test src/apps/watchlist/test`
- `pnpm run build`

## 23. 验收标准

- 六个 key 在 registry 唯一可用，返回通过公共 output schema。
- 任何模型输入无法覆盖 userId、任意字段或超范围查询。
- 数据截止时间和复权口径可在每个结果中定位。

## 24. 完成定义

- [x] 四个领域 Facade、六个 strict Tool definitions 与 Module exports 已完成；adapter 不经内部 HTTP，也不直接注入 Prisma。
- [x] `resolve_security` 覆盖 STOCK/INDEX/FUND/OPTION；行情实现 NONE/FORWARD/BACKWARD、日周月、字段白名单和最近 N 条截断。
- [x] QFQ 修为 `raw * factor / latestFactor`，周/月 `pctChange` 保持百分数；历史 overview 的快报公告日不晚于请求时点。
- [x] Market section 独立 `asOf/status`；THS 历史概念成分 fail-closed；Watchlist 强制 owner 条件且不缓存私有结果。
- [x] 实现提交：`497caa7 feat(agent): add stock market query tools`。
- [x] 专项 26/26、Batch 006 Tool 27/27、Stock/Market/Index/Industry/Watchlist 487/487、production build、legacy ESLint、contracts 和格式门禁通过。
- [x] 日线查询命中 `stock_daily_prices_pkey` backward index scan；估值与复权因子命中各自复合主键；1001 bars 热态执行 18.673ms。
- [x] 开发容器编译 `Found 0 errors`，App/PostgreSQL/Redis healthy，`/health` 与 `/ready` 均为 ok。
- [x] Tool inventory、[测试方案](../../../design/Agent股票市场与自选股工具测试方案-20260719.md)、[执行报告](../../../Agent股票市场与自选股工具测试执行报告-20260719.md)与 `docs/README.md` 已同步。

## 25. 回滚方案

从 AgentModule 注销六个 Tool 即可立即关闭；Facade 保留不影响现有 API，无 DB 回滚。

## 26. 后续批次

- Batch 011 编排可调用这些 Tool。
- Batch 017 用 fixture 展示行情/市场/自选结果。
