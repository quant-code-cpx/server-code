# Agent 后端方案

本目录给出基于当前 NestJS 11、Prisma 6、PostgreSQL 17、Redis 与 BullMQ 的可实施后端设计。MVP 采用模块化单体：API、编排、会话、模型网关与 Tool 沿用同一代码库，API、Worker、Scheduler 可以使用不同启动入口独立运行。

公共协议不在本目录重复定义。以下文件是唯一规范源：

- [REST API](../api/rest-api.md)
- [SSE 事件](../api/sse-events.md)
- [WebSocket 事件](../api/websocket-events.md)
- [错误码](../api/error-codes.md)
- [Tool 目录与 Schema](../tools/README.md)
- [数据库设计](./database-design.md)

实现发生冲突时，公共 REST/SSE/WebSocket/错误结构以 `docs/agent/api/` 为准，Tool key 与参数结构以 `docs/agent/tools/` 为准，数据库物理模型以 `docs/agent/database/` 为准。

## 导航

| 文档                                                           | 单一职责                                                             |
| -------------------------------------------------------------- | -------------------------------------------------------------------- |
| [后端架构](./architecture.md)                                  | 模块边界、进程边界、依赖方向与架构取舍                               |
| [Agent 编排器](./agent-orchestrator.md)                        | Run 状态机、工作流、检查点、重试和取消                               |
| [模型网关](./model-gateway.md)                                 | 多供应商抽象、路由、降级、成本和流式适配                             |
| [Tool 系统](./tool-system.md)                                  | Registry、Policy、执行管线、权限和审计                               |
| [金融数据服务](./financial-data-service.md)                    | 真实股票、市场、财务、用户数据 Service 的 Facade 边界                |
| [量化计算服务](./quantitative-compute-service.md)              | 确定性计算、回测、异步计算与 Python 边界                             |
| [联网搜索服务](./web-search-service.md)                        | 搜索、抓取、来源验证、引用和外部内容隔离                             |
| [会话与记忆](./conversation-and-memory.md)                     | 原始消息、上下文预算、摘要、长期记忆和恢复                           |
| [调度与通知](./scheduler-and-notification.md)                  | 定时/条件任务、唯一执行、渠道投递和去重                              |
| [API 落地](./api-design.md)                                    | NestJS Controller、DTO、POST-SSE 与现有拦截器适配                    |
| [数据库接线](./database-design.md)                             | Repository、事务、Outbox、租约与 Prisma 模块接线（由数据库方案维护） |
| [可观测性](./observability.md)                                 | 日志、指标、Trace、审计和评测                                        |
| [安全](./security.md)                                          | 认证、租户隔离、Tool/模型/搜索安全和上线门禁                         |
| [部署](./deployment.md)                                        | 本地、个人和多用户运行拓扑、密钥、备份与扩缩容（由部署方案维护）     |
| [智能体队列工作进程运行手册](./智能体队列工作进程-运行手册.md) | Agent BullMQ 入队、独立 Worker、恢复、监控、故障处理与回滚           |
| [智能体 REST 接口运行手册](./智能体REST接口-运行手册.md)       | 会话、消息、Run、严格 DTO、幂等、配额、取消、outbox 与故障判断       |

## 明确结论

| 问题       | 决策                                                                                 |
| ---------- | ------------------------------------------------------------------------------------ |
| 编排放置   | 在现有 NestJS 新增 `src/apps/agent/`，不放前端、不先拆微服务                         |
| Agent 模式 | 单个受控研究 Agent + 版本化确定性工作流 + 白名单 Tool                                |
| 工作流实现 | MVP 自研显式状态机与数据库检查点；暂不引入 LangGraph                                 |
| 模型网关   | NestJS 内部独立模块；业务代码不直接依赖供应商 SDK                                    |
| 队列       | 复用 BullMQ，新增 `agent-execution` 与 `agent-notification`；PostgreSQL 是状态权威源 |
| Python     | MVP 不接 `../data-service`；达到计算拆分阈值后重构为无状态计算服务                   |
| 向量数据库 | MVP 不需要；结构化状态、全文/关键词和版本摘要足够                                    |
| 多 Agent   | MVP 不启用自由委派；满足 ADR 复审条件后才引入专业节点                                |
| 流式传输   | 命令/查询走 POST JSON，正文走 POST fetch-SSE，Socket.IO 仅做状态失效通知             |
| 数据访问   | Tool 只调用受控 Facade；模型不得取得 Prisma、SQL、HTTP 客户端或密钥                  |

详细取舍见 [ADR 索引](../decisions/README.md)。

## 现有能力与落地边界

直接复用：

- `src/apps/auth/`、`src/apps/user/`、`src/lifecycle/guard/` 和 `src/shared/token.service.ts` 的 HTTP 身份体系。
- `src/apps/stock/`、`src/apps/market/`、`src/apps/index/`、`src/apps/industry/` 的公开金融查询。
- `src/apps/watchlist/`、`src/apps/portfolio/`、`src/apps/backtest/` 的用户隔离查询与量化结果。
- `src/apps/factor/` 的确定性因子能力，但必须先关闭已发现的租户越权入口。
- `src/queue/`、`src/shared/cache.service.ts`、`src/shared/metrics/`、`src/shared/logger/` 的基础设施。

新增：

- `src/apps/agent/`：API、会话、Run、编排、模型网关、Tool、工作流、Worker、审计事件。
- `src/apps/web-search/`：搜索供应商、受控抓取、正文提取与来源验证。
- `src/apps/scheduled-research/`：用户调度、执行租约、通知投递与补偿。
- `prisma/agent/`：物理模型以[数据库设计](./database-design.md)为准。

改造：

- 在股票、市场、自选股、组合、回测、因子和报告模块增加只导出稳定 DTO 的 `*ToolFacade`；Agent Tool 不直接注入内部 Service 或 `PrismaService`。
- 为 `src/websocket/events.gateway.ts` 修复强制鉴权、资源归属与多副本广播。
- 为 `src/lifecycle/interceptors/transform.interceptor.ts` 增加显式 SSE 旁路；Agent DTO 全部使用 class-validator 类。
- 将 API、Worker、Scheduler 的启动职责解耦，并为定时任务加入分布式唯一执行。

## 开发前门禁

以下问题不是“后续优化”，而是 Agent 上线前门禁：

1. **P0 WebSocket 鉴权**：`src/shared/shared.module.ts` 当前用空 secret 注册全局 `JwtService`；`src/websocket/events.gateway.ts` 允许无效 Token 连接，且 `subscribe_backtest` 未校验任务归属。
2. **P0 因子租户隔离**：`prisma/research/factor.prisma` 的 `FactorDefinition` 没有 `userId`，普通认证用户可改全局自定义因子；`FactorBacktestService.attribution()` 未按用户校验回测归属。
3. **P0 数据可重建与行情口径**：全新 migration 链缺少十张已在 Prisma 中声明的表；周/月线 `pct_chg` 与日线单位不一致；`StockDetailService.getDetailChart()` 的前复权公式方向写反。行情 Tool 必须等 migration、修复、回填和黄金样例验收后开放。
4. **P0 点时性与回测偏差**：历史概览会混入当前最新快报，财务/因子未统一按公告可用日过滤；现有 ALL_A 使用当前上市股票、部分策略忽略 universe。未修复的历史回测只能返回 `BACKTEST_BIAS_UNVERIFIED`，不能作为已验证结论。
5. **P0 同步成功语义不可信**：最新进度会短路更早失败日期并把 retry 标成功；空响应路径可删旧数据；部分分片失败仍可写 SUCCESS；现有时效检查把比较值误作滞后天数。Agent freshness gate 不能只读取同步日志 status。
6. **P1 错误传输**：`BusinessException` 当前总是 HTTP 200，HTTP 错误指标无法识别业务失败；Agent 必须按[错误码](../api/error-codes.md)同时表达 HTTP 与业务语义。
7. **P1 队列可靠性**：Batch 012 已将默认 Redis 改为 `noeviction`，并支持 Agent 独立 Redis URL、namespace、outbox 与数据库恢复；生产仍须配置独立凭据/ACL/logical DB 或实例。
8. **P1 调度重复**：当前 API、Worker、Socket.IO 和大量 Cron 同进程，多副本会重复执行；Agent Scheduler 必须先实现租约与幂等。

## 文档使用方式

开发批次应先固定 DTO/OpenAPI、状态枚举、Tool Schema 与数据库 migration，再并行实现前端、模型适配器和 Tool adapter。任何实现批次都要引用本目录中的模块主文档，不能在批次内重新定义协议。
