---
batch: 24
status: pending
type: backend
depends_on: ["batch-009-deterministic-quant-tools", "batch-012-agent-bullmq-worker", "batch-018-mvp-e2e-and-model-regression"]
blocks: []
parallel_with: ["batch-019-conversation-summary-and-memory", "batch-020-scheduled-agent-tasks", "batch-021-outbound-notification-channels", "batch-022-research-report-and-investment-journal", "batch-023-multi-provider-routing-and-fallback", "batch-025-ai-observability-cost-and-evaluation", "batch-029-backtest-bias-and-adjustment-remediation"]
recommended_executor: general-coding-agent
recommended_reasoning_level: very-high
estimated_scope: large
---

# Batch 024：无状态 Python 量化计算服务

## 1. 批次目标

仅在性能/库依赖门禁被证实后，将选定 CPU 密集计算拆到无状态 Python 服务；NestJS 仍负责数据、权限、队列、状态和审计。

## 2. 业务价值

在需要 NumPy/Pandas/优化器或独立资源隔离时提升吞吐，不复制主数据库口径或变成第二套 Agent。

## 3. 前置依赖

- Batch 009 确定性 TS 口径作为 golden baseline。
- Batch 012 queue。
- Batch 018 性能基线证明拆分阈值；需 ADR-003 复审批准。

## 4. 执行范围

- benchmark 选定 1–2 个计算，不全量迁移。
- 新建独立 service contract、容器、资源限制、Nest client/circuit。
- 输入快照/hash、算法/代码版本、结果 hash 和 TS/Python 差分测试。

## 5. 不在本批次范围内

- Python 不连主库、不做鉴权/会话/Agent 编排。
- 不执行用户/模型代码，不开放任意 notebook。
- 门禁未达到则记录“不实施”评审结果，不创建长期服务。

## 6. 涉及的现有文件

- `../data-service` 仅作算法参考，禁止直接部署/接入
- Batch 009 quant pure functions
- Docker/Compose、Agent worker

## 7. 需要新增的文件

- `services/quant-compute/pyproject.toml`
- `services/quant-compute/src/quant_compute/main.py`、`contracts.py`、`algorithms/`
- `services/quant-compute/tests/`
- `dockerfiles/quant-compute/Dockerfile`
- `src/apps/agent/quant/python-quant-compute.client.ts`
- `src/apps/agent/quant/test/python-quant-contract.spec.ts`

## 8. 需要修改的文件

- Docker Compose 增 optional quant-compute
- Agent quant adapter 按 capability/threshold 路由
- `.env.example`/CI 增 Python test job

## 9. 数据库变更

不新增 Python 数据库。计算 artifact 仍由 NestJS 写 AiToolCall/AiAgentStep；输入大对象通过有时效 object ref 或请求体，Python 不保存用户数据。

## 10. API 变更

内部 HTTP/gRPC（本批次选择一种）只绑定私网；固定 `/v1/calculations/execute`/health contract，不暴露给 Web 用户。

## 11. 后端实现任务

- NestJS 从 Facade 取 point-in-time 输入，生成 inputHash 并调用 Python。
- Python 校验 schema/size/version，纯函数计算，返回 outputHash/runtime/warnings。
- timeout/cancel/circuit；失败可在规模允许时回退 TS 实现。

## 12. 前端实现任务

不涉及。

## 13. Tool 或工作流变更

Tool key 不变，adapter 内部实现切换不影响模型 schema。

## 14. 详细执行步骤

- 用 Batch 018 数据测 CPU/内存/event-loop/成本，记录是否达到门禁。
- 批准后选择计算 contract 与 algorithm version。
- 实现 Python service/container/tests 和 Nest client。
- 建立 TS/Python 同 fixture 差分、取消、超时、进程崩溃。
- 以 feature flag shadow/小流量灰度，不直接全切。

## 15. 核心数据结构

- `CalculationRequest { type, algorithmVersion, inputHash, datasetVersion, parameters, data|dataRef }`。
- `CalculationResponse { output, outputHash, codeVersion, runtimeMs, warnings }`。

## 16. 关键接口定义

- `QuantComputePort.execute(request, signal)`；TS 与 Python adapters 实现同一接口。

## 17. 配置和环境变量

- `QUANT_COMPUTE_ENABLED`、`QUANT_COMPUTE_URL`、`QUANT_COMPUTE_TIMEOUT_MS`、内部 mTLS/token、CPU/内存限制。

## 18. 异常和边缘场景

- 浮点/排序/NaN 差异、Python worker OOM、取消未生效、dataRef 过期、版本不支持、网络分区、结果过大。

## 19. 安全要求

- 只读 rootfs、nonroot、无 Docker socket、无主库凭据、出网默认关闭、请求签名/mTLS、资源/时间限制。

## 20. 日志和可观测性要求

- 计算 type/version/points/runtime/memory/status/fallback/diff；不记录输入数据。
- OpenTelemetry trace context 从 Nest 传播。

## 21. 测试要求

- Python unit/property、contract、TS/Python golden diff、fuzz size、timeout/cancel/OOM。
- 容器扫描和无主库/无出网验证。

## 22. 执行命令

- `pnpm test -- src/apps/agent/quant/test/python-quant-contract.spec.ts`
- `pytest services/quant-compute/tests`
- `docker build -f dockerfiles/quant-compute/Dockerfile .`
- `pnpm run build`

## 23. 验收标准

- 若实施：同算法/version 在容差内与 TS golden 一致，性能门禁改善且故障可回退。
- Python 无主库/用户代码/公网入口。
- 若不实施：评审证据和 ADR 复审结论合入，Batch 标记 deferred 而非创建空服务。

## 24. 完成定义

门禁报告；若批准则 service/client/container/contracts/diff/security/灰度测试全完成。

## 25. 回滚方案

关闭 `QUANT_COMPUTE_ENABLED` 回到 TS；停止容器。计算审计保留，未改 Tool/API。

## 26. 后续批次

- 按实际 workload 扩展算法，仍逐项 golden gate。
- Batch 026 纳入生产资源/网络策略（若启用）。
