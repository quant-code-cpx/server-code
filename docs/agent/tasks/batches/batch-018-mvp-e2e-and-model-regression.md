---
batch: 18
status: pending
type: testing
depends_on: ["batch-000-platform-data-readiness", "batch-011-agent-orchestrator-workflow", "batch-012-agent-bullmq-worker", "batch-013-conversation-rest-api", "batch-014-post-sse-stream-and-replay", "batch-015-frontend-stream-client-and-contracts", "batch-016-frontend-chat-shell", "batch-017-frontend-rich-response-blocks"]
blocks: ["batch-019-conversation-summary-and-memory", "batch-020-scheduled-agent-tasks", "batch-023-multi-provider-routing-and-fallback", "batch-024-python-quant-compute-service", "batch-025-ai-observability-cost-and-evaluation", "batch-026-security-hardening-and-production-deployment", "batch-029-backtest-bias-and-adjustment-remediation"]
parallel_with: []
recommended_executor: testing-agent
recommended_reasoning_level: very-high
estimated_scope: large
---

# Batch 018：MVP 端到端、金融口径与模型回归

## 1. 批次目标

用可重复测试证明“前端提问→Run→受控 Tool/计算/搜索→模型流→引用/会话保存”的完整闭环，并覆盖金融正确性、故障恢复、安全和成本边界。

## 2. 业务价值

MVP 只有在真实边界和失败场景中可验证，才能进入个人使用试运行；该批次也是后续功能的稳定基线。

## 3. 前置依赖

- Batch 000 数据门禁。
- Batch 011–017 后端工作流、worker、API/SSE 与前端闭环。

## 4. 执行范围

- 建立后端 E2E、前端 Playwright、模型 golden/regression 数据集。
- 覆盖普通问答、内部数据、内外融合、多 Tool、计算、取消、重连、重生成。
- 覆盖代码映射、复权/单位、财报时点、前视/幸存者提示、引用和 prompt injection。
- 建立性能/成本 smoke 与失败注入。

## 5. 不在本批次范围内

- 不修复测试发现的非 Agent 业务 bug；记录并阻断对应 gate。
- 不做全生产压力容量证明；Batch 025/026 深化。
- 不以模型措辞逐字相等作为唯一断言。

## 6. 涉及的现有文件

- 根 `test/` 的 6 个 E2E 与 fresh test
- `src/apps/**/test/`、Vitest/Jest 配置
- `../client-code/tests/`、Playwright/MSW/RTL 配置
- Batch 000–017 fixtures 与 fake providers

## 7. 需要新增的文件

- `test/agent/agent-mvp.e2e-spec.ts`
- `test/agent/fixtures/financial-golden-cases.json`
- `test/agent/fixtures/model-regression-cases.jsonl`
- `test/agent/fault-injection/agent-faults.ts`
- `../client-code/tests/e2e/agent-research.spec.ts`
- `scripts/evaluate-agent-regression.ts`
- `docs/agent/tasks/test-evidence/mvp-baseline.md`

## 8. 需要修改的文件

- CI workflow 把 Agent unit/integration/E2E 加入必过 job
- `package.json` 增加 `test:agent:e2e`/`eval:agent`
- 前端 package scripts 增加 Agent Playwright target

## 9. 数据库变更

使用隔离测试数据库，从 migration 全链创建并加载最小固定金融 fixture；测试结束删除临时 schema/database。不得对开发实库写入。

## 10. API 变更

按 `docs/agent/api/` 做 contract assertions：REST DTO、14 SSE events、sequence/replay、错误码、内容块和引用。

## 11. 后端实现任务

- 使用 fake deterministic model/search 做 CI 主链；可选真实 provider nightly 只做语义评测。
- 故障注入 Redis/worker/provider/tool/search/DB 短暂失败、cancel race、重复请求。
- 对每次 case 检查消息/Run/Step/Tool/Model/Source/Citation 审计链。

## 12. 前端实现任务

- Playwright 验证会话创建、流式进度、刷新重连、取消/重生成、表格/图/Kline/引用、错误恢复和键盘/ARIA 基线。
- MSW 提供 protocol malformed/gap/duplicate/unknown event fixtures。

## 13. Tool 或工作流变更

- 15 个 MVP Tool 各有至少一个成功和一个权限/边界失败 case；外部搜索必须有引用，确定性计算校验数值而非模型文本。

## 14. 详细执行步骤

- 定义场景 ID、输入 fixture、事实断言、禁止断言、预算和引用覆盖阈值。
- 建立 fresh DB+fake provider/search harness，跑单用户端到端。
- 增加跨租户、幂等、取消/恢复、断网/replay 和崩溃恢复。
- 增加财务公告时点、单位/复权、停牌、缺失和 backtest bias warnings。
- 前端 Playwright 用真实本地后端跑核心路径。
- 输出基线报告与 CI gates；真实模型回归独立、可重跑且不泄密。

## 15. 核心数据结构

- `RegressionCase { id, prompt, context, requiredFacts, forbiddenClaims, requiredTools, requiredCitationTypes, maxCost }`。
- `EvaluationResult { pass, factScore, citationCoverage, toolTraceMatch, latency, usage, failures }`。

## 16. 关键接口定义

- `pnpm eval:agent --provider=fake --suite=mvp`
- `evaluateCase(case, runArtifact): EvaluationResult`

## 17. 配置和环境变量

- 测试专用 `DATABASE_URL`/`AGENT_QUEUE_REDIS_URL`、`AGENT_MODEL_PROVIDER=fake`、`AGENT_SEARCH_PROVIDER=fake`。
- 真实模型 job 需 protected secrets、费用上限和手动/nightly trigger。

## 18. 异常和边缘场景

- 模型措辞变化但事实等价、流分片随机、时区跨日、无交易日、数据缺失、provider refusal、部分 Tool 失败、浏览器刷新多次。

## 19. 安全要求

- 跨租户矩阵覆盖会话/Run/Tool/组合/回测/SSE。
- prompt injection、SSRF、XSS Markdown/chart payload、日志 secret scanner 必须通过。

## 20. 日志和可观测性要求

- 测试产物保留 trace/run IDs、状态/延迟/usage/score，不保存真实 secret 或用户数据。
- 失败可从审计链重现节点而非只看截图。

## 21. 测试要求

- Unit/contract/integration/E2E/model regression/data correctness/security/fault/performance smoke 全部纳入。
- 至少 6 个现有 E2E 也进入 CI，防止 Agent 改造破坏业务。

## 22. 执行命令

- `pnpm run test:agent:e2e`
- `pnpm run eval:agent -- --provider=fake --suite=mvp`
- `pnpm run build && pnpm run lint`
- `yarn --cwd ../client-code test`
- `yarn --cwd ../client-code e2e tests/e2e/agent-research.spec.ts`

## 23. 验收标准

- MVP 完整闭环通过；断线/崩溃/cancel 无丢事件或终态回写。
- 金融 golden facts 100% 精确；引用 ID/来源/时点完整；禁止声明为零。
- 跨租户和注入测试全通过；fake suite 零外网依赖。
- 响应/成本在批准阈值内，阈值值写配置而非本文工期。

## 24. 完成定义

测试代码、fixtures、CI gates、基线报告、失败分类和复现命令合入；所有 MVP gates green。

## 25. 回滚方案

回滚测试/CI 配置不改变业务数据；不得为让 CI 绿而降低安全/金融断言。若功能不达标，关闭 Agent feature flag。

## 26. 后续批次

- Batch 019–026 在此基线上扩展。
- Batch 029 修复后更新回测 bias golden case。
