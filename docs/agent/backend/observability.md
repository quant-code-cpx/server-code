# 可观测性与评测

## 1. 当前基线

可复用能力：

- `src/shared/context/` 用 AsyncLocalStorage 为 HTTP 请求传播 traceId/userId。
- `src/shared/logger/logger.service.ts` 在生产使用 Winston JSON 与轮转文件。
- `src/shared/metrics/metrics.module.ts` 已暴露 HTTP、Prisma、Tushare、缓存、Redis、WebSocket 和通用 BullMQ gauge。
- `src/queue/queue-metrics.service.ts` 当前只采集 `backtesting` queue。
- `src/shared/health/` 提供 `/health` 与 `/ready`；Prometheus 使用 `/metrics`。

缺口：Worker/Scheduler 没有 HTTP AsyncLocalStorage 上下文；Agent/模型/Tool/搜索/引用/成本无指标；没有 OpenTelemetry；业务异常常返回 HTTP 200；现有 `AuditLogService` 位于 `src/apps/user/audit-log.service.ts`，fire-and-forget 且只适合用户管理操作，不能作为关键 Agent 审计权威源。

## 2. 三类记录分离

| 类型     | 用途          | 内容                                         | 存储               |
| -------- | ------------- | -------------------------------------------- | ------------------ |
| 运行日志 | 排障          | 脱敏错误、阶段、latency、内部 ID             | Logger/日志聚合    |
| Metrics  | SLO/告警/容量 | counter/histogram/gauge，无高基数 ID label   | Prometheus/Grafana |
| 业务审计 | 可追溯/复现   | Run、Tool、Model、引用、版本、权限决策、成本 | PostgreSQL 权威表  |

日志和 Metrics 丢失不能让业务审计不可恢复；审计写失败时关键 Tool/Model 状态不能继续伪装成功。

## 3. Trace 传播

新增 OpenTelemetry，根 trace 从 HTTP `messages/send` 开始，经 Outbox、BullMQ、Worker、Orchestrator、Tool、Prisma、Model Provider、Search 和 Notification 延续：

```text
HTTP agent.messages.send
└─ db.transaction
└─ outbox.dispatch
   └─ bullmq.agent-execution
      └─ agent.run
         ├─ workflow.node
         ├─ tool.call
         │  └─ domain.facade / db.query
         ├─ model.call
         │  └─ provider.http
         └─ citation.verify
```

- Outbox/queue metadata 保存 W3C trace context；敏感正文不进入 baggage。
- Worker 启动节点时创建 AsyncLocalStorage context，填 traceId、runId、userId；完成后正确释放，防 job 间串数据。
- retry 创建 child span 并带 attempt；Provider fallback 是新的 model.call span。
- span attribute 只放 workflow/model/tool key、status、attempt、token/rowCount/truncated，不放 Prompt、SQL、URL query secret、持仓或用户输入全文。
- traceId 写入 [SSE 事件](../api/sse-events.md)和审计记录，用户可用它报障，但不能据此读取其他用户数据。

## 4. Metrics

新增 metric provider 到 `src/apps/agent/observability/agent-metrics.module.ts`，建议名称：

| 指标                                | 类型      | 低基数 labels                       |
| ----------------------------------- | --------- | ----------------------------------- |
| `agent_run_total`                   | Counter   | workflow,status,trigger             |
| `agent_run_duration_seconds`        | Histogram | workflow,status                     |
| `agent_first_event_seconds`         | Histogram | workflow                            |
| `agent_time_to_first_token_seconds` | Histogram | provider,model_group                |
| `agent_tool_call_total`             | Counter   | tool,status,error_category          |
| `agent_tool_duration_seconds`       | Histogram | tool,status                         |
| `agent_tool_result_rows`            | Histogram | tool,truncated                      |
| `agent_model_call_total`            | Counter   | provider,model_group,purpose,status |
| `agent_model_tokens_total`          | Counter   | provider,model_group,direction      |
| `agent_model_cost_cny_total`        | Counter   | provider,model_group,estimated      |
| `agent_search_total`                | Counter   | provider,status                     |
| `agent_citation_verification_total` | Counter   | source_type,status                  |
| `agent_queue_wait_seconds`          | Histogram | queue                               |
| `agent_schedule_execution_total`    | Counter   | workflow,status                     |
| `agent_notification_delivery_total` | Counter   | channel,status                      |
| `agent_recovery_total`              | Counter   | recovery_point,outcome              |

禁止 userId、conversationId、runId、toolCallId、URL、股票代码或原始错误作为 label；它们只放日志/trace。`QueueMetricsService` 扩展为采集所有显式队列或按 queue registry 采集，不能只观察 backtesting。

## 5. 结构化日志

所有 Agent 模块统一字段：`traceId/runId/conversationId/stepKey/toolCallId/modelCallId/userIdHash/workflow/version/component/status/durationMs/attempt/errorCategory`。userId 如运维确需关联，使用受控字段或稳定 hash；公共日志不写账号、Prompt、消息正文、完整 Tool input/output、网页正文、API key、Cookie/Token、持仓明细。

`src/lifecycle/interceptors/logging.interceptor.ts` 当前敏感字段列表缺 `refreshToken`、`authorization`、`apiKey`、`clientSecret`、`webhookSecret` 等，且只做精确大小写匹配。Agent 上线前改为递归、大小写不敏感、模式化 redact，并对 `/api/agent/messages/send` 默认不记录 body。

模型/Tool 失败日志记录安全类别与 provider request ID hash；原始 provider response 只在严格访问控制、短保留的诊断存储按需启用。

## 6. SLO 与告警

先建立基线再固化数值目标；至少维护：

- Run 成功率/取消率/超时率，按 workflow 与触发类型。
- API 到首事件、首 Token、总耗时的 p50/p95/p99。
- Tool/模型/搜索成功率与延迟，Provider fallback/circuit open 频率。
- 队列等待/深度/active/stalled/failed、Outbox oldest age、过期 lease。
- 数据 freshness、引用验证率、通知成功率、schedule lateness。
- token/成本按用户额度聚合（数据库报表，不作 Prometheus user label）。

告警至少覆盖：连续 Run 失败、无可用模型、Tool 权限异常激增、Agent queue backlog、Outbox 卡住、scheduler 双执行/长时间无 claim、数据 stale、引用验证下降、通知渠道失败、成本突增和 PostgreSQL/Redis readiness。业务异常改用真实 HTTP 状态后，HTTP error 指标才可用于 SLO。

数据 freshness 指标不能只消费现有同步 SUCCESS/`checkTimeliness()`：当前 retry、空响应、部分失败和时效天数均有已确认误判。指标采集需要同时展示 target watermark、实际行覆盖、校验和、quality rule version 与 `PARTIAL/FAILED`，否则 Grafana 会把错误数据显示为健康。

## 7. 评测系统

离线评测集按真实业务场景版本化：单股概览、财报时点、估值分位、行情复权、组合权限、回测解释、新闻时效、冲突来源和 Tool 失败。每条样例包含输入、允许 Tool、期望事实/引用、禁止断言、数据 snapshot 和评分器版本。

指标：

- Tool 选择/参数正确率、事实准确率、数值一致率、citation precision/coverage、data cutoff 正确率。
- 幻觉率、无来源事实率、过度确定性、事实/程序计算/观点/推断分级正确率。
- 多模型回归、一致性和 fallback 行为；不是要求不同模型文字一致。
- 回测可复现率、前视/幸存者偏差检测、单位/scale 错误率。
- Prompt Injection 防护、租户越权和敏感数据泄漏。
- 成本、token、首 Token 和总时延。

线上抽样评测只使用脱敏数据；LLM-as-judge 不能作为唯一正确性判定，金融数字、日期、引用和权限使用程序评分器。

## 8. Health 与 readiness

- API readiness：PostgreSQL、必要 Redis 连接和配置可用；不因单个可选 Provider 暂时失败而完全下线状态查询。
- Agent Worker readiness：数据库、`agent-execution` Redis、至少一个允许的主/降级 Provider 配置和 Tool Registry 启动校验通过。
- Scheduler readiness：数据库、租约 Redis、队列与交易日历可读。
- Notification Worker readiness：队列和至少站内 Adapter 可用；各外部渠道单独 health。

不要让 health probe 调用付费模型/搜索。Provider 使用轻量配置检查、被动指标和低频受控探测。

## 9. 文件落点

新增：

```text
src/config/telemetry.config.ts
src/apps/agent/observability/agent-metrics.module.ts
src/apps/agent/observability/agent-metrics.service.ts
src/apps/agent/observability/agent-tracing.service.ts
src/apps/agent/observability/agent-audit.service.ts
src/apps/agent/observability/redaction.service.ts
src/apps/agent/observability/evaluation.service.ts
src/apps/agent/observability/evaluation-datasets/mvp-regression.v1.json
```

修改：

- `src/shared/context/request-context.service.ts`：支持 Worker 上下文并增加 run identifiers。
- `src/shared/logger/logger.service.ts`、`src/lifecycle/interceptors/logging.interceptor.ts`：结构化字段与统一 redact。
- `src/shared/metrics/metrics.module.ts`、`src/queue/queue-metrics.service.ts`：Agent 指标和全部队列。
- `src/shared/health/health.module.ts`：按运行角色提供 readiness indicator。
- `src/main.ts` 和 Worker bootstrap：初始化/flush tracing，优雅关闭。

## 10. 测试与验收

```text
src/apps/agent/test/observability/agent-metrics.spec.ts
src/apps/agent/test/observability/agent-tracing.integration.spec.ts
src/apps/agent/test/observability/redaction.spec.ts
src/apps/agent/test/observability/agent-audit.integration.spec.ts
src/apps/agent/test/evaluation/agent-regression.spec.ts
```

验证 HTTP→BullMQ→Worker trace 连续、并发 job context 不串、retry/fallback spans、指标 label 无高基数、成本只结算一次、所有敏感字段/大小写/嵌套 redact、审计失败阻断关键终态、Prometheus 抓取与 readiness。故障注入覆盖 DB/Redis/Provider/Search/Notification 失败和 Worker 强制退出。
