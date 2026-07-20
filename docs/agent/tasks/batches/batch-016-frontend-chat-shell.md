---
batch: 16
status: completed
type: frontend
depends_on: ["batch-015-frontend-stream-client-and-contracts"]
blocks: ["batch-017-frontend-rich-response-blocks", "batch-018-mvp-e2e-and-model-regression"]
parallel_with: ["batch-007-stock-market-query-tools", "batch-008-financial-fund-flow-tools", "batch-009-deterministic-quant-tools", "batch-010-web-search-and-citations", "batch-011-agent-orchestrator-workflow", "batch-012-agent-bullmq-worker", "batch-013-conversation-rest-api", "batch-014-post-sse-stream-and-replay"]
recommended_executor: frontend-coding-agent
recommended_reasoning_level: high
estimated_scope: large
---

# Batch 016：前端 Agent 会话壳

## 1. 批次目标

在 `../client-code` 新增受保护的 Agent 路由、导航、会话侧栏、消息视口、输入区、运行状态和 feature-scoped reducer/Provider，打通创建会话、发送、流式文本、取消、刷新恢复与重新生成的最小交互闭环。

## 2. 业务价值

用户可在现有量化 Dashboard 内稳定进行多轮研究，不因刷新、会话切换、输入法、断线或取消竞态丢消息；后续富图表/引用可在同一消息壳增量加入。

## 3. 前置依赖

- Batch 015 已提供生成类型、普通 Agent API、POST Fetch SSE 客户端与错误分类。
- 公共会话、消息、Run、取消和重生成语义以 `docs/agent/api/` 为准。
- 路由、Auth、MUI Theme 与布局沿用 `../client-code` 当前实现。

## 4. 执行范围

- `/agent` 与 `/agent/:conversationId` 受保护路由和 Dashboard 导航。
- 会话分页/切换/新建态、消息时间线、Composer、模型偏好、运行状态、停止/重试/重新生成。
- Agent 路由级 Context + reducer、规范化实体、草稿与请求代次。
- 刷新/深链/断线恢复、基础 Markdown/纯文本占位和关键 UI 测试。

## 5. 不在本批次范围内

- 不实现最终 Markdown 安全渲染、引用卡、Tool 详情、表格、Chart、K 线和财务块；Batch 017 负责。
- 不引入 Redux、Zustand 或 TanStack Query。
- 不新增/修改公共 API 或 Socket 事件。
- 不实现附件、离线发送队列、多 Run 客户端排队或高风险写 Tool 确认。

## 6. 涉及的现有文件

- `../client-code/src/routes/sections.tsx`
- `../client-code/src/layouts/nav-config-dashboard.tsx`
- `../client-code/src/layouts/dashboard/content.tsx`
- `../client-code/src/auth/provider.tsx`
- `../client-code/src/contexts/sync-notification-context.tsx`
- `../client-code/src/components/page-header/`
- `../client-code/src/components/empty-content/`
- `../client-code/src/components/confirm-dialog/`
- `../client-code/src/pages/` 现有薄页面模式
- Batch 015 新增的 `src/api/agent.ts` 与 `agent-stream.ts`

## 7. 需要新增的文件

- `../client-code/src/pages/agent.tsx`
- `../client-code/src/sections/agent/view/agent-view.tsx`
- `../client-code/src/sections/agent/components/agent-shell.tsx`
- `../client-code/src/sections/agent/components/conversation-sidebar.tsx`
- `../client-code/src/sections/agent/components/message-viewport.tsx`
- `../client-code/src/sections/agent/components/message-item.tsx`
- `../client-code/src/sections/agent/components/composer.tsx`
- `../client-code/src/sections/agent/components/run-status-bar.tsx`
- `../client-code/src/sections/agent/state/agent-provider.tsx`
- `../client-code/src/sections/agent/state/agent-reducer.ts`
- `../client-code/src/sections/agent/state/agent-selectors.ts`
- `../client-code/src/sections/agent/state/agent-state.types.ts`
- `../client-code/src/sections/agent/hooks/use-agent-run.ts`
- `../client-code/src/sections/agent/hooks/use-conversation-list.ts`
- `../client-code/src/sections/agent/hooks/use-composer-draft.ts`
- `../client-code/src/sections/agent/__tests__/agent-reducer.test.ts`
- `../client-code/src/sections/agent/__tests__/agent-view.test.tsx`
- `../client-code/src/sections/agent/__tests__/composer.test.tsx`
- `../client-code/e2e/agent-chat.spec.ts`

## 8. 需要修改的文件

- `../client-code/src/routes/sections.tsx`：注册懒加载、受保护 Agent 路由。
- `../client-code/src/layouts/nav-config-dashboard.tsx`：增加“AI 研究”导航与权限/feature flag。
- `../client-code/src/routes/__tests__/routes.test.tsx`：覆盖 Agent 路由、深链和 AuthGuard。
- `../client-code/src/contexts/sync-notification-context.tsx`：只增加 Agent 后台状态失效入口，不承载 token。
- `../client-code/src/mocks/agent-mocks.ts`：补齐聊天壳场景。
- `../client-code/.env.example`：新增非敏感 Agent UI feature flag。

## 9. 数据库变更

不涉及。会话、消息、Run、Tool 与引用以服务端为真相源；浏览器只缓存 UI 偏好和未提交草稿。

## 10. API 变更

不新增 API。调用 Batch 015 facade；路径、Body、响应、运行状态和错误码只引用 `docs/agent/api/rest-api.md`、`sse-events.md`、`error-codes.md`。

## 11. 后端实现任务

不改后端。联调发现状态、终态或恢复不一致时在 Batch 013/014 修复 canonical 实现，禁止在 reducer 里添加私有兼容事件。

## 12. 前端实现任务

- Provider 只覆盖 Agent 路由；Auth、Theme、全局通知继续用现有 Provider。
- reducer 使用 `byId + orderedIds` 管理会话/消息/运行投影，按连接代次和 sequence 拒绝旧事件。
- 首次提交才创建会话；用户消息乐观插入并用服务端身份原位替换，不追加重复项。
- `use-agent-run` 集中拥有 AbortController、流订阅、恢复和取消；组件不得直接管理 reader。
- Composer 支持中文 IME、Enter/Shift+Enter、运行中草稿、上下文 Chip、发送/停止状态。
- 深链先加载指定会话；无权限/不存在不自动跳到其他会话。
- `react-virtuoso` 渲染长消息列表；用户离开底部时不强制自动滚动。

## 13. Tool 或工作流变更

不改 Tool/Workflow。聊天壳展示公共阶段摘要和基础 Tool 占位；不推断隐藏推理，不把 WebSocket 通知作为消息正文。

## 14. 详细执行步骤

1. 建薄 `pages/agent.tsx`、懒路由和 nav flag，先通过路由/Auth 测试。
2. 实现纯 reducer、action 和 selector；用 fixture 覆盖快照、乐观替换、重复/乱序、旧请求迟到。
3. 实现 Provider 与会话列表/详情加载 hook，加入请求 generation 和 Abort。
4. 实现 `use-agent-run`：发送、绑定 assistant placeholder、批量文本更新、终态刷新、停止与恢复。
5. 组合 AgentShell、Sidebar、MessageViewport、Composer、StatusBar；接入现有 Theme、PageHeader、EmptyContent。
6. 加 session/local storage 草稿/偏好版本化迁移与退出清理；消息正文不落长期存储。
7. 写组件、可访问性、路由和 Playwright 最小闭环测试，运行全量前端门禁。

## 15. 核心数据结构

- `AgentState`：会话/消息索引、当前会话、运行投影、列表分页、加载/错误、草稿/偏好。
- `AgentAction`：以“快照加载成功、事件已接受、取消已请求”等事实命名，禁止通用 `SET_STATE`。
- `OptimisticMessageRef`：`clientRequestId/localId/serverId/status`，服务端确认后原位替换。
- `RunConnectionState`：连接代次、最后 sequence、最近活动、恢复次数；不保存 reader/controller。
- 公共实体字段全部从 Batch 015 生成类型投影，不手写 DTO。

## 16. 关键接口定义

- `AgentProvider({ children, initialConversationId? })`
- `useConversationList(): { items, loadMore, refresh, status }`
- `useAgentRun(conversationId): { send, cancel, regenerate, connectionState }`
- `useComposerDraft(scopeKey): { value, setValue, clear, recovered }`
- `selectOrderedMessages(state, conversationId)` 与单实体 selector。

## 17. 配置和环境变量

- `VITE_AGENT_ENABLED=false` 默认关闭未完成入口；生产 Batch 018 验收后启用。
- 复用 Batch 015 `VITE_API_URL` 和 stream 配置。
- 草稿 schema version 是代码常量；不得通过环境变量改变存储格式。
- 不新增任何前端密钥。

## 18. 异常和边缘场景

- 无历史、新建空态、深链无权限/已删除、会话分页重复、快速切换旧响应迟到。
- 首次发送创建会话失败、结果未知、双击、刷新后运行仍进行、终态与取消竞态。
- IME composition、超长文本、多行、移动键盘、运行中编辑下一条草稿。
- 用户向上阅读时持续 token、超长会话、隐藏标签页恢复。
- 401 refresh 失败、离线、SSE 恢复历史过期、Socket 不可用。

## 19. 安全要求

- 用户/会话 ID 只用于服务端 owner-scoped 请求；客户端路由参数不代表授权。
- Batch 017 前，assistant 内容只以转义纯文本展示；禁止 `dangerouslySetInnerHTML`。
- access token 不持久化；退出时中止流并清理用户隔离草稿。
- 页面上下文以可见、可删除 Chip 呈现，不静默上传隐藏数据。

## 20. 日志和可观测性要求

- 记录页面加载、发送到确认、首可见内容、完成/取消、恢复次数和 UI 错误边界；不记录正文、token 或完整上下文。
- reducer 可在开发模式输出 action 名与 runId/sequence，生产关闭正文与 state dump。
- 性能采集区分列表加载、首消息、流式 render commit 和长任务总时长。

## 21. 测试要求

- reducer：乐观身份替换、快照合并、重复/乱序、旧连接、取消竞态、快速切换。
- Composer：IME、快捷键、空白、运行态、草稿恢复、上下文移除。
- AgentView：空态、加载、深链、无权限、断线恢复、终态刷新。
- MessageViewport：长列表虚拟化、底部跟随/暂停、可访问状态播报。
- Playwright：登录后进入 Agent、发送、看到流式文本、停止、刷新恢复；后端可先用确定 fixture。

## 22. 执行命令

- `yarn --cwd ../client-code test src/sections/agent/__tests__/agent-reducer.test.ts src/sections/agent/__tests__/agent-view.test.tsx src/sections/agent/__tests__/composer.test.tsx src/routes/__tests__/routes.test.tsx`
- `yarn --cwd ../client-code e2e e2e/agent-chat.spec.ts`
- `yarn --cwd ../client-code lint`
- `yarn --cwd ../client-code build`

## 23. 验收标准

- 登录用户可从导航进入、深链刷新、创建/选择会话、发送、看到增量、停止和重新生成。
- 同一提交/事件不会产生重复消息；会话快速切换无串流或旧响应覆盖。
- 刷新后从服务端恢复运行与消息；草稿保留且按用户/会话隔离。
- 键盘、中文输入法、读屏和移动断点完成核心流程；长会话滚动稳定。
- 关闭 `VITE_AGENT_ENABLED` 后路由/nav 不暴露未完成功能，旧页面无回归。

## 24. 完成定义

路由、导航、Provider/reducer/hooks、聊天壳组件、草稿、虚拟列表、基础错误恢复、单元/组件/Playwright 测试全部合入；Batch 017 可通过 BlockRenderer 替换基础消息正文。

当前进度（2026-07-20）：

- 已在 `../client-code` 完成 `/agent`、`/agent/:conversationId`、默认关闭的 `VITE_AGENT_ENABLED` route/nav 双门禁和 Agent 路由级 Provider。
- reducer 使用 `byId + orderedIds`，完成乐观身份原位替换、请求/连接 generation、sequence 去重、终态与取消竞态保护。
- 已完成首次发送建会话、POST-SSE 流、状态/消息权威快照恢复、显式取消、重新生成、模型偏好与页面切换仅断 reader。
- 已完成桌面侧栏/移动 Drawer、`react-virtuoso` 消息区、纯文本安全消息、Run 状态栏和 IME/草稿 Composer。
- 草稿按用户与会话写入版本化 `sessionStorage`；登出、401 与跨标签登出均清理 Agent 草稿。
- Socket Context 只增加 `agent_run_updated` 失效入口，不把 WebSocket payload 当消息正文。
- Agent 定向测试 86/86、Playwright 2/2、契约漂移检查、ESLint、TypeScript 与 production build 通过；全量 Vitest 489/491，剩余 2 项为已登记旧债。
- 桌面与 `390×844` 浏览器验收通过，无横向溢出或 console error/warn。
- 前端测试方案与报告：`docs/testing/Agent会话壳-测试方案.md`、`docs/testing/reports/Agent会话壳-round1-2026-07-20.md`。

## 25. 回滚方案

关闭 `VITE_AGENT_ENABLED`，回退 route/nav 与 `sections/agent`。服务端会话和 Run 保留，不删除用户数据；Batch 015 API/stream 基础可保留供后续重启开发。

## 26. 后续批次

- Batch 017 增加安全 Markdown、引用、Tool、表格、图表、K 线和财务块。
- Batch 018 用真实 API/模型执行端到端与故障回归。
- Batch 026 发布同域前端并完成生产安全加固。
