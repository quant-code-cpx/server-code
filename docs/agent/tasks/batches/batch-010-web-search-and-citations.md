---
batch: 10
status: completed
type: backend
depends_on: ["batch-003-agent-audit-and-citation-schema", "batch-006-tool-registry-and-policy"]
blocks: ["batch-011-agent-orchestrator-workflow", "batch-025-ai-observability-cost-and-evaluation"]
parallel_with: ["batch-007-stock-market-query-tools", "batch-008-financial-fund-flow-tools", "batch-009-deterministic-quant-tools", "batch-015-frontend-stream-client-and-contracts", "batch-016-frontend-chat-shell"]
recommended_executor: backend-coding-agent
recommended_reasoning_level: very-high
estimated_scope: large
---

# Batch 010：受控联网搜索、抓取与引用

## 1. 批次目标

实现 `search_web`、`fetch_web_page` provider adapter、SSRF 隔离、来源持久化和引用 locator，使内部数据可与最新外部信息安全融合。

## 2. 业务价值

回答公告、政策和新闻问题时给出可验证来源，而不是模型记忆或无法追溯的搜索摘要。

## 3. 前置依赖

- Batch 003 来源/引用模型。
- Batch 006 Tool 基础与审计。

## 4. 执行范围

- 搜索 provider port + fake provider + 一个待配置真实 adapter。
- 搜索签发 run/user-bound URL token；抓取只接受 token。
- 内容清洗、hash、来源分级、引用定位和 prompt injection 隔离。

## 5. 不在本批次范围内

- 不构建通用浏览器/JS 渲染平台。
- 不绕过 robots/版权/供应商条款。
- 不把网页全文默认永久存数据库。

## 6. 涉及的现有文件

- `src/shared/context/`、logger/metrics/config
- `docs/agent/tools/schemas/web-research-tools.md`
- Batch 003 `AiSearchSource/AiCitation` repositories

## 7. 需要新增的文件

- `src/apps/web-search/web-search.module.ts`
- `src/apps/web-search/web-search.provider.ts`
- `src/apps/web-search/web-search.service.ts`
- `src/apps/web-search/web-fetch.service.ts`
- `src/apps/web-search/ssrf-policy.service.ts`
- `src/apps/web-search/providers/fake-search.provider.ts`
- `src/apps/web-search/test/web-search.service.spec.ts`
- `src/apps/agent/tools/adapters/web-research-tools.ts`
- `src/config/search.config.ts`

## 8. 需要修改的文件

- `src/app.module.ts` 导入 WebSearchModule
- `src/apps/agent/agent.module.ts` 注册两 Tool
- `.env.example` 增加变量名

## 9. 数据库变更

使用 Batch 003 来源/引用表；不新增表。网页正文大于阈值只保存 hash+locator+受控 object ref。

## 10. API 变更

不新增公共 REST；模型只能经 Tool。最终引用展示结构沿用 API content block provenance。

## 11. 后端实现任务

- search 结果 canonicalize/dedupe/sourceType；snippet 不作为关键事实正文。
- URL token 签名绑定 userId/runId/url/expiry；fetch DNS 前后校验并限制 redirect/MIME/bytes/time。
- HTML 转纯文本/sections，不执行 JS，不传 cookie/auth。
- 引用 locator 绑定 contentHash，页面变化不改历史证据。

## 12. 前端实现任务

不涉及；Batch 017 渲染引用。

## 13. Tool 或工作流变更

- `search_web` 最大 10 条；`fetch_web_page` 最大 100k chars。
- 两个 Tool READ/idempotent（fetch 对同 token/content 可缓存），配额独立。

## 14. 详细执行步骤

- 确定 provider port 和 fake fixtures；真实供应商留 discovery 配置 gate。
- 实现 URL canonicalization、source scoring 和 repository 写入。
- 实现 HMAC URL token、SSRF/DNS/redirect/resource policy。
- 实现抽取、section locator、hash、prompt injection marker。
- 注册 Tool 并覆盖内网/redirect/压缩/MIME/重复来源/时间缺失测试。

## 15. 核心数据结构

- `SearchHit`、`SignedUrlTokenClaims`、`FetchedSource`、`CitationLocator`。
- publishedAt 可 null；retrievedAt 必填；sourceType 由服务端规则，不信任模型。

## 16. 关键接口定义

- `SearchProvider.search(query, policy, signal)`
- `WebSearchService.search(context, input)`
- `WebFetchService.fetch(context, urlToken)`
- `SsrfPolicy.assertAllowed(url, resolvedAddresses)`

## 17. 配置和环境变量

- `AGENT_SEARCH_PROVIDER`、`AGENT_SEARCH_API_KEY`、`AGENT_SEARCH_BASE_URL`、`AGENT_SEARCH_TIMEOUT_MS`、`AGENT_FETCH_MAX_BYTES`、`AGENT_URL_TOKEN_SECRET`。

## 18. 异常和边缘场景

- DNS rebinding、IPv6 私网、重定向内网、压缩炸弹、PDF/错误 MIME、JS-only 页面、无日期、canonical 环、paywall、来源改文。

## 19. 安全要求

- 默认拒绝私网/metadata/非 HTTPS/非默认端口；HTTP 仅允许隔离测试 fixture policy，生产不可配置放开。
- 网页指令永远是不可信数据；内容不携带到 system role。

## 20. 日志和可观测性要求

- search/fetch success/latency/quota/cache/sourceType/SSRFReject/bytes/truncated；记录 host hash，不记录敏感 query 原文。

## 21. 测试要求

- fake provider contract；SSRF/DNS/redirect/MIME/size/timeout fixtures。
- URL token 跨 user/run/过期/篡改拒绝。
- citation locator 与 content hash 一致；snippet 不满足强引用。

## 22. 执行命令

- `pnpm test -- src/apps/web-search/test/web-search.service.spec.ts`
- `pnpm run build`
- 真实 smoke 仅在显式测试 key 下手工执行，不进 CI

## 23. 验收标准

- 模型无法抓取任意 URL；所有已抓取来源有 canonical URL、hash、时点和 locator。
- 内部网地址及所有 redirect 绕过 fixture 被拒绝。
- 搜索/抓取失败不会伪造引用，可让 workflow 降级为内部数据回答。

## 24. 完成定义

- [x] Provider-neutral port、默认 `disabled`、测试 `fake` 与配置 gate 后的 Brave adapter 已实现。
- [x] `search_web`、`fetch_web_page` strict schema、READ/idempotent policy 和 `PUBLIC_WEB` scope 已注册。
- [x] HMAC token 绑定 `sourceId/userId/runId/urlHash/expiry`；模型不能提交 URL，跨用户/Run/过期/篡改均拒绝。
- [x] 生产仅 HTTPS 默认端口；HTTP 只能注入精确隔离 fixture，不能由环境配置放开。
- [x] 初始 URL 与每次 redirect 都重新校验 userinfo、协议、端口、hostname、DNS、私网/metadata/IPv6 地址。
- [x] HTTP 客户端使用已校验 DNS 地址完成 lookup pinning；不携带 cookie/auth，限制 redirect/MIME/压缩前后字节/总超时。
- [x] HTML 静态正文、metadata、contentHash、提取版本、paragraph/offset locator 和 Prompt Injection risk flag 已实现。
- [x] 搜索 metadata 与抓取快照通过 `CitationRepository` 写入 `AiSearchSource`；`EXCHANGE/REGULATOR/COMPANY` 映射现有 `OFFICIAL` enum，无 migration。
- [x] 默认 `AGENT_SEARCH_PROVIDER=disabled`、`AGENT_TOOLS_ENABLED` 为空；缺 API key 应用正常启动。
- [x] 专项 7 suites、16/16；Agent/Portfolio/Backtest 38 suites、588/588；Stock 11 suites、229/229。
- [x] build、contracts、legacy ESLint、Prettier、`git diff --check` 通过；真实 HTTPS 抓取成功。
- [x] App/PostgreSQL/Redis healthy；容器内 `/health`、`/ready` 为 ok；[执行报告](../../../Agent受控联网搜索与引用测试执行报告-20260720.md)与 `docs/README.md` 已同步。
- [x] 实现提交：`497cf8a feat(agent): add controlled web research tools`。

## 25. 回滚方案

从 Registry 注销两 Tool、禁用 WebSearchModule；保留历史来源/引用，不删除审计。

## 26. 后续批次

- Batch 011 实现内部+外部融合。
- Batch 017 展示引用。
- Batch 025 评测搜索命中/引用准确率。
