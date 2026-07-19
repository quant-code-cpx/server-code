# Agent 安全与权限

## 1. 安全目标与边界

Agent 是金融研究辅助系统，不是交易执行系统。MVP 不提供下单、通用写数据库、任意 SQL、任意 HTTP、任意代码、任意通知或自由子 Agent Tool。模型输出永远不是授权决定或事务提交依据。

核心原则：服务端身份、最小权限、资源所有权、数据分级、程序策略优先、外部内容不可信、全链路审计、失败时不补造。

## 2. 上线阻断风险

| 级别 | 已确认问题                                                      | 真实位置                                                         | 上线前动作                                                                                                    |
| ---- | --------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| P0   | 全局 `JwtService` 以空 secret 注册，WebSocket 用默认 `verify()` | `src/shared/shared.module.ts`、`src/websocket/events.gateway.ts` | Gateway 改用 `TokenService.verifyAccessToken()`，校验 blacklist；无效握手立即断开；移除对空默认 secret 的依赖 |
| P0   | 匿名 Socket 仍保留，任意 `subscribe_backtest` jobId 可加入房间  | `src/websocket/events.gateway.ts`                                | socket data 固定认证身份；订阅前 owner check；服务端房间；补跨用户集成测试                                    |
| P0   | 自定义因子无 userId，全局可被普通认证用户创建/改/删/预计算      | `prisma/research/factor.prisma`、`src/apps/factor/`              | 增加 owner/visibility 或限制为管理员；migration/回填；Agent 首期不开放写因子                                  |
| P0   | Factor attribution 按回测 ID 查询但未校验 userId                | `src/apps/factor/services/factor-backtest.service.ts`            | 强制 owner predicate；回归测试枚举跨用户 ID                                                                   |
| P0   | migration 不能从空库完整重建、周/月收益单位错配                 | `prisma/migrations/`、Tushare mapper/sync                        | 数据修复验收前禁用受影响 Tool，防错误金融结论                                                                 |
| P1   | `BusinessException` 总是 HTTP 200                               | `src/common/exceptions/business.exception.ts`、全局 filter       | Agent 使用真实 HTTP 语义与规范错误 code                                                                       |
| P1   | 全局 ValidationPipe 允许额外字段被静默剔除                      | `src/main.ts`                                                    | Agent DTO 使用 strict pipe；高风险命令拒绝未知字段                                                            |
| P1   | HTTP body redact 未覆盖 refreshToken/API key 等                 | `src/lifecycle/interceptors/logging.interceptor.ts`              | 集中式递归 redaction；Agent message body 默认不日志化                                                         |
| P1   | BigInt 全局转 Number 可能失真                                   | `src/main.ts`                                                    | Agent ID/sequence 明确序列化为字符串或安全整数                                                                |

这些修复应先于任何真实模型/搜索 Key 接入。

## 3. 认证与资源隔离

- HTTP 复用全局 `JwtAuthGuard`、`JwtStrategy`、`TokenService`；Agent Controller 不标 `@Public()`。
- application/repository 方法显式接收 server-side `userId`，查询条件带 owner；禁止先全局 findUnique 再在内存比较敏感资源。
- WebSocket handshake 同时检查签名、exp、jti blacklist，失败断开。订阅 Run/回测前查询 owner；客户端不能提交 user room。
- 系统目前只有 `USER < ADMIN < SUPER_ADMIN` 角色层级，没有组织/tenant 模型。MVP 把 userId 作为租户边界；若未来组织共享，必须新增明确 membership/resource scope，不能把 ADMIN 当跨租户读取许可。
- 普通 not-found 与非本人保持同一外部语义，防 ID 枚举；审计记录内部原因。

## 4. Tool 授权

有效权限计算见 [Tool 系统](./tool-system.md)。强制要求：

- 模型不能传 userId、role、permission 或资源 owner。
- 私有 Tool：`get_user_watchlist`、`get_portfolio_risk`、`get_backtest_result` 每次调用 owner check。
- 公共数据 Tool 仍有时间范围、行数、并发和成本配额。
- `save_research_report` 仅第一后续阶段加入，`requiresConfirmation=true`；确认 token 绑定输入 hash 并短期有效。
- Schedule/Notification 不成为自由 Tool，走结构化 API/固定 Workflow。
- Tool adapter 无 `PrismaService`、通用 SQL、通用 HTTP client、文件系统或 child process 权限。
- Tool 失败后返回稳定错误，System Prompt 与 verifier 都禁止模型编造替代数据。

## 5. 数据分级与模型供应商隔离

| 等级                  | 示例                                             | 默认处理                                        |
| --------------------- | ------------------------------------------------ | ----------------------------------------------- |
| `PUBLIC_MARKET`       | 公共行情、财报、指数                             | 可发送给已批准供应商，仍最小化                  |
| `USER_PRIVATE`        | 自选股、偏好、研究笔记                           | 只在用户授权且供应商 policy 允许时发送          |
| `PORTFOLIO_SENSITIVE` | 持仓、数量、成本、交易日志、风险偏好             | 默认只发送程序聚合摘要；原始明细需明确政策/授权 |
| `SECRET`              | JWT、API Key、webhook secret、Cookie、数据库凭据 | 永不发送模型                                    |

Model Gateway 路由前做数据等级 gate；供应商配置记录允许等级、区域、数据保留/训练政策和组织批准状态。切换模型不能绕过原供应商限制。Prompt/response 默认不落普通日志，供应商 request ID 仅 hash 后关联。

API Key 使用 Secret 管理或运行时环境注入，分 Provider/环境/用途，支持轮换和最小额度；禁止存入数据库明文、`.env.example`、前端、BullMQ job 或 Tool result。

## 6. Prompt Injection 与输出安全

- 系统/Workflow/Tool policy 是高信任指令；用户问题是待处理输入；网页、搜索 snippet、报告和 Tool 字符串字段都是不可信数据。
- 外部文本中的角色声明、Tool 请求、URL、SQL、密钥索取或“忽略规则”不改变执行策略。
- Plan 必须通过程序 allowlist、Schema、步数/依赖/成本检查；模型不能动态注册 Tool。
- 回答 verifier 检查数字/日期/来源/截止日与 citation；无法验证的内容标为推断/假设或删除。
- Markdown 由前端白名单渲染；后端不返回模型生成 HTML、script、ApexCharts option 或可执行代码。
- 不保存隐藏推理，只保存公开计划摘要和结构化决策原因。

网页隔离细节见[联网搜索服务](./web-search-service.md)。

## 7. SSRF、SQL 与文件安全

### SSRF

`fetch_web_page` 只经 `UrlPolicyService/SafeWebFetcher`：拒绝私网/metadata/本机、危险 scheme、DNS rebinding、未校验 redirect、超大响应和凭据透传。搜索/通知 webhook 分别使用独立 egress allowlist。

### SQL

- MVP 无 Text-to-SQL；模型无 Prisma/数据库句柄。
- 当前代码存在多处 `$queryRawUnsafe`；Agent Facade 接入时逐项改为 tagged parameterized query 或固定枚举片段。
- 应用数据库账号不使用 PostgreSQL superuser；API/Worker、migration、只读分析分离账号。
- 后期管理员 SQL Explorer 必须按 [ADR-004](../decisions/adr-004-tool-access-control.md)实施只读副本、AST 白名单、EXPLAIN/timeout/LIMIT/审计，不能复用生产写账号。

### 文件/对象存储

- 报告和网页 artifact 使用 server-generated object key；用户标题不能形成路径。
- 现有 `src/apps/report/` 使用本地 `storage/reports`，删除记录未必清文件；接入 Agent 前补路径约束、MIME/大小、生命周期和删除补偿。
- 模型不能读取任意本地文件或返回本地路径。

## 8. Python 与代码执行

MVP 不提供 Python Tool。第二阶段无状态 Compute Service 只接收 schema 化数据快照；容器非 root、只读 rootfs、无宿主挂载、默认无 egress、CPU/内存/时间/process 限制、服务身份/mTLS、依赖锁定和镜像签名。用户/模型代码、pickle、动态 import、shell 和任意包安装一律不接受。

## 9. 配额、滥用与成本

- HTTP 全局已有 Throttler，但 Agent 需按 endpoint/user/IP 增加更低速率，并单独限制活跃 Run、Tool 并行、搜索、Model tokens 和每日成本。
- 入队前预估额度；每个 ModelCall/高成本 Tool 前复核；完成后真实结算。并发请求使用原子 reservation，防额度竞态。
- 超额返回 `AI_COST_QUOTA_EXCEEDED`，不能通过自动换模型、拆小 Run 或重试绕过。
- 防重复使用 `clientRequestId`、request hash、Run/Tool 幂等键；取消/失败重试不重复计费或写入。
- 异常股票枚举、跨用户资源探测、URL 拦截激增、Tool forbidden 和成本突增进入安全告警。

## 10. 通知与外部渠道

- Channel credential 加密存储，只给对应 Adapter 解密；创建后不回显。
- Webhook 只允许 HTTPS allowlist，出站签名含 timestamp/nonce，接收响应限制大小；测试接口同样防 SSRF。
- 通知内容按渠道做敏感数据裁剪，默认不发送完整持仓/成本或模型 Prompt。
- 普通个人微信自动化不支持；只接经正式资质确认的企业微信/公众号等官方能力。
- 退订、频控、去重和 Delivery 审计见[调度与通知](./scheduler-and-notification.md)。

## 11. 审计

每次 Run、权限决策、Tool/Model/Search/写操作/确认/通知保存：userId、资源、输入 hash、版本、decision、reason code、时间、traceId、data classification、usage/cost 和安全结果。Tool 完整敏感 payload 与普通管理员列表分离。

现有 `AuditLogService.record()` 是 fire-and-forget，失败只写日志；关键 Agent 审计必须与状态事务写入或经事务 Outbox 可靠落库。审计查询需要独立管理员权限、理由、分页/导出限制和二次审计。

## 12. 文件落点

新增：

```text
src/apps/agent/security/agent-authorization.service.ts
src/apps/agent/security/data-classification.service.ts
src/apps/agent/security/cost-quota.service.ts
src/apps/agent/security/confirmation.service.ts
src/apps/agent/security/prompt-injection-detector.service.ts
src/apps/agent/security/agent-audit.repository.ts
src/apps/agent/api/agent.exception.ts
src/apps/web-search/fetch/url-policy.service.ts
```

修改：

- `src/shared/shared.module.ts`
- `src/websocket/events.gateway.ts` 与 `src/websocket/test/events.gateway.spec.ts`
- `src/apps/factor/`、`prisma/research/factor.prisma` 和对应 migration
- `src/main.ts`、`src/lifecycle/interceptors/logging.interceptor.ts`
- `src/common/exceptions/business.exception.ts`、`src/lifecycle/filters/global.exception.ts`
- 涉及 `$queryRawUnsafe` 的 Agent 复用查询路径
- 数据库/Redis 账号与 ACL 配置由部署方案落实，本文件只定义安全门禁

## 13. 安全测试与发布门禁

必须覆盖：

- JWT 伪造/过期/blacklist、匿名 WS、任意 backtest/run 订阅、跨用户会话/自选股/组合/回测/报告/调度。
- Tool input 伪造 userId、额外字段、越界日期/行数、未确认写 Tool、确认重放/篡改。
- Prompt Injection（用户、网页、Tool 文本）、伪造引用、Tool 失败后补造、敏感数据外发。
- SSRF 的 IPv4/IPv6/重定向/DNS rebinding/metadata、Webhook SSRF、超大响应。
- SQL 注入、动态表名、timeout/LIMIT、数据库最小权限；Factor owner/visibility 回归。
- Key/Token/持仓/Prompt 日志扫描，BigInt 边界、成本并发 reservation、审计写失败。

发布必须满足：P0 全部关闭；安全测试全绿；真实 Secret 不在 Git/日志/Swagger；API/Worker 数据库账号最小权限；Agent Redis 队列不使用可淘汰策略；模型/搜索/通知供应商完成数据处理与配额审批；任何自动交易能力保持不存在。
