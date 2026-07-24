---
batch: 18
status: completed
type: testing
depends_on:
  [
    'batch-000-platform-data-readiness',
    'batch-011-agent-orchestrator-workflow',
    'batch-012-agent-bullmq-worker',
    'batch-013-conversation-rest-api',
    'batch-014-post-sse-stream-and-replay',
    'batch-015-frontend-stream-client-and-contracts',
    'batch-016-frontend-chat-shell',
    'batch-017-frontend-rich-response-blocks',
  ]
blocks:
  [
    'batch-019-conversation-summary-and-memory',
    'batch-020-scheduled-agent-tasks',
    'batch-023-multi-provider-routing-and-fallback',
    'batch-024-python-quant-compute-service',
    'batch-025-ai-observability-cost-and-evaluation',
    'batch-026-security-hardening-and-production-deployment',
    'batch-029-backtest-bias-and-adjustment-remediation',
  ]
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

完成证据（2026-07-21）：

- 已按全新业务黑盒方法完成测试设计，未用现有 spec 或实现反推期望。
- 测试方案：`docs/design/智能体MVP端到端测试方案-20260720.md`。
- 已冻结并完成 51 个跨 BIZ/EDGE/ERR/SEC/DATA/RACE/PERF/LOAD/STRESS/E2E/REG 场景，并为 15 个 MVP Tool 建立成功与权限/边界失败门禁。
- 已建立隔离 fresh DB、完整 migration、真实 HTTP/Repository/Workflow/inline Worker/POST-SSE、fake model 与固定 Tool harness。
- 服务端当前：Agent unit/contract 193/193、PERF 指标单元 3/3、Agent/Queue 单元 222/222、模型取消审计单元 2/2、15 Tool 统一矩阵 16/16、Tool/adapter 定向回归 67/67、DB integration 22/22、Redis integration 2/2、MVP E2E 19/19、金融 golden 6/6、模型 regression 3/3、TypeScript 与 production build 通过。
- 前端当前：全量 Vitest 509/509、fixture Agent Playwright 7/7、真实后端 Playwright 3/3、OpenAPI 漂移检查和 production build 通过。
- 旧业务 E2E 已恢复 6/6、21/21 通过：认证 3、预警信号 5、组合风控 3、回测导入组合 3、策略回测 4、因子策略回测 3；使用临时 PostgreSQL 16/Redis 7、完整 migration 与真实 BullMQ Worker，并已加入 CI gate。
- Flow 2 首轮发现净值接口返回账户权益金额而非归一化 NAV；已修复 API 输出并补单测，Flow 2 E2E 4/4、相关单测 25/25、TypeScript 与 production build 通过。
- Flow 4 修复指数 universe 丢失、因子 rotation 越池选股、非法 universe 未拒绝三项问题；Flow 4 E2E 3/3、Flow 2+4 联合 7/7、相关单测 36/36、Factor API 68/68、TypeScript 与 production build 通过。
- Flow 6 修复价格扫描重复/并发写、Prisma `upsert` 竞态、显式交易日落到 UTC 前一日、首次激活被 NULL 查询漏掉四项问题；Flow 6 E2E 5/5、相关单测 39/39、六条联合回归 21/21、Prisma validate、TypeScript 与 production build 通过。
- PERF/LOAD baseline 3/3 通过：REST create/send/status 各 100 次，100 事件 replay ×20，1/5/10 Run 阶梯；0 错误、0 gap、0 跨流、0 活跃 Run、0 待投递 Outbox；显式 gate 模式 3/3 通过。
- STRESS 已验证 Token 预算 `6018`、Tool 次数 `6019`、SSE 第 4 连接 429、释放后重连和数据一致性；独立 1/1 为 448 ms，完整 fresh-DB E2E 19/19 中该场景 198 ms；修复 Tool 超预算误报 `6021` 的错误分类。
- 外部数据安全链 3/3 通过：官方公告仅引用 `FETCHED` source；搜索连续两次 TIMEOUT 后内部回答仍完成；恶意网页不触发禁用 Tool、不泄露 canary，Prompt Injection warning 可见并审计。
- 已修无取消原因导致 `agent.cancelled` SSE 终态丢失、Inline queue Outbox 假残留、PLAN 无法传递前序 Tool 运行结果、搜索摘要可被引用、持久 `model.delta`、Tool/Model/Citation 事件缺失、同事务 sequence、FAILED/CANCELLED assistant 终态、并发 E2E harness、`resolve_security` strict output 泄漏、财务 provenance date-time、Redis 错误凭据泄漏、Worker crash 后 ModelCall 恢复、取消旧 `statusVersion` 冲突重试和 ModelCall 取消审计终态。
- 全仓 ESLint 边界已建立：`src/test/scripts` 共 760 文件进入真实 parser，冻结 297 个“文件 + ruleId + severity”历史分组（1168 error/530 warning）；比较器单元 3/3、当前快照通过，临时新 warning 会精确失败；CI 已移除 `continue-on-error`。
- 执行证据：`docs/智能体MVP端到端测试执行报告-20260720.md`。
- 最终放行审计结论为 GO；正式模型/费用上限与生产时延、吞吐、成本 SLO 不阻塞 fake-provider MVP，分别转交 Batch 025/026。
- 实现 commit/PR：当前工作树未创建独立 commit/PR，由用户统一提交；本节已记录实际验证命令、结果和证据路径，未以状态替代证据。

## 25. 回滚方案

回滚测试/CI 配置不改变业务数据；不得为让 CI 绿而降低安全/金融断言。若功能不达标，关闭 Agent feature flag。

## 26. 后续批次

- Batch 019–026 在此基线上扩展。
- Batch 029 修复后更新回测 bias golden case。
