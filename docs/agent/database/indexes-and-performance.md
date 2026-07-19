# 索引与性能设计

## 1. 基线与口径

基线日期 2026-07-19。运行库 41 GB、111 张业务表、332 个索引、0 张分区表；`pg_stat_statements` 已安装，未安装 pgvector/TimescaleDB。以下精确行数来自 `COUNT`：Daily 18,002,711、DailyBasic 17,912,325、AdjFactor 18,824,105、StkFactor 18,152,124、CyqChips 27,985,453。`pg_class.reltuples` 仅是估算，当前与精确计数存在明显偏差。

Agent 上线的第一性能目标不是增加更多索引，而是固定查询形状、下推租户/日期/证券条件、限制返回量、更新统计信息并用真实参数核验执行计划。

## 2. 查询预算

| 查询类别 | 默认预算 | 强制边界 |
| --- | --- | --- |
| 证券解析/概览 | p95 300 ms | 候选 <= 20；禁止模糊全表无限返回 |
| 单证券日线 | p95 500 ms | 区间 <= 10 年或 3,000 bars；稳定 date 排序 |
| 市场单日快照 | p95 1 s | 目标交易日等值；分页 <= 5,000 行 |
| 财报/指标 | p95 800 ms | 单次证券 <= 20；报告期 <= 40；按 availableAt 过滤 |
| 自选股/组合/回测摘要 | p95 500 ms | 必须 userId/owner 条件；明细游标分页 |
| Tool 总调用 | 默认 10 s | 数据库 statement timeout 小于 Tool deadline |
| 调度扫描/Outbox | 单批 <= 1 s | 每批 100–500；`SKIP LOCKED`；短事务 |

Repository 必须设置最大日期跨度、最大证券数、最大字节和稳定游标。禁止 OFFSET 扫描深页、`SELECT *` 大表、无 tradeDate 的市场横截面和把千万行加载进 Node 后过滤。

## 3. 现有关键索引策略

### 3.1 行情、估值与因子

Daily、DailyBasic、AdjFactor、Weekly、Monthly、StkFactor 的 `(tsCode,tradeDate)` 复合主键适合单证券区间；已有 tradeDate 索引用于单日横截面。接入 Tool 前逐一执行：

```sql
EXPLAIN (ANALYZE, BUFFERS, WAL, SETTINGS)
SELECT trade_date, open, high, low, close, vol, amount
FROM stock_daily_prices
WHERE ts_code = $1 AND trade_date BETWEEN $2 AND $3
ORDER BY trade_date;
```

只有出现 heap fetch/排序/回表瓶颈并且写放大可接受时，才评估 INCLUDE 索引；不为每个输出列复制 4 GB 大表。横截面固定 `(trade_date, ts_code)` 顺序，避免仅靠 tradeDate 索引后随机排序。

建议候选，必须以执行计划决定是否落地：

- `stock_daily_prices (trade_date, ts_code) INCLUDE (close, pct_chg, vol, amount)`：市场快照高频读取。
- `stock_daily_valuation_metrics (trade_date, ts_code) INCLUDE (pe_ttm, pb, ps_ttm, total_mv, circ_mv)`：估值横截面和分位。
- `stock_adjustment_factors (ts_code, trade_date DESC) INCLUDE (adj_factor)`：截止日因子；现有 PK 可反向扫描时不重复创建。
- `index_constituent_weights (index_code, trade_date DESC, con_code)`：历史成分 as-of；当前日期为 String，先迁为 date 或建立格式验证。

### 3.2 主数据与历史股票池

`StockBasic` 主键 tsCode；证券搜索已有 symbol/name 等索引，但 `%关键词%` 不会可靠利用普通 B-tree。MVP 对代码前缀、精确名称、拼音字段采用规范化列；若确需中缀搜索，评测后安装 `pg_trgm` 并限制候选数，不在无压测时新增 GIN。

历史股票池不能用当前 `listStatus='L'`。候选索引：`stock_basic_profiles (list_date, delist_date, ts_code)`，查询条件为 `list_date <= asOf AND (delist_date IS NULL OR delist_date >= asOf)`。但当前 3 个 Daily 代码无主数据，回测门禁还需数据修复，不由索引掩盖。

### 3.3 财务报表的 point-in-time 访问

Income、BalanceSheet、Cashflow 当前按自增 id 存多版本。canonical 选择必须先过滤公告可得日，再按报告期和修订优先级选版。建议三表统一候选索引：

```text
(ts_code, report_type, ann_date DESC, end_date DESC, update_flag DESC, id DESC)
WHERE ann_date IS NOT NULL
```

若业务使用 `f_ann_date` 作为首次可得日，应先生成并回填单一 `available_at date`，再建 `(ts_code, available_at DESC, end_date DESC, id DESC)`；不能在每次查询中动态 COALESCE 字符串并期待稳定索引。

`FinaIndicator` 是 canonical `get_financial_indicators` 数据源；DailyBasic 只服务估值/概览。FinaIndicator 需要 `(ts_code, ann_date DESC, end_date DESC)` 候选索引和公告版本缺失 warning。

### 3.4 Dividend 与 nullable unique

Dividend 先按真实业务列去重 16,260 条冗余，再增加自然唯一键。自然键必须与 Tushare 真实返回核对，至少包含证券、公告/实施日期、进度、每股分红送转、登记/除权/支付日期和修订标识。nullable 列使用 PostgreSQL 15 `NULLS NOT DISTINCT` 或经评审的规范化表达式；不能依赖默认 NULL distinct。

同类问题还包括 BlockTrade buyer/seller、ShareFloat holderName。修复顺序：碰撞报告 → 上游样本确认 → canonical row 规则 → 归档重复 → unique constraint → 同步回归。禁止直接加 unique 后让 deploy 在脏数据上失败。

### 3.5 索引漂移

`20260503000003_backtest_run_strategy_id` migration 创建 `backtest_runs_strategy_id_idx`；当前 schema/实库缺该索引且没有 DROP migration。处理方式只能二选一：

1. 查询确实需要：在 Prisma `@@index([strategyId])` 恢复并用新 migration 重建；
2. 查询不需要：增加显式 DROP/说明 migration，使可重放历史与最终状态一致。

不能继续让 `db push` 或手工改库承担反向变更。

## 4. Agent 表索引

| 表 | 必需索引/约束 | 查询目的 |
| --- | --- | --- |
| `ai_conversations` | unique `(user_id,client_request_id)`；`(user_id,status,last_message_at DESC,id DESC)` | 创建幂等、会话游标 |
| `ai_messages` | unique `(conversation_id,client_request_id)`、`(parent_message_id,version)`；`(conversation_id,created_at,id)` | 消息发送/编辑幂等、顺序页 |
| `ai_agent_runs` | unique `(user_id,client_request_id)`；`(conversation_id,created_at DESC)`；partial queued lease | Run 查询与领取 |
| `ai_agent_steps` | unique `(run_id,node_key,ordinal)`；`(run_id,ordinal)` | checkpoint 恢复 |
| `ai_run_events` | unique `(run_id,sequence)`；`(run_id,created_at,id)` | SSE 断点重放 |
| `ai_tool_calls` | unique `(run_id,logical_node_key,invocation_index)`；`(run_id,started_at)` | Tool 幂等与审计 |
| `ai_model_calls` | `(run_id,started_at)`；`(provider,model,started_at)` | Run 账务和供应商统计 |
| `ai_search_sources` | unique `(canonical_url_hash,content_hash)`；`(fetched_at)` | 来源去重/清理 |
| `ai_citations` | `(message_id,id)`、`(research_report_id,id)`、source/tool FK 索引 | 答案/报告引用展开 |
| `ai_user_memories` | partial unique `(user_id,kind,key) WHERE status='ACTIVE'` | 当前记忆唯一 |
| `ai_scheduled_tasks` | partial `(next_run_at,id) WHERE status='ACTIVE'` | 到期扫描 |
| `ai_task_executions` | unique `(scheduled_task_id,scheduled_for)`；`(status,lease_expires_at,scheduled_for)` | 触发幂等/回收 |
| `ai_notification_deliveries` | 幂等 unique；partial `(next_attempt_at,id) WHERE status IN ('PENDING','FAILED')` | 投递重试 |
| `ai_outbox_events` | 聚合版本 unique；partial `(available_at,id) WHERE status IN ('PENDING','RETRY')` | Outbox 领取 |

所有 FK 列必须有索引，但先检查 unique/复合索引是否已经覆盖左前缀，避免重复。JSONB 不默认建 GIN；只有稳定、选择性足够且无法规范化的查询才增加表达式/GIN 索引。

## 5. 统计信息与维护

当前 `pg_class`/`pg_stat_user_tables` 估算陈旧，实施前先记录 `last_analyze/last_autoanalyze/n_live_tup/n_dead_tup`，对变化大的表执行受控 `ANALYZE`。建议：

- 提高大表关键列 `statistics target`，包括 tradeDate、tsCode、reportType、annDate；多列相关性明显时建立 extended statistics。
- 为 delete+insert 高频表单独调低 autovacuum analyze/vacuum scale factor，并以真实写入量计算 threshold。
- 监控 table/index bloat、dead tuples、long transaction、checkpoint、WAL 和 cache hit，不以一次 VACUUM FULL 作为常规方案。
- 上线索引前记录 top SQL；上线后比较 calls、mean/p95、shared blocks、temp blocks 和 rows。
- 每次大回填后显式 ANALYZE；统计完成前不做性能验收。

大表 rebuild、unique 验证和回填使用小批游标；避免长事务阻塞同步。`CREATE INDEX CONCURRENTLY` 不能放进事务块，生产在线索引需要独立、可恢复、可审计的 migration/runbook；空库基线仍必须由 migration 链创建最终结构。

## 6. 分区决策

当前 41 GB、0 分区并不等于必须立即重分区。优先候选是按 tradeDate 持续增长、查询天然带日期且单表达到数千万行的 Daily、DailyBasic、AdjFactor、StkFactor、OptDaily、CyqChips；Agent 的 AiRunEvent 只有在超过约 5,000 万行或 30 GB、清理成为主要瓶颈时再分区。

决策前必须比较：

1. 典型单证券长区间、单日横截面、最近 N 日扫描的计划和耗时；
2. 分区裁剪、分区数、索引总尺寸、同步 insert/delete、autovacuum 和备份恢复成本；
3. 主键/unique 是否包含分区键，Prisma CRUD 是否仍能生成正确 SQL。

若收益成立，金融时序表优先按 tradeDate 年分区；极高写入/清理表可月分区。在线迁移流程：新建 shadow partitioned table → 创建全部约束/索引 → 按日期批量复制并校验 count/min/max/checksum → 短期双写或维护窗增量追平 → 原子 rename/swap → 保留只读旧表观察 → 明确回滚点。Prisma 不表达的分区 DDL 用 raw SQL migration，Repository 仍访问相同逻辑表名。

## 7. 连接、并发与副本

- API、Agent Worker、Tushare Sync、Scheduler 使用独立数据库角色和连接池配额，防模型/同步耗尽连接。
- Worker 并发同时受 BullMQ concurrency、Tool bulkhead 和数据库池约束；不能用 Node 全局 `Promise.all` 放大查询。
- 可选只读副本只承载允许延迟的公共行情/研究查询；用户消息、Run、租约、调度、Outbox 和 owner check 仍走主库。
- 副本返回必须携带 replay lag/dataVersion；asOf 已满足但同步尚未回放时不能伪装最新。
- Redis 是缓存，不承担数据库连接熔断后的事实源。

## 8. 缓存键与失效

公共金融缓存键至少包含 Tool key/version、规范化参数、tradeDate/asOf、dataset version、adjustment、unit schema version。用户私有缓存额外包含 userId、资源 id、资源 updatedAt/version。不得只用 tsCode 作为行情缓存键，也不得跨用户缓存 Watchlist/Portfolio/Backtest。

同步成功后的失效只在实际分片校验成功后发出；当前 Tushare SUCCESS 日志会覆盖空响应/部分失败场景，不能直接驱动“最新数据”缓存。

## 9. 上线验收

每个新增/变更索引必须保存以下证据：生产规模副本上的 `EXPLAIN (ANALYZE,BUFFERS)`、基线/新计划、索引尺寸、写入影响、回滚 SQL 和慢查询变化。验收覆盖冷/热缓存、常见/极端证券、长短区间、最新/历史 asOf、并发 1/10/50、取消和 statement timeout。

P0 完成标准：

- 现有 migration 可空库重放且 schema diff 为空。
- Dividend/nullable unique 不再增长重复。
- 核心 Tool 没有顺序扫描千万级表，除非离线管理任务明确允许。
- 用户资源查询执行计划第一层包含 owner 过滤。
- RunEvent、Outbox、Schedule 并发领取不出现重复 sequence/Execution/Delivery。
- 大表统计新鲜，慢查询/锁/WAL/磁盘有告警阈值。

参见[现有 Schema 分析](./existing-schema-analysis.md)、[拟议 Schema 变更](./proposed-schema-changes.md)和[数据能力盘点](../overview/data-capability-inventory.md)。
