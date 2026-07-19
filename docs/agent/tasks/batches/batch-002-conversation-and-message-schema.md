---
batch: 2
status: pending
type: database
depends_on: ["batch-000-platform-data-readiness", "batch-001-agent-public-contracts"]
blocks: ["batch-003-agent-audit-and-citation-schema", "batch-005-run-state-and-event-store", "batch-013-conversation-rest-api", "batch-019-conversation-summary-and-memory"]
parallel_with: ["batch-004-model-gateway-foundation"]
recommended_executor: database-agent
recommended_reasoning_level: high
estimated_scope: medium
---

# Batch 002：会话与消息数据模型

## 1. 批次目标

新增 AI 会话、不可变消息、消息版本和内容块存储，建立严格租户边界与幂等创建语义。

## 2. 业务价值

会话是刷新恢复、继续追问、重新生成和审计的持久基础；不可变消息避免历史被模型或重试覆盖。

## 3. 前置依赖

- Batch 000 fresh migration gate 通过。
- Batch 001 的状态和内容块契约冻结。

## 4. 执行范围

- 新增 `AiConversation`、`AiMessage` 及必要枚举/关系。
- 实现 Agent domain repository，只允许 user-scoped query。
- 支持游标分页、归档、assistant message version 和 clientRequestId 幂等。

## 5. 不在本批次范围内

- 不保存 Run/step/tool/model 审计；Batch 003/005 负责。
- 不实现 REST Controller 或前端页面。
- 不实现摘要/长期记忆；Batch 019 负责。

## 6. 涉及的现有文件

- `prisma/user.prisma`、`prisma/base.prisma`
- `src/shared/prisma.service.ts`
- 现有 module test 目录规范
- `docs/agent/database/proposed-schema-changes.md`

## 7. 需要新增的文件

- `prisma/agent/conversation.prisma`
- `src/apps/agent/conversation/agent-conversation.repository.ts`
- `src/apps/agent/conversation/agent-message.repository.ts`
- `src/apps/agent/conversation/test/agent-conversation.repository.spec.ts`
- `prisma/migrations/20260720010000_add_ai_conversation_and_message/migration.sql`

## 8. 需要修改的文件

- `prisma/user.prisma` 增加关系字段
- Prisma schema 聚合/生成配置（按现有 multi-file 方式）
- `src/apps/agent/agent.module.ts`（若 Batch 001 已建立则注册 repository）

## 9. 数据库变更

- `AiConversation`: id、userId、title、status、modelPolicy、preferredModel、summaryVersion、createdAt/updatedAt/archivedAt、statusVersion。
- `AiMessage`: id、conversationId、role、status、contentBlocks Json、parentMessageId、version、clientRequestId、createdAt。
- 唯一键：`(userId, clientRequestId)` 用于会话创建；消息用 `(conversationId, clientRequestId)`；assistant version 用 `(parentMessageId, version)`。
- 索引：conversation `(userId,status,updatedAt,id)`；message `(conversationId,createdAt,id)`；FK 删除策略按数据库设计文档执行。

## 10. API 变更

不实现 API；repository DTO 对齐 `conversations/create/list/detail/messages/list` 所需字段。

## 11. 后端实现任务

- Repository 方法全部接收 `userId`，查询条件同时过滤资源归属。
- 写消息只 append；重新生成创建 sibling/version，不 update 历史正文。
- 内容块入库前用 Batch 001 runtime schema 验证，读取时也验证/迁移版本。

## 12. 前端实现任务

不涉及。

## 13. Tool 或工作流变更

不涉及。

## 14. 详细执行步骤

- 按数据库设计确认字段、ID 类型、枚举和 delete/retention 策略。
- 编写 Prisma models 与显式 migration，禁止 `db push`。
- 实现事务内 createConversation/appendMessage/listByCursor/archive。
- 添加跨用户、重复 clientRequestId、稳定分页、assistant version 测试。
- 在空库和已有库副本执行 migration/status/schema diff。

## 15. 核心数据结构

- 公共 `ConversationStatus = ACTIVE | ARCHIVED`；内部 `ConversationRecordStatus` 可增加 `DELETED`，仅供生命周期作业，删除态不对外返回资源。
- `MessageRole = USER | ASSISTANT | SYSTEM | TOOL`；不存 hidden chain-of-thought，`SYSTEM` 仅保存可审计系统事件/摘要元数据。
- `contentBlocks` 含 schemaVersion，便于未来迁移。

## 16. 关键接口定义

- `createConversation(userId, command): Promise<AiConversation>`
- `appendMessage(userId, conversationId, message): Promise<AiMessage>`
- `listMessages(userId, conversationId, cursor): Promise<CursorPage<AiMessage>>`
- `createAssistantVersion(userId, sourceMessageId, clientRequestId): Promise<AiMessage>`

## 17. 配置和环境变量

不新增环境变量。

## 18. 异常和边缘场景

- 重复 clientRequestId 并发；同毫秒消息游标；归档会话继续发送；父消息跨会话；内容块 schema 升级。
- 用户删除时保留审计与隐私删除的冲突由生命周期状态解决，不物理级联丢审计。

## 19. 安全要求

- 所有查询含 userId；数据库 FK 不能替代租户检查。
- 消息内容不进入普通日志；管理员访问需要单独审计接口，本批次不提供。

## 20. 日志和可观测性要求

- 记录 repository operation、duration、rowCount、conflict，不记录内容。
- 慢查询阈值沿用 Prisma metrics。

## 21. 测试要求

- Prisma repository integration test 使用临时数据库。
- 并发幂等、跨租户、cursor、归档、内容 schema 正反例。
- migration deploy + rollback rehearsal。

## 22. 执行命令

- `pnpm prisma:generate`
- `pnpm exec prisma migrate deploy`（临时数据库）
- `pnpm test -- src/apps/agent/conversation/test/agent-conversation.repository.spec.ts`
- `pnpm run build`

## 23. 验收标准

- 会话/消息在进程重启后可读取；重复命令不重复写。
- 用户 A 无法通过 ID/parent/cursor 访问用户 B 数据。
- 所有索引和唯一约束与数据库设计一致，fresh migration 通过。

## 24. 完成定义

Prisma model、migration、repository、集成测试、数据字典和回滚说明全部完成。

## 25. 回滚方案

应用先停止写新表；回滚代码后在确认无消费方时 DROP 新表/枚举。生产已有数据默认保留，不自动删除。

## 26. 后续批次

- Batch 003 扩展审计/引用关系。
- Batch 005 建 Run/事件状态。
- Batch 013 暴露会话 API。
