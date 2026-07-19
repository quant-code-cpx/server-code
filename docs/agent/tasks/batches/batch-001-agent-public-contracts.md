---
batch: 1
status: pending
type: fullstack
depends_on: []
blocks: ["batch-002-conversation-and-message-schema", "batch-003-agent-audit-and-citation-schema", "batch-004-model-gateway-foundation", "batch-006-tool-registry-and-policy", "batch-013-conversation-rest-api", "batch-015-frontend-stream-client-and-contracts"]
parallel_with: ["batch-000-platform-data-readiness"]
recommended_executor: general-coding-agent
recommended_reasoning_level: high
estimated_scope: medium
---

# Batch 001：Agent 公共协议与领域枚举

## 1. 批次目标

把已评审的 REST、SSE、错误码、消息内容块、Run/Tool/模型状态定义为唯一可生成的 TypeScript 公共契约。

## 2. 业务价值

协议先行让前端流客户端、后端状态机和测试可并行，避免各自维护事件名、状态和图表结构。

## 3. 前置依赖

- 以 `docs/agent/api/*.md` 为规范源。
- 不依赖 Agent 数据库或模型供应商。

## 4. 执行范围

- 创建后端契约包、DTO 基类与事件 discriminated union。
- 在前端增加可由后端 schema 生成/同步的类型入口。
- 固定 POST 业务约定、显式 HTTP 200/202 与 raw SSE bypass 标记。
- 为 15 个 MVP Tool key 建枚举，不实现 Tool。

## 5. 不在本批次范围内

- 不实现 Controller、SSE 网络流、数据库表、模型调用或 UI。
- 不改现有 315 个业务端点的 200/201 漂移。

## 6. 涉及的现有文件

- `src/main.ts`、`src/lifecycle/interceptor/transform.interceptor.ts`
- `src/constant/response-code.constant.ts`
- `../client-code/src/api/client.ts`、`../client-code/src/types/`
- `docs/agent/api/rest-api.md`、`sse-events.md`、`error-codes.md`

## 7. 需要新增的文件

- `src/apps/agent/contracts/agent-status.ts`
- `src/apps/agent/contracts/agent-events.ts`
- `src/apps/agent/contracts/message-blocks.ts`
- `src/apps/agent/contracts/tool-keys.ts`
- `src/apps/agent/contracts/agent-errors.ts`
- `src/apps/agent/contracts/test/agent-contracts.spec.ts`
- `../client-code/src/types/agent/generated.ts`
- `scripts/export-agent-contracts.ts`

## 8. 需要修改的文件

- `src/constant/response-code.constant.ts` 增加 6001–6031 与 6099，且不改已有值
- `package.json` 增加契约导出/校验脚本
- 前端 `package.json` 增加同步校验命令（若生成器需要）

## 9. 数据库变更

不涉及。

## 10. API 变更

- 严格实现 `docs/agent/api/` 中的 endpoint DTO 形状、14 个 SSE event name、`MessageBlock`/`DataProvenance`。
- 业务 POST 显式 `@HttpCode(200)`；创建异步 Run 可按契约返回业务状态，不依赖默认 201。

## 11. 后端实现任务

- 用 TypeScript `as const`/discriminated union 和 runtime schema 单源定义；生成 JSON Schema。
- SSE event 基础字段包含 eventId、runId、sequence、occurredAt、type、payload。
- 标记 raw response metadata，供后续 TransformInterceptor 跳过 SSE。

## 12. 前端实现任务

- 生成/同步的类型不依赖 NestJS；前端解析未知 event/type 时返回 typed protocol error。
- 内容块只允许 Markdown/Table/Chart/Kline/FinancialMetrics/RiskNotice 白名单。

## 13. Tool 或工作流变更

固定 15 个 MVP key；Tool input/output 细节由 Batch 006–010 实现并引用 `docs/agent/tools/`。

## 14. 详细执行步骤

- 从 API 文档列出状态、事件、内容块、错误码和 endpoint DTO 清单。
- 建立纯 TypeScript 契约，不导出 Nest/Prisma class。
- 添加 runtime schema 与 JSON Schema 导出，生成前端文件。
- 写正反序列化、未知字段、枚举穷尽和 schema snapshot 测试。
- 在 CI 增加生成后 git diff 必须为空的 contract drift 检查。

## 15. 核心数据结构

- `AgentRunStatus`、`AgentStepStatus`、`ToolCallStatus`、`ModelCallStatus`。
- `AgentSseEvent` discriminated union；`MessageBlock` + `DataProvenance`。
- `AgentErrorCode` 6001–6031 与 6099；`ToolKey` 15 项。

## 16. 关键接口定义

- `parseAgentSseEvent(input: unknown): AgentSseEvent`
- `exportAgentJsonSchemas(outputDir): void`
- `@RawStreamResponse()` metadata decorator（只定义，不接流）。

## 17. 配置和环境变量

不新增环境变量。

## 18. 异常和边缘场景

- 后端新增 event 而旧前端未知；前端必须忽略非关键 extension 或触发可恢复错误，不崩溃。
- 整数 sequence 超出 JS 安全范围时采用十进制字符串或限制；本批次固定一种并测试。
- null/缺失 data provenance、表格过大、非法 chart unit 均 schema 拒绝。

## 19. 安全要求

- 不在公共事件暴露 hidden reasoning、模型 key、完整 prompt、SQL、内部堆栈。
- 错误 details 采用 allowlist。

## 20. 日志和可观测性要求

契约解析失败计数预留 `agent_protocol_error_total{type,version}`；本批次测试 schema，不接指标实现。

## 21. 测试要求

- 后端 contract unit/snapshot test。
- 前端用同一 fixtures 解析全部 14 事件与内容块。
- 导出结果可重复，未提交漂移导致 CI 失败。

## 22. 执行命令

- `pnpm run agent:contracts:generate`
- `pnpm test -- src/apps/agent/contracts/test/agent-contracts.spec.ts`
- `pnpm run build`
- `yarn --cwd ../client-code test agent-contracts`

## 23. 验收标准

- 文档中的事件名、错误码、状态和内容块逐项有类型与 runtime schema。
- 后端生成后前端无手写重复定义；两端 fixtures 互通。
- 未引入 Controller/DB/model provider。

## 24. 完成定义

公共契约、生成脚本、两端测试与 drift gate 合入；API 文档链接到生成入口。

## 25. 回滚方案

删除新增契约/脚本并还原错误码常量；未触及运行 API/DB，无数据回滚。

## 26. 后续批次

- Batch 002/003 使用领域枚举建表。
- Batch 013/014 实现 REST/SSE。
- Batch 015 前端流客户端直接消费生成类型。
