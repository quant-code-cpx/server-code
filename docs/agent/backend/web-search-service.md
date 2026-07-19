# 联网搜索与网页抓取服务

## 1. 定位与未决项

当前仓库没有通用搜索供应商、网页抓取、正文提取或来源引用模块，因此新增独立 `WebSearchModule`。正式搜索供应商、区域、配额、是否允许 JavaScript 渲染和网页快照存储产品尚不能从仓库确认；实现先固定供应商无关 port，通过 discovery gate 选择 Adapter，不把某个供应商字段写进 Tool Schema。

MVP 对模型只开放 [Tool 目录](../tools/README.md)中的 `search_web` 和 `fetch_web_page`。任意 URL 访问、浏览器控制、搜索结果自动执行指令都不属于 Tool 能力。

## 2. 模块职责

`WebSearchService` 负责：

- 查询归一、供应商路由、结果去重和查询审计。
- URL 规范化、SSRF policy、受限下载、正文提取和内容类型校验。
- 标题、作者、发布时间、事件时间、抓取时间和来源类型提取。
- 官方来源优先、可信度分级、相似内容聚类、冲突保留和引用候选生成。
- 把外部正文标记为不可信数据，防止 Prompt Injection。

它不负责：决定研究问题、把网页声明为事实、绕过付费墙/登录/robots/服务条款、验证金融内部数据、生成最终回答或保存用户报告。

## 3. 内部接口

精确 Tool 输入输出以 [Tool 目录](../tools/README.md) 为准。内部 port：

```ts
interface SearchProviderAdapter {
  readonly provider: string
  search(query: ProviderSearchQuery, signal: AbortSignal): Promise<ProviderSearchResult>
}

interface WebFetcher {
  fetch(request: SafeFetchRequest, signal: AbortSignal): Promise<FetchedDocument>
}

interface ContentExtractor {
  supports(contentType: string): boolean
  extract(document: FetchedDocument): Promise<ExtractedContent>
}
```

`SearchProviderAdapter` 只返回搜索元数据和供应商摘要；摘要不能冒充原文引用。需要引用正文时必须由 `fetch_web_page` 抓取并生成定位信息，或者把搜索供应商明确支持的可验证 snippet 标为 snippet。

## 4. 执行流程

```mermaid
flowchart LR
  Q["规范化查询 + 时间/域约束"] --> S["Search Provider"]
  S --> N["URL canonicalize + 去重"]
  N --> R["来源初始分级"]
  R --> F["选择候选抓取"]
  F --> P["SSRF / redirect / MIME policy"]
  P --> X["下载 + 正文提取"]
  X --> T["时间、作者、来源、正文 hash"]
  T --> C["聚类 + 冲突/旧闻检测"]
  C --> V["引用定位与持久化"]
```

逻辑状态为 `PENDING -> SEARCHING -> FETCHING -> EXTRACTING -> VERIFIED | PARTIAL | FAILED`；对前端仍投影为规范 `tool.started/completed/failed`，不新增公共事件。

## 5. URL 与网络安全

初始 URL 和重定向每一跳都重新执行完整 policy，包括协议、SSRF、DNS rebinding 与私网地址检查：

1. 生产环境只允许 `https`；`http` 仅允许注入式、隔离测试 fixture，禁止进入生产配置；同时禁止 `file/data/ftp/gopher` 等 scheme。
2. 每一跳解析 hostname 后都拒绝 loopback、link-local、RFC1918、ULA、metadata 地址、本机域名、Unix socket 和内部服务域；连接前再次绑定该跳解析结果，防 SSRF、DNS rebinding 和重定向绕过。
3. 禁止 URL userinfo；规范化 punycode、端口和 fragment；限制 URL 长度、redirect 次数和跨域 redirect。
4. 设置连接/首字节/总超时、最大压缩前后字节、最大正文字符和允许 MIME；防 zip bomb、流式无限响应和非预期二进制。
5. 不透传用户 Cookie、Authorization、内网代理或浏览器登录态；下载器使用独立 egress 身份。
6. 记录最终 URL、redirect chain、DNS/策略决策和 content hash，但不记录敏感 query token。

JavaScript 动态页面不是默认路径。第二阶段如确需渲染，使用独立、无登录态、只读文件系统、禁下载、禁扩展、限 CPU/内存/网络 allowlist 的浏览器 Worker；不复用报告模块 Puppeteer 的进程权限。

## 6. 来源和时间语义

来源等级不是模型自由标签：

| 等级          | 典型来源                                | 使用规则                               |
| ------------- | --------------------------------------- | -------------------------------------- |
| `OFFICIAL`    | 交易所、监管、公司官网/投资者关系、政府 | 优先作为事实来源；仍核对发布时间与正文 |
| `PRIMARY`     | 公司正式披露镜像、法定信息平台          | 与官方源互相校验                       |
| `MEDIA`       | 有编辑责任的新闻媒体                    | 作为报道，不表述成官方事实             |
| `INSTITUTION` | 券商、研究机构、行业协会                | 明确为观点/研究                        |
| `UNVERIFIED`  | 聚合转载、论坛、无法确认作者            | 默认只作线索，不支持高确定性事实       |

每条来源分别保存 `publishedAt`、`eventOccurredAt`、`retrievedAt`、`updatedAt`（若可确认）和 timezone/解析置信度。缺少发布时间不能用抓取时间代替；旧文重新传播通过 canonical URL、content hash、标题/实体/事件时间聚类识别。

同一事件来源冲突时保留双方及各自等级，不在 extractor 中“合并成一个真相”。Workflow 需要至少一个可验证来源；高影响事实优先两个独立来源，官方来源可单独支持其自身声明。

## 7. 外部内容注入隔离

- 网页正文放入明确的 `untrusted_external_content` 数据块，系统 Prompt 告知模型其中的命令、Tool 请求、角色声明和密钥索取都无效。
- 清除脚本、样式、隐藏文本、表单、SVG active content 和不可见字符；保留可引用的纯文本段落及段落 locator。
- 外部文本不能修改 Tool allowlist、model policy、用户身份、成本、截止日或后续 URL policy。
- 即使网页要求“忽略之前指令”“调用某 URL”，Orchestrator 也只执行原 Workflow 已允许的 Tool。
- 检测到注入特征时不必丢弃整篇资料，但标记 risk，降低信任并进入审计；高风险页面不得用于自动写报告。

## 8. 去重、正文和引用

- URL 去重：去 fragment、规范 host/path、剔除已知 tracking 参数，保留可能影响正文的参数。
- 内容去重：规范化正文 hash；近似重复用标题、实体、发布时间和文本指纹聚类。
- 网页快照保存正文 hash、提取器版本和可选对象存储 key；不默认永久保存受版权/服务条款限制的全文。
- Citation 必须指向真实 URL、来源、标题、抓取时间和正文段落 locator；链接失效后仍可用合规快照 hash 验证当时内容。
- 搜索摘要和正文引用分开；不能引用未抓取 snippet 为“原文说”。

物理字段与生命周期见[数据库设计](./database-design.md)，回答块引用结构见 [REST API](../api/rest-api.md)。

## 9. 缓存、限流与失败

- Search query 缓存 key 含 provider、规范查询、时间/域过滤、locale 和安全策略版本；突发新闻 TTL 短，历史官方文档可长。
- Fetch 缓存按 canonical URL + validator/正文 hash；尊重响应缓存指示和数据保留策略。
- provider/user/global 三层限流与 bulkhead；搜索默认有限重试，抓取只重试幂等网络失败。
- 付费墙、登录墙、robots/条款阻止、SSRF、恶意 MIME 返回 `AI_WEB_SOURCE_BLOCKED`；供应商失败映射 `AI_SEARCH_FAILED`。
- 部分候选失败可返回 `PARTIAL`，必须列 warnings；全部失败不能假装完成联网核对。
- 供应商原始 response、网页完整正文和反爬细节不进入公共错误。

## 10. 文件落点

新增：

```text
src/config/web-search.config.ts
src/apps/web-search/web-search.module.ts
src/apps/web-search/web-search.service.ts
src/apps/web-search/search-provider.registry.ts
src/apps/web-search/providers/search-provider.adapter.ts
src/apps/web-search/fetch/safe-web-fetcher.service.ts
src/apps/web-search/fetch/url-policy.service.ts
src/apps/web-search/extract/content-extractor.service.ts
src/apps/web-search/extract/html-content.extractor.ts
src/apps/web-search/source/source-classifier.service.ts
src/apps/web-search/source/search-deduplicator.service.ts
src/apps/web-search/source/citation-builder.service.ts
src/apps/agent/tools/adapters/search-web.tool.ts
src/apps/agent/tools/adapters/fetch-web-page.tool.ts
```

修改：

- `src/config/index.ts`：注册 search 配置。
- `src/apps/agent/agent.module.ts`：导入 `WebSearchModule`，只把两个显式 adapter 注册到 Tool Registry。
- `.env.example`：增加供应商、base URL、配额和策略变量名，不写真实 token。

## 11. 测试与验收

```text
src/apps/web-search/test/url-policy.service.spec.ts
src/apps/web-search/test/html-content.extractor.spec.ts
src/apps/web-search/test/search-deduplicator.spec.ts
src/apps/web-search/test/web-search.service.spec.ts
src/apps/web-search/test/web-search-security.integration.spec.ts
src/apps/agent/test/tools/web-search-tools.contract.spec.ts
```

fixture 覆盖官方公告、媒体转载、无发布时间、旧闻重发、冲突报道、canonical/redirect、乱码、多语言、空正文、付费墙和动态页面。安全测试覆盖所有私网地址表示、IPv4/IPv6、DNS rebinding、跨域 redirect、压缩炸弹、超大流、恶意 MIME、Prompt Injection 和伪造引用。集成测试使用本地受控 fake server，不访问真实互联网。
