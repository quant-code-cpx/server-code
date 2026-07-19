---
batch: 15
status: pending
type: frontend
depends_on: ["batch-001-agent-public-contracts"]
blocks: ["batch-016-frontend-chat-shell", "batch-017-frontend-rich-response-blocks", "batch-018-mvp-e2e-and-model-regression"]
parallel_with: ["batch-004-model-gateway-foundation", "batch-005-run-state-and-event-store", "batch-006-tool-registry-and-policy", "batch-007-stock-market-query-tools", "batch-008-financial-fund-flow-tools", "batch-009-deterministic-quant-tools", "batch-010-web-search-and-citations", "batch-011-agent-orchestrator-workflow", "batch-012-agent-bullmq-worker", "batch-013-conversation-rest-api", "batch-014-post-sse-stream-and-replay"]
recommended_executor: frontend-coding-agent
recommended_reasoning_level: high
estimated_scope: medium
---

# Batch 015：前端流客户端与契约生成

## 1. 批次目标

在 `../client-code` 建立 Agent 公共类型生成链、普通 JSON API 适配器和 POST Fetch SSE 客户端。流客户端必须支持 Bearer 鉴权、401 单飞刷新、任意字节分片解析、取消、心跳、去重、顺序检查和断点恢复。

## 2. 业务价值

后续聊天壳与富响应块直接消费同一套生成类型；刷新或断网不会丢运行进度，也不会形成手写 DTO、EventSource 和 JSON wrapper 三套冲突实现。

## 3. 前置依赖

- Batch 001 已冻结 Agent DTO、事件与错误契约，并能产出 OpenAPI 制品。
- 公共 REST、SSE、WebSocket、错误码只引用 `docs/agent/api/README.md`、`rest-api.md`、`sse-events.md`、`websocket-events.md`、`error-codes.md`。
- `../client-code` 使用 Node 20+、Yarn 1、React 19、Vite 6、Vitest 3 与 MSW 2。

## 4. 执行范围

- 从服务端 OpenAPI 生成 `src/api/generated/agent-api.ts`，建立漂移检查。
- 抽取 `authenticatedFetch`，保持现有 `src/api/client.ts` JSON 调用兼容。
- 新增 Agent JSON facade、纯 SSE parser、流连接/恢复客户端和错误适配器。
- 增加分块流、鉴权刷新、Abort、重连与契约测试。

## 5. 不在本批次范围内

- 不实现会话页面、消息 reducer 或富响应 UI。
- 不定义新的 REST 路径、请求/响应 DTO、SSE/Socket 事件或错误码。
- 不使用原生 `EventSource`，不让 WebSocket 承载模型 token。
- 不修改服务端 Batch 013/014 的实现。

## 6. 涉及的现有文件

- `../client-code/src/api/client.ts`
- `../client-code/src/api/__tests__/client.test.ts`
- Batch 001 生成的 `../client-code/src/types/agent/generated.ts` 与 runtime parser
- `../client-code/src/auth/provider.tsx`
- `../client-code/package.json`、`yarn.lock`
- `../client-code/vite.config.ts`、`vitest.config.ts`
- `../client-code/.github/workflows/ci.yml`
- 服务端 `scripts/generate-swagger.ts` 与 Batch 001 契约制品（只读输入）

## 7. 需要新增的文件

- `../client-code/src/api/generated/agent-api.ts`（生成文件）
- `../client-code/src/api/agent.ts`
- `../client-code/src/api/agent-stream.ts`
- `../client-code/src/api/sse-parser.ts`
- `../client-code/src/api/agent-error.ts`
- `../client-code/src/api/__tests__/agent.test.ts`
- `../client-code/src/api/__tests__/agent-stream.test.ts`
- `../client-code/src/api/__tests__/sse-parser.test.ts`
- `../client-code/src/mocks/agent-mocks.ts`
- `../client-code/scripts/generate-agent-api.mjs`

## 8. 需要修改的文件

- `../client-code/src/api/client.ts`：抽取 raw authenticated fetch；原 JSON request API 行为不变。
- `../client-code/src/api/__tests__/client.test.ts`：覆盖 raw/JSON 共用刷新锁。
- `../client-code/package.json`：增加 `api:agent:generate`、`api:agent:check` 脚本及固定版本生成器依赖。
- `../client-code/yarn.lock`：锁定新增 devDependency。
- `../client-code/.github/workflows/ci.yml`：在 type-check 前验证生成类型无漂移。
- `../client-code/src/mocks/handlers.ts`：注册 Agent mock。

## 9. 数据库变更

不涉及。游标、事件和消息持久化由服务端负责；浏览器不建立 IndexedDB 事实副本。

## 10. API 变更

不新增或修改公共 API。`agent.ts` 与 `agent-stream.ts` 只消费 `docs/agent/api/` 的 canonical 契约；生成类型来自同一 OpenAPI，禁止手写第二份 DTO。

## 11. 后端实现任务

不改后端业务代码。联调前确认 Batch 001 在 CI 可输出固定名称的 OpenAPI artifact，并由 Batch 014 返回 raw `text/event-stream`；发现差异时回到对应后端批次修正，前端不得兼容错误临时字段。

## 12. 前端实现任务

- 将 `src/api/client.ts` 拆为 `authenticatedFetch(input, init)` 与现有 JSON unwrap；访问令牌仍只在内存，401 共享一个 refresh Promise，最多重放一次。
- `agent.ts` 按业务语义封装会话、消息、Run、报告/通知等普通请求；路径和类型由生成契约索引取得。
- `sse-parser.ts` 使用持久 `TextDecoder`，正确处理 UTF-8 跨 chunk、LF/CRLF、注释、多行 data、空帧和 EOF。
- `agent-stream.ts` 校验状态码与媒体类型，读取 `ReadableStream`，按事件 ID/sequence 去重，维护最后连续游标并按服务端策略恢复。
- 连接代次阻止旧请求迟到事件；用户 Abort 与网络中断使用不同错误分类。

## 13. Tool 或工作流变更

不改 Tool 或 Workflow。流客户端只传输 canonical Run 事件，不解释 Tool payload；Batch 016/017 的 reducer/renderer 负责展示。

## 14. 详细执行步骤

1. 固定 OpenAPI 输入位置：本地默认读取相邻 `server-code/swagger.json`，CI 读取 Batch 001 artifact；输入缺失立即失败。
2. 引入固定版本 `openapi-typescript`，编写生成脚本；输出临时文件后比较内容，`api:agent:check` 不改工作树。
3. 为现有 `client.ts` 写回归测试，再抽取 `authenticatedFetch`，确认所有旧 API 测试不变。
4. 先用字节 fixture 实现纯 parser，再调用 Batch 001 生成的 `parseAgentSseEvent` runtime parser；HTTP endpoint 类型由 OpenAPI 生成，不手写重复 guard。
5. 实现 POST stream、Abort、401 refresh 后按已确认游标新建请求、有限退避与心跳超窗。
6. 用 MSW/本地测试 Response 构造真实分块流；覆盖慢流、断线、重复、乱序、终态和错误响应。
7. 接入 CI 漂移检查、lint、type-check、unit test 和 production build。

## 15. 核心数据结构

- `AuthenticatedFetchOptions`：是否允许 401 后重放、外部 AbortSignal、期望媒体类型；不含业务 DTO。
- `ParsedSseFrame`：parser 内部 `id/event/retry/dataLines`，进入业务 adapter 后立即丢弃未知字段。
- `AgentStreamCursor`：`runId/lastAppliedSequence/lastEventId/connectionGeneration`。
- `AgentStreamCallbacks`：已验证事件、连接状态、可恢复错误、终态回调。
- 所有公共消息、事件和错误类型从 `src/api/generated/agent-api.ts` 导入。

## 16. 关键接口定义

- `authenticatedFetch(input: RequestInfo | URL, init: RequestInit, options?): Promise<Response>`
- `agentApi.<semanticMethod>(input, signal?): Promise<GeneratedType>`
- `parseSseStream(stream: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<ParsedSseFrame>`
- `streamAgentRun(options): Promise<AgentStreamResult>`
- `toAgentClientError(responseOrError): AgentClientError`

公开 DTO 与事件字段不在本批次文档复制，直接引用 `docs/agent/api/`。

## 17. 配置和环境变量

- 复用现有 `VITE_API_URL`；默认同域时允许相对 `/api`。
- 构建脚本使用 `AGENT_OPENAPI_PATH` 指定输入制品，默认 `../server-code/swagger.json`。
- 可增加 `VITE_AGENT_STREAM_MAX_RETRIES`、`VITE_AGENT_STREAM_STALE_MS`，提供安全默认值并在启动时校验范围。
- 禁止把访问令牌、refresh token 或供应商密钥写入 Vite 环境变量。

## 18. 异常和边缘场景

- chunk 在 UTF-8 中文字符、字段名、CRLF 或 JSON 中间切断。
- heartbeat 注释、多个 data 行、未知字段、空 data、畸形 JSON、未知 schema version。
- 200 但媒体类型错误、401 refresh 成功/失败、429/5xx、浏览器 offline/online、页面休眠。
- EOF 未见终态、重复/倒退 sequence、序号缺口、恢复历史过期、旧连接迟到。
- 用户 Abort 与路由卸载不能触发自动重连；网络 Abort 可进入恢复预算。

## 19. 安全要求

- Token 只放 Authorization header，不放 query、日志、localStorage 或错误正文。
- 流错误和未知 payload 不进入 DOM；先做 runtime guard 和大小限制。
- refresh 单飞且最多重放一次，避免失效凭据重试风暴。
- page context 只由调用方传结构化最小字段；客户端不得采集 DOM 或隐藏数据。

## 20. 日志和可观测性要求

- 开发诊断记录 runId、连接代次、首事件耗时、恢复次数、最后 sequence、终止原因；不记录问题、回答、token 或完整 Tool payload。
- 暴露可注入 telemetry callback，Batch 025/026 接入正式前端观测；默认生产不 `console.log` 流正文。
- 解析错误包含安全 schemaVersion/eventId/traceId（可用时）。

## 21. 测试要求

- `sse-parser.test.ts`：每个字节边界、中文、CRLF、多行、注释、EOF、畸形帧。
- `agent-stream.test.ts`：POST body、媒体类型、Abort、心跳、退避、重复/乱序、恢复、401 单飞。
- `agent.test.ts`：生成类型驱动的普通 API、错误映射和 signal。
- `client.test.ts`：旧 JSON 请求、并发 401 和 raw response 无回归。
- 契约 fixture 必须从 OpenAPI/生成类型构造，不手写冲突 DTO。

## 22. 执行命令

- `yarn --cwd ../client-code install --frozen-lockfile`
- `yarn --cwd ../client-code api:agent:generate`
- `yarn --cwd ../client-code api:agent:check`
- `yarn --cwd ../client-code test src/api/__tests__/sse-parser.test.ts src/api/__tests__/agent-stream.test.ts src/api/__tests__/agent.test.ts src/api/__tests__/client.test.ts`
- `yarn --cwd ../client-code lint`
- `yarn --cwd ../client-code build`

## 23. 验收标准

- 相同 OpenAPI 生成结果稳定，契约变化会让 CI 明确失败并展示 diff。
- 任意合法字节分片可解析为与服务端一致的事件序列；无终态 EOF 不误判成功。
- 并发 JSON/stream 401 只刷新一次；刷新成功从最后连续游标恢复，无重复业务 action。
- Abort 后无残留 reader、timer 或重连；旧连接事件不会污染新连接。
- 现有所有 API 测试、lint、type-check 和 production build 通过。

## 24. 完成定义

生成脚本与类型、`authenticatedFetch`、Agent JSON/stream API、纯 parser、错误适配、MSW fixture、CI 漂移门禁和故障测试全部合入；Batch 016 可直接以 reducer 消费已验证事件。

## 25. 回滚方案

回退 `agent.ts`、stream/parser 和生成脚本；恢复 `client.ts` 原 JSON 实现与 lockfile。Agent feature flag 保持关闭，旧业务 API 不受影响。不得删除服务端事件或放宽契约来迁就旧前端。

## 26. 后续批次

- Batch 016 使用生成类型和流客户端实现聊天壳。
- Batch 017 使用生成消息块类型实现白名单 renderer。
- Batch 018 连接真实后端做断线、取消、鉴权和模型回归。
