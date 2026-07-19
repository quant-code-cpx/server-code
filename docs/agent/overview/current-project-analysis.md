# 当前项目分析

> 扫描基线：2026-07-19。结论来自当前服务端仓库、同级 `../client-code`、同级 `../data-service`、Prisma schema、migration、Docker 配置，以及本机运行中的只读数据库统计。本文只描述现状；目标架构见 [总体架构](./architecture-overview.md)。

## 1. 仓库与技术栈

当前工作区是单体 NestJS 服务，并非前后端 monorepo。服务端入口为 `src/main.ts` 和 `src/app.module.ts`；`pnpm-workspace.yaml` 只包含当前目录。真实 Web 前端位于同级 `../client-code`，历史 Python 原型位于 `../data-service`。

| 层 | 已确认技术 | 真实依据 |
| --- | --- | --- |
| Web | React 19、TypeScript 5.8、Vite 6、MUI 7、React Router 7 | `../client-code/package.json`、`../client-code/src/routes/sections.tsx` |
| 前端数据与可视化 | Fetch、ApexCharts、Socket.IO Client、react-markdown、MSW、Vitest、Playwright | `../client-code/src/api/client.ts`、`../client-code/src/components/chart/` |
| API | NestJS 11、Swagger、class-validator、Passport JWT | `package.json`、`src/main.ts`、`src/apps/auth/` |
| 数据 | Prisma 6、PostgreSQL 17 | `prisma.config.ts`、`prisma/**/*.prisma`、`docker-compose.yml` |
| 异步与缓存 | BullMQ、Redis、Nest Schedule | `src/queue/`、`src/shared/cache.service.ts`、各 scheduler |
| 实时 | Socket.IO namespace `/ws` | `src/websocket/events.gateway.ts` |
| 可观测性 | Winston、Prometheus、Terminus、AsyncLocalStorage traceId | `src/shared/logger/`、`src/shared/metrics/`、`src/shared/health/`、`src/shared/context/` |
| 报告 | Puppeteer、本地 `storage/reports` | `src/apps/report/`、`dockerfiles/app/Dockerfile.prod` |

## 2. 服务端模块结构

`src/app.module.ts` 聚合认证、股票、市场、指数、行业、因子、资金流、回测、组合、报告、研究笔记、预警、通知、Tushare 等模块。控制器采用 `/api` 全局前缀，业务查询也普遍使用 `POST`；健康与指标端点被排除前缀。

扫描得到 26 个业务 Controller、315 个业务端点。所有业务端点都是非空路径 `POST`，没有 `@Query()`；这是一项项目约定，Agent API 继续遵循该约定，只有 `POST` 流式响应采用 `text/event-stream`。当前 20 个端点缺 Swagger response 装饰器，71 个 `@Body()` 使用内联或交叉类型，未能稳定触发 DTO 校验。另有运行时默认 `POST 201` 与 Swagger 标注 `200` 的契约漂移，应在 Agent 公共契约落地前一并治理。

可直接复用的业务能力：

- `src/apps/stock/`：股票解析、概览、行情、财务、资金流、分析、筛选。
- `src/apps/market/`、`src/apps/index/`、`src/apps/industry/`、`src/apps/industry-rotation/`：市场和板块上下文。
- `src/apps/factor/`、`src/apps/backtest/`：确定性因子、绩效和回测能力。
- `src/apps/portfolio/`、`src/apps/watchlist/`：受用户权限约束的持仓和自选股。
- `src/apps/report/`、`src/apps/research-note/`：研究产物和个人记录。
- `src/apps/notification/`、`src/apps/alert/`、`src/apps/screener-subscription/`：通知、条件触发和订阅。
- `src/tushare/`：计划驱动的全量/增量同步、质量检查、修复及衍生计算；`src/apps/tushare/` 只承担管理 API。
- `src/queue/`、`src/shared/cache.service.ts`、`src/websocket/events.gateway.ts`：队列、缓存、事件基础设施。

## 3. 金融数据同步与定时任务

Tushare 同步已经是分类、注册表和 plan-driven 架构。`src/tushare/sync/sync-registry.service.ts` 注册任务，`src/tushare/sync/sync-plan.types.ts` 与各分类 sync service 描述依赖、窗口、模式和调度，质量/修复/信号/热力图作为后置阶段。当前实际有 65 个同步计划，覆盖基础、行情、财务、资金流、因子、另类、基金、宏观和期权。

当前进程同时承载 API、BullMQ worker、WebSocket 和 scheduler。除 10 个静态 `@Cron`/`@Interval` 外，Tushare 动态注册约 64 个 plan schedule；多副本没有 leader election 或分布式锁，会重复运行。19:00 的预警/事件扫描也可能与尚未结束的数据同步竞争。Agent 定时研究必须先建立唯一调度和幂等执行语义，不能直接再加一组普通 `@Cron`。

## 4. 数据库与真实数据量

当前 Prisma schema 有 111 个 Model；运行库有 112 张普通表（含 `_prisma_migrations`），即 111 张业务表，运行库与当前 schema 未发现结构漂移。主要事实表已达到千万级：

| 表 | 精确行数 | 数据范围（业务日期） |
| --- | ---: | --- |
| `stock_daily_prices` | 18,002,711 | 1990-12-19 至 2026-07-17 |
| `stock_daily_valuation_metrics` | 17,912,325 | 1990-12-19 至 2026-07-17 |
| `stock_technical_factors` | 18,152,124 | 1990-12-19 至 2026-07-17 |
| `cyq_chips` | 27,985,453 | 2026-04-20 至 2026-07-17 |
| `share_float_schedule` | 10,159,691 | 2005-01-21 至 2035-10-29 |
| `cashflow_reports` | 333,160 | 2012-03-31 至 2026-06-30 |
| `income_statement_reports` | 322,666 | 2012-03-31 至 2026-06-30 |
| `balance_sheet_reports` | 349,990 | 2012-03-31 至 2026-06-30 |

完整能力、索引和来源见 [数据能力盘点](./data-capability-inventory.md)。

以下数据阻断风险已被实库和代码交叉验证：

1. migration 链缺少 `ValuationDailyMedian`、`CyqChips`、`CyqPerf`、`LimitListD`、`FundAdj`、`FundPortfolio`、`FundShare`、`ThsDaily`、`DailyInfo`、`GgtDaily` 十张表的 `CREATE`；`20260426000002_backfill_valuation_daily_medians` 却直接写其中一表，全新环境不能认为可重建。
2. 周/月线 Tushare `pct_chg` 是小数比例，日线是百分数，但共用 mapper 未换算。数据库抽样聚合比值为 weekly/monthly `0.0100`、daily `1.0000`，已发现周线 72,629 条、月线 20,000 条单位错配。任何跨周期收益 Tool 上线前必须修复并回填。
3. `Dividend` 没有自然唯一键；全量同步对非空表不清理，`createMany(skipDuplicates)` 因无唯一约束而不能去重。实库 17,151 行包含 807 个重复业务键组、16,260 条冗余，单组最多重复 84 次；再次全量会继续放大。
4. `SyncRetryService` 的历史失败日期会被最新进度短路为“已最新”，240 条 retry 即使标记 `SUCCEEDED` 也不能证明补数成功。周/月 period end 还会把未结束周期当缺口；实库已有成功队列但零行的 WEEKLY/MONTHLY 目标。
5. 股票详情前复权公式使用 `latestAdj/factor`，与 Tushare 定义的 `factor/latestAdj` 相反；回测路径公式虽正确，但最新复权因子的选择缺稳定排序。
6. 回测 ALL_A 使用当前上市状态，历史样本排除了 337 个已有日线的现退市证券且不会动态加入后续 IPO；指数成分退出未剔除，部分轮动策略忽略 universe，财务因子按报告期而非公告可用日过滤，存在幸存者偏差与前视偏差。

此外，`pg_stat_user_tables` 统计估算与精确行数严重偏离，说明统计信息陈旧；千万级 Tool 查询必须先以 `EXPLAIN (ANALYZE, BUFFERS)` 验证索引，不能只依赖 ORM 直觉。同步配置中的 `requestIntervalMs`、`dateBatchConcurrency`、`syncCron` 目前只定义未消费，真实频控依赖客户端固定全局并发和少数任务的显式节流。

## 5. 前端现状

前端路由由 `../client-code/src/routes/sections.tsx` 懒加载并经 `AuthGuard` 与 `DashboardLayout` 保护；页面通常较薄，业务逻辑位于 `src/sections/`。认证由 reducer + Context 管理，其他功能以局部 hooks 为主。首期 Agent 可采用 feature-scoped reducer + Context，不必为单一功能引入 Redux/Zustand。

`../client-code/src/api/client.ts` 已实现内存 access token、HttpOnly refresh cookie、单航班刷新和 `AbortSignal`，但假定 JSON 响应；Agent 需要独立的 `fetch` POST SSE reader。浏览器 `EventSource` 不支持本项目所需的 POST body 和现有认证方式，不采用。

可复用 `src/components/chart/`、Markdown preview 和通用 UI；股票详情 K 线当前耦合在约 1,182 行的 `stock-detail-market-tab.tsx`，需抽成受控公共组件。服务端返回 chart/table/Kline 规范化数据，前端只接受白名单 schema，禁止模型直接注入 ApexCharts options 或 HTML。

## 6. 部署与基础设施现状

开发 Compose 中 PostgreSQL、Redis、Nest、Prometheus、Grafana 当前均可运行。生产链路尚不完整：

- `dockerfiles/app/Dockerfile.prod` 健康检查请求 `/api/health`，实际端点是 `/health`。
- 仓库没有 `.dockerignore`，`COPY . .` 会扩大构建上下文并可能带入 `.env`。
- 开发启动执行 `prisma db push --accept-data-loss`；生产镜像没有显式 `prisma migrate deploy` 作业。
- 非 root 镜像没有为 `/app/logs`、`/app/storage` 建目录并 chown；Puppeteer Chromium 也未可靠打包。
- 单 Redis 同时承载缓存、认证和 BullMQ，`volatile-lru` 与宽泛 ACL 不适合持久队列；需要至少逻辑隔离、独立策略和备份。
- Socket.IO 没有 Redis adapter，多副本下事件无法广播；cron 也没有主实例/锁。
- CI lint 允许失败，6 个 E2E 未进入 CI。

## 7. 权限与实时通信风险

HTTP 认证基础可复用，但当前 WebSocket 存在上线阻断缺陷：`SharedModule` 注册的 JwtModule 默认 secret 为空，gateway 存在空 secret 回退校验路径；匿名连接被允许，订阅回测进度缺少资源归属校验。前端未发送 token handshake，并发送服务端未实现的 replay 事件；异常通知的事件名也有漂移。

因此，Agent 正文流只走带现有 HTTP 认证的 POST SSE；WebSocket 仅用于通知和多设备失效，并在启用前完成强制鉴权、订阅 ACL、事件契约和跨实例 adapter 改造。详见 [安全与风险控制](./security-and-risk-control.md)。

## 8. 新增、改造与暂不接入

必须新增：`src/apps/agent/` 领域模块、模型网关、受控 Tool Registry、执行状态/事件存储、会话与记忆、POST SSE replay、Agent BullMQ worker、搜索适配器、Agent 评测与指标。

必须改造：业务 Service 的稳定只读门面、统一 DTO/响应码、WebSocket 安全、Redis/队列隔离、scheduler 唯一执行、生产 migration 和存储目录、前端 API reader 与 K 线公共组件。

暂不接入：`../data-service`。它是独立 FastAPI/AkShare/SQLAlchemy 原型，使用另一套数据库与开发 reload，没有统一认证、CI、可观测性和契约。第二阶段若确定性重计算达到拆分阈值，应新建无状态量化计算服务并复用算法，而不是让 Agent 直连该原型。

## 9. 已确认与尚未确认

已确认：技术栈、主要模块、业务 API 约定、Prisma/运行库结构、核心数据量、同步框架、认证方式、前端目录、Docker 服务和上述风险。

尚未确认并需在对应批次做 discovery gate：正式模型供应商与区域、联网搜索供应商、通知渠道、生产并发/成本额度、对象存储产品、数据保留期限、是否允许模型供应商持久化请求。它们不阻塞 MVP 的供应商无关接口和本地实现。
