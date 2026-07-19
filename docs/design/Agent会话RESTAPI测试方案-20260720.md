# Agent 会话 REST API 测试方案-20260720

> 范围：Batch 013 会话、消息、Run 与 Tool 摘要 10 个 REST 端点  
> 设计原则：按 REST 契约和业务不变量推导，不以当前实现或旧测试为正确性依据。  
> 状态：✅ 已回归

## 1. 业务规则

- 全部端点使用带非空路径的 `POST`，运行时和 Swagger 均为 HTTP 200 成功响应。
- 服务端只信任 JWT `userId`；跨租户资源统一返回 not found。
- Agent DTO 顶层和嵌套未知字段必须拒绝，不能被全局 whitelist 静默删除。
- `messages/send` 单事务创建 user message、assistant placeholder、Run、初始 Event 和 `AiJobOutbox`。
- `clientRequestId` 同请求返回首次 Run；相同键不同内容返回 6004；并发请求不得重复写入。
- 队列暂时不可用时 HTTP 命令仍成功，outbox 保留可恢复意图。
- `regenerate` 新建 assistant version 和 Run，旧版本保留。
- 每用户活跃 Run 和上海自然日成本受配置限制。
- `cancel` 使用 `expectedStatusVersion`；终态幂等；waiting job 尽力移除；active job 由 DB 状态与 AbortSignal 协作取消。
- Tool 调用端点只返回脱敏 summary，不返回 ref、hash、敏感正文或隐藏推理。

## 2. 接口范围

1. `POST /api/agent/conversations/create`
2. `POST /api/agent/conversations/list`
3. `POST /api/agent/conversations/detail`
4. `POST /api/agent/conversations/messages/list`
5. `POST /api/agent/conversations/model/update`
6. `POST /api/agent/messages/send`
7. `POST /api/agent/runs/regenerate`
8. `POST /api/agent/runs/status`
9. `POST /api/agent/runs/cancel`
10. `POST /api/agent/runs/tool-calls/list`

不测试 SSE、schedule、report、notification API。

## 3. 测试矩阵

| 用例 ID           | 类型   | 优先级 | 场景                                     | 独立期望                                                   |
| ----------------- | ------ | ------ | ---------------------------------------- | ---------------------------------------------------------- |
| AGREST-BIZ-001    | BIZ    | P0     | 创建、列表、详情、消息列表、模型更新     | 响应映射稳定，历史消息含引用和关联 Run 摘要                |
| AGREST-BIZ-002    | BIZ    | P0     | 发送消息                                 | 五类记录同事务形成，返回 QUEUED Run 和固定 stream endpoint |
| AGREST-BIZ-003    | BIZ    | P0     | 重新生成                                 | 新 assistant version 递增，旧版本不改写                    |
| AGREST-SEC-001    | SEC    | P0     | 无 JWT                                   | 全部端点 401                                               |
| AGREST-SEC-002    | SEC    | P0     | 跨租户访问                               | 全部资源端点统一 6001/6002 not found，不泄露存在性         |
| AGREST-SEC-003    | SEC    | P0     | Tool payload                             | 只返回脱敏 summary，不返回 inputRef/outputRef/hash         |
| AGREST-ERR-001    | ERR    | P0     | 未知字段、非法 ID/UUID/model/pageContext | HTTP 400、code 9001，嵌套未知字段同样拒绝                  |
| AGREST-ERR-002    | ERR    | P0     | 归档会话发送                             | 不创建任何消息、Run、Event、outbox                         |
| AGREST-DATA-001   | DATA   | P0     | 事务任一步失败                           | 五类记录全部回滚，不出现半成功                             |
| AGREST-RACE-001   | RACE   | P0     | send 并发同幂等键                        | 只存在一个 Run，全部响应指向首次结果                       |
| AGREST-RACE-002   | RACE   | P0     | 同幂等键不同内容                         | 首次成功，冲突请求返回 6004                                |
| AGREST-RACE-003   | RACE   | P0     | regenerate 并发                          | 只创建一个新版本和一个 Run                                 |
| AGREST-RACE-004   | RACE   | P0     | cancel CAS                               | 版本冲突返回 6003；终态重复取消幂等成功                    |
| AGREST-DATA-002   | DATA   | P0     | Redis 入队失败                           | Run/outbox 保留，响应不丢失命令结果                        |
| AGREST-DATA-003   | DATA   | P1     | 活跃 Run/每日预算达到上限                | 新 Run 被 6019 拒绝，已有数据不变                          |
| AGREST-REG-001    | REG    | P0     | 路由与 Swagger                           | 10 路由均为非空 `POST`，成功状态均为 200                   |
| AGREST-E2E-001    | E2E    | P0     | PostgreSQL + Redis 闭环                  | 创建→发送→入队→状态/取消/恢复行为一致                      |
| AGREST-PERF-001   | PERF   | P2     | 会话/消息分页                            | 记录本机数据规模和耗时，不虚构阈值                         |
| AGREST-LOAD-001   | LOAD   | P2     | 并发重复发送                             | 逐级并发验证错误率与幂等稳定性                             |
| AGREST-STRESS-001 | STRESS | P2     | 超活跃 Run 上限                          | 限额后稳定返回 429，不打满队列或 DB                        |

## 4. 执行顺序

1. DTO、Guard、Controller 和 application service 单元测试。
2. Supertest 请求链：Guard、Pipe、Interceptor、Filter、响应包装。
3. 真实 PostgreSQL 事务、幂等、跨租户和版本测试。
4. 真实 Redis 入队、故障恢复和 cancel 测试。
5. 相关 Agent/Queue 回归、lint、build、容器日志与 health/ready。

## 5. 完成条件

- P0/P1 自动化用例通过；P2 性能项记录真实环境与结果。
- 无未解释的半成功、越权、敏感字段或状态机回退。
- 发现缺陷均有回归用例；执行报告同步记录命令和结果。
