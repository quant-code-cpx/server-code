# Agent 前端设计索引

> 状态：可实施设计稿
> 基线：`server-code` 与同级 `../client-code` 当前代码，2026-07-19
> 路径约定：本文出现的 `../client-code/...` 均相对 `server-code` 仓库根目录。

## 1. 目标与边界

Agent 前端不是独立聊天玩具，而是现有量化平台中的“研究工作台”：用户在同一条可追溯会话里提出研究问题、观察工具执行、检查行情与财务数据、阅读引用、取消或恢复长任务，并能回到股票详情、回测、报告等既有业务页面。

本目录只负责前端架构、交互和接入方案。公开 REST、SSE、WebSocket 与错误码的唯一事实来源是：

- [Agent API 总览](../api/README.md)
- [REST API](../api/rest-api.md)
- [SSE 事件](../api/sse-events.md)
- [WebSocket 事件](../api/websocket-events.md)
- [错误码](../api/error-codes.md)

前端文档不重新定义请求体、响应体或公开事件结构；契约调整必须先修改上述 API 文档与生成类型。

## 2. 当前仓库基线

前端实际位于同级仓库 `../client-code`，主要技术栈为 React 19、TypeScript、Vite、React Router、MUI 7、ApexCharts、Socket.IO Client、Vitest 与 Playwright。当前没有 Redux、Zustand 或 TanStack Query，业务状态主要由组件状态和少量 Context 管理。

可直接复用或适配的现有能力：

| 能力 | 当前路径 | Agent 用法 |
| --- | --- | --- |
| 登录与令牌刷新 | `../client-code/src/auth/provider.tsx`、`src/api/client.ts` | 复用登录态；抽取统一鉴权请求执行器 |
| 图表壳与主题 | `../client-code/src/components/chart/` | 复用 ApexCharts 封装与暗色主题 |
| Markdown/GFM | `../client-code/src/sections/research-note/research-note-preview.tsx` | 抽成共享安全渲染器 |
| 股票搜索 | `../client-code/src/components/stock-search-autocomplete/` | 用于会话上下文与股票跳转 |
| 页面标题、空态、确认框、标签 | `../client-code/src/components/` | 复用现有视觉语言 |
| K 线数据类型与接口 | `../client-code/src/api/stock.ts` | 复用类型；从股票详情巨型组件抽出纯展示块 |
| 全局通知 | `../client-code/src/contexts/sync-notification-context.tsx` | 仅承接后台通知，不承载逐 token 流 |

当前 `../client-code/src/sections/stock-detail/stock-detail-market-tab.tsx` 同时承担 K 线、均线、成交量、历史懒加载、分时与资金流，耦合过重。Agent 不直接引用该页面组件，应抽取数据无关的 K 线展示内核。

## 3. 文档导航

- [前端架构](./architecture.md)：模块边界、目录与数据流。
- [交互流程](./interaction-flow.md)：从发问到恢复、取消、重试的用户旅程。
- [流式协议接入](./streaming-protocol.md)：POST Fetch SSE 客户端、断线恢复与背压。
- [状态管理](./state-management.md)：会话、运行、消息与草稿状态模型。
- [组件设计](./component-design.md)：布局、组件树、无障碍与响应式方案。
- [图表与数据可视化](./chart-and-data-visualization.md)：富数据块、K 线、表格与来源标识。
- [错误与恢复](./error-and-recovery.md)：错误分层、重试、降级与诊断。
- [API 集成](./api-integration.md)：普通 JSON 请求、流请求、生成类型与测试替身。
- [后端部署](../backend/deployment.md)：同域发布、扩缩容、存储、观测与灾备。

## 4. 设计原则

1. **服务端是真相源。** 消息正文、运行状态、工具调用与引用必须可重新拉取；浏览器缓存只优化体验。
2. **一条运行一条流。** SSE 只传当前运行的有序增量；Socket.IO 只做后台与跨设备通知。
3. **先可审计，再炫技。** 工具名称、参数摘要、耗时、数据时间、来源与失败原因均可查看。
4. **富内容白名单渲染。** 服务端数据只能进入受控组件，不能下发任意 HTML、脚本或图表配置。
5. **增量接入现有工程。** 保留 `src/api/client.ts`、MUI、ApexCharts、Auth Context 与现有路由结构，不为 Agent 引入第二套设计系统。
6. **恢复优先。** 刷新、临时断网、令牌刷新和页面切换后，都能从服务端快照与游标继续。

## 5. 实施批次

| 批次 | 交付重点 | 入口文档 |
| --- | --- | --- |
| 015 | 流客户端、契约生成、解析器与恢复测试 | [batch-015](../tasks/batches/batch-015-frontend-stream-client-and-contracts.md) |
| 016 | 会话列表、消息区、输入框、运行状态与路由 | [batch-016](../tasks/batches/batch-016-frontend-chat-shell.md) |
| 017 | Markdown、引用、工具、表格、图表和 K 线富响应块 | [batch-017](../tasks/batches/batch-017-frontend-rich-response-blocks.md) |
| 026 | 鉴权加固、同域部署、观测、扩缩容与回滚 | [batch-026](../tasks/batches/batch-026-security-hardening-and-production-deployment.md) |

## 6. 完成定义

- 新增 Agent 路由能从仪表盘导航进入，桌面与移动端均可用。
- POST Fetch SSE 支持鉴权、取消、心跳检测、事件去重和断线恢复。
- 刷新后可恢复运行与历史消息；失败不丢草稿，重复提交受幂等键保护。
- Markdown、链接、引用与数据块均经过白名单和安全策略处理。
- 单元测试覆盖解析器、reducer 与关键组件；Playwright 覆盖发送、流式渲染、取消、断线恢复和鉴权过期。
- 生产环境采用同域 `/api` 与 `/socket.io`，部署、迁移、日志、指标、备份和回滚均可执行。
