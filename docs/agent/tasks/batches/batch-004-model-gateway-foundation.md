---
batch: 4
status: completed
type: backend
depends_on: ["batch-001-agent-public-contracts"]
blocks: ["batch-011-agent-orchestrator-workflow", "batch-023-multi-provider-routing-and-fallback", "batch-025-ai-observability-cost-and-evaluation"]
parallel_with: ["batch-000-platform-data-readiness", "batch-002-conversation-and-message-schema", "batch-003-agent-audit-and-citation-schema", "batch-005-run-state-and-event-store", "batch-006-tool-registry-and-policy", "batch-015-frontend-stream-client-and-contracts"]
recommended_executor: backend-coding-agent
recommended_reasoning_level: high
estimated_scope: medium
---

# Batch 004：模型网关基础

## 1. 批次目标

在 NestJS 内建立供应商无关模型端口和首个 OpenAI-compatible adapter，支持流式文本、结构化计划、Tool calling、usage、超时和错误分类。

## 2. 业务价值

隔离模型 SDK 和易变配置，让编排、测试和后续多模型路由不绑定具体供应商。

## 3. 前置依赖

- Batch 001 公共状态/错误和 Tool key。
- 需要用户确认首个 provider/key 才能做真实 smoke test；不阻塞 fake adapter 开发。

## 4. 执行范围

- ModelGateway port、capability registry、single-provider router。
- OpenAI-compatible adapter 与 deterministic fake provider。
- usage/cost 接口、AbortSignal、timeout、有限重试和结构化输出校验。

## 5. 不在本批次范围内

- 不做多 provider 自动降级；Batch 023 负责。
- 不实现 Orchestrator、Tool、数据库审计或 UI。
- 不硬编码当前模型价格/context window。

## 6. 涉及的现有文件

- `src/config/`、`src/shared/logger/`、`src/shared/context/`
- Batch 001 contracts
- `package.json`（选择官方/兼容 SDK）

## 7. 需要新增的文件

- `src/apps/agent/model-gateway/model-gateway.port.ts`
- `src/apps/agent/model-gateway/model-gateway.service.ts`
- `src/apps/agent/model-gateway/model-capability.registry.ts`
- `src/apps/agent/model-gateway/providers/openai-compatible.provider.ts`
- `src/apps/agent/model-gateway/providers/fake-model.provider.ts`
- `src/apps/agent/model-gateway/test/model-gateway.service.spec.ts`
- `src/config/model.config.ts`

## 8. 需要修改的文件

- `src/apps/agent/agent.module.ts` 注册 provider token
- `package.json`/lockfile 增加最小 SDK 依赖（如使用）
- `.env.example` 只增加变量名和安全说明，不放 key

## 9. 数据库变更

不涉及；Batch 003 的 `AiModelCall` 端口通过接口注入，单测用 fake。

## 10. API 变更

不新增 Controller；gateway 返回内部 normalized chunks，与 `model.started/model.delta` 公共事件可映射但不直接发送。

## 11. 后端实现任务

- 统一 `generateStructured` 和 `streamResponse`；provider adapter 负责 request/response 映射。
- structured output 使用 JSON schema 严格校验；非法输出只允许一次受控 repair。
- timeout/abort 贯穿 SDK；错误分类 AUTH/RATE_LIMIT/TIMEOUT/UNAVAILABLE/CONTENT/INVALID_OUTPUT。
- capability 从配置读取，不以模型名 if/else 分散判断。

## 12. 前端实现任务

不涉及。

## 13. Tool 或工作流变更

向 provider 只暴露 Batch 006 生成的 schema；本批次用 fixture tool schema 测试，不执行。

## 14. 详细执行步骤

- 冻结 port、normalized usage/chunk/error 类型。
- 实现 strict config validation 和 fake provider。
- 实现 OpenAI-compatible 请求、流解析、Tool call fragment 合并、usage。
- 实现 timeout/abort/retry guard；一旦有输出不自动换 attempt。
- 添加 provider contract suite，fake 与真实 adapter 共用。
- 用 mock HTTP 完成集成测试；真实 smoke 需显式 key 且不进 CI。

## 15. 核心数据结构

- `ModelRequest { messages, tools, responseSchema, temperature, maxOutputTokens, metadata }`。
- `ModelChunk = textDelta | toolCallDelta | usage | finish`。
- `ModelUsage { inputTokens, outputTokens, cachedTokens?, providerCost? }`；成本允许 unknown。

## 16. 关键接口定义

- `ModelGateway.generateStructured<T>(request, signal): Promise<ModelResult<T>>`
- `ModelGateway.stream(request, signal): AsyncIterable<ModelChunk>`
- `ModelProvider.supports(capability): boolean`

## 17. 配置和环境变量

- `AGENT_MODEL_PROVIDER`、`AGENT_MODEL_BASE_URL`、`AGENT_MODEL_API_KEY`、`AGENT_MODEL_DEFAULT`、`AGENT_MODEL_TIMEOUT_MS`。
- 变量启动时严格校验；key 日志脱敏。

## 18. 异常和边缘场景

- 流中断、UTF-8 fragment、重复/乱序 tool call delta、provider 无 usage、429 Retry-After、用户取消、非法 JSON、content refusal。

## 19. 安全要求

- 不把 system policy/secret 写日志；provider metadata 只传 trace-safe ID。
- 禁用任意 base URL 或在生产 allowlist；TLS 必须校验。

## 20. 日志和可观测性要求

- 记录 provider/model/attempt/duration/TTFT/tokens/status/errorClass，不记录 prompt。
- 预留 model success、latency、token、cost、cancel metrics。

## 21. 测试要求

- fake provider 确定性输出。
- mock HTTP 覆盖流分片、Tool call、usage、429/5xx/timeout/abort/invalid schema。
- config 缺 key/base URL 拒绝启动；日志不含 key。

## 22. 执行命令

- `pnpm install --lockfile-only`（仅新增依赖时）
- `pnpm test -- src/apps/agent/model-gateway/test/model-gateway.service.spec.ts`
- `pnpm run build`

## 23. 验收标准

- 同一 contract suite 通过 fake 和 OpenAI-compatible adapter。
- AbortSignal 能在测试时停止流；非法结构不进入编排。
- 无供应商常量泄漏到 Orchestrator/Controller。

## 24. 完成定义

端口、首 adapter、fake、配置、contract test、错误/指标 hook 和安全说明合入。

当前进度（2026-07-19）：

- 已实现 provider-neutral `ModelGatewayPort`、DI token、capability registry、deterministic fake provider 和 OpenAI-compatible Chat Completions adapter；未引入供应商 SDK。
- adapter 支持 SSE UTF-8 增量解码、流式文本、Tool call fragment 合并及完整 JSON 校验、usage/finish/request ID 归一化。
- 已实现 strict JSON Schema 预校验与结构化输出校验；非法结构最多执行一次受控 repair，仍失败则返回 `INVALID_OUTPUT`。
- timeout、用户 `AbortSignal`、429/5xx 有限重试和“首个可见输出后禁止重试”已落地；错误统一分类为 AUTH/RATE_LIMIT/TIMEOUT/UNAVAILABLE/CONTENT/INVALID_OUTPUT。
- 配置与运行时边界严格校验；生产 base URL 强制 HTTPS + origin allowlist，HTTP redirect fail-closed；日志不记录 key、Prompt、provider body 或 hidden reasoning。
- Model Gateway 测试 16/16、Batch 001 canonical contract 回归 9/9、frozen lock、Prettier、ESLint 和生产 Nest build 通过。
- 开发容器增量编译 `Found 0 errors`，Nest 启动成功，app/PostgreSQL/Redis 均 healthy，`/health` 返回 ok。
- 真实 provider smoke test 未执行：当前未提供显式 provider key；集成行为由 loopback mock HTTP 覆盖，不向 CI 或仓库注入真实凭据。
- 实现 commit：`6f5595f feat(agent): add model gateway foundation`。

## 25. 回滚方案

切换 DI 到 fake/disabled provider，移除 adapter 配置和依赖；无数据库数据。

## 26. 后续批次

- Batch 011 编排调用 gateway。
- Batch 023 扩展多 provider 路由。
- Batch 025 接入成本与评测。
