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

Body：`{ "conversationId": "cm_01J..." }`。仅返回当前用户会话。

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

## 4. Run 控制与恢复

### `POST /api/agent/runs/events`

请求头：`Accept: text/event-stream`、`Authorization: Bearer ...`、可选 `Last-Event-ID`。

Body：`{ "runId": "run_01J...", "afterSequence": 41 }`。返回协议见 [SSE 事件](./sse-events.md)。

### `POST /api/agent/runs/status`

Body：`{ "runId": "run_01J..." }`。返回 Run 状态、当前步骤、最终消息、最新事件序号和是否可取消。

### `POST /api/agent/runs/cancel`

Body：`{ "runId": "run_01J...", "expectedStatusVersion": 7 }`。原子写入 `CANCEL_REQUESTED`，移除等待任务并通知正在运行的 Tool/模型 AbortController。终态请求按幂等成功返回。

### `POST /api/agent/runs/tool-calls/list`

Body：`{ "runId": "run_01J...", "includePayload": false }`。普通用户只见脱敏输入/输出摘要；管理员审计接口另行授权。

## 5. 定时任务

- `POST /api/agent/schedules/create`
- `POST /api/agent/schedules/list`
- `POST /api/agent/schedules/detail`
- `POST /api/agent/schedules/update`
- `POST /api/agent/schedules/pause`
- `POST /api/agent/schedules/resume`
- `POST /api/agent/schedules/delete`
- `POST /api/agent/schedules/executions/list`

创建示例：

```json
{
  "clientRequestId": "2a3...",
  "name": "每日自选股公告摘要",
  "triggerType": "CRON",
  "cron": "0 30 18 * * 1-5",
  "timeZone": "Asia/Shanghai",
  "tradingDayOnly": true,
  "workflowKey": "watchlist_daily_research",
  "workflowVersion": 1,
  "input": { "watchlistId": 3 },
  "notificationChannelIds": ["channel_wecom_01"],
  "maxCostCny": 2.0
}
```

条件触发必须使用结构化规则，不接受任意代码或模型生成 SQL。普通微信不作为可选官方通道。

## 6. 报告、通知与现有用户数据 API

- `POST /api/agent/reports/list`、`detail`、`save`、`delete`
- `POST /api/agent/notification-channels/list`、`create`、`update`、`test`、`delete`
- `POST /api/agent/notification-deliveries/list`、`retry`

自选股和组合不重复建 API，直接复用真实端点：`POST /api/watchlist/list`、`POST /api/watchlist/stocks/list`、`POST /api/portfolio/list`、`POST /api/portfolio/detail`、`POST /api/portfolio/risk/snapshot`。Agent Tool 复用 `WatchlistService`、`PortfolioService` 和 `PortfolioRiskService`，不经内部 HTTP 回环。

## 7. 内容块

REST 消息、`message.created` 和最终 `AiMessage.contentBlocks` 统一采用 [消息内容块协议](./content-blocks.md)。Table、Chart、Kline、FinancialMetrics、RiskNotice 和 provenance 只在该文件定义；Controller、SSE、前端不得另建同名但不同字段的类型。
