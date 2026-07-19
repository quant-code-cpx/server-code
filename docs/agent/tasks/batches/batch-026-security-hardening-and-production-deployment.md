---
batch: 26
status: pending
type: platform
depends_on: ["batch-000-platform-data-readiness", "batch-018-mvp-e2e-and-model-regression", "batch-021-outbound-notification-channels", "batch-023-multi-provider-routing-and-fallback", "batch-025-ai-observability-cost-and-evaluation"]
blocks: ["batch-028-controlled-sql-explorer"]
parallel_with: []
recommended_executor: general-coding-agent
recommended_reasoning_level: very-high
estimated_scope: large
---

# Batch 026：安全加固与生产部署

## 1. 批次目标

把当前开发 Compose 和基础生产 Dockerfile 收敛为可迁移、可观测、可备份、可灰度、可回滚的生产部署；修复 health path、构建上下文、非 root 写目录、Chromium、Redis 策略、进程角色、Cron 唯一性、WebSocket 鉴权/多实例、CI E2E 和灾备阻断项。

## 2. 业务价值

Agent/API/Worker 可安全独立扩容；长 SSE、队列、通知、报告和定时任务在多实例下不重复、不丢失。发布失败能停止放流或切回旧镜像，数据库与用户研究数据可恢复。

## 3. 前置依赖

- Batch 000 fresh migration 与数据门禁 green。
- Batch 018 真实 Agent E2E/模型回归稳定。
- Batch 021 通知 channel/outbox/delivery 已可恢复。
- Batch 023 多供应商路由、超时和降级稳定。
- Batch 025 指标、成本、评测和告警基线可用于 canary 判定。

## 4. 执行范围

- 生产镜像、`.dockerignore`、非 root runtime、Chromium/字体、只读根文件系统与临时/持久目录。
- production Compose、同域 edge、raw SSE 代理、one-shot `prisma migrate deploy`。
- API/worker/scheduler 角色拆分、现有业务 Cron 分布式租约与优雅停机。
- Redis `noeviction`、AOF/RDB、最小 ACL 用户、队列/Socket adapter。
- WebSocket 强鉴权、owner-scoped 订阅、Redis adapter 与前端握手修复。
- CI 镜像/SBOM/漏洞扫描、固定摘要 E2E、备份恢复演练、canary/rollback 自动化。

## 5. 不在本批次范围内

- 不新增 Agent REST/SSE/WS 公共事件或 DTO；只实现 `docs/agent/api/` 已定义行为。
- 不引入任意 SQL 能力；Batch 028 仍被本批次阻塞。
- 不执行破坏性 down migration，不用 `prisma db push --accept-data-loss`。
- 不承诺 Kubernetes；先交付可验证 production Compose，平台迁移保持镜像/探针/角色兼容。
- 不在本批次修复业务金融口径；依赖 Batch 000/029 门禁。

## 6. 涉及的现有文件

- `.dockerignore`、`.env.example`、`package.json`、`pnpm-lock.yaml`
- `dockerfiles/app/Dockerfile.prod`
- `docker-compose.yml`
- `dockerfiles/redis/Dockerfile`、`redis.conf`、`docker-entrypoint.sh`
- `src/main.ts`、`src/app.module.ts`、Batch 012 `src/worker.main.ts`
- `src/shared/health/health.controller.ts`
- `src/shared/logger/logger.service.ts`
- `src/apps/report/services/report-renderer.service.ts`
- `src/config/redis.config.ts`
- `src/websocket/events.gateway.ts`、`src/websocket/websocket.module.ts`
- `src/apps/alert/price-alert.service.ts`、`market-anomaly.service.ts`
- `src/apps/event-study/event-signal.scheduler.ts`
- `src/apps/screener-subscription/screener-subscription.scheduler.ts`
- `src/tushare/sync/sync.service.ts`、`sync-retry.service.ts`
- `.github/workflows/ci.yml`
- `../client-code/src/lib/socket.ts`、`.github/workflows/ci.yml`、`playwright.config.ts`

## 7. 需要新增的文件

- `docker-compose.prod.yml`
- `dockerfiles/nginx/nginx.prod.conf`
- `dockerfiles/redis/redis.prod.conf`
- `dockerfiles/redis/docker-entrypoint.prod.sh`
- `src/scheduler.main.ts`
- `src/bootstrap/process-role.ts`
- `src/shared/scheduler/distributed-cron-lock.service.ts`
- `src/shared/scheduler/test/distributed-cron-lock.service.spec.ts`
- `src/websocket/redis-io.adapter.ts`
- `src/websocket/test/redis-io.adapter.integration.spec.ts`
- `test/deployment/process-role.integration.spec.ts`
- `test/deployment/production-smoke.spec.ts`
- `scripts/ops/backup-postgres.sh`
- `scripts/ops/verify-postgres-backup.sh`
- `scripts/ops/restore-postgres-drill.sh`
- `scripts/ops/rollout-prod.sh`
- `scripts/ops/rollback-prod.sh`
- `.github/workflows/container-release.yml`
- `.github/workflows/production-deploy.yml`
- `../client-code/.github/workflows/e2e.yml`
- `../client-code/e2e/docker-compose.e2e.yml`
- `../client-code/e2e/agent-production-smoke.spec.ts`

## 8. 需要修改的文件

- `.dockerignore`：排除 `.git`、本地数据、`storage/`、日志、coverage、Playwright 产物、编辑器/Agent 缓存和所有 `.env*`（仅保留无密钥示例）。
- `dockerfiles/app/Dockerfile.prod`：health 改真实 `/health`；安装固定 Chromium/中文字体；创建/chown `/app/logs`、`/app/storage`、`/app/tmp`；固定非 root。
- `package.json`、`pnpm-lock.yaml`：增加 api/worker/scheduler 生产启动与部署 smoke 脚本，锁定 `@socket.io/redis-adapter`；复用现有 `redis` client。
- `src/app.module.ts`/bootstrap：按 `PROCESS_ROLE` 只加载允许模块；API 不注册业务 Cron/processor。
- `src/main.ts`：安装 Redis Socket.IO adapter、严格 CORS/代理信任、优雅摘流。
- Logger/ReportRenderer：生产 stdout 默认、显式临时目录、Chromium executable，移除硬编码 `--no-sandbox` 并验证非 root sandbox。
- Redis config/entrypoint：生产 ACL、TLS/私网参数、`noeviction` 和独立账号。
- 所有有副作用的 `@Cron`：scheduler-only + 分布式 lease + 幂等业务键。
- EventsGateway/前端 socket：强鉴权、socket identity、owner check、规范重放和连接 token。
- server/client CI：移除宽松门禁，加入 migrate deploy、镜像、固定摘要 E2E 与发布证据。

## 9. 数据库变更

本批次不新增业务表；使用前置批次 migration。生产部署由一次性 migration service/job 执行 `prisma migrate deploy`，API/worker/scheduler 只在成功后启动。

若现有 Cron 业务缺数据库幂等键，必须回到所属模块增加独立 migration，并遵循 expand/contract；Redis lease 只能减少竞争，不能代替业务唯一约束。备份脚本先验证 schema/migration 版本并生成校验和。

## 10. API 变更

不改变 Agent 公共 API。REST/SSE/WS 行为严格引用 `docs/agent/api/README.md`、`rest-api.md`、`sse-events.md`、`websocket-events.md`、`error-codes.md`。

基础设施探针沿用真实 `/health`（liveness）与 `/ready`（readiness）；修复 Dockerfile 当前错误 `/api/health`。Edge 对 SSE 关闭缓存/缓冲并保留 streaming headers，不包装响应。

## 11. 后端实现任务

- 构建镜像：用固定 Node/pnpm base digest；生产只复制 dist、prod deps、Prisma、模板；生成 SBOM。Chromium/字体版本可追溯，ReportRenderer 使用显式 executablePath，默认启用 sandbox；无法启用时只允许隔离 report worker 并记录风险门禁。
- 目录权限：镜像构建阶段创建/chown，运行时 root filesystem read-only，`/app/tmp` 用 tmpfs，报告成品使用受管存储/卷；Logger 默认 stdout。
- 角色拆分：`PROCESS_ROLE=api|worker|scheduler|all`；生产禁止 `all`。API 只暴露 HTTP/SSE/WS，worker 只消费队列，scheduler 只扫描/入队。
- Cron 锁：Redis `SET NX PX` + owner token + Lua compare-delete/renew；租约小于任务超时且有 heartbeat。Tushare、alert、event-study、screener 任务同时保持数据库幂等。
- Redis：生产 queue 实例 `maxmemory-policy noeviction`；default user disabled；api/worker/socket/ops 使用最小 command/key ACL。需要可驱逐 cache 时使用独立 Redis。
- WS：无/坏/过期 JWT 立即 `disconnect(true)`；identity 放 `socket.data`；订阅回测/Run 前查 user ownership；启用 `@socket.io/redis-adapter` pub/sub 客户端和有限重放。
- 报告存储：单机 Compose 可将同一受管 volume 挂给 API/报告 worker；多主机必须使用 Batch 022 对象存储 adapter，否则生产禁用 PDF/文件下载能力，不允许各副本写独立本地盘。
- 关闭时先 readiness=false，停止新连接/任务，等待 SSE 宽限期，worker 停取新 job，scheduler 释放租约。

## 12. 前端实现任务

- `../client-code/src/lib/socket.ts` 从 Auth Provider 获取当前 access token 放入 Socket.IO handshake auth；token 刷新后重连，登出立即断开。
- 只消费 `docs/agent/api/websocket-events.md` 的通知，收到后经 REST/SSE 拉权威状态；不把 Socket payload 当消息真相。
- 生产构建默认同域相对 API/Socket URL；CSP、base path 和 SPA fallback 与 nginx 配置联测。
- 新增 E2E workflow：使用 server CI 产出的不可变 image digest，启动 PostgreSQL/Redis/migration/API/worker/scheduler/edge，运行现有与 Agent Playwright；禁止浮动 `latest`。

## 13. Tool 或工作流变更

不改 Tool/Workflow 语义。运行角色、队列、Cron lock、供应商凭据和预算配置必须保持前置版本记录。生产禁用未发布 Tool、未签名 workflow/prompt 和 Batch 028 SQL 能力。

定时研究/通知失败只恢复对应 execution/delivery，不重跑已成功 Agent Run；进程拆分后仍以 PostgreSQL/outbox 为权威。

## 14. 详细执行步骤

1. 先写 production smoke，固定当前失败证据：Docker `/api/health`、非 root logs/storage、Chromium、WS 无效 token、重复 Cron。
2. 收紧 `.dockerignore`，修改生产镜像；以 appuser 在只读根文件系统运行 health、日志和中文 PDF smoke。
3. 实现 process role/bootstrap 与 scheduler 入口；逐模块验证 API 无 processor/Cron、worker 无公网、scheduler 不消费业务队列。
4. 实现 Cron lease，双 scheduler/kill -9/failover 集成测试；核对业务唯一键。
5. 加 production Redis conf/ACL/noeviction，使用不同账号运行 API、worker、Socket adapter；验证越权命令被拒。
6. 修 EventsGateway 与前端 handshake；启动两个 API 实例测试跨实例房间、owner 拒绝、重连/重放。
7. 建 `docker-compose.prod.yml` 与 nginx；migration job 成功后再启动应用，验证 `/health`、`/ready`、SSE 无缓冲和 WebSocket upgrade。
8. CI 改 fresh DB `migrate deploy`，lint 不再 continue-on-error；构建/扫描/签名 SHA 镜像并运行固定摘要 E2E。
9. 编写备份、校验和隔离 restore drill；保存 RPO/RTO 证据。
10. 在预生产执行 canary、SIGTERM、DB/Redis/供应商故障、备份恢复和回滚演练后才开放生产批准。

## 15. 核心数据结构

- `ProcessRole = 'api' | 'worker' | 'scheduler' | 'all'`；生产校验拒绝 `all`。
- `CronLease { key, ownerToken, acquiredAt, leaseUntil, heartbeatAt }`；owner token 不写日志全文。
- `SocketIdentity { userId, role, authenticatedAt, tokenExpiresAt }`；只由服务端 JWT 验证创建。
- `ReleaseManifest { serverImageDigest, clientArtifactHash, migrationVersion, contractVersion, configVersion, previousDigest }`。
- `BackupManifest { startedAt, completedAt, database, schemaVersion, checksum, encryptedObjectRef, restoreVerifiedAt }`。

## 16. 关键接口定义

- `bootstrapForRole(role: ProcessRole): Promise<INestApplicationContext>`
- `DistributedCronLockService.runWithLease(key, ttlMs, task): Promise<'executed' | 'skipped'>`
- `RedisIoAdapter.connectToRedis(): Promise<void>` 与 `createIOServer(port, options)`。
- `EventsGateway.handleConnection(client): Promise<void>`：失败立即断开；订阅 handler 异步 owner check。
- `ReportRendererService.launchBrowser(): Promise<Browser>`：固定 executable、sandbox、超时和临时目录。
- 运维脚本只接收显式环境文件、image digest、backup object；拒绝空值和 `latest`。

## 17. 配置和环境变量

- `NODE_ENV=production`、`PROCESS_ROLE`、`APP_IMAGE_DIGEST`、`CLIENT_ARTIFACT_HASH`。
- `DATABASE_URL` 与 migration 专用 `MIGRATION_DATABASE_URL`，权限分离。
- `REDIS_API_USERNAME/PASSWORD`、`REDIS_WORKER_USERNAME/PASSWORD`、`REDIS_SOCKET_USERNAME/PASSWORD`、`REDIS_OPS_USERNAME/PASSWORD`。
- `CRON_LOCK_PREFIX`、`CRON_LOCK_TTL_MS`、`SHUTDOWN_GRACE_MS`。
- `LOG_OUTPUT=stdout`、`APP_TMP_DIR=/app/tmp`、`REPORT_STORAGE_DIR=/app/storage/reports`、`PUPPETEER_EXECUTABLE_PATH`。
- `CORS_ORIGIN` 只允许明确来源；同域优先。所有 secret 来自 secret manager/CI protected secret，不写镜像或 Git。

## 18. 异常和边缘场景

- migration 失败/中断、旧应用与新 schema 并存、readiness 过早、health path 漂移。
- appuser 无目录权限、磁盘满、只读 root、Chromium 缺字体/崩溃/超时/残留进程。
- Redis OOM/noeviction 写失败、ACL 错配、AOF 恢复、pub/sub 单边断开。
- scheduler 在获得锁、续租、入队或释放时崩溃；长任务超过租约；网络分区双执行。
- WS token 过期、伪造 room、订阅他人回测、跨实例重连、adapter 暂时不可用。
- SSE 经 nginx 被缓冲/超时、部署中断流、worker SIGTERM、通知 provider 失败。
- 备份损坏/不完整、restore 到错误环境、回滚镜像不兼容新 migration。

## 19. 安全要求

- 镜像 non-root、cap drop、`no-new-privileges`、只读 root、最小端口；不得把 Docker socket 挂入容器。
- `.dockerignore` 阻止 `.env`、本地数据库/Redis、storage、日志、测试报告、Git/Agent 元数据进入 context。
- Redis default user disabled，ACL 按 key prefix/command 最小授权；生产不暴露 6379 公网。
- WS 在加入任何 room 前鉴权/owner check；CORS/Origin 严格，token 不进 query/log。
- Chromium 不访问任意外网/内网资源；报告 HTML 经过模板/URL allowlist，防 SSRF。
- 备份/restore/rollout 脚本启用 `set -euo pipefail`，要求显式目标与确认标识，拒绝空路径、根目录、浮动 `latest` 和生产原地 restore；日志不打印连接串或 secret。
- 发布制品含 SBOM、漏洞阈值、签名与 provenance；secret 扫描失败阻止发布。

## 20. 日志和可观测性要求

- 复用 Batch 025 指标/trace；增加 deployment version、process role、health/readiness、shutdown、Cron lease、WS auth/rooms、Redis adapter、migration、backup/restore。
- API、worker、scheduler 日志统一 stdout JSON；traceId/runId/jobId 传播，禁止 prompt、token、Cookie、持仓、网页正文和 secret。
- 告警：5xx/SSE 恢复率、队列最老任务、Cron 重复/漏跑、Redis OOM/eviction、WS auth reject、migration/backup/restore、磁盘和 Chromium 失败。
- canary 自动比较前后版本错误率、p95、Run 成功率、成本和队列 lag，超阈值停止 rollout。

## 21. 测试要求

- Docker smoke：appuser、只读 root、目录权限、`/health`/`/ready`、中文 PDF/Chromium、SIGTERM。
- process role：API 无副作用 Cron/processor，worker/scheduler 无意外公网 Controller。
- Cron：双实例只执行一次、续租、owner release、进程崩溃接管、业务幂等。
- Redis：`noeviction`、ACL 正/负权限、AOF restart、队列与 Socket adapter 双实例。
- WS：无效 token 断开、owner subscription、跨实例 room、token refresh/replay、payload 安全。
- migration：空库/已有库 `migrate deploy`、schema drift、失败阻止放流。
- CI E2E：固定 server digest + client build，登录、Agent SSE、取消/恢复、通知/WS、报告 smoke。
- backup：加密/校验和、隔离数据库 restore、行数/schema/app smoke 与 RPO/RTO 记录。

## 22. 执行命令

- `pnpm install --frozen-lockfile`
- `pnpm exec prisma generate`
- `pnpm run lint`
- `pnpm run build`
- `pnpm test`
- `docker build --pull -f dockerfiles/app/Dockerfile.prod -t quant-server:${GIT_SHA} .`
- `docker compose -f docker-compose.prod.yml config`
- `docker compose -f docker-compose.prod.yml run --rm migration`
- `docker compose -f docker-compose.prod.yml up -d database redis api worker scheduler edge`
- `curl -fsS http://localhost/health`
- `curl -fsS http://localhost/ready`
- `yarn --cwd ../client-code install --frozen-lockfile`
- `yarn --cwd ../client-code lint`
- `yarn --cwd ../client-code test`
- `yarn --cwd ../client-code build`
- `yarn --cwd ../client-code e2e e2e/agent-production-smoke.spec.ts`
- `scripts/ops/backup-postgres.sh --env-file <approved-env>`
- `scripts/ops/restore-postgres-drill.sh --manifest <backup-manifest> --target <isolated-db>`

## 23. 验收标准

- 生产镜像以 appuser 在只读 root 下启动；`/health`、`/ready`、日志、临时目录和中文 PDF 全通过。
- fresh/已有数据库只用 `migrate deploy`；migration 失败时 API/worker/scheduler 不放流。
- API、worker、scheduler 独立启动/扩容；双 scheduler 无重复业务 Cron，故障可接管。
- Redis `noeviction` 与 ACL 实测有效；API/worker/socket 无越权命令，Socket 跨实例通知可达。
- 无效 WS token 被断开，用户不能订阅他人 Run/回测；前端 refresh/reconnect 正常。
- CI 产出签名不可变摘要，固定摘要全栈 E2E 通过；不再依赖 `latest`。
- 备份可在隔离环境恢复并通过应用 smoke；canary 自动门禁和旧摘要 rollback 演练成功。

## 24. 完成定义

生产 Docker/Compose/nginx、health、migration job、non-root/Chromium、Redis ACL/noeviction、process roles、Cron lock、WS adapter/auth、server/client CI E2E、SBOM/扫描、备份恢复、rollout/rollback 脚本和运行证据全部合入；运维人员无需手工拼命令修补部署。

## 25. 回滚方案

- 发布前记录 `ReleaseManifest.previousDigest`；canary 失败停止增流，脚本把 edge/worker/scheduler 切回上一签名摘要并验证 `/health`、`/ready` 与核心 Run。
- 数据库只使用 expand/contract；应用回滚不执行自动 down migration。若新 schema 不兼容，停止发布并前向修复。
- Redis/ACL 改造回滚保留 AOF/RDB 与旧凭据短暂双轨窗口，确认全部客户端切换后再撤销；不删除队列 key。
- Cron/WS feature flag 可禁用新 adapter/runner，但 scheduler 只能保留一个旧实例；Run/outbox/通知数据不删除。
- Chromium/报告失败时禁用 PDF worker，保留 HTML/已生成对象；不得改回 root 容器或永久 `--no-sandbox`。

## 26. 后续批次

- Batch 028 只有在本批次鉴权、审计、网络隔离、部署和恢复门禁通过后，才可评估受控 SQL Explorer。
- 后续 Batch 029 修复回测 bias/复权后再解除生产 warning。
- 每季度重复 restore、WS 多实例、scheduler failover 与 rollback 演练；依赖/镜像漏洞按风险滚动修复。
