# 智能体 REST 接口运行手册

## 1. 范围

Batch 013 已实现 `/api/agent/*` 的 10 个会话、消息与 Run JSON 接口：

- `POST /api/agent/conversations/create`
- `POST /api/agent/conversations/list`
- `POST /api/agent/conversations/detail`
- `POST /api/agent/conversations/messages/list`
- `POST /api/agent/conversations/model/update`
- `POST /api/agent/messages/send`
- `POST /api/agent/runs/regenerate`
- `POST /api/agent/runs/status`
- `POST /api/agent/runs/cancel`
- `POST /api/agent/runs/tool-calls/list`

Batch 014 已实现 `POST /api/agent/runs/events` SSE；发送和重新生成响应中的 `streamEndpoint` 固定指向该 canonical 路径。流式连接、游标、背压和指标见[智能体事件流运行手册](./智能体事件流-运行手册.md)。

## 2. 启动前配置

```dotenv
AGENT_MAX_ACTIVE_RUNS_PER_USER=3
AGENT_DEFAULT_DAILY_BUDGET=20
```

- `AGENT_MAX_ACTIVE_RUNS_PER_USER`：单用户 `QUEUED/RUNNING/CANCEL_REQUESTED` Run 总上限，范围 1–100。
- `AGENT_DEFAULT_DAILY_BUDGET`：上海自然日默认 CNY 成本额度，必须为非负有限数值。
- 生产环境必须显式配置两项；开发环境默认使用上方示例值。
- Run 单次预算仍受 `AGENT_MAX_COST_PER_RUN` 限制，实际预算取单次上限与当日剩余额度的较小值。

创建 Run 还要求数据库已发布 `stock_research@1` 和 `stock_research_system@1`。缺失时分别返回 6024、6025，不会创建半成品消息或 Run。

## 3. 请求与错误约定

- 全部接口需要 Bearer JWT，并从认证上下文读取 `userId`；Body 中提交 `userId` 会被拒绝。
- Agent Controller 使用专用严格 Body Guard。顶层或嵌套未知字段返回 HTTP 400、code 9001，不受全局“静默删除未知字段”行为影响。
- 成功统一 HTTP 200、`{ code: 0, data, message }`。
- 跨租户会话和 Run 分别统一返回 HTTP 404、code 6001/6002。
- 幂等键相同但请求内容不同返回 HTTP 409、code 6004。
- 活跃 Run 或每日成本达到上限返回 HTTP 429、code 6019。
- 取消状态版本冲突返回 HTTP 409、code 6003。

## 4. 消息发送原子边界

`messages/send` 在一个 PostgreSQL 事务中完成：

1. 创建完成态 user message。
2. 创建待处理 assistant placeholder。
3. 创建 `QUEUED` Agent Run。
4. 创建初始 `message.created` Event。
5. 创建 `AiJobOutbox` durable intent。
6. 更新会话 `messageCount/lastMessageAt`。

任一步失败全部回滚。事务提交后才尝试 BullMQ 入队；Redis 暂时失败时接口仍返回首次 Run，outbox 标记 `RETRY`，由 Reconciler 恢复。

同一用户的 Run 创建使用 PostgreSQL transaction advisory lock，活跃配额检查与创建串行化；`clientRequestId` 并发重复只返回一个 Run。

## 5. 重新生成与取消

- `runs/regenerate` 保留旧 assistant message，新建 sibling version 和新 Run；原请求上下文、capability 与数据 scope 继承自旧 Run。
- `runs/cancel` 使用 `expectedStatusVersion` 做 CAS。
- `QUEUED` 直接进入 `CANCELLED`，随后尽力移除 waiting/delayed BullMQ job。
- `RUNNING` 进入 `CANCEL_REQUESTED`；Worker heartbeat 读取数据库状态并通过 AbortSignal 协作取消。
- `COMPLETED/FAILED/CANCELLED` 重复取消幂等成功，不发生状态回退。

## 6. Tool 摘要安全

`runs/tool-calls/list` 始终只返回已经脱敏的 `inputSummary/outputSummary` 和公开状态字段。即使请求 `includePayload=true`，普通用户端点也不会返回：

- `inputRef/outputRef`
- `inputHash/outputHash`
- 模型隐藏推理
- 供应商原始响应、SQL、密钥或未脱敏正文

管理员深度审计接口另行设计，不复用普通用户端点。

## 7. 验证命令

```bash
pnpm exec jest src/apps/agent/api/test/agent.controller.spec.ts --runInBand
pnpm exec jest src/apps/agent/application/test/agent-application.service.spec.ts --runInBand
RUN_AGENT_DB_INTEGRATION=true RUN_AGENT_QUEUE_INTEGRATION=true \
  pnpm exec jest src/apps/agent/application/test/agent-interaction.repository.spec.ts --runInBand
pnpm run build
```

运行态检查：

```bash
docker compose ps app agent-worker
curl -fsS http://localhost:3000/health
curl -fsS http://localhost:3000/ready
```

未携带 JWT 请求 Agent 接口应返回 401；携带有效 JWT 且 Body 含未知字段应返回 400/9001。

## 8. 故障判断

- Run 已创建、BullMQ 无 job：检查 `ai_job_outbox.status/last_error/next_attempt_at` 和 Agent Reconciler 日志。
- 发送返回 6024/6025：重新执行 `pnpm run agent:workflow:publish-v1`，确认发布 hash 与服务器快照一致。
- 发送返回 6019：检查用户活跃 Run 数、上海自然日 CNY 模型成本和两项 API 配额配置。
- 取消后 active job 未立即结束：检查 Worker heartbeat、Run 是否为 `CANCEL_REQUESTED`、Tool/模型是否正确传播 AbortSignal。
- 生产启动失败提示 Agent API 配置缺失：补齐两项环境变量后重启 API 与 Agent Worker。
