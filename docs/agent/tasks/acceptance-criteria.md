# 公共验收标准

每个批次除自身第 23/24 节外，还必须满足以下适用门禁。任何“暂时跳过”要在批次记录原因、风险、负责人和解除条件，不能直接标 completed。

## 1. 编译、类型与 Lint

- 服务端 `pnpm run build` 通过；不得新增 TypeScript error、未处理 Promise 或循环依赖。
- 服务端 `pnpm run lint` 通过，运行前后 git diff 只能包含批次授权文件；lint 自动修复不能改用户无关代码。
- Prisma `pnpm run lint:prisma`、`pnpm run prisma:generate` 通过且生成结果可重复。
- 前端使用仓库声明的 Yarn 1.22.22，执行 `yarn --cwd ../client-code build` 和 `yarn --cwd ../client-code lint`。

## 2. 测试

- 新领域逻辑必须有 unit test；Repository/Tool/provider/queue/stream 必须有 integration/contract test。
- 服务端按风险执行 `pnpm run test:unit`、`test:api`、`test:integration`、`test:e2e`；Agent MVP 的 E2E 必须进入 CI，不能沿用当前漏跑 6 个 E2E 的状态。
- 前端执行 `yarn --cwd ../client-code test`；核心流程执行 `yarn --cwd ../client-code e2e`。
- fake model/search 是 CI 默认；真实 provider 测试使用受保护 secrets、显式预算和独立 job。
- flaky retry 不能掩盖竞态；失败须可用 runId/fixture 稳定复现。

## 3. 数据库迁移

- 所有 schema 改动必须有显式 `prisma/migrations/<id>_<name>/migration.sql`，禁止用 `prisma db push` 或 `--accept-data-loss` 作为交付。
- 用临时空 PostgreSQL 执行完整 `pnpm exec prisma migrate deploy`；再在脱敏/副本的已有库执行幂等升级和 schema diff。
- 大表变更先测锁、WAL、磁盘、索引构建、回滚；禁止无界单事务 UPDATE/DELETE。
- 数据修复有 dry-run、cursor/checkpoint、备份、批量上限、前后计数/hash 和中断恢复。
- 新外键/唯一键先审计/清理现有冲突；时区用 `timestamptz`、交易日用 `date`，除非数据库设计给出理由。

## 4. API 与契约

- 业务 endpoint 全部 `POST('非空路径')`、专用 class DTO、显式 `@HttpCode`、Swagger response；不新增 `@Query()` 或默认 201/文档 200 漂移。
- Runtime schema、后端类型、前端生成类型、API 文档和 fixtures 同源；生成后 git diff 必须为空。
- POST SSE 严格使用 [公共事件](../api/sse-events.md)，sequence 可重放、幂等、gap 可恢复；正文流不用 WebSocket。
- 所有 API 有认证、资源所有权、跨租户负例、幂等/并发、错误码测试。

## 5. 金融数据正确性

- 每个事实输出来源、交易/报告/公告/可用/抓取时点、市场时区、单位、币种、复权和质量 flags。
- 股票代码映射、停牌、退市、后续 IPO、指数成分有效期、财报公告可用日、修订版本、复权、周/月 pctChange 均有 golden case。
- 回测记录 data/engine/universe/financial/adjustment versions，检查前视、幸存者、交易成本、可交易性和复现 hash。
- null 不伪造成 0；数据门禁失败返回 typed error/warning，不让模型补数字。

## 6. Tool 与工作流安全

- Tool 默认 deny、JSON Schema `additionalProperties=false`，userId/role 从认证上下文注入；模型不能访问 Prisma/SQL/Redis/文件/任意 URL。
- 每个 Tool 定义 role/scope/sideEffect/confirmation/idempotency/timeout/attempt/maxRows/cost/audit。
- 写操作有显式确认、clientRequestId、前后快照和 outbox；破坏性 Tool、Tushare 管理、用户管理、交易下单不注册。
- Workflow 有最大 step/Tool/token/cost/time、版本冻结、checkpoint、协作取消和恢复；审计/引用失败不能 completed。
- 搜索抓取通过 SSRF、DNS rebinding、重定向、MIME/大小、prompt injection 和引用 hash 测试。

## 7. 前端与可访问性

- 流 parser 处理随机 chunk、UTF-8、重复/gap/未知事件/断线/401；刷新从持久 sequence 恢复。
- MUI 主题与响应式一致；输入、会话、取消、重试、引用、Tool 状态有键盘操作、焦点、ARIA 和 screen reader 文案。
- Markdown 禁原始 HTML；链接安全；Chart/Table/Kline 只渲染白名单 schema，单块错误不拖垮消息。
- 大会话使用虚拟化/分段渲染，stream update 有节流；性能阈值在批次记录和测试中固定。

## 8. 日志、指标与审计

- 所有异步边界传播 traceId/runId/step/tool/model attempt；日志不记录 prompt、token/key、refreshToken、完整持仓、网页全文或 SQL。
- 指标 label 不含 userId/runId 等高基数值；至少记录成功率、延迟、TTFT、usage/cost、数据时效、队列/重试/取消。
- Tool/模型/来源/引用/写确认/任务/送达形成持久审计链；fire-and-forget/吞异常不合格。
- 新告警有 runbook，dashboard/rule syntax 在 CI 校验。

## 9. 性能与故障恢复

- 关键数据库查询提供 `EXPLAIN (ANALYZE, BUFFERS)` 基线；千万级表禁止无索引宽范围读取。
- API、Worker、scheduler 可独立扩容；多副本 scheduler 有唯一 claim，WS 启用前有 Redis adapter/强鉴权。
- Redis queue 使用 noeviction/独立 ACL；Redis 清空、worker SIGTERM/provider 超时、SSE 断线均有恢复测试。
- timeout/retry 只作用于幂等且分类可重试的操作；通知失败不重跑研究。

## 10. 文档、完成与回滚

- 真实新增/修改文件、类、接口、环境变量、migration、测试、命令与行为同步到主设计；相对链接全部有效。
- 批次 frontmatter 的 depends/blocks/parallel/status 与依赖图一致，无循环。
- `git diff --check` 通过；不得修改用户已有无关变更或泄露个人绝对路径/密钥。
- 回滚经过演练或明确验证：功能 flag/旧版本/停止 worker/保留审计/数据库 down strategy；不得以删除生产数据作为默认回滚。
- Definition of Done 是代码、测试、migration、观测、文档和回滚全部完成，不以“功能可点”代替。
