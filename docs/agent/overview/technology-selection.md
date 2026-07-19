# 技术选型

## 1. 选型结论

| 问题 | MVP 决策 | 复审条件 |
| --- | --- | --- |
| Agent 编排放哪里 | 现有 NestJS 的 `src/apps/agent/` | 独立扩容或组织边界要求明显 |
| 工作流引擎 | 自研小型、显式、版本化状态机 | 图分支/暂停恢复复杂度超过维护能力时评估 LangGraph |
| LangGraph | 不进入 MVP | 需要大量动态子图、人工审批、跨语言 checkpoint 时试点 |
| LangChain | 不作为编排核心；可借鉴 schema/provider adapter | 多供应商集成维护成本显著上升时局部采用 |
| OpenAI Agents SDK | 不作为跨供应商核心 | 确认长期单一供应商并需要其 handoff/tracing 时复审 |
| 独立模型网关服务 | 不需要；NestJS 内部 Module | 多产品共享、独立团队或独立扩缩容出现时拆分 |
| Python 服务 | MVP 不需要 | CPU 密集计算、ML/科学库、任务时长和隔离指标达到阈值时引入 |
| 消息队列 | 需要；复用 BullMQ，但独立 queue/worker/Redis 策略 | 无 |
| 向量数据库 | MVP 不需要 | 有可评测的非结构化语义检索集后先试点 pgvector |
| 多 Agent | MVP 不需要 | 出现可独立授权、独立评测、可并行的稳定专业子域时复审 |
| 外部搜索 | provider adapter + 受控 fetch | 供应商由 discovery gate 确认 |
| 对象存储 | 接口先行；MVP 本地，生产 S3-compatible | 生产部署前必须确认产品与保留策略 |

## 2. 为什么继续使用 NestJS

现有金融查询、JWT 用户上下文、Prisma、BullMQ、Prometheus、日志都在同一 TypeScript 进程。将编排放入 NestJS 可直接调用受控 Facade，避免内部 HTTP、双份权限和跨语言数据口径。`src/app.module.ts` 已有模块化基础，新增 Agent bounded context 比复制 86 个直接 Prisma 依赖到独立服务风险更低。

限制是 CPU 密集任务会影响 API；因此从第一天就让 Agent Run 进入独立 BullMQ processor，并让 API/worker 可用相同镜像、不同启动命令部署。模块化单体不是“所有工作在 HTTP 进程内执行”。

## 3. 编排框架比较

| 方案 | TS 兼容 | 状态持久化/恢复 | 可控性 | 多模型 | 可观测性 | 绑定与成本 | 当前结论 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 自研显式状态机 | 最佳 | 按本项目表和事件实现 | 最强 | 自建 gateway | 与现有指标统一 | 维护核心代码 | **MVP 推荐** |
| LangGraph JS | 好 | checkpoint、interrupt、stream 能力成熟 | 好，但引入抽象 | 经 LangChain | 有生态追踪 | 学习/升级成本 | 后续候选 |
| LangChain JS | 好 | 需组合其他能力 | 中 | 强 | 生态完善 | 抽象与版本变化 | 只局部借鉴 |
| OpenAI Agents SDK TS | 好 | 需自行对接本项目持久化 | handoff/guardrail 友好 | 以 OpenAI 路线最佳 | 内建 tracing | 供应商倾向明显 | 非跨供应商核心 |
| Semantic Kernel | JS/TS 不是本栈最佳路径 | 支持 agent/process 概念 | 中 | 多供应商 | 企业生态 | 引入 .NET/Python 心智 | 不选 |
| LlamaIndex | 以 RAG/文档索引见长 | 本项目需另建执行状态 | 中 | 支持 | 独立体系 | MVP 无主要 RAG 需求 | 不选 |
| 独立 Python Agent | 跨语言 | 需另做 DB/鉴权/部署 | 边界清晰但重复多 | 强 | 两套体系 | 当前维护成本最高 | MVP 不选 |

LangGraph 官方文档明确提供 [persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence)、[interrupts](https://docs.langchain.com/oss/javascript/langgraph/interrupts) 与 [event streaming](https://docs.langchain.com/oss/javascript/langgraph/event-streaming)，因此它是可信的复审候选；但这些能力本项目仍需映射到自有用户权限、Run event、BullMQ 和 Prisma，不能消除领域实现。OpenAI Agents SDK TS 提供 agents、handoffs、guardrails、sessions 和 tracing，适合单供应商路径，参见其[官方文档](https://openai.github.io/openai-agents-js/)。Semantic Kernel 的能力与支持边界见 [Microsoft 官方文档](https://learn.microsoft.com/semantic-kernel/frameworks/agent/)。

## 4. 自研工作流的限定范围

“自研”只包括一个小型可验证内核：固定状态枚举、注册式节点、条件边、checkpoint、版本冻结、重试/取消、事件持久化。它不包括可视化 DSL、任意用户脚本、动态代码生成、分布式 actor 或通用 BPM 平台。

工作流定义必须是 TypeScript 代码 + 版本号；节点输入输出用 schema 校验。Run 固定 `workflowKey/workflowVersion`，升级不影响进行中或历史执行。核心节点为 `load_context → plan → authorize_tools → execute_tools → synthesize → validate_citations → persist → complete`。

## 5. 模型网关

网关是 `AgentModule` 内的 DI 边界：统一流式文本、结构化输出、Tool calling、usage、timeout、错误分类和 provider request ID。首个 adapter 采用 OpenAI-compatible API；模型名、context window、价格和能力来自配置/数据库 capability，不在文档写易过时常量。

路由顺序是“请求 policy → 用户/管理员允许列表 → 数据地域与隐私约束 → 所需能力 → 预算 → 健康度 → 模型”。失败只在未产生不可逆副作用且预算允许时降级；已输出 token 后切换模型要生成新 attempt 和明确事件，不能拼接成一个不可审计回答。

## 6. TypeScript / Python 边界

现有 TS 已包含回测、因子、风险和市场计算，MVP 的绩效指标、估值分位等使用纯函数实现并固定版本。Python 只在以下任何条件持续出现时引入：

- 单任务 CPU/内存使 Node event loop 或 worker SLO 不可接受；
- 必须使用成熟的 NumPy/Pandas/scikit-learn/优化器能力；
- 需要进程级资源限制或沙箱；
- 独立扩容可显著降低成本。

Python 服务不得直接连接主 PostgreSQL。NestJS 从数据 Facade 取得带版本/时点的输入快照，提交 `calculationType/algorithmVersion/inputHash/parameters`，Python 返回结果、warnings、runtime、codeVersion、outputHash。详情见 [ADR-003](../decisions/adr-003-typescript-python-boundary.md)。

## 7. 检索、向量与搜索

项目的核心事实是结构化行情/财务/因子数据，精确筛选、日期范围、代码关联优先使用 PostgreSQL 索引和确定性 Tool。会话上下文先用最近消息 + 版本化摘要 + 明确用户记忆；研究报告先用元数据、关键词和 PostgreSQL FTS。

仅当离线评测证明语义检索能改善召回，才在现有 PostgreSQL 试点 pgvector；不单独部署向量数据库。联网信息是另一能力：通过 `search_web` 得到候选，再由 `fetch_web_page` 在 SSRF/大小/类型/重定向限制下获取，保留 URL、发布/抓取时间、标题、publisher、内容 hash 和引用片段位置。

## 8. 队列与存储

BullMQ 是已采用的技术，长模型请求、搜索、报告、回测和定时研究都需要重试、并发、延迟和可观察队列，因此继续使用。Agent queue 使用独立前缀和连接配置；生产优先独立 Redis 实例且 `noeviction`。PostgreSQL 保存 job 意图、状态和事件；BullMQ job 不是唯一事实源。

结构化消息与审计留 PostgreSQL。较大 PDF、图像、原始网页归档通过 StoragePort，开发使用本地目录，生产接 S3-compatible 对象存储。对象 key 不包含用户名/股票持仓等敏感明文。

## 9. 十个最容易踩坑的问题

1. 把周/月 `pct_chg` 当日线百分数，导致收益扩大或缩小 100 倍。
2. fresh migration 缺表，却只在已有数据库上用 `db push` 看似正常。
3. 让模型生成 SQL、表名、股票代码或复权口径。
4. SSE 事件先推送后落库，断线后无法可靠 replay。
5. Redis 当权威状态源，并继续用会驱逐队列键的策略。
6. 多副本 cron 无锁，重复研究、重复通知和读取半同步数据。
7. WebSocket 匿名连接或只按 jobId 订阅，造成跨用户数据泄漏。
8. 模型总结混淆报告期、公告日、交易日和抓取时间。
9. 将模型生成 chart options/HTML 直接交给浏览器渲染。
10. 为“未来扩展”过早上多 Agent、向量库、Python 和独立网关，反而没有端到端可审计闭环。

在回测领域还必须把“现有代码能运行”与“结果口径可靠”分开：当前 ALL_A/指数 universe、公告可用日和前复权路径已发现幸存者、前视及复权风险。因此 MVP 只允许读取已有回测并展示风险标记；修复与可复现 golden case 通过前，不让模型自由提交新回测或据此生成强结论。
