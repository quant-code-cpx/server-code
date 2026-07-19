# WebSocket 事件

## 1. 职责边界

复用 `src/websocket/events.gateway.ts` 的 Socket.IO `/ws`。WebSocket 只发后台/多端通知，不承载模型 Token；Run 详细过程由 [SSE](./sse-events.md) 回放，避免 SSE 与 WS 两套流式真相。

## 2. 鉴权改造

当前 `handleConnection()` 对无效 Token 仅返回 `null`，连接仍存在；`subscribe_backtest` 也未校验任务归属。Agent 上线前必须：

1. 握手无有效 JWT 时 `client.disconnect(true)`。
2. 订阅 Run/回测前校验 `userId` 所有权。
3. 房间仅由服务端根据认证身份加入，拒绝客户端提交任意 `userId`。
4. 事件 payload 不含模型原始 Prompt、持仓明细或 API Key。

## 3. 新增事件

服务端 → 客户端：

| 事件 | payload | 用途 |
| --- | --- | --- |
| `agent_run_updated` | `runId,status,lastSequence,updatedAt` | 其他标签页/设备触发状态刷新 |
| `agent_schedule_updated` | `scheduleId,status,nextRunAt` | 定时任务状态变化 |
| `agent_task_notification` | `executionId,reportId?,severity,title` | 后台研究完成或失败 |
| `notification` | 沿用现有结构 | 站内通知刷新 |

客户端 → 服务端：

| 事件 | payload | 校验 |
| --- | --- | --- |
| `subscribe_agent_run` | `runId` | Run 属于当前用户 |
| `unsubscribe_agent_run` | `runId` | 幂等 |
| `replay_missed_events` | `afterEventId` | 只回放当前用户事件，最多 200 条 |

收到 `agent_run_updated` 后，前端以 REST/SSE 拉取权威状态；WebSocket payload 不作为持久状态源。

## 4. 重连

客户端用最后持久化的 `eventId`，不使用本机时间戳，避免时钟漂移和同毫秒事件遗漏。离线超过 WebSocket 回放保留期时，服务端返回 `replayRequired: true`，客户端重新查询会话/Run。
