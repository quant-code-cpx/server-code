# Agent 会话 REST 接口测试执行报告（2026-07-20）

## 1. 结论

Batch 013 已完成。10 个会话、消息、Run 与 Tool 摘要端点已接入真实 NestJS 应用；发送/重新生成具备 PostgreSQL 原子事务、并发幂等、用户配额、durable outbox 和 BullMQ 恢复能力。

代码提交：`1a4a8af feat(agent): add conversation and run REST API`。

## 2. 实现范围

- 10 个非空路径 `@Post` 端点，全部显式 HTTP 200 和 Swagger response DTO。
- 会话 create/list/detail/messages list/model update。
- 消息 send、assistant regenerate、Run status/cancel、Tool call summary list。
- Agent 专用严格 Body Guard，顶层/嵌套 unknown fields 返回 400/9001。
- Agent HTTP exception 映射，HTTP 状态与 6001–6099 业务码同时生效。
- `send/regenerate` 原子创建消息、Run、Event、outbox；Redis 失败不丢命令意图。
- `clientRequestId` transaction advisory lock + request hash 并发幂等。
- user-scoped read/write；跨租户统一 not found。
- 上海自然日成本额度与单用户活跃 Run 上限。
- cancel CAS、终态幂等、waiting job 移除和 active AbortSignal 协作。
- Tool 接口仅返回脱敏 summary，不返回 ref/hash/隐藏正文。
- Queue producer 从 Worker 模块拆出，API 与 Worker 复用同一 producer，无循环模块依赖。

未实现 SSE、schedule、report、notification API；由后续批次负责。

## 3. 配置与数据库

新增配置：

- `AGENT_MAX_ACTIVE_RUNS_PER_USER=3`
- `AGENT_DEFAULT_DAILY_BUDGET=20`

生产环境必须显式配置。开发环境使用安全默认值。

本批次未新增 Prisma model、字段或 migration。复用 Batch 002/003/005/012 已落地表和 outbox。

## 4. 自动化测试

- Controller + Supertest：25/25。
  - 10 路由只接受 POST、成功 HTTP 200。
  - 10 路由无 JWT 均返回 401。
  - Swagger 只声明 200，不声明默认 201。
  - 顶层/嵌套未知字段、非法 UUID/model/pageContext 拒绝。
  - 6001/6002 显式 HTTP not found 映射。
- Application/config：8/8。
  - 模型策略校验、capability 收窄、Redis 失败、pageContext、不回滚取消、Tool 脱敏标记、生产配置门禁。
- Agent/Queue/Filter 相关回归：75/75。
- Agent 全量非集成回归：136/136；4 suites、35 tests 按环境开关跳过。
- 会话 Repository 独立 PostgreSQL：7/7。
- Run/Step/Event/cancel CAS 独立 PostgreSQL：9/9。
- Batch 013 独立 PostgreSQL + Redis：10/10。
  - send 并发幂等与 6004 冲突。
  - 事务后段失败全回滚。
  - 归档/跨租户拒绝。
  - model update owner scope。
  - regenerate sibling version 并发幂等。
  - 活跃 Run 与每日成本额度。
  - Redis 入队失败 outbox `RETRY`。
  - Tool ref/hash 不泄露。
  - 真实 outbox → BullMQ enqueue → waiting remove。

Agent 全量回归首次运行时，既有 Tool 并发幂等用例出现一次时序波动；目标文件独立重跑通过，随后 Agent 全量重跑 136/136。未发现本批次业务回归。

## 5. 真实运行验证

- `pnpm run build`：通过。
- legacy ESLint 定向检查：0 error、0 warning；ESLint 9 仍需 `ESLINT_USE_FLAT_CONFIG=false` 读取仓库现有 `.eslintrc.js`。
- Prettier、`git diff --check`：通过。
- API 与独立 Agent Worker 容器重建成功。
- App：healthy；Agent Worker：running。
- `/health`：ok。
- `/ready`：database/redis 均 up。
- 启动日志确认 10 个 `/api/agent/*` 路由全部映射。
- 真实 JWT 只读 smoke：会话列表 HTTP 200/code 0；同请求加入未知 `userId` 返回 HTTP 400/code 9001。
- 最近启动日志无 `ERROR`、依赖解析异常或未处理异常。

## 6. 发现并修复的问题

- 高：原消息与 Run Repository 各自事务，无法保证 user/assistant/Run/Event/outbox 原子性。新增 `AgentInteractionRepository` 和真实回滚测试。
- 高：全局 ValidationPipe 会静默删除未知字段，Agent 无法满足严格协议。新增 Agent 专用前置 Guard，覆盖嵌套 DTO。
- 高：普通 HttpException 经全局 Filter 会丢失 Agent 业务码。新增 `AgentHttpException` 与专用映射。
- 中：API 需要注入 queue producer，但原 QueueModule 反向依赖 AgentModule。拆出 `AgentQueueProducerModule`，API/Worker 共享且运行时依赖图通过。
- 中：活跃 Run 配额若只在事务外检查会被并发绕过。使用 user advisory lock 将检查与创建放入同一事务。

## 7. 后续

下一批推荐 Batch 014：实现 `POST /api/agent/runs/events` 的 SSE、Last-Event-ID/afterSequence 重放、背压与断线恢复。复用本批次 user-scoped Run 查询、错误映射和持久事件，不另建状态源。
