# 模型网关设计

## 1. 边界与目标

`ModelGatewayModule` 位于 `src/apps/agent/model-gateway/`，是 NestJS 内部供应商无关模块。Orchestrator 只依赖内部 port；OpenAI、Anthropic、Gemini、DeepSeek、Qwen、GLM、Kimi 或其他 OpenAI-compatible 差异全部停在 Adapter 内。

网关负责请求规范化、能力校验、模型路由、消息转换、Tool Call ID 映射、结构化输出、流式事件、超时/限流/熔断、usage/cost 和脱敏审计。网关不负责工作流、Tool 权限、会话摘要、金融数据访问或最终引用验证。

采用内部模块而非独立微服务的理由与复审条件见 [ADR-009](../decisions/adr-009-model-gateway-boundary.md)。

## 2. 内部接口

以下是后端 port，不是前端公共协议：

```ts
interface ModelGateway {
  stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelEvent>
  complete(request: ModelRequest, signal: AbortSignal): Promise<ModelCompletion>
  getCapabilities(modelRef: string): ModelCapabilities
}

type ModelRequest = {
  modelPolicy: 'AUTO' | 'MANUAL'
  preferredModel?: string | null
  purpose: 'CLASSIFY' | 'PLAN' | 'SYNTHESIZE' | 'SUMMARIZE' | 'VERIFY'
  messages: NormalizedMessage[]
  tools: NormalizedToolDefinition[]
  responseSchema?: Record<string, unknown>
  temperature?: number
  reasoningEffort?: 'LOW' | 'MEDIUM' | 'HIGH'
  maxOutputTokens: number
  deadlineAt: string
  trace: { runId: string; modelCallId: string; traceId: string }
}
```

`NormalizedMessage` 只保留跨供应商可移植内容：role、结构化 content blocks、内部 `toolCallId`、Tool 结果摘要与引用 ID。供应商原生 reasoning state、cache handle 或 response ID 只能放在 `providerExtensions`，不能成为后续 Run 的必要状态。

统一事件至少覆盖 `OUTPUT_TEXT_DELTA`、`TOOL_CALL_DELTA`、`TOOL_CALL_COMPLETED`、`USAGE`、`COMPLETED`、`FAILED`。转成前端事件时必须使用 [SSE 事件](../api/sse-events.md) 的 `model.*` 结构，不能把内部枚举直接暴露给前端。

ModelCall 的 canonical 状态集合为 `PENDING/STREAMING/RETRY_WAIT/SUCCEEDED/FAILED/CANCELLED`。首个可见增量前保持 `PENDING`；产生增量后进入 `STREAMING`；同一 Provider 的可重试等待进入 `RETRY_WAIT`，恢复后回到 `PENDING` 或 `STREAMING`。成功终态使用 `SUCCEEDED`，不与 Run 的 `COMPLETED` 混用。

## 3. Provider Adapter

```ts
interface ModelProviderAdapter {
  readonly provider: string
  listModels(): readonly ModelDescriptor[]
  supports(model: string, required: RequiredCapabilities): boolean
  stream(request: ProviderModelRequest, signal: AbortSignal): AsyncIterable<ProviderModelEvent>
}
```

首期实现 `OpenAiCompatibleAdapter`，但不能假定所有兼容端点都支持同一能力。每个 `ModelDescriptor` 显式声明：

- context window、最大输出、Tool Call、并行 Tool、JSON Schema/structured output、streaming、vision。
- 支持的 reasoning effort 与是否返回可计费 reasoning tokens。
- 数据驻留/日志保留策略标签、每百万输入/输出 token 成本、限流组。
- 是否允许处理 `PUBLIC`、`USER_PRIVATE`、`PORTFOLIO_SENSITIVE` 数据等级。

Anthropic 与 Gemini 必须各自实现 Adapter，不通过“伪 OpenAI”字段猜测。DeepSeek、Qwen、GLM、Kimi 若使用 OpenAI-compatible 接口，也要有独立 capability 配置和契约测试。

## 4. 路由决策

路由输入由程序生成，不让模型自行选择供应商。筛选顺序：

1. 用户/管理员允许的供应商和数据处理区域。
2. `purpose` 所需能力、context window、Tool/structured output 支持。
3. 供应商健康状态、并发/速率配额和 circuit breaker。
4. 当前 Run 剩余成本与 deadline。
5. MANUAL 模式优先指定模型；不满足硬约束时返回 `AI_MODEL_NOT_AVAILABLE`，不静默换模型。
6. AUTO 模式按配置的质量层级、延迟和成本评分选择，并持久化路由原因。

示例策略：分类/摘要使用低成本模型；复杂规划与综合使用支持严格 Tool Schema 的主模型；引用验证优先结构化输出稳定的模型。模型名与价格属于配置数据，不能硬编码进 Workflow。

## 5. 多模型连续性

- 数据库保存规范化消息、Tool call、Tool 结果和引用；不依赖供应商会话对象，所以切换模型不丢历史。
- 每个内部 `modelCallId`、`toolCallId` 由系统先创建；Adapter 保存 `providerCallId/providerToolCallId -> internalId` 映射。供应商重试不能生成第二个业务 ToolCall。
- Context Builder 按目标模型窗口重新裁剪，使用原始消息 ID、版本摘要和 Tool 摘要；不把另一模型隐藏推理传给新模型。
- Provider 在任何可见 `model.delta` 之前失败，可透明降级；已产生可见增量后失败时，先把当前 ModelCall 标为失败，再创建新 ModelCall 并发出明确重试阶段，禁止把两个流伪装成同一次调用。
- 不支持当前 Tool Schema 的模型不进入候选；不得把 Tool 描述改写成自由文本后继续执行。
- 切换只影响后续 Run；会话 API 的行为以 [REST API](../api/rest-api.md) 为准。

## 6. 超时、重试、熔断和并发

| 层                      | 策略                                                                    |
| ----------------------- | ----------------------------------------------------------------------- |
| 单次调用                | 默认 120 秒，受 Run deadline 进一步收紧；AbortSignal 必须传到 SDK/HTTP  |
| 网络错误/429/可重试 5xx | 同 Adapter 最多 2 次短重试，指数退避+jitter；不重试已完成的 Tool 副作用 |
| 降级                    | AUTO 才允许；换 Provider 必须创建新的 ModelCall 审计记录                |
| 熔断                    | 按 `(provider, region, modelGroup)`，连续失败打开；半开只放少量探测     |
| bulkhead                | 每供应商、模型、用户和全局分别限并发；等待也消耗 Run deadline           |
| 配额                    | 入队前估算、每次调用前复核、完成后用真实 usage 结算                     |

供应商没有返回 usage 时只允许记录 `estimated=true` 的保守估计，不能当精确费用。

## 7. 数据与密钥安全

- API Key 只由 Provider Adapter 从 Secret/环境配置取得，不进 Prompt、BullMQ payload、数据库正文或前端。
- Prompt 发送前按数据等级做字段级裁剪。持仓数量、成本价、投资日志默认属于 `PORTFOLIO_SENSITIVE`；无供应商授权时只传程序生成的聚合风险摘要。
- 日志只记录 provider、model、purpose、token/cost、latency、状态和内部 ID；默认不记完整 Prompt/response。
- 不保存模型隐藏推理；只保存用户可见正文和程序生成的 `planSummary`。
- Provider 原始错误先映射为内部类别，再按 [Agent 错误码](../api/error-codes.md)输出；生产响应不得含原始 body、request headers 或 key。

完整策略见[安全设计](./security.md)。

## 8. 缓存

MVP 不对交互回答做跨用户响应缓存。允许：

- 对不含用户数据的分类/固定摘要做精确键缓存，key 必须包含 provider、model、promptVersion、输入 hash 和安全域。
- 供应商支持 prompt cache 时记录命中与费用，但 cache handle 只留 Adapter，并设置生命周期。
- Tool 数据缓存属于 [Tool 系统](./tool-system.md)，不由模型网关重复维护。

## 9. 文件落点

新增：

```text
src/config/agent-model.config.ts
src/apps/agent/model-gateway/model-gateway.module.ts
src/apps/agent/model-gateway/model-gateway.service.ts
src/apps/agent/model-gateway/model-gateway.types.ts
src/apps/agent/model-gateway/model-router.service.ts
src/apps/agent/model-gateway/model-capability-registry.service.ts
src/apps/agent/model-gateway/model-usage.service.ts
src/apps/agent/model-gateway/providers/model-provider.adapter.ts
src/apps/agent/model-gateway/providers/openai-compatible.adapter.ts
src/apps/agent/model-gateway/providers/anthropic.adapter.ts       # 后续
src/apps/agent/model-gateway/providers/gemini.adapter.ts          # 后续
```

修改：

- `src/config/index.ts`：注册模型网关配置。
- `.env.example`：只声明变量名和说明，不放真实 Key。
- `src/apps/agent/agent.module.ts`：导入 `ModelGatewayModule`，Orchestrator 只注入 port token。

## 10. 异常与扩展

- Provider 不返回完整 Tool arguments：Adapter 只缓存增量，完整 JSON 校验成功后才产生 Tool call；流结束仍不完整则失败。
- usage 事件早于/晚于完成事件：聚合器幂等合并，最终只结算一次。
- 上下文过大：先由 Context Builder 裁剪；仍超限返回 `AI_CONTEXT_TOO_LARGE`，不能无限递归摘要。
- 新供应商扩展：实现 Adapter、声明 capability/price/data policy、加入 fixture 契约测试；不得修改 Orchestrator 分支。
- 供应商专有功能：放 `providerExtensions` 并由 capability gate 控制；Workflow 不得依赖未声明特性。

## 11. 测试与验收

新增：

```text
src/apps/agent/test/model-gateway/model-router.service.spec.ts
src/apps/agent/test/model-gateway/openai-compatible.adapter.spec.ts
src/apps/agent/test/model-gateway/model-stream-normalizer.spec.ts
src/apps/agent/test/model-gateway/model-fallback.integration.spec.ts
src/apps/agent/test/model-gateway/model-cost.spec.ts
```

必须使用录制后脱敏的 fixture/fake server，覆盖：流分片、UTF-8 边界、Tool arguments 分段、Tool ID 映射、structured output 校验、429/timeout/断流、熔断半开、AUTO 降级、MANUAL 拒绝降级、usage 缺失和成本上限。CI 不调用真实付费 API。
