# 拟议 Schema 变更

## 1. 目标与边界

本方案在现有 111 个 Prisma Model 之外新增 Agent 持久化域。PostgreSQL 保存用户可见会话、Run 状态、可重放事件、Tool/Model 审计、来源与引用、报告、记忆、调度、通知投递和版本；Redis/BullMQ 只保存可重建的队列、租约与缓存。

本批次不新增向量扩展，不允许模型直连 Prisma/Tushare，也不保存 hidden chain-of-thought。`AiAgentStep` 只记录可公开的步骤类型、输入输出摘要、状态、错误和耗时。

命名约定：Prisma Model 使用 `Ai*`，数据库表统一 `ai_*`；JSON 字段使用 `jsonb`；金额和模型费用使用 `decimal(18,8)`；交易日使用 `date`；事件、审计、调度和租约时间使用 `timestamptz`。

## 2. 标识符、租户与删除策略

- 对外聚合根使用 `String @id @default(cuid()) @db.VarChar(32)`：Conversation、Message、Run、ToolCall、Report、Memory、Schedule 等。
- 高频 append 表使用 `BigInt @id @default(autoincrement())`：RunEvent、Citation、OutboxEvent、Evaluation。
- `userId` 继续引用现有 `User.id Int`。所有用户查询必须同时带 `userId`，不能仅凭子资源 id 授权。
- 会话、消息、Run、来源、引用和审计链默认 `onDelete: Restrict`；用户注销先逻辑删除/匿名化，再走显式隐私清理作业。
- 非审计型投影可 `onDelete: Cascade`，例如未发送的用户通知渠道；已投递记录不级联删除，只匿名化收件人指纹。
- 外部幂等键只保存哈希或受长度限制的字符串；API 不接受客户端指定数据库主键。

## 3. 模型总览

| Model / 表 | 主键 | 关键外键 | 主要用途 |
| --- | --- | --- | --- |
| `AiConversation` / `ai_conversations` | cuid | User | 会话聚合根、标题、归档、当前摘要 |
| `AiMessage` / `ai_messages` | cuid | Conversation、User、parent Message | 用户/助手/系统可见消息和编辑版本 |
| `AiConversationSummary` / `ai_conversation_summaries` | cuid | Conversation、covering Message | 可追溯的分段摘要，不覆盖原消息 |
| `AiAgentRun` / `ai_agent_runs` | cuid | Conversation、trigger Message、Prompt/Workflow Version | 一次可恢复执行 |
| `AiAgentStep` / `ai_agent_steps` | cuid | Run、parent Step | 公开执行 DAG/树节点 |
| `AiRunEvent` / `ai_run_events` | bigint | Run、Step | SSE 重放和状态审计 |
| `AiToolCall` / `ai_tool_calls` | cuid | Run、Step | canonical Tool 调用、输入输出摘要、数据版本 |
| `AiModelCall` / `ai_model_calls` | cuid | Run、Step、Prompt Version | 模型调用、token、成本、错误 |
| `AiSearchSource` / `ai_search_sources` | cuid | first-seen Run | Web 来源快照及去重 |
| `AiCitation` / `ai_citations` | bigint | Message/Report、Source 或 ToolCall | 答案片段到证据的定位 |
| `AiResearchReport` / `ai_research_reports` | cuid | Run、现有 Report、ResearchNote | 研究报告语义与产物映射 |
| `AiUserMemory` / `ai_user_memories` | cuid | User、source Conversation | 明示、可撤回的结构化记忆 |
| `AiScheduledTask` / `ai_scheduled_tasks` | cuid | User、Workflow Version | 时区化调度定义 |
| `AiTaskExecution` / `ai_task_executions` | cuid | Schedule、Run | 一次计划触发及幂等状态 |
| `AiNotificationChannel` / `ai_notification_channels` | cuid | User | 站内/邮件/Webhook 渠道配置 |
| `AiNotificationDelivery` / `ai_notification_deliveries` | cuid | Execution、Channel、现有 Notification | 每次投递及重试审计 |
| `AiPromptVersion` / `ai_prompt_versions` | cuid | publisher User | 不可变 Prompt 版本 |
| `AiWorkflowVersion` / `ai_workflow_versions` | cuid | publisher User | 不可变 Workflow/Tool allowlist |
| `AiOutboxEvent` / `ai_outbox_events` | bigint | 逻辑聚合 | 数据库事务到 BullMQ/通知的可靠投递 |
| `AiEvaluation` / `ai_evaluations` | bigint | Run、Message | 自动/人工质量与安全评测 |

## 4. 会话、消息与摘要

### 4.1 `AiConversation`

建议字段：

- `id`、`userId`、`title varchar(200)`、内部记录状态 `recordStatus`（`ACTIVE/ARCHIVED/DELETED`）；公共 `ConversationStatus` 只投影 `ACTIVE/ARCHIVED`，删除态不对外返回资源。
- `clientRequestId varchar(128)?`：创建幂等；unique `(userId, clientRequestId)`，NULL 不参与。
- `currentSummaryId?`：摘要生成后再回指，避免创建环形事务。
- `lastMessageAt timestamptz`、`messageCount int`、`metadata jsonb`。
- `createdAt/updatedAt/archivedAt/deletedAt timestamptz`。

索引：`(userId, status, lastMessageAt DESC, id DESC)`；归档页使用稳定游标 `(lastMessageAt,id)`。

### 4.2 `AiMessage`

建议字段：

- `id`、`conversationId`、`userId`、`role`（`USER/ASSISTANT/SYSTEM/TOOL`）、`status`（`PENDING/STREAMING/COMPLETED/FAILED/CANCELLED`）。
- `parentMessageId?`、`version int default 1`、`clientRequestId?`。
- `contentText text?`、`contentBlocks jsonb`、`attachments jsonb`、`safetyLabels jsonb`。
- `runId?`、`modelName?`、`tokenCount?`、`createdAt/updatedAt/completedAt timestamptz`。

约束：unique `(conversationId, clientRequestId)`；unique `(parentMessageId, version)`；检查 `contentText IS NOT NULL OR jsonb_array_length(contentBlocks)>0` 对完成消息成立。编辑创建新版本，不原地覆盖已完成内容。

索引：`(conversationId, createdAt, id)`、`(userId, createdAt DESC, id DESC)`；全文检索可在二期增加生成列/GIN，不进入 MVP 阻断项。

### 4.3 `AiConversationSummary`

保存 `conversationId`、`fromMessageId`、`throughMessageId`、`summaryText`、`facts jsonb`、`promptVersionId`、`sourceTokenCount`、`createdAt`。unique `(conversationId, throughMessageId, promptVersionId)`。摘要是缓存型派生物；原消息仍是事实源。

## 5. Run、Step 与事件重放

### 5.1 `AiAgentRun`

关键字段：

- `id`、`userId`、`conversationId`、`triggerMessageId`。
- `status`：`QUEUED/RUNNING/CANCEL_REQUESTED/COMPLETED/FAILED/CANCELLED`；重试从 `RUNNING` 回到 `QUEUED`，不增加公共状态。
- `statusVersion int default 1`：所有转换使用 expected version 做 CAS。
- `clientRequestId`，unique `(userId, clientRequestId)`。
- `promptVersionId`、`workflowVersionId`，Run 创建时固定，发布后版本不可变。
- `inputSnapshot jsonb`、`resultSummary jsonb`、`errorCode/errorMessage`。
- `nextEventSequence bigint default 1`、`attempt int default 0`、`maxAttempts int`。
- `leaseOwner?`、`leaseExpiresAt? timestamptz`、`heartbeatAt? timestamptz`。
- `queuedAt/startedAt/finishedAt/cancelRequestedAt/createdAt/updatedAt timestamptz`。

索引：`(conversationId, createdAt DESC)`、`(userId, status, createdAt DESC)`；可领取 Run 使用 partial index `(leaseExpiresAt, createdAt) WHERE status='QUEUED'`。

### 5.2 `AiAgentStep`

字段：`id`、`runId`、`parentStepId?`、`nodeKey varchar(128)`、`kind`（`PLAN/TOOL/MODEL/VALIDATION/WAIT/FINALIZE`）、`status`、`ordinal int`、`inputSummary jsonb`、`outputSummary jsonb`、`error*`、`startedAt/finishedAt/createdAt timestamptz`。unique `(runId,nodeKey,ordinal)`；index `(runId,ordinal)`。

`inputSummary/outputSummary` 只能存可展示的结构化摘要，不存模型私有推理文本。

### 5.3 `AiRunEvent`

字段：`id bigint`、`publicId cuid`、`runId`、`stepId?`、`sequence bigint`、`eventType varchar(64)`、`visibility`（`USER/OPERATOR/INTERNAL`）、`traceId varchar(64)`、`payload jsonb`、`createdAt timestamptz`。unique `publicId`、unique `(runId,sequence)`，index `(runId,createdAt,id)`。

追加事件时在同一事务中原子递增 `AiAgentRun.nextEventSequence`；客户端以 `(runId,sequence)` 断点重放。BullMQ job id 不能作为事件 id 或业务状态源。

## 6. Tool、模型、来源与引用

### 6.1 `AiToolCall`

字段：

- `id`、`runId`、`stepId`、`toolName varchar(96)`、`toolVersion varchar(40)`。
- `logicalNodeKey`、`invocationIndex int`，unique `(runId,logicalNodeKey,invocationIndex)`。
- `status`（`PENDING/AUTHORIZING/RUNNING/RETRY_WAIT/SUCCEEDED/FAILED/CANCELLED/REJECTED`）、`attemptCount`、`arguments jsonb`、`argumentHash char(64)`。
- `resultSummary jsonb`、`resultBlobRef?`、`resultHash?`、`errorCode/errorMessage`。
- `dataAsOf date?`、`dataThrough date?`、`marketTimezone varchar(64)?`、`dataVersion varchar(160)?`、`qualityFlags jsonb`、`sourceTasks jsonb`。
- `startedAt/finishedAt/createdAt timestamptz`、`durationMs int`。

每次网络/数据库重试写 RunEvent；同一逻辑调用不制造多个相互矛盾的 ToolCall。大结果进入对象存储，数据库只留摘要、hash、权限信息和引用。

### 6.2 `AiModelCall`

字段：`id`、`runId`、`stepId?`、`promptVersionId`、`provider`、`model`、`requestHash`、`responseHash?`、`status`（`PENDING/STREAMING/RETRY_WAIT/SUCCEEDED/FAILED/CANCELLED`）、`attemptCount`、`inputTokens/outputTokens/cachedTokens`、`cost decimal(18,8)`、`latencyMs`、`finishReason`、`error*`、`startedAt/finishedAt`。索引 `(runId,startedAt)`、`(provider,model,startedAt)`。

默认不存完整系统 Prompt、API 密钥或 hidden chain-of-thought；调试采样需单独权限、脱敏、短保留期。

### 6.3 `AiSearchSource` 与 `AiCitation`

`AiSearchSource` 保存 canonical URL、`canonicalUrlHash char(64)`、标题、站点、作者、published/fetched 时间、contentHash、对象存储引用、mime/language、license、robots/抓取状态和 firstSeenRunId。unique `(canonicalUrlHash,contentHash)`。

`AiCitation` 使用 bigint 内部主键并增加唯一 `publicId cuid` 供 API/SSE 使用；保存 `messageId?`、`researchReportId?`、`searchSourceId?`、`toolCallId?`、`claimKey`、`startOffset/endOffset?`、`locator jsonb`、`quoteHash?`、`createdAt`。数据库 CHECK：

1. Message 或 ResearchReport 至少一个 owner；
2. SearchSource 与 ToolCall 恰有一个证据来源；
3. 文本 offset 同时为空或 `0 <= start < end`。

索引：`(messageId,id)`、`(researchReportId,id)`、`(searchSourceId)`、`(toolCallId)`。

## 7. 报告、记忆与现有资产复用

### 7.1 `AiResearchReport`

保存 `id`、`userId`、`runId`、`title`、`status`、`thesis jsonb`、`asOf date`、`marketTimezone`、`dataVersionSet jsonb`、`qualityFlags jsonb`、`reportId?`、`researchNoteId?`、`createdAt/updatedAt/publishedAt`。unique `(runId)`；unique `reportId`；index `(userId,createdAt DESC)`。

- 复用现有 `Report` 作为 JSON/HTML/PDF 物化文件与生成状态，不复制 filePath/data 管理。
- 复用 `ResearchNote` 作为用户可编辑笔记；Agent 发布内容先生成新笔记/版本，不静默覆盖用户文本。
- 后续 `save_research_report` 是显式确认的写 Tool；首次 MVP 只读研究可不启用。

### 7.2 `AiUserMemory`

字段：`id`、`userId`、`kind`（`PREFERENCE/PROFILE/CONSTRAINT/DOMAIN_FACT`）、`key`、`value jsonb`、`sourceConversationId?`、`sourceMessageId?`、`confidence decimal(5,4)`、`status`（`ACTIVE/REVOKED/EXPIRED`）、`expiresAt?`、`createdAt/updatedAt/revokedAt`。unique `(userId,kind,key)` 只对 ACTIVE 生效；index `(userId,status,updatedAt DESC)`。

记忆只存用户明确表达或确认的稳定偏好；证券结论、持仓事实、密码、token 和推断出的敏感属性不得写入。

### 7.3 Watchlist、Portfolio 与 Notification

- Watchlist/Portfolio 始终经 owner-scoped Facade 查询。Run 的 `inputSnapshot/contextRefs` 可记录资源 id 和读取时版本，不复制其权威数据。
- 现有 `Notification` 是站内收件箱投影；`AiNotificationDelivery` 保存生成、渠道、尝试和 provider 回执，两者职责不重叠。
- 现有 `User.status=DELETED` 触发隐私清理状态机，不直接级联删审计链。

## 8. 调度与通知

### 8.1 `AiScheduledTask` 与 `AiTaskExecution`

Schedule 字段：`id`、`userId`、`name`、`status`（`ACTIVE/PAUSED/DELETED`）、`triggerType`（`CRON/CONDITION/EVENT`）、`cronExpression?`、`conditionRule? jsonb`、`eventKey?`、`timezone`、`nextRunAt timestamptz`、`workflowVersionId`、`inputTemplate jsonb`、`misfirePolicy`、`maxConcurrency`、`clientRequestId?`、`lastExecutedAt?`、`createdAt/updatedAt/pausedAt/deletedAt`。unique `(userId,clientRequestId)`；领取索引 `(nextRunAt,id) WHERE status='ACTIVE'`。

Execution 字段：`id`、`scheduledTaskId`、`scheduledFor timestamptz`、`status`（`PENDING/CLAIMED/QUEUED/RUNNING/SUCCEEDED/FAILED/CANCELLED/SKIPPED`）、`runId?`、`attempt`、`leaseOwner/leaseExpiresAt`、`skipReason?`、`error*`、`startedAt/finishedAt/createdAt`。unique `(scheduledTaskId,scheduledFor)`；index `(status,leaseExpiresAt,scheduledFor)`。

`timezone` 必须是 IANA 名称；A 股市场任务固定 `Asia/Shanghai`，DST 市场由调度器按当地日历解析，不能把 cron 当 UTC 固化。

### 8.2 `AiNotificationChannel` 与 `AiNotificationDelivery`

Channel 保存 `userId`、`type`（`IN_APP/EMAIL/WEBHOOK`）、`status`、`displayName`、加密 credential reference、`recipientFingerprint`、验证时间、限流配置和时间戳。禁止明文保存 API key/Webhook secret。

Delivery 保存 `taskExecutionId?`、`runId?`、`channelId`、`notificationId?`、`status`（`PENDING/SENDING/DELIVERED/FAILED/SUPPRESSED`）、`contentVersion`、`recipientFingerprint`、`providerMessageId?`、`attemptCount`、`nextAttemptAt?`、`lastError*`、`sentAt/deliveredAt/createdAt`。unique `(taskExecutionId,channelId,recipientFingerprint,contentVersion)`；重试索引 `(status,nextAttemptAt)`。

## 9. Prompt 与 Workflow 版本

`AiPromptVersion`：`id`、`promptKey`、`version int`、`status`（`DRAFT/PUBLISHED/RETIRED`）、`template`、`inputSchema jsonb`、`outputSchema jsonb`、`contentHash`、`createdBy/publishedBy`、时间戳。unique `(promptKey,version)` 和 `(promptKey,contentHash)`。

`AiWorkflowVersion`：`id`、`workflowKey`、`version`、`status`、`definition jsonb`、`toolAllowlist jsonb`、`input/outputSchema`、`contentHash`、发布者和时间戳。unique `(workflowKey,version)`。

发布动作通过事务把版本从 DRAFT 改 PUBLISHED；PUBLISHED 行禁止 UPDATE/DELETE，只能创建新版本并把旧版 RETIRED。Run 永久引用实际执行版本。

## 10. Outbox 与评测

`AiOutboxEvent` 保存 `aggregateType`、`aggregateId`、`eventType`、`eventVersion`、`payload`、`status`、`availableAt`、`attemptCount`、`lease*`、`publishedAt`、`lastError`、`createdAt`。unique `(aggregateType,aggregateId,eventType,eventVersion)`；partial index `(availableAt,id) WHERE status IN ('PENDING','RETRY')`。

`AiEvaluation` 保存 `runId`、`messageId?`、`evaluatorType`、`rubricVersion`、`scores jsonb`、`labels jsonb`、`comment?`、`createdBy?`、`createdAt`。不允许评测记录反向修改历史 Message/Run；修正通过新消息、新 Run 或明确标注完成。

## 11. 生命周期、归档与清理

下表时间均为容量设计的**建议默认值**，不是已确认的合规政策；生产上线前必须由数据保留、隐私和合规评审确认，并配置化实施。

| 数据 | 热库保留 | 后续处理 |
| --- | --- | --- |
| Conversation/Message/Report | 用户未删除时长期 | 归档只改变状态；隐私删除走显式 purge |
| Run/Step/Tool/Model 审计 | 180 天热数据 | 加密对象归档至 2 年；保留 hash、状态和账务汇总 |
| RunEvent 流重放 | 7 天热数据 | 过期后由 Run/Message/Tool/Citation 快照恢复；必要运营事件归档至 180 天 |
| SearchSource 抓取正文 | 未引用 90 天；被引用随报告 | 正文对象删除后保留 URL/hash/时间/许可元数据 |
| UserMemory | 到期或撤回立即禁用 | 建议 30 天内物理清除值，保留匿名撤回审计 |
| Schedule/Execution | Schedule 长期；Execution 1 年 | 失败与合规事件可延长至 2 年 |
| NotificationDelivery | 1 年 | 去除 provider payload 和收件人明文 |
| Outbox | 成功 30 天；失败 180 天 | 聚合统计后批量删除 |
| Prompt/Workflow Version | 长期 | 发布版不可删除 |

清理任务按主键/时间游标小批执行，使用 `FOR UPDATE SKIP LOCKED`，每批设置超时；不得用单个超大 DELETE 锁表。

## 12. 迁移顺序与验证

1. 先补齐现有 migration 缺失的 10 个 `CREATE TABLE`，修复 `valuation_daily_medians` 提前 INSERT，并解释/重建 `backtest_runs_strategy_id_idx`。
2. 在空 PostgreSQL 执行完整 `prisma migrate deploy`，确认 111 个旧 Model 都存在；再用 `prisma migrate diff` 验证空差异。
3. 清理 Dividend 重复并增加自然唯一键；修复 nullable unique，完成周/月单位与 QFQ 数据回填。
4. 单独 migration 创建 Agent enums、Prompt/Workflow、Conversation/Message、Run/Step/Event、Tool/Model、Source/Citation、Report/Memory。
5. 第二个 migration 创建 Schedule/Execution、Channel/Delivery、Outbox/Evaluation 和所有 FK/unique/check；Prisma 不表达的 partial/include/check 用审计过的 raw SQL。
6. 先部署只写双读的 Repository，验证旧业务无回归；再启用 Worker、Outbox publisher 和 SSE replay。
7. 在生产副本回放真实会话，核对幂等、取消、租约过期、重复 BullMQ job、通知重复和隐私清理。
8. 每个 migration 在空库、现有库副本、回滚演练三条路径执行；生产只用 `migrate deploy`，禁止 `db push`。

验收至少包含：FK/unique/check 全量查询、重复幂等请求、并发领取、RunEvent sequence 无缺口/重复、发布版不可变、租户越权负例、时区/DST 边界、清理批处理以及 Redis 全量丢失后的 PostgreSQL 恢复。

## 13. 不在本批次内

- pgvector、语义记忆召回和 Text-to-SQL。
- 模型自定义 SQL、表名、列名或任意 Tool。
- 用 Agent 表替换现有 Watchlist、Portfolio、Report、ResearchNote、Notification。
- 在未完成公告可得日、历史股票池、复权和质量门禁前把财务/回测数据标记为可信研究结论。

参见[索引与性能](./indexes-and-performance.md)、[数据血缘](./data-lineage.md)和[后端数据库设计](../backend/database-design.md)。
