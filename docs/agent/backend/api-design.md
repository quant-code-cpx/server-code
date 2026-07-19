# Agent API 落地设计

## 1. 唯一公共契约

本文件只说明 NestJS 实现方式，不重复请求/响应或事件字段。公共规范源：

- 路径、Body、响应和内容块：[REST API](../api/rest-api.md)
- 事件字典、顺序、重连和 heartbeat：[SSE 事件](../api/sse-events.md)
- 后台通知与订阅：[WebSocket 事件](../api/websocket-events.md)
- HTTP/业务码与 Tool error 映射：[错误码](../api/error-codes.md)

规范路径是 `/api/agent/*`，**没有 `/v1`**。`src/main.ts` 已设置 `/api` 全局前缀，因此 Controller 使用 `@Controller('agent/...')`，不能在装饰器中再写 `api`。

## 2. Controller 拆分

| Controller                            | Nest prefix                     | 负责的 canonical 路径                                         |
| ------------------------------------- | ------------------------------- | ------------------------------------------------------------- |
| `AgentConversationController`         | `agent/conversations`           | create/list/detail/messages/list/model/update                 |
| `AgentMessageController`              | `agent/messages`                | send                                                          |
| `AgentRunController`                  | `agent/runs`                    | events/status/cancel/regenerate/tool-calls/list               |
| `AgentScheduleController`             | `agent/schedules`               | create/list/detail/update/pause/resume/delete/executions/list |
| `AgentReportController`               | `agent/reports`                 | list/detail/save/delete                                       |
| `AgentNotificationChannelController`  | `agent/notification-channels`   | list/create/update/test/delete                                |
| `AgentNotificationDeliveryController` | `agent/notification-deliveries` | list/retry                                                    |

所有方法使用带非空路径的 `@Post()`；查询条件放 class DTO Body，不使用 `@Query()`。Controller 只做身份/DTO/调用 application service/响应传输，禁止直接注入 Prisma、Model Gateway 或 Tool executor。

## 3. HTTP 状态与包装

- JSON 端点沿用项目 `ResponseModel`/`TransformInterceptor` 形成的 `{ code, data, message? }`，精确结构见 [REST API](../api/rest-api.md)。
- 每个 POST 显式声明 `@HttpCode(HttpStatus.OK)` 或 OpenAPI 中规定的状态，禁止依赖 Nest 默认 201。当前仓库大量 POST 的运行时 201 与 Swagger 200 漂移，Agent 不能复制该问题。
- POST-SSE 返回原始 `text/event-stream`，不经过 JSON wrapper。
- API response DTO、Swagger decorator 与 runtime status 必须来自同一类；不写内联/交叉 `@Body()` 类型。
- BigInt/Decimal 在 presenter 中按协议显式转换。`src/main.ts` 当前把所有 BigInt 转 Number，有越过安全整数风险；Agent ID 使用不透明字符串，不依赖全局转换。

## 4. DTO 与校验

```text
src/apps/agent/api/dto/agent-response.dto.ts
src/apps/agent/api/dto/conversation.dto.ts
src/apps/agent/api/dto/message.dto.ts
src/apps/agent/api/dto/run.dto.ts
src/apps/agent/api/dto/schedule.dto.ts
src/apps/agent/api/dto/report.dto.ts
src/apps/agent/api/dto/notification-channel.dto.ts
src/apps/agent/api/dto/notification-delivery.dto.ts
```

- DTO 全部是 `class`，使用 class-validator/class-transformer 和 Swagger decorator；嵌套对象用 `@ValidateNested()` + `@Type()`。
- Agent Controller 使用 strict ValidationPipe：transform、whitelist、`forbidNonWhitelisted=true`；避免当前全局 `src/main.ts` 的 false 设置让未知字段静默消失。
- `clientRequestId` 校验 UUID；ID 只校验长度/格式上限，不推断数据库类型；Agent 公共日期严格使用 ISO `YYYY-MM-DD`，时间为 ISO 8601 UTC，timezone 为 IANA 名称；只有 Facade 调用现有 Service 时才转换为 `YYYYMMDD`。
- `content/pageContext/input` 设置深度、数组、字符串和总 JSON 大小；`src/main.ts` 的 1 MB 请求体上限继续生效，Agent 单消息设置更小业务上限。
- 服务端忽略/拒绝 Body 中的 userId、role、tenant、cost usage、Tool result、Prompt 或 ModelCall 状态。

## 5. 身份、资源和幂等

- Agent Controller 不使用 `@Public()`；复用全局 `JwtAuthGuard` 与 `@CurrentUser()`，application service 只接收已认证 `user.id`。
- 每个 repository 查询都带 userId/owner 条件，不能只在 Controller 先查一次。
- 所有创建/执行命令使用 `(userId, clientRequestId)` 唯一约束并保存 request hash。相同键同内容返回首次结果；同键不同内容返回 `AI_DUPLICATE_REQUEST_CONFLICT`。
- `messages/send` 在一个事务中写消息、Run 和 Outbox；入队失败由 dispatcher 补偿，Controller 不直接调用 `queue.add()` 后再补数据库。
- cancel 使用 `expectedStatusVersion` 做乐观锁；终态请求按规范幂等成功。
- schedule/channel/report 的所有 ID 都做 owner check；管理员审计接口不复用普通用户端点绕过。

## 6. POST-SSE 实现

`POST /api/agent/runs/events` 使用 `fetch` stream，不能使用 Nest `@Sse()`（它隐含 GET）或浏览器 EventSource。

新增 `@RawStreamResponse()`：

```text
src/common/decorators/raw-stream-response.decorator.ts
src/lifecycle/interceptors/transform.interceptor.ts
```

`TransformInterceptor` 通过 handler/class metadata 判断旁路；禁止继续把 Agent path 加入硬编码 URL 数组。`src/main.ts` 应通过 DI/Reflector 注册拦截器，确保 metadata 可测试。

流处理：

1. Controller 校验 JWT、runId owner 和游标；Header/Body 优先级按 [SSE 协议](../api/sse-events.md)。
2. `RunEventStreamService` 先从 PostgreSQL 分页重放 `sequence > cursor`，再订阅实时 append；订阅前后二次查 sequence，关闭竞态窗口。
3. 严格按 `id/event/data` 序列化并以空行结尾；每条 data 是单行 JSON。
4. 15 秒无业务事件写 `: heartbeat`，不占 sequence、不落库。
5. 处理 Node response backpressure：`write()` false 时等待 drain；客户端断开触发 AbortSignal，但**不自动取消 Run**。
6. 收到终态后 flush 并关闭；网络中断只结束连接，刷新后可重放。
7. 代理 buffering/idle timeout 属部署配置，本实现通过 heartbeat 和集成测试验证。

Access Token 在已建立短流期间过期不回收连接；任何重连重新鉴权。SSE payload 不含 refresh token、Prompt、完整持仓或 provider raw error。

## 7. WebSocket 边界

Socket.IO `/ws` 只发 [WebSocket 事件](../api/websocket-events.md)中的状态失效/后台通知，不承载 Token 流或权威 Run 状态。启用 Agent 事件前必须先：

- 用 `TokenService.verifyAccessToken()` 和 blacklist 校验握手；失败 `disconnect(true)`。
- 把认证 payload 保存到 socket data，房间只由服务端加入。
- `subscribe_agent_run`/现有 `subscribe_backtest` 都查询 userId 归属。
- 多副本配置 Redis adapter 后再承诺跨实例通知。

详细风险与修改见[安全设计](./security.md)。

## 8. 错误落地

精确码和 HTTP 状态只引用 [Agent 错误码](../api/error-codes.md)。当前 `BusinessException` 固定 HTTP 200，且 `GlobalExceptionsFilter` 对普通 HttpException 默认用 HTTP status 作为 `code`；Agent 上线前需：

1. 在 `src/constant/response-code.constant.ts` 增加规范 6001–6099 enum。
2. 新增能同时携带业务 code、HTTP status、安全 details 的 `AgentException`，或为现有异常建立兼容扩展。
3. 修改 `src/lifecycle/filters/global.exception.ts`：保留受控 response body code，并统一生产脱敏。
4. 为 SSE 在 HTTP headers 已发送后的失败写 `agent.failed`，不能再尝试 JSON exception response。
5. 让 `HttpMetricsInterceptor` 识别真实 4xx/5xx；业务失败不再全部统计成成功。

迁移现有 `BusinessException` 的行为可能影响旧前端，应单独兼容批次完成；Agent 端点从第一天使用正确语义。

## 9. Swagger 与生成链

- 更新 `scripts/generate-swagger.ts`，确保能在不启动真实模型/Worker/Scheduler 的环境生成文档。
- OpenAPI 是前端类型生成源，不能在 `../client-code` 手写第二套 DTO。
- Agent DTO/endpoint 变更同批更新 `docs/agent/api/`、Swagger snapshot、前端生成类型和契约测试。
- CI 比较规范 endpoint、method、status、required fields、enum 和 SSE content type；SSE event payload 另用 JSON Schema fixture 测试。

## 10. 文件落点

新增：

```text
src/apps/agent/api/agent-conversation.controller.ts
src/apps/agent/api/agent-message.controller.ts
src/apps/agent/api/agent-run.controller.ts
src/apps/agent/api/agent-schedule.controller.ts
src/apps/agent/api/agent-report.controller.ts
src/apps/agent/api/agent-notification-channel.controller.ts
src/apps/agent/api/agent-notification-delivery.controller.ts
src/apps/agent/api/dto/agent-response.dto.ts
src/apps/agent/api/dto/conversation.dto.ts
src/apps/agent/api/dto/message.dto.ts
src/apps/agent/api/dto/run.dto.ts
src/apps/agent/api/dto/schedule.dto.ts
src/apps/agent/api/dto/report.dto.ts
src/apps/agent/api/dto/notification-channel.dto.ts
src/apps/agent/api/dto/notification-delivery.dto.ts
src/apps/agent/api/run-event-stream.service.ts
src/apps/agent/api/sse-writer.ts
src/apps/agent/api/agent.exception.ts
src/common/decorators/skip-transform.decorator.ts
```

修改：

- `src/main.ts`
- `src/lifecycle/interceptors/transform.interceptor.ts`
- `src/lifecycle/filters/global.exception.ts`
- `src/constant/response-code.constant.ts`
- `scripts/generate-swagger.ts`
- `src/app.module.ts`

## 11. 测试与验收

```text
src/apps/agent/test/api/agent-api.spec.ts
src/apps/agent/test/api/agent-api.contract.spec.ts
src/apps/agent/test/api/run-event-stream.spec.ts
src/apps/agent/test/api/agent-idempotency.integration.spec.ts
src/apps/agent/test/api/agent-api-security.integration.spec.ts
```

覆盖所有 canonical endpoint、显式 HTTP status、wrapper/SSE 旁路、DTO 未知字段、伪造 userId、owner 隔离、重复 request、request hash 冲突、SSE 游标/乱序/断连/重连/heartbeat/backpressure/终态、Token 重连、真实错误 code 和 Swagger diff。不得使用内联 DTO；测试不访问真实模型、搜索或通知供应商。
