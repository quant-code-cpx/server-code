# REST API 设计

## 1. 传输选择

命令和查询走 POST JSON；单次 Agent 输出走 POST-SSE；现有 Socket.IO 仅承担后台任务完成、多端状态失效通知。原因：项目强制 POST，原生 `EventSource` 只支持 GET 且不能稳定携带 Bearer Token；前端使用 `fetch` 读取 `ReadableStream`。

## 2. 通用结构

```ts
type ApiResponse<T> = { code: number; data: T; message?: string }

type PageContext = {
  route: string
  entityType?: 'STOCK' | 'INDEX' | 'PORTFOLIO' | 'BACKTEST' | 'REPORT'
  entityId?: string
  selectedRange?: { start: string; end: string }
  visibleDataAsOf?: string
}
```

所有创建/执行命令要求 `clientRequestId`（UUID）；数据库对 `(userId, clientRequestId)` 建唯一约束。重复请求返回首次结果，不创建第二个 Run。

Batch 013 已实现本文件第 3、4 节除 `runs/events` 外的 10 个 JSON 端点。成功统一 HTTP 200；Agent 专用 DTO 会拒绝顶层和嵌套未知字段。HTTP 错误状态与 Agent 业务码同时返回，不沿用全仓 `BusinessException` 的 HTTP 200 行为。

## 3. 会话与消息

### `POST /api/agent/conversations/create`

```json
{
  "clientRequestId": "8e598a53-84d5-45bd-b06a-d8d10d3fb125",
  "title": "贵州茅台估值研究",
  "modelPolicy": "AUTO",
  "preferredModel": null
}
```

```json
{
  "code": 0,
  "data": {
    "conversationId": "cm_01J...",
    "status": "ACTIVE",
    "createdAt": "2026-07-19T02:10:00.000Z"
  }
}
```

### `POST /api/agent/conversations/list`

Body：`{ "cursor": null, "limit": 30, "includeArchived": false }`。`limit` 为 1–100。

### `POST /api/agent/conversations/detail`

Body：`{ "conversationId": "cm_01J..." }`。仅返回当前用户会话。`currentSummary` 为空或只包含 `summaryId/version/fromMessageId/throughMessageId/promptVersionId/modelName/sourceTokenCount/contentHash/createdAt`；不返回摘要正文、facts 或内部 source 列表。

### `POST /api/agent/conversations/messages/list`

Body：`{ "conversationId": "cm_01J...", "beforeMessageId": null, "limit": 50 }`。返回消息、内容块、引用、关联 Run 摘要；不返回模型隐藏推理。

### `POST /api/agent/messages/send`

创建用户消息、Agent Run、队列任务，并立即返回流地址。

```json
{
  "clientRequestId": "04907f45-c978-4058-8a4a-454625f27a2d",
  "conversationId": "cm_01J...",
  "content": "比较贵州茅台和五粮液近五年估值与盈利质量，并核对最新公告",
  "pageContext": {
    "route": "/stock/detail",
    "entityType": "STOCK",
    "entityId": "600519.SH",
    "visibleDataAsOf": "2026-07-17"
  },
  "modelPolicy": "AUTO",
  "allowedCapabilities": ["INTERNAL_DATA", "QUANT_COMPUTE", "WEB_SEARCH"]
}
```

```json
{
  "code": 0,
  "data": {
    "conversationId": "cm_01J...",
    "userMessageId": "msg_01J...",
    "assistantMessageId": "msg_01K...",
    "runId": "run_01J...",
    "runStatus": "QUEUED",
    "streamEndpoint": "/api/agent/runs/events"
  }
}
```

继续追问复用该接口和 `conversationId`。服务端从认证上下文取 `userId`，禁止客户端提交用户 ID。

### `POST /api/agent/runs/regenerate`

Body：`{ "clientRequestId": "...", "messageId": "msg_01K...", "modelPolicy": "AUTO" }`。创建新 Run 与新 assistant message version；旧版本保留。

### `POST /api/agent/conversations/model/update`

Body：`{ "conversationId": "cm_01J...", "modelPolicy": "MANUAL", "preferredModel": "deepseek-reasoner" }`。仅影响后续 Run，不改写历史模型记录。

### `POST /api/agent/models/list`

Body：`{}`。返回当前可见模型目录：`items[]` 包含 `model`、`displayName`、`provider`、`capabilities`、`costTier`（`LOW/MEDIUM/HIGH`）、`status`（`AVAILABLE/UNAVAILABLE`）和可空的通用 `reason`。`UNAVAILABLE` 条目用于前端展示，不能用于手动选择。

目录绝不返回 API key、base URL、供应商原始错误、失败计数、熔断剩余时间或其他内部健康数据。会话设为 `MANUAL` 时服务端仍会重新校验模型注册状态、健康状态和 `USER_PRIVATE` 数据等级资格。

## 4. Run 控制与恢复

### `POST /api/agent/runs/events`

请求头：`Accept: text/event-stream`、`Authorization: Bearer ...`、可选 `Last-Event-ID`。

Body：`{ "runId": "run_01J...", "afterSequence": 41 }`。返回协议见 [SSE 事件](./sse-events.md)。

### `POST /api/agent/runs/status`

Body：`{ "runId": "run_01J..." }`。返回 Run 状态、当前步骤、最终消息、最新事件序号和是否可取消。

```json
{
  "code": 0,
  "data": {
    "runId": "run_01J...",
    "conversationId": "cm_01J...",
    "status": "RUNNING",
    "statusVersion": 3,
    "currentStep": {
      "stepId": "step_01J...",
      "stepKey": "execute_tools",
      "kind": "TOOL",
      "status": "RUNNING",
      "ordinal": 3
    },
    "finalMessageId": null,
    "latestEventSequence": 12,
    "canCancel": true,
    "errorCode": null,
    "errorMessage": null,
    "queuedAt": "2026-07-20T02:10:00.000Z",
    "startedAt": "2026-07-20T02:10:01.000Z",
    "endedAt": null
  }
}
```

### `POST /api/agent/runs/cancel`

Body：`{ "runId": "run_01J...", "expectedStatusVersion": 7 }`。原子写入 `CANCEL_REQUESTED`，移除等待任务并通知正在运行的 Tool/模型 AbortController。终态请求按幂等成功返回。

响应包含 `runId`、最新 `status/statusVersion` 和 `cancellationAccepted`。`QUEUED` 可直接进入 `CANCELLED`；`RUNNING` 进入 `CANCEL_REQUESTED`，不回退为 `QUEUED`。

### `POST /api/agent/runs/tool-calls/list`

Body：`{ "runId": "run_01J...", "includePayload": false }`。普通用户只见脱敏输入/输出摘要；管理员审计接口另行授权。

普通用户端点固定返回 `payloadIncluded: false`。即使请求 `includePayload=true`，也不返回 `inputRef/outputRef`、hash、供应商原文、SQL、密钥或隐藏推理。

## 5. 用户长期记忆

- `POST /api/agent/memories/list`
- `POST /api/agent/memories/create`
- `POST /api/agent/memories/update`
- `POST /api/agent/memories/delete`

`list` Body：`{ "cursor": null, "limit": 30, "includeInactive": false }`。默认只返回未删除、未过期的 `CONFIRMED`；`includeInactive=true` 返回未删除历史版本。稳定 cursor 使用 `(updatedAt,id)`，limit 1–100。

`create` 示例：

```json
{
  "category": "PREFERENCE",
  "key": "response.style",
  "value": { "style": "concise" },
  "sensitivity": "NORMAL",
  "sourceConversationId": null,
  "sourceMessageId": null,
  "confidence": 1,
  "expiresAt": null,
  "topic": "GENERAL",
  "confirmation": true
}
```

`update` 使用 `memoryId` 和新 `value` 创建下一版本，不覆盖旧值；同样强制 `confirmation=true`。`delete` Body 为 `{ "memoryId": "..." }`，软删除后立即从默认列表与新 Run 候选中排除。

身份只取 JWT，Body 禁止 `userId`。value 必须为非 null JSON，最大 8192 bytes、嵌套深度 8。持仓、交易日志、凭据、健康和政治推断禁止写入；明显敏感内容不能通过声明 `GENERAL` 绕过。

## 6. 定时任务

- `POST /api/agent/schedules/create`
- `POST /api/agent/schedules/list`
- `POST /api/agent/schedules/detail`
- `POST /api/agent/schedules/update`
- `POST /api/agent/schedules/pause`
- `POST /api/agent/schedules/resume`
- `POST /api/agent/schedules/delete`
- `POST /api/agent/schedules/run`
- `POST /api/agent/schedules/executions/list`

所有端点只从 JWT 读取 owner，Body 不接受 `userId`。`update/pause/resume/delete` 都要求 `expectedVersion`，避免用户修改与 scanner claim 互相覆盖。`delete` 是软删除，保留 execution 审计；`pause` 不取消已创建的 Run。

`create` 必填 `clientRequestId`、`name`、`trigger`、`prompt`、`allowedCapabilities`、`maxCostCny`；同一用户同一 `clientRequestId` 只能对应同一份配置。首批固定工作流为 `stock_research@1`，创建时服务端冻结 workflow/prompt hash。`maxCostCny` 会下压到 Agent Run 的单次预算，不能绕过用户日预算。

CRON 创建示例：

```json
{
  "clientRequestId": "2a3...",
  "name": "每日自选股公告摘要",
  "trigger": "CRON",
  "cronExpression": "0 30 18 * * 1-5",
  "timeZone": "Asia/Shanghai",
  "tradingDayOnly": true,
  "prompt": "总结今天市场变化与自选股风险。",
  "workflowKey": "stock_research",
  "workflowVersion": 1,
  "input": { "watchlistId": 3 },
  "allowedCapabilities": ["INTERNAL_DATA"],
  "requiredWatermarks": [{ "dataset": "DAILY", "minTradeDate": "20260722", "maxAgeMinutes": 180 }],
  "maxCostCny": 2.0
}
```

触发三选一：

- `CRON`：`cronExpression` + IANA `timeZone`；不能同时携带 `oneTimeAt` 或 `condition`。
- `ONE_TIME`：未来 `oneTimeAt`；完成后不补跑。
- `STRUCTURED_CONDITION`：首批仅公开日线 `DAILY_CLOSE`，`resourceId` 为公开股票代码，operator 仅 `GT/GTE/LT/LTE`，含整数 `cooldownMinutes`。不接受任意代码、SQL、表达式或未知字段。

`requiredWatermarks` 首批仅支持 `DAILY`。目标数据不存在或超过 `maxAgeMinutes` 时，execution 为 `DEFERRED` 并记录 gate evidence；scanner 不调用 Tushare 同步，不会把同步日志 SUCCESS 当作数据就绪。

`run` Body 为 `{ "taskId": "...", "clientRequestId": "uuid" }`。手动运行只允许 ACTIVE task，仍经过交易日/水位 gate，且同一 request ID 返回同一 execution。`executions/list` 返回 status、gate evidence、runId、成本和受控错误摘要，不返回 Prompt、Tool 原始 payload 或隐藏推理。普通微信不作为可选官方通道。

## 7. 报告、通知与现有用户数据 API

- `POST /api/agent/reports/list`、`detail`、`save`、`delete`
- `POST /api/agent/notification-channels/list`、`create`、`update`、`test`、`delete`
- `POST /api/agent/notification-deliveries/list`、`retry`

报告端点仅从 JWT 读取 owner，Body 禁止 `userId`。报告由已完成的 Agent Run 冻结生成，所有详情内容均来自保存时的消息版本，不读取后续 Run 重生成内容。

`reports/list` Body 为 `{ "cursor": null, "limit": 30, "status": "COMPLETED" }`；`status` 可省略，`limit` 为 1–100。响应按 `(createdAt desc, id desc)` 返回当前用户未删除报告及 `nextCursor`，每项包含 `reportId/runId/conversationId/messageId/messageVersion/version/status/title/summary/dataAsOf/journalId/renderedAt`，不包含正文、存储路径或隐藏推理。

`reports/detail` Body 为 `{ "reportId": "..." }`。除列表字段外，返回冻结的 `contentText`、经消息内容块协议校验的 `contentBlocks`、可展示的 citation manifest 和版本 manifest；任何跨租户或已删除 ID 均返回 `AI_RESEARCH_REPORT_NOT_FOUND`。

`reports/save` 采用同一端点的两阶段确认，首次请求只生成预览，不写报告、投资日志或对象存储：

```json
{
  "runId": "run_01J...",
  "journal": {
    "tsCode": "600519.SH",
    "thesis": "估值回落后具备跟踪价值",
    "risks": ["需求波动"],
    "decision": "继续观察",
    "reviewAt": "2026-08-01T00:00:00.000Z"
  }
}
```

预览响应为 `{ "requiresConfirmation": true, "preview": { "title", "summary", "dataAsOf", "citations", "contentBlocks", "confirmationExpiresAt" }, "confirmationToken": "..." }`。确认请求携带原样 journal、`confirmationToken` 和同一用户内唯一的 `clientRequestId`：

```json
{
  "confirmationToken": "...",
  "clientRequestId": "save-report-20260722-001",
  "journal": {
    "tsCode": "600519.SH",
    "thesis": "估值回落后具备跟踪价值",
    "risks": ["需求波动"],
    "decision": "继续观察",
    "reviewAt": "2026-08-01T00:00:00.000Z"
  }
}
```

确认后响应 `{ "requiresConfirmation": false, "report": { ... } }`，新报告为 `QUEUED` 并由 worker 异步渲染。token 绑定 user、Run、消息版本、内容 hash 与 journal hash；过期、篡改、跨租户或内容变化返回 `AI_RESEARCH_REPORT_CONFIRMATION_INVALID`。同一 `clientRequestId` 且相同内容返回首次报告，不会重复写入；不同内容返回 `AI_RESEARCH_REPORT_CONFLICT`。

`reports/delete` Body 为 `{ "reportId": "..." }`。删除将报告标记为 `DELETED`，保留审计和投资日志关联；已有受管渲染文件进入异步 cleanup 队列，不同步暴露或孤立文件。

`channels/list` Body 为 `{ "cursor": null, "limit": 30 }`，稳定 cursor 为 channel ID，limit 1–100。创建站内信使用 `{ "type": "IN_APP", "name": "研究完成站内信" }`；创建 Webhook 额外要求 `webhookUrl` 与至少 16 字符的 `secret`。Webhook 仅允许服务端 allowlist 内的 HTTPS 公网域名，私网 IP/DNS、redirect、凭据 URL 均拒绝。`secret` 只写入请求，AES-256-GCM 密文落库，任何响应永不返回。

`channels/update` 使用 `{ "channelId": "...", "expectedVersion": 1, "name": "...", "enabled": true }` CAS 更新；修改 Webhook URL 或 secret 会清除验证状态，须再调用 `channels/test`。`channels/test` Body 为 `{ "channelId": "..." }`，发送安全测试 envelope 并只返回验证结果；`channels/delete` 使用 `channelId + expectedVersion` 软删除，历史投递审计保留。

`deliveries/list` Body 为 `{ "cursor": null, "limit": 30, "status": "FAILED" }`，`status` 可省略。响应包含渠道脱敏信息、attempt、nextAttemptAt、deliveredAt、providerMessageId 和 errorClass，不返回 payload、Webhook URL 或 secret。`deliveries/retry` 仅接收 `{ "deliveryId": "..." }`，只能重试当前 owner 的失败/抑制投递；不会创建或重跑 Agent Run、研究任务。

自选股和组合不重复建 API，直接复用真实端点：`POST /api/watchlist/list`、`POST /api/watchlist/stocks/list`、`POST /api/portfolio/list`、`POST /api/portfolio/detail`、`POST /api/portfolio/risk/snapshot`。Agent Tool 复用 `WatchlistService`、`PortfolioService` 和 `PortfolioRiskService`，不经内部 HTTP 回环。

## 8. 管理员评测

三个端点都要求 Bearer JWT、`ADMIN` 角色和严格 Body；普通用户、未认证请求及未知字段均拒绝。评测使用版本化 fake dataset，不接收 Prompt、用户数据、模型密钥或任意文件路径。

### `POST /api/agent/admin/evaluations/run`

```json
{
  "clientRequestId": "04907f45-c978-4058-8a4a-454625f27a2d",
  "dataset": "mvp",
  "provider": "fake"
}
```

`dataset` 和 `provider` 当前只接受 `mvp`、`fake`。同一管理员重复提交同一 `clientRequestId` 返回原 evaluation run，不重复创建结果。响应包含 `evaluationRunId`、状态、门禁结果、dataset id/version/hash、workflow/prompt/model/provider 版本、通过/失败数、总成本、artifactRef 和受控摘要；不返回测试 Prompt、模型输出、Tool payload 或隐藏推理。

### `POST /api/agent/admin/evaluations/status`

Body：`{ "evaluationRunId": "..." }`。返回该评测运行的版本、计数、门禁与摘要。`evaluationRunId` 只允许 1–32 位字母、数字、`_`、`-`。

### `POST /api/agent/admin/evaluations/detail`

Body：`{ "evaluationRunId": "...", "caseId": "..." }`。返回单 case 的 fact score、citation coverage、Tool trace match、latency、cost、失败摘要和版本 manifest。缺失 run 或 case 统一返回受控 not-found，不披露底层数据库信息。

## 9. 内容块

REST 消息、`message.created` 和最终 `AiMessage.contentBlocks` 统一采用 [消息内容块协议](./content-blocks.md)。Table、Chart、Kline、FinancialMetrics、RiskNotice 和 provenance 只在该文件定义；Controller、SSE、前端不得另建同名但不同字段的类型。
