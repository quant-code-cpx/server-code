---
batch: 17
status: pending
type: frontend
depends_on: ["batch-015-frontend-stream-client-and-contracts", "batch-016-frontend-chat-shell"]
blocks: ["batch-018-mvp-e2e-and-model-regression", "batch-022-research-report-and-investment-journal"]
parallel_with: ["batch-007-stock-market-query-tools", "batch-008-financial-fund-flow-tools", "batch-009-deterministic-quant-tools", "batch-010-web-search-and-citations", "batch-011-agent-orchestrator-workflow", "batch-012-agent-bullmq-worker", "batch-013-conversation-rest-api", "batch-014-post-sse-stream-and-replay"]
recommended_executor: frontend-coding-agent
recommended_reasoning_level: high
estimated_scope: large
---

# Batch 017：前端富响应块与可审计展示

## 1. 批次目标

为 Batch 016 消息壳实现白名单 BlockRenderer、安全 Markdown、引用、Tool 执行卡、表格、通用图表、股票 K 线、财务指标与风险提示；复用现有 MUI、ApexCharts 和股票详情能力，所有数据块显示时点、来源、单位与 warning。

## 2. 业务价值

Agent 回答从纯文本升级为可核验的量化研究结果。用户能检查数据来源、工具失败、复权/单位和数据截止日；单块故障不会摧毁整条回答。

## 3. 前置依赖

- Batch 015 生成消息块、引用与 Tool 事件类型。
- Batch 016 提供 MessageItem、消息视口、运行状态和错误恢复壳。
- Batch 007–010 的结果 fixture 可并行准备；公共结构仍以 `docs/agent/api/` 为准。

## 4. 执行范围

- 抽取可供研究笔记与 Agent 共用的安全 Markdown/GFM renderer。
- 白名单分发公共消息块；未知/过新/畸形块局部降级。
- Tool 状态、输入/输出脱敏摘要、耗时、warning 与重试尝试展示。
- 引用列表、来源定位、数据 provenance。
- MUI Table、ApexCharts、K 线和财务指标适配器、性能/可访问性/安全测试。

## 5. 不在本批次范围内

- 不允许服务端下发任意 HTML、React 组件、ApexCharts config、formatter 或脚本。
- 不引入 MUI DataGrid，不做十万行客户端表格。
- 不复刻股票详情全部分时/盘口/资金流标签页。
- 不新增消息块、Tool、REST DTO 或事件；缺契约回 Batch 001/API 文档修改。
- 不实现报告保存/投资日志；Batch 022 负责。

## 6. 涉及的现有文件

- `../client-code/src/sections/research-note/research-note-preview.tsx`
- `../client-code/src/components/chart/chart.tsx`
- `../client-code/src/components/chart/use-chart.ts`
- `../client-code/src/components/chart/types.ts`
- `../client-code/src/components/chart/__tests__/`
- `../client-code/src/api/stock.ts`
- `../client-code/src/sections/stock-detail/stock-detail-market-tab.tsx`
- `../client-code/src/components/label/`、`iconify/`、`scrollbar/`
- Batch 016 `src/sections/agent/components/message-item.tsx`

## 7. 需要新增的文件

- `../client-code/src/components/markdown/markdown.tsx`
- `../client-code/src/components/markdown/markdown.types.ts`
- `../client-code/src/components/markdown/__tests__/markdown.test.tsx`
- `../client-code/src/components/stock-kline/stock-kline.tsx`
- `../client-code/src/components/stock-kline/stock-kline.types.ts`
- `../client-code/src/components/stock-kline/__tests__/stock-kline.test.tsx`
- `../client-code/src/sections/agent/components/tool-call-card.tsx`
- `../client-code/src/sections/agent/components/citation-list.tsx`
- `../client-code/src/sections/agent/components/data-provenance.tsx`
- `../client-code/src/sections/agent/components/blocks/block-renderer.tsx`
- `../client-code/src/sections/agent/components/blocks/block-error-boundary.tsx`
- `../client-code/src/sections/agent/components/blocks/markdown-block.tsx`
- `../client-code/src/sections/agent/components/blocks/data-table-block.tsx`
- `../client-code/src/sections/agent/components/blocks/chart-block.tsx`
- `../client-code/src/sections/agent/components/blocks/stock-kline-block.tsx`
- `../client-code/src/sections/agent/components/blocks/financial-metrics-block.tsx`
- `../client-code/src/sections/agent/components/blocks/risk-notice-block.tsx`
- `../client-code/src/sections/agent/lib/message-block-guards.ts`
- `../client-code/src/sections/agent/lib/format-finance-value.ts`
- `../client-code/src/sections/agent/lib/chart-adapters.ts`
- `../client-code/src/sections/agent/__tests__/block-renderer.test.tsx`
- `../client-code/src/sections/agent/__tests__/tool-call-card.test.tsx`
- `../client-code/src/sections/agent/__tests__/citation-list.test.tsx`
- `../client-code/e2e/agent-rich-response.spec.ts`

## 8. 需要修改的文件

- `../client-code/src/sections/research-note/research-note-preview.tsx`：改用共享 Markdown，不改变研究笔记功能。
- `../client-code/src/sections/agent/components/message-item.tsx`：接入 BlockRenderer、引用和 Tool 卡。
- `../client-code/src/components/chart/`：仅补通用主题/无障碍能力，不复制 Agent 专属 adapter。
- `../client-code/src/sections/stock-detail/stock-detail-market-tab.tsx`：改用抽取后的 StockKline 展示内核，保留取数/标签页职责。
- `../client-code/src/mocks/agent-mocks.ts`：加入所有 canonical block、未知版本和超限 fixture。
- `../client-code/e2e/` fixture/helper：加入固定富响应场景。

## 9. 数据库变更

不涉及。图表、表格和引用均来自服务端消息/Tool 结果；前端不写派生事实。

## 10. API 变更

不新增 API、DTO 或事件。消息块、provenance、引用、Tool 摘要和错误只消费 `docs/agent/api/README.md`、`rest-api.md`、`sse-events.md`、`error-codes.md` 的生成类型。

## 11. 后端实现任务

不改后端。若 fixture 无法表达需要的来源、单位或 warning，先在 canonical API/Batch 001 评审契约；禁止前端添加隐藏字段或猜测口径。

## 12. 前端实现任务

- BlockRenderer 运行时校验后以固定映射选择组件；未知块显示升级提示，单块 ErrorBoundary 隔离。
- Markdown 禁止原始 HTML，外链执行协议/域安全处理，代码只展示不执行。
- ToolCallCard 使用事件投影展示状态、attempt、脱敏摘要、耗时、时点和 warning；不显示隐藏推理/原始敏感 payload。
- 表格数值右对齐、单位进表头、null 显示缺失、CSV 防公式注入；大结果展示 truncated/next action。
- Chart adapter 只接收已验证数据，formatter 从本地 allowlist 选择；提供文本摘要/数据表替代。
- StockKline 接收已排序 OHLCV 与明确 adjustment，不负责 fetch；复权风险未验证时醒目标警。
- 流式 Markdown/文本按 Batch 015/016 批次更新，终态后再做完整高成本渲染。

## 13. Tool 或工作流变更

不改 Tool/Workflow。15 个 Tool 的结果只通过公共消息块和 Tool 事件呈现；前端不能基于 toolName 执行任意组件代码。回测、行情和财务 warning 原样保留并提升到用户可见区域。

## 14. 详细执行步骤

1. 从研究笔记抽共享 Markdown，先跑研究笔记回归与 XSS fixture。
2. 实现公共消息块 runtime guards、BlockErrorBoundary 和未知版本降级。
3. 接入 Markdown、风险、provenance、引用和 Tool 卡；验证流式/终态更新。
4. 实现 Table 与金融值 formatter，固定 null、金额、比例、日期和 CSV 规则。
5. 基于现有 `components/chart` 实现 chart adapter 与可访问替代。
6. 从股票详情巨型组件抽 StockKline 纯展示内核；股票详情与 Agent 分别写 adapter 测试。
7. 加 lazy render、memo、ResizeObserver 节流、虚拟列表兼容和窄屏布局。
8. 完成安全、视觉、可访问性、性能和 Playwright 富响应回归。

## 15. 核心数据结构

- `SupportedMessageBlock`：Batch 015 生成 union 经过 runtime guard 后的窄化类型。
- `BlockRenderContext`：messageId、runId、streaming、theme、citation lookup；不含任意组件工厂。
- `FinanceFormatSpec`：unit/currency/scale/precision/null policy，值来自协议、规则在客户端固定。
- `NormalizedKlineSeries`：tsCode、adjustment、timezone、升序 bars、provenance/warnings。
- `ChartViewModel`：允许 chart kind、x、有限 series、本地 formatter key、文本摘要。

## 16. 关键接口定义

- `isSupportedMessageBlock(input: unknown): input is SupportedMessageBlock`
- `BlockRenderer({ block, context })`
- `Markdown({ children, streaming, citationResolver })`
- `toChartViewModel(block): ChartViewModel`
- `StockKline({ series, height, onOpenStockDetail })`
- `formatFinanceValue(value, spec): string`

所有公共 block/引用字段由生成类型决定，不在本批次重新声明。

## 17. 配置和环境变量

- 可增加 `VITE_AGENT_RICH_BLOCKS_ENABLED=false`，用于独立灰度；关闭时只显示安全 Markdown/纯文本和“暂不支持此数据块”。
- 图表点数、表格行列和 Markdown 字符上限使用代码常量并与后端契约较小值对齐，不由用户环境变量放大。
- 不引入 CDN 脚本或前端密钥。

## 18. 异常和边缘场景

- 未知 block type/version、缺字段、超长字符串、过多系列/点/行列、NaN/Infinity。
- null 与真实 0、百分比 decimal/percent、不同币种、时区/非交易日、乱序/重复 K 线。
- Markdown 恶意 HTML、javascript/data URL、超深嵌套、超长代码块、表格横向溢出。
- 引用缺链接、来源冲突、网页已更新、Tool 部分失败、warning/truncated。
- 图表初始化/ResizeObserver 失败、隐藏 Drawer、暗色模式、窄屏和 reduced motion。

## 19. 安全要求

- 禁止 `dangerouslySetInnerHTML`；如确需 HTML，必须单独评审并使用严格 sanitizer allowlist。
- URL 只允许安全协议；外链加安全 rel，图片默认禁用或走受控允许域。
- 服务端不能下发 Apex callback、formatter、颜色脚本、组件名动态 import。
- CSV 对 `= + - @` 起始单元格转义，防表格公式注入。
- Block 错误日志不含网页正文、完整 Tool payload、持仓或模型回答。

## 20. 日志和可观测性要求

- 指标：block type/版本使用量、runtime validation reject、render error、render duration、chart point count、降级率。
- 未知/失败块上报 messageId/blockIndex/schemaVersion/traceId，不上报内容。
- 流式阶段与终态渲染耗时分开；对超预算块记录性能 warning。

## 21. 测试要求

- Markdown：XSS、链接、GFM、代码、流式、研究笔记回归。
- BlockRenderer：全部 canonical 类型、未知类型/版本、畸形/超限、单块错误隔离。
- Tool/引用：状态更新、attempt、warning、来源定位、缺链接和可访问性。
- Table/formatter：null/0、货币/比例、CSV 注入、窄屏。
- Chart/Kline：主题、单位、时区、排序/去重、点数降级、文本替代、卸载清理。
- Playwright：一条回答同时含文本、Tool、引用、表格、图表、K 线、风险提示；单块失败不影响后续。

## 22. 执行命令

- `yarn --cwd ../client-code test src/components/markdown/__tests__/markdown.test.tsx src/components/stock-kline/__tests__/stock-kline.test.tsx src/sections/agent/__tests__/block-renderer.test.tsx src/sections/agent/__tests__/tool-call-card.test.tsx src/sections/agent/__tests__/citation-list.test.tsx`
- `yarn --cwd ../client-code test src/components/chart/__tests__ src/sections/research-note`
- `yarn --cwd ../client-code e2e e2e/agent-rich-response.spec.ts`
- `yarn --cwd ../client-code lint`
- `yarn --cwd ../client-code build`

## 23. 验收标准

- 所有 canonical 消息块由固定组件渲染，未知/恶意/超限输入局部降级且无代码执行。
- 数值、单位、数据时点、来源、引用、warning 和 truncated 对用户可见；null 不变 0。
- 图表/K 线复用现有主题，暗色/亮色/移动端/读屏均有可用表示。
- 股票详情改用抽取内核后功能无回归；Agent 不导入巨型 market tab。
- 长回答滚动和流式更新无明显抖动，单块错误不影响消息或会话。

## 24. 完成定义

共享 Markdown、白名单 renderer、Tool/引用/provenance、Table/Chart/Kline/财务/风险组件、股票详情适配、安全/性能/可访问性测试和 E2E fixture 全部合入。

## 25. 回滚方案

关闭 `VITE_AGENT_RICH_BLOCKS_ENABLED`，BlockRenderer 回退安全纯文本/升级提示；回退共享 Markdown 或 StockKline 时恢复研究笔记/股票详情原组件。保留服务端结构化块，不删除历史消息。

## 26. 后续批次

- Batch 018 在真实 Agent 闭环验证所有富响应和故障路径。
- Batch 022 复用安全块生成研究报告/投资日志预览。
- Batch 026 为静态资源、CSP、同域 API/SSE 和生产观测提供部署保障。
