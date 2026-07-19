---
batch: 6
status: pending
type: backend
depends_on: ["batch-001-agent-public-contracts", "batch-003-agent-audit-and-citation-schema"]
blocks: ["batch-007-stock-market-query-tools", "batch-008-financial-fund-flow-tools", "batch-009-deterministic-quant-tools", "batch-010-web-search-and-citations", "batch-011-agent-orchestrator-workflow", "batch-025-ai-observability-cost-and-evaluation", "batch-028-controlled-sql-explorer"]
parallel_with: ["batch-004-model-gateway-foundation", "batch-005-run-state-and-event-store", "batch-015-frontend-stream-client-and-contracts"]
recommended_executor: backend-coding-agent
recommended_reasoning_level: very-high
estimated_scope: large
---

# Batch 006：Tool Registry、策略与执行器

## 1. 批次目标

实现默认拒绝的 Tool Registry、Policy、schema 校验、统一执行器、超时/取消/重试和审计端口，为领域 Tool 提供安全底座。

## 2. 业务价值

模型只能调用被授权且可审计的确定性能力，杜绝直连 Prisma、任意 SQL/URL和跨租户参数注入。

## 3. 前置依赖

- Batch 001 Tool key/公共错误契约。
- Batch 003 Tool call 审计 repository。

## 4. 执行范围

- 定义 ToolDefinition、ToolAccessContext、ToolResult/ToolError。
- 实现 registry、policy、JSON Schema validator、executor、retry classifier。
- 注册 fake/echo fixture Tool 验证完整生命周期；不注册金融 Tool。

## 5. 不在本批次范围内

- 不实现股票/财务/计算/搜索 adapters。
- 不实现 Orchestrator 或 provider model gateway。
- 不开放写/破坏性 Tool。

## 6. 涉及的现有文件

- `src/lifecycle/guard/roles.guard.ts`、`src/apps/user/user.service.ts`
- `src/shared/context/`、`src/shared/cache.service.ts`
- `docs/agent/tools/tool-development-standard.md` 与 schemas
- Batch 003 audit repository

## 7. 需要新增的文件

- `src/apps/agent/tools/contracts/tool-definition.ts`
- `src/apps/agent/tools/contracts/tool-result.ts`
- `src/apps/agent/tools/tool-access-context.ts`
- `src/apps/agent/tools/tool-registry.service.ts`
- `src/apps/agent/tools/tool-policy.service.ts`
- `src/apps/agent/tools/tool-executor.service.ts`
- `src/apps/agent/tools/tool-schema-validator.ts`
- `src/apps/agent/tools/test/tool-executor.service.spec.ts`

## 8. 需要修改的文件

- `src/apps/agent/agent.module.ts` 注册 Tool providers
- `package.json`/lockfile 增加选定 JSON Schema validator（优先 Ajv）
- Agent metrics token 预留

## 9. 数据库变更

不新增表；使用 Batch 003 `AiToolCall`。

## 10. API 变更

不新增 API；Tool error 映射到 `docs/agent/api/error-codes.md`，但由后续 application/controller 完成。

## 11. 后端实现任务

- Registry 启动时检查 key/version 唯一、schema 可编译、policy 上下限。
- Policy 从认证上下文注入 userId/role/scope，模型 input 不能覆盖。
- Executor 先审计 start，再 timeout+AbortSignal 执行；仅 idempotent+retryable 自动重试。
- 输出 schema/行数/大小/provenance 校验失败即 Tool failed。

## 12. 前端实现任务

不涉及。

## 13. Tool 或工作流变更

- 本批次只注册 deterministic fixture，15 个 MVP key 仅声明未实现状态。
- 元数据包含 requiredRole、sideEffect、confirmation、idempotent、timeout、attempt、maxRows、costClass、scopes。

## 14. 详细执行步骤

- 从 Tool 标准生成 contracts 与 validator。
- 实现 registry 启动校验和 frozen per-run snapshot。
- 实现 policy 链：enabled→user status→role/scope→budget/count→confirmation。
- 实现 executor + audit + timeout/cancel/retry + output validation。
- 写恶意 input、跨用户字段、未知 key、重复注册、cancel、late result 等测试。
- 输出 provider tool schema 的 deterministic serializer。

## 15. 核心数据结构

- `ToolDefinition<TInput,TData>`、`ToolPolicy`、`ToolAccessContext`、`ToolResult<T>`、`ToolError`。
- Schema `additionalProperties=false`；context userId 永远不在 input schema。

## 16. 关键接口定义

- `ToolRegistry.get(key, version)`
- `ToolPolicy.authorize(definition, input, context)`
- `ToolExecutor.execute(call, context): Promise<ToolResult>`
- `ToolRegistry.toModelSchemas(snapshot): ModelToolSchema[]`

## 17. 配置和环境变量

- `AGENT_TOOLS_ENABLED`（显式 allowlist）
- `AGENT_TOOL_MAX_CALLS_PER_RUN`、`AGENT_TOOL_DEFAULT_TIMEOUT_MS`、`AGENT_TOOL_MAX_RESULT_BYTES`。

## 18. 异常和边缘场景

- 重复 Tool call；schema `$ref`；返回循环对象/BigInt/Decimal；取消后迟到结果；audit 写失败；cache 命中但权限不同。
- 缓存 key 必须含 data scope/version，不缓存用户私有结果到公共 namespace。

## 19. 安全要求

- 默认 deny；READ 之外 sideEffect 在 MVP 启动失败。
- 禁止暴露 `PrismaService`、`CacheService`、HTTP client 或任意 callback 给模型。
- sanitized input/output 后才审计/日志。

## 20. 日志和可观测性要求

- tool calls/success/failure/rejection/retry/timeout/cancel、duration、result bytes、rows。
- 日志含 key/version/callId/runId，不含原始 payload。

## 21. 测试要求

- registry/validator/policy/executor 单元测试。
- 审计失败 fail-closed；timeout/cancel 无 completed 事件。
- 属性测试生成未知字段/超界数组/非法日期。
- provider schema snapshot 稳定。

## 22. 执行命令

- `pnpm install --lockfile-only`（仅新增 Ajv 时）
- `pnpm test -- src/apps/agent/tools/test/tool-executor.service.spec.ts`
- `pnpm run build`

## 23. 验收标准

- 未注册/未授权/非法 schema 的 Tool 零次触达 adapter。
- 每个 attempt 有审计终态；只重试允许的幂等错误。
- MVP 启动时无法注册 WRITE/DESTRUCTIVE definition。

## 24. 完成定义

contracts、registry、policy、executor、validator、审计/指标 hook 和完整测试合入。

## 25. 回滚方案

禁用 `AGENT_TOOLS_ENABLED` 并移除 Module providers；无数据迁移。已写审计保留。

## 26. 后续批次

- Batch 007/008/009/010 并行实现各类 Tool。
- Batch 011 通过执行器调用，不能绕过。
