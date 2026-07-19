---
batch: 25
status: pending
type: backend
depends_on: ["batch-004-model-gateway-foundation", "batch-005-run-state-and-event-store", "batch-006-tool-registry-and-policy", "batch-010-web-search-and-citations", "batch-012-agent-bullmq-worker", "batch-014-post-sse-stream-and-replay", "batch-018-mvp-e2e-and-model-regression"]
blocks: ["batch-026-security-hardening-and-production-deployment", "batch-027-vector-retrieval-pilot", "batch-028-controlled-sql-explorer"]
parallel_with: ["batch-019-conversation-summary-and-memory", "batch-020-scheduled-agent-tasks", "batch-021-outbound-notification-channels", "batch-022-research-report-and-investment-journal", "batch-023-multi-provider-routing-and-fallback", "batch-024-python-quant-compute-service", "batch-029-backtest-bias-and-adjustment-remediation"]
recommended_executor: general-coding-agent
recommended_reasoning_level: very-high
estimated_scope: large
---

# Batch 025：AI 可观测性、成本与评测平台

## 1. 批次目标

把 Run/Step/Tool/模型/搜索/SSE/任务/通知的指标、结构化 trace、成本聚合和持续评测接入现有 Prometheus/Grafana/日志体系。

## 2. 业务价值

能回答“哪里慢、哪里错、花多少钱、数据多旧、引用是否可靠”，并用门禁阻止质量回退。

## 3. 前置依赖

- Batch 004/005/006/010/012/014/018 的埋点和基线。

## 4. 执行范围

- Agent metrics providers、OpenTelemetry traces、Grafana dashboard/alerts。
- 成本/usage 聚合、预算告警、评测 runner 与 dataset/version。
- 日志脱敏和高基数控制，Run trace explorer 的后端查询（管理员）。

## 5. 不在本批次范围内

- 不采购具体 SaaS tracing 平台。
- 不记录完整 prompt/持仓/网页正文。
- 不把 LLM judge 当唯一事实准确率判定。

## 6. 涉及的现有文件

- `src/shared/logger/`、`src/shared/metrics/`、`src/shared/context/`
- Prometheus/Grafana Compose/config
- Batch 018 regression runner
- Batch 003 Model/Tool audit

## 7. 需要新增的文件

- `src/apps/agent/observability/agent-metrics.provider.ts`
- `agent-tracing.service.ts`、`agent-cost.service.ts`、`evaluation.service.ts`
- `src/apps/agent/observability/test/agent-observability.spec.ts`
- `monitoring/grafana/dashboards/agent-overview.json`
- `monitoring/prometheus/agent-alerts.yml`
- `test/agent/evaluation-datasets/`

## 8. 需要修改的文件

- existing metrics module 注册 Agent collectors
- logger sanitizer/ALS trace propagation 到 BullMQ/provider
- Prometheus/Grafana provisioning
- CI 增 regression threshold job

## 9. 数据库变更

优先聚合 Batch 003/005 表；可新增 `AiEvaluationRun/AiEvaluationResult` migration，含 dataset/prompt/workflow/model versions、scores、artifact ref。高频 metrics 不写业务表。

## 10. API 变更

可新增管理员 POST `/api/agent/admin/evaluations/run/status/detail`，受 ADMIN 角色；普通用户不见跨用户成本/trace。

## 11. 后端实现任务

- 标准 spans：HTTP→enqueue→worker→node→model/tool/search→persist/stream。
- metrics 控制 label，不用 userId/runId 作为 Prometheus label。
- 成本以 provider usage+版本化价格表计算，未知明确标记。
- 评测混合 deterministic facts、citation checker、Tool trace matcher 和受限 judge。

## 12. 前端实现任务

可在管理员页面后续接 dashboard；本批次以 Grafana 为主要可视化。

## 13. Tool 或工作流变更

每 Tool 指标成功/失败/拒绝/时延/数据新鲜度/结果量；不能从模型文本猜调用成功。

## 14. 详细执行步骤

- 定义指标字典/SLO/label cardinality/数据分类。
- 接 ALS/BullMQ trace propagation 和 provider/tool spans。
- 实现 usage/cost 聚合与预算告警。
- 构建 Grafana dashboard/Prom alerts。
- 把 Batch 018 dataset 版本化，加入事实/引用/幻觉/成本/可复现评分。
- 做 load/cardinality/log secret tests 和 runbook。

## 15. 核心数据结构

- 指标覆盖用户要求的模型/Tool/Agent 成功率、TTFT、成本/token/cache、查询耗时、搜索命中、引用/事实/幻觉、时效、任务/通知、回测复现。
- `EvaluationRun/Result` 绑定所有版本和 case hash。

## 16. 关键接口定义

- `AgentMetrics.observe*` typed methods
- `AgentTracing.startNodeSpan`
- `AgentCostService.calculate(usage, priceVersion)`
- `EvaluationService.run(datasetVersion, policy)`

## 17. 配置和环境变量

- OTEL endpoint/service/sample rate、price catalog version、evaluation budget、alert thresholds；生产 secret 不在 dashboard。

## 18. 异常和边缘场景

- provider usage 缺失/延迟、stream 未 finish、trace 采样、价格变化、重复 attempt、metrics label 爆炸、judge 波动、定时评测费用失控。

## 19. 安全要求

- trace/log payload 默认 metadata-only；PII/secret sanitizer 有单测。
- 管理员 evaluation/API 审计；数据集不用真实用户私有内容。

## 20. 日志和可观测性要求

- 本批次即交付 dashboard/alerts：error budget、queue backlog、orphan run、citation drop、cost spike、data lag、notification failure。

## 21. 测试要求

- metric names/labels/single count、trace parent across queue、cost Decimal/unknown usage。
- 高并发 cardinality、日志 secret scan、dashboard provisioning、alert rule syntax。
- 评测重复性与阈值 gate。

## 22. 执行命令

- `pnpm test -- src/apps/agent/observability/test/agent-observability.spec.ts`
- `pnpm run eval:agent -- --provider=fake --suite=mvp`
- `promtool check rules monitoring/prometheus/agent-alerts.yml`
- `pnpm run build`

## 23. 验收标准

- 一次 Run 可从 trace 定位节点/Tool/model/stream，不暴露正文。
- 成本/usage 与 audit attempts 对账，不双计；未知项可见。
- Grafana/alerts 可加载；评测回退让 CI 失败。

## 24. 完成定义

指标字典、代码埋点、OTel、成本、评测表/runner、dashboard/alerts、测试和 runbook 合入。

## 25. 回滚方案

关闭 OTel export/evaluation schedule，不移除核心审计；dashboard/alerts 可回滚版本。指标名避免破坏性重命名。

## 26. 后续批次

- Batch 026 用 SLO/告警支持生产发布。
- Batch 027/028 必须先建立专属评测门禁。
