# 会话与记忆设计

## 1. 四类状态必须分离

| 类型         | 内容                                          | 权威性               | 生命周期                      |
| ------------ | --------------------------------------------- | -------------------- | ----------------------------- |
| 原始记录     | 用户/assistant 消息、内容块、版本、引用       | 不可变审计事实       | 按账户/合规策略长期保存或删除 |
| Run 工作状态 | Step、Tool/Model call、checkpoint、usage/cost | 执行权威状态         | 热事件短期，审计摘要长期      |
| 会话工作记忆 | 当前股票、比较对象、日期范围、滚动摘要        | 可重建、有版本       | 随会话更新/归档               |
| 用户长期记忆 | 明确保存的偏好、风险约束、研究结论            | 用户可查看/纠错/删除 | 带来源、置信度和过期时间      |

Tool 完整输出、网页快照和报告是独立 artifact，只在消息/记忆中保存引用与预算化摘要。物理模型、索引和删除策略以[数据库设计](./database-design.md)为准。

## 2. 会话与消息规则

公共创建、列表、详情、消息列表、发送、重新生成和模型切换接口只使用 [REST API](../api/rest-api.md) 的路径和结构。

- 会话只属于一个 `userId`；服务端从 JWT 取身份，任何查询都使用 owner predicate。
- 用户消息提交后不可覆盖。编辑/重新生成创建新 message version/branch，旧版本保留。
- assistant 消息先创建占位记录，再由 Run 逐步写结构化 blocks；不保存模型隐藏推理。
- 每个消息内容块记录 schema version、asOf、sourceType 和 citationIds；正文中的数字不能脱离块 provenance。
- 默认每个会话同一时刻只允许一个生成中的 Run，避免两个分支竞争摘要；重复 `clientRequestId` 返回首次结果。后续若开放并发分支，必须显式 parentMessageId。
- 归档不等于删除；删除/账户注销按数据库生命周期执行级联或匿名化，并清理缓存、快照和对象存储。

## 3. 上下文构建

`ContextBuilderService` 每次 ModelCall 根据目标模型能力重新构建，不把上一次供应商请求对象复用：

```text
固定系统/安全规则
→ Workflow/Prompt 固定版本
→ 当前页面与结构化会话状态
→ 版本化会话摘要
→ 最近相关原始消息
→ 当前 Run 已完成 Tool 摘要/引用
→ 用户明确授权的长期记忆
→ token 预算验证
```

预算优先级：系统规则和当前用户问题不可丢；Tool 事实保留结构化值/单位/asOf；较旧闲聊先裁剪；完整表格、网页正文和重复 Tool 结果只保留引用。超出窗口先用独立摘要步骤压缩，仍超限返回 `AI_CONTEXT_TOO_LARGE`，禁止无限摘要递归。

`pageContext` 是提示线索，不是权限。`entityId` 仍需 `resolve_security` 或 owner check；前端传来的 `visibleDataAsOf` 不能覆盖数据库实际截止日。

## 4. 结构化会话状态

```ts
type ConversationState = {
  primarySecurity?: string
  comparisonSecurities: string[]
  dateRange?: { start: string; end: string }
  portfolioId?: string
  researchIntent?: string
  acceptedDataCutoffs: Record<string, string>
  userCorrections: Array<{ key: string; value: unknown; sourceMessageId: string }>
}
```

更新采用“模型提议、程序校验、版本化提交”：股票代码重新解析；portfolioId 校验所有权；日期范围校验；纠错引用来源消息。摘要错误不能覆盖原始消息，用户纠错创建新 state/summary version。

## 5. 摘要

- 滚动摘要保存 `summaryVersion`、覆盖的 message ID 范围、生成模型、promptVersion、createdAt 和 sourceMessageIds。
- 摘要只写已在原始消息/引用中出现的事实；不把模型推断升级为长期事实。
- 新摘要以旧摘要和增量消息生成，但验证器检查实体、数字、日期和引用是否仍可追溯。
- 重新生成回答不自动改摘要；只有分支被用户采纳或后续消息基于该分支时推进 active branch。
- 摘要失败不阻断原始会话读取；下一 Run 可用更少历史继续并返回 warning。

## 6. 长期记忆

MVP 只允许以下来源进入长期记忆：用户明确保存、用户设置/风险偏好、已保存研究报告中的结构化结论。模型自动推测的“用户喜欢”“用户风险承受力”不能直接持久化。

每条记忆包含 scope、type、structured value、source message/report、confidence、validFrom、expiresAt、sensitivity、status 和 version。用户可列表、纠错、删除；删除后上下文构建立即排除并异步清理派生索引。

持仓、成本价和交易日志是领域数据，不复制成长记忆；上下文按需通过 owner-scoped Tool 获取聚合。发送给模型前按[安全设计](./security.md)的数据等级裁剪。

Batch 019 冻结策略：

| 类别          | 用途                       | 默认 TTL | 最大 TTL |
| ------------- | -------------------------- | -------: | -------: |
| `PREFERENCE`  | 展示、研究方式等稳定偏好   |   365 天 |  1825 天 |
| `PROFILE`     | 用户明确提供的稳定资料     |   365 天 |  1095 天 |
| `CONSTRAINT`  | 明确风险或研究约束         |   180 天 |   730 天 |
| `DOMAIN_FACT` | 用户确认的阶段性结构化事实 |    90 天 |   365 天 |

- sensitivity 为 `NORMAL/PERSONAL/FINANCIAL`；`FINANCIAL` 只允许明确确认的 `PREFERENCE/CONSTRAINT`。
- status 为 `CANDIDATE/CONFIRMED/REVOKED/EXPIRED`；只有未删除、未过期的 `CONFIRMED` 记忆可进入新 Run。
- 持仓明细、交易日志、凭据、健康信息和政治推断禁止写入长期记忆；模型推断不能绕过用户确认。
- 每个 `(userId,category,key)` 同时最多一个有效 `CONFIRMED` 版本；纠错撤销旧版本并新增版本，不覆盖历史。

## 7. 检索策略

MVP 使用：

1. 结构化过滤：userId、conversationId、实体、日期、memory type、status。
2. PostgreSQL 全文/关键词：消息、摘要、报告标题和用户研究笔记。
3. 最近性 + 实体匹配 + 用户固定标记的确定性排序。

Batch 027 已补齐版本化 chunk、retrieval/embedding port、metadata + PostgreSQL FTS baseline、可选 pgvector/hybrid adapter 与 ContextBuilder 降级。默认 `AGENT_RETRIEVAL_MODE=fts`；FTS 对 PostgreSQL `simple` 无法切分的连续中文增加转义 substring fallback，tenant/status/delete/expiry/data cutoff 均在 SQL 本体过滤。报告命中以 `RETRIEVED_SOURCES` 写入有界 Context/manifest；记忆命中只提升既有 confirmed memory 排序，不绕过记忆策略。

当前不引入生产向量能力，见 [ADR-007](../decisions/adr-007-vector-database-necessity.md) 与 [ADR-010](../decisions/adr-010-语义检索试点结论.md)。真实 41 GB 数据库的已确认记忆和报告均为 0 行，远低于 10 万条复审线；真实 embedding 模型、成本和 41 GB 克隆索引/WAL/备份门禁也未通过。因此没有 pgvector migration/table/index，`hybrid` 不得用于生产。

检索配置：

- `AGENT_RETRIEVAL_MODE=fts|hybrid`，默认 `fts`。
- `AGENT_RETRIEVAL_MAX_HITS`、`AGENT_RETRIEVAL_FTS_CANDIDATES`、固定 FTS/vector 权重和 chunk/overlap。
- hybrid 必须固定 embedding HTTPS endpoint allowlist、secret、model、dimension、batch、timeout、HNSW `ef_search` 和 IVFFlat `probes`。
- embedding/pgvector 运行失败自动返回 FTS；原 query 不写日志，仅保留 SHA-256。
- 结构化行情/财务事实、完整持仓、未确认会话和 hidden reasoning 永不进入 embedding。

## 8. Tool 结果和引用去重

- 同一 Run 内以 ToolCall 幂等键复用；跨 Run 只复用满足 tool/version/input/dataVersion/permission scope 的缓存结果。
- Context 中相同 citationId 只出现一次，多个结论可以引用它。
- 数据更新后旧 Tool 结果仍是历史事实，不覆盖；新 Run 产生新 dataVersion/asOf。
- 引用失效时保留历史 citation 记录并标记不可重新验证，不自动替换成相似网页。
- 用户要求“截至某日”时，Context Builder 丢弃晚于截止日的 Tool 结果和记忆事实。

## 9. 恢复与并发

- 页面刷新先调用 Run status/messages，再按 [SSE 协议](../api/sse-events.md)以 sequence 重连；Redis pub/sub 历史不是恢复源。
- Context summary/state 更新使用 version 乐观锁；冲突时重读 active branch 后重算，不能 last-write-wins。
- Worker 崩溃从 Run checkpoint 恢复，不从模型 stream 的内存 buffer 恢复；已持久化 delta 和完整 assistant content 可继续展示。
- 模型切换不修改历史 ModelCall；下一 Run 针对新窗口重新预算。
- archived conversation 默认不进入长期检索，除非用户显式选择。

## 10. 异常

| 情况                      | 行为                                             |
| ------------------------- | ------------------------------------------------ |
| 会话/消息非本人           | 安全 not-found，映射 `AI_CONVERSATION_NOT_FOUND` |
| active Run 冲突           | 返回稳定 409 或复用同一 `clientRequestId` 的 Run |
| 摘要版本缺失/损坏         | 回退最近合法摘要 + 原始消息，记录 warning        |
| 引用/Tool artifact 已清理 | 保留元数据，标记正文不可回放，不补造             |
| token 预算仍超限          | `AI_CONTEXT_TOO_LARGE`                           |
| 删除正在执行的会话        | 先请求取消，终态后执行删除/清理工作流            |

## 11. 文件落点

新增：

```text
src/apps/agent/application/conversation.service.ts
src/apps/agent/application/message.service.ts
src/apps/agent/application/context-builder.service.ts
src/apps/agent/application/conversation-summary.service.ts
src/apps/agent/application/memory.service.ts
src/apps/agent/domain/conversation-state.ts
src/apps/agent/infrastructure/conversation.repository.ts
src/apps/agent/infrastructure/message.repository.ts
src/apps/agent/infrastructure/memory.repository.ts
src/apps/agent/infrastructure/artifact.repository.ts
```

修改 `src/apps/user/` 时只增加用户可管理的 Agent 偏好入口，不把会话数据塞进现有 User JSON；Prisma 文件和 migration 由[数据库设计](./database-design.md)指定。

Batch 019 已落地的 Repository 位于：

```text
src/apps/agent/memory/conversation-summary.repository.ts
src/apps/agent/memory/user-memory.repository.ts
src/apps/agent/memory/memory-policy.ts
src/apps/agent/memory/memory-repository.errors.ts
```

- Summary 创建、会话 `currentSummaryId/summaryVersion` 推进使用同一事务和 expected version CAS；会话级事务锁保证同一会话并发只有一个版本成功。
- Memory confirm/correct 以 `(userId,category,key)` 事务锁和 partial unique 保证 active 唯一；确认新候选前原子推进同 key 已过期版本，避免过期行阻塞新版本。
- 所有读取、修改和 source conversation/message 校验显式携带 `userId`；跨租户统一返回安全 not-found 或空 owner 列表。

Batch 019 第三阶段已落地 Service/API：

```text
src/apps/agent/memory/conversation-summary.service.ts
src/apps/agent/memory/user-memory.service.ts
src/apps/agent/api/agent-memory.controller.ts
src/apps/agent/api/dto/memory/memory-request.dto.ts
src/apps/agent/api/dto/memory/memory-response.dto.ts
```

- `ConversationSummaryService` 规范化摘要内容并由服务端计算 SHA-256；会话 detail 只返回 current summary metadata。
- `UserMemoryService` 对 value 执行 8192-byte、8 层深度和明显敏感内容检查；公开 create 使用单事务 `createConfirmed`，失败不遗留 candidate。
- 管理 API 固定为 `POST agent/memories/list|create|update|delete`，使用 JWT owner、严格 Body DTO、HTTP 200 成功和 6032–6036 稳定错误码。

Batch 019 第四、五阶段已落地有界 Context 与自动滚动摘要：

```text
src/apps/agent/memory/context-builder.service.ts
src/apps/agent/memory/conversation-summary-generator.service.ts
src/apps/agent/memory/conversation-summary.prompt.ts
src/apps/agent/workflow/nodes/load-context.node.ts
```

- `ContextBuilderService` 按固定 segment 顺序和目标模型窗口构建上下文；摘要 hash/range 异常时回退原始消息。
- `ConversationSummaryGeneratorService` 在 `load_context` 前按消息数与 token 双阈值选择旧消息；保护当前问题和最近窗口，单批有界。
- 摘要调用固定 `purpose=SUMMARIZE` 和专用发布态 Prompt；结构、来源、实体/数字/日期/引号校验通过后才提交。
- CAS 冲突重读后最多重算一次；模型或校验失败只追加脱敏 warning，用户取消仍终止 Workflow。
- `AGENT_SUMMARY_ENABLED=false` 可只停止自动摘要；原始消息、已有摘要和记忆数据不删除。

## 12. 测试与验收

```text
src/apps/agent/test/conversation.service.spec.ts
src/apps/agent/test/context-builder.service.spec.ts
src/apps/agent/test/conversation-summary.service.spec.ts
src/apps/agent/test/memory.service.spec.ts
src/apps/agent/test/conversation-recovery.integration.spec.ts
src/apps/agent/test/conversation-tenancy.integration.spec.ts
```

覆盖超长会话裁剪、跨模型窗口、摘要数字/引用保持、分支重新生成、用户纠错、同会话并发、重复提交、跨用户读取、删除/归档、过期记忆、敏感记忆裁剪、刷新/SSE 恢复、artifact 清理和旧截止日过滤。评测必须证明 Context 中每个事实仍可定位到消息/Tool/引用。
