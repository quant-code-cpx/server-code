---
batch: 28
status: pending
type: backend
depends_on: ["batch-006-tool-registry-and-policy", "batch-025-ai-observability-cost-and-evaluation", "batch-026-security-hardening-and-production-deployment"]
blocks: []
parallel_with: ["batch-027-vector-retrieval-pilot", "batch-029-backtest-bias-and-adjustment-remediation"]
recommended_executor: general-coding-agent
recommended_reasoning_level: very-high
estimated_scope: large
---

# Batch 028：受控只读 SQL Explorer 试点

## 1. 批次目标

仅在固定 Tool 无法覆盖且评测证明有价值时，试点 AST 白名单的只读 SQL Explorer；运行于只读副本/专用 role，绝不让模型直连主库。

## 2. 业务价值

为少量长尾分析提供受控灵活性，同时把 SQL 注入、全表扫描、数据泄漏和主库风险限定在可证明边界。

## 3. 前置依赖

- Batch 006 Tool Policy。
- Batch 025 评测/观测。
- Batch 026 生产最小权限/网络/副本基础。

## 4. 执行范围

- 先收集无法由固定 Tool 回答的 approved queries，并尝试新增固定 Tool。
- 若仍需，定义语义 query plan→服务端 SQL builder/AST validator。
- 专用 read-only DB、statement/lock timeout、row/byte/cost limit、EXPLAIN gate、审计。
- 管理员/受信研究模式 feature flag；默认不向普通 Agent 注册。

## 5. 不在本批次范围内

- 不执行模型原始 SQL。
- 不写主库、不调用函数/扩展/系统表、不接受 DDL/DML/multi-statement。
- 不替代 Batch 007–010 固定 Tool。

## 6. 涉及的现有文件

- `src/shared/prisma.service.ts` 与现有 `$queryRawUnsafe` 仅作风险证据，不复用 unsafe 路径
- Batch 006 registry/policy
- PostgreSQL read replica/role 需 Batch 026 提供

## 7. 需要新增的文件

- `src/apps/agent/sql-explorer/query-plan.schema.ts`
- `sql-builder.service.ts`、`sql-ast-policy.service.ts`、`sql-explorer.service.ts`
- `src/apps/agent/sql-explorer/test/sql-explorer.security.spec.ts`
- `docs/agent/decisions/adr-011-controlled-sql-pilot-result.md`

## 8. 需要修改的文件

- Agent Tool registry 可选注册 `query_financial_dataset_v1`（仅批准模式；不称任意 SQL）
- DB config 增 read-only DSN
- evaluation dataset 增长尾 query cases

## 9. 数据库变更

不改业务 schema。创建专用只读 role/副本 grants，只能访问 approved views；必要时新建显式 `agent_read_*` views 通过独立 migration。transaction `READ ONLY`，statement/lock/idle timeout。

## 10. API 变更

不新增普通 API；管理员 feature/policy 管理走受审计配置，不接受 SQL 字符串。

## 11. 后端实现任务

- 模型输出结构化 QueryPlan（dataset、dimensions、metrics、filters、group/order/limit）。
- builder 只从 catalog 映射标识符；AST 二次验证 select-only/no subquery/function allowlist/no comments。
- 先 EXPLAIN 检查 cost/rows，再执行；结果统一 Tool provenance/truncated。

## 12. 前端实现任务

不涉及；结果仍按 Table/Chart schema 展示。

## 13. Tool 或工作流变更

- 条件 Tool 默认 disabled、ADMIN/approvedScope、READ、maxRows 1000、不可自动重试大查询。
- 每次记录 plan/hash/generatedSqlHash/explain/result rows，不把 SQL 返回模型。

## 14. 详细执行步骤

- 用评测证明固定 Tool gap，并记录为何不能新增专用 Tool。
- 建立 Dataset Catalog/approved views/QueryPlan schema。
- 实现 builder+parser/AST policy+EXPLAIN gate。
- 配置独立 read-only connection/role/timeouts。
- 用 SQL injection/CTE/subquery/function/system catalog/comment/DoS fixtures 攻击测试。
- 只在隔离环境评测后写 ADR go/no-go。

## 15. 核心数据结构

- `DatasetCatalogEntry`、`QueryPlan`、`ValidatedQuery { sqlHash, params, explainCost }`。
- 标识符永远来自 catalog，值永远 parameterized。

## 16. 关键接口定义

- `SqlExplorer.execute(context, queryPlan, signal)`
- `SqlAstPolicy.validate(ast, catalog)`
- `QueryCostGuard.check(explainJson)`

## 17. 配置和环境变量

- `AGENT_SQL_EXPLORER_ENABLED=false`、专用 `AGENT_READONLY_DATABASE_URL`、statement/lock timeout、max cost/rows/bytes。

## 18. 异常和边缘场景

- WITH/recursive、UNION、subquery、volatile function、pg_sleep、JSON path、regex DoS、巨大 sort、空 filter、transaction escape、replica lag。

## 19. 安全要求

- 主库凭据和 PrismaService 不注入；DB role 无 write/create/temp/function execute，网络只通副本。
- 普通用户/模型不能打开 feature flag；每个 dataset 仍实施 tenant/row policy。

## 20. 日志和可观测性要求

- approval/deny reason、explain cost/rows/runtime/timeout/replica lag；不记录值/完整 SQL，仅 hash+template key。

## 21. 测试要求

- parser fuzz、SQLi/DoS/privilege escape、read-only role integration、tenant leakage。
- 固定 Tool vs explorer 事实/成本/延迟评测。

## 22. 执行命令

- `pnpm test -- src/apps/agent/sql-explorer/test/sql-explorer.security.spec.ts`
- `pnpm run eval:agent -- --suite=sql-explorer`
- 在隔离只读库执行 privilege test

## 23. 验收标准

- 模型原始字符串无法进入 DB driver；所有标识符 allowlist、值 parameterized。
- 写/系统表/高成本/跨租户攻击 100% 拒绝。
- 若价值未显著超过新增固定 Tool，ADR 必须 no-go 并保持 disabled。

## 24. 完成定义

gap 证据、catalog/policy/安全测试/ADR；只有 go 才部署只读 role/views 和条件 Tool。

## 25. 回滚方案

立即关闭 flag/撤销 role 网络和 grants；删除 approved views 前确认无依赖。固定 Tool 不受影响。

## 26. 后续批次

- 每增加 dataset/metric 都需独立 catalog review 和攻击回归；禁止逐步演化为任意 Text-to-SQL。
