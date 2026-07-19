# Agent 数据库方案

## 1. 定位

本目录定义 AI Agent 对现有 PostgreSQL/Prisma 数据资产的复用方式、已确认缺陷、新增持久化模型、索引与血缘。PostgreSQL 是会话、Run、审计、来源、调度和通知状态的权威源；Redis/BullMQ 只承载投递、租约和短期缓存。

基线日期为 2026-07-19。当前 Prisma 共 111 个 Model；运行库有 111 张对应业务表，另有 `_prisma_migrations`。数据库 41 GB、332 个索引、22 个外键、0 张分区表。精确行数与 `pg_class` 估算必须分开解释。

## 2. 文档导航

- [现有 Schema 分析](./existing-schema-analysis.md)：111 个 Model、迁移、主键、唯一键、外键、日期与数据质量风险。
- [拟议 Schema 变更](./proposed-schema-changes.md)：Agent 会话、Run、Tool、引用、报告、记忆、调度、通知、版本与 Outbox 模型。
- [索引与性能](./indexes-and-performance.md)：41 GB 现状、索引设计、统计信息、分区、查询预算和验收基线。
- [数据血缘](./data-lineage.md)：从 Tushare/Web 到 Tool、Citation、Message、Report 的可追溯链。
- [数据能力盘点](../overview/data-capability-inventory.md)：按数据域列出真实 Prisma Model、表、来源、频率、量级、查询和 canonical Tool。
- [后端数据库设计](../backend/database-design.md)：Repository、事务、状态机、Outbox、租约和模块接线。

相关上层约束：

- [总体架构](../overview/architecture-overview.md)
- [金融数据服务边界](../backend/financial-data-service.md)
- [Tool 方案](../tools/README.md)
- [ADR-004：Tool 数据访问控制](../decisions/adr-004-tool-access-control.md)
- [ADR-007：向量数据库必要性](../decisions/adr-007-vector-database-necessity.md)

## 3. 必须先关闭的上线门禁

1. 修复 migration 链缺少 10 张表 `CREATE TABLE`，在空库执行完整 `migrate deploy`。
2. 修复并回填周/月线 `pct_chg` 100 倍单位错配。
3. 修复个股图表前复权公式 `latestAdj/factor` 反向问题。
4. 为财报查询建立 `asOf/availableAt` 语义，禁止按报告期直接使用尚未公告数据。
5. 清理 Dividend 16,260 条确认重复并增加自然唯一键。
6. 重试改为精确分片执行；目标分片无行不能标成功。
7. 空上游响应不能删除旧数据；部分失败不能记录 SUCCESS。
8. 关键千万级 Tool 查询完成 `EXPLAIN (ANALYZE, BUFFERS)`、超时和返回上限验收。
9. Agent 新表只通过显式 migration 上线，禁止生产 `db push`。

## 4. 核心不变量

- 模型无 Prisma、SQL、Tushare 管理端或任意网络句柄。
- Agent Tool 仅依赖 owner-scoped 领域 Facade；`userId` 来自认证上下文。
- 金融事实携带 `source`、`asOf`、`availableAt`、`timezone`、`unit`、`adjustment`、`dataVersion` 和质量告警。
- 交易日用 PostgreSQL `date`；事件、审计、租约、调度时间用 `timestamptz`；市场时区显式保存为 IANA 名称。
- 消息、事件、Tool/Model 审计采用 append-first；不保存 hidden chain-of-thought。
- 发布后的 Prompt/Workflow 版本不可修改；Run 固定引用版本。
- Redis 丢失后，Run 状态、事件重放、调度执行与通知投递仍能从 PostgreSQL恢复。
- MVP 不安装 pgvector；先用结构化条件、PostgreSQL 全文/关键词与明确评测。

## 5. 迁移原则

- 每批次一个可审计 migration，顺序见[拟议 Schema 变更](./proposed-schema-changes.md#12-迁移顺序与验证)。
- migration 账号、API/Worker 账号、未来只读分析账号分离。
- 先修现有基线，再建 Agent 表；不能让 Agent migration 掩盖旧链缺口。
- 生产只执行 `prisma generate` + `prisma migrate deploy`；空库、现有库副本、回滚演练三条路径都要验证。
