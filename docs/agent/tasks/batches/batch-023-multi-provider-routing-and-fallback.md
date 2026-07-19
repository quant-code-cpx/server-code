---
batch: 23
status: pending
type: backend
depends_on: ["batch-004-model-gateway-foundation", "batch-011-agent-orchestrator-workflow", "batch-018-mvp-e2e-and-model-regression"]
blocks: ["batch-026-security-hardening-and-production-deployment"]
parallel_with: ["batch-019-conversation-summary-and-memory", "batch-020-scheduled-agent-tasks", "batch-021-outbound-notification-channels", "batch-022-research-report-and-investment-journal", "batch-024-python-quant-compute-service", "batch-025-ai-observability-cost-and-evaluation", "batch-029-backtest-bias-and-adjustment-remediation"]
recommended_executor: backend-coding-agent
recommended_reasoning_level: very-high
estimated_scope: large
---

# Batch 023：多供应商模型路由与降级

## 1. 批次目标

在既有 ModelGateway 增加至少第二个 provider、能力/隐私/预算/健康路由、circuit breaker 和可审计降级。

## 2. 业务价值

降低单一模型故障风险，并允许用户在可控范围按能力、隐私和成本选择模型。

## 3. 前置依赖

- Batch 004 ModelGateway。
- Batch 011 Orchestrator。
- Batch 018 MVP 回归。

## 4. 执行范围

- 第二 provider adapter、capability registry、routing policy、health/circuit、fallback attempts。
- 模型列表/会话选择 API 与前端 selector。
- provider contract suite、故障/成本/输出一致性回归。

## 5. 不在本批次范围内

- 不承诺任意 provider 自动兼容。
- 不在单个已输出回答中拼接多个 provider 半流。
- 不让用户提交 base URL/key。

## 6. 涉及的现有文件

- Batch 004 model-gateway
- Batch 003 AiModelCall
- Agent conversation modelPolicy/preferredModel
- 前端 Agent model selector 预留

## 7. 需要新增的文件

- `src/apps/agent/model-gateway/model-router.service.ts`
- `providers/<approved-second-provider>.provider.ts`
- `src/apps/agent/model-gateway/provider-health.service.ts`
- `src/apps/agent/model-gateway/test/model-routing.spec.ts`
- `../client-code/src/sections/agent/components/agent-model-selector.tsx`

## 8. 需要修改的文件

- `src/config/model.config.ts` 支持 provider list/capabilities
- Agent models list/select endpoints
- Orchestrator 记录 route decision category

## 9. 数据库变更

优先复用 Prompt/ModelCall/Conversation；若需管理员配置，新增非 secret `AiModelCatalog` 明确 migration。API key 始终不入库。

## 10. API 变更

- 实现/完成 models list/select 与 conversation model update。
- 响应只返回 displayName/capabilities/status/policy，不返回 base URL/key/内部健康详情。

## 11. 后端实现任务

- 路由顺序：政策/用户 allowlist→地域隐私→能力→预算→健康→默认。
- fallback 仅在 retry-safe、无不可逆副作用且未提交 final output 时发生。
- 每 attempt 独立 ModelCall；切换时发可审计 progress，不伪装同一次调用。

## 12. 前端实现任务

- selector 展示 AUTO/允许模型、能力/可能费用等级和不可用原因；切换只影响后续 Run。

## 13. Tool 或工作流变更

不同 provider 的 Tool schema 由同一 Registry serializer 适配；capability 不足时路由拒绝而非丢 Tool。

## 14. 详细执行步骤

- 确认第二 provider 合规/区域/保留/SDK contract。
- 实现 adapter 并通过 Batch 004 contract suite。
- 实现 policy/health/circuit/fallback 状态机。
- 接 API/UI，冻结每 Run route policy。
- 做限流/5xx/invalid output/stream mid-failure/成本和跨 provider regression。

## 15. 核心数据结构

- `ModelCapability`、`RoutingPolicy`、`RouteDecision { considered, selected, reasonCodes }`、`ProviderHealthState`。

## 16. 关键接口定义

- `ModelRouter.select(requestContext): RouteDecision`
- `ModelGateway.attemptWithPolicy(request, policy, signal)`

## 17. 配置和环境变量

- 每 provider 独立 base URL/key/models/timeouts/budget；`AGENT_MODEL_ROUTING_POLICY`、circuit thresholds。

## 18. 异常和边缘场景

- 首 provider 输出部分 token 后失败、两 provider tool schema 差异、usage 缺失、模型下线、价格配置过期、用户选择无权限模型。

## 19. 安全要求

- provider data residency/retention allowlist；敏感 Run 可限制 provider。
- keys 独立、日志脱敏、管理员配置也不能读回 secret。

## 20. 日志和可观测性要求

- routing selection/fallback/circuit/attempt、provider/model latency/TTFT/usage/cost/error；route reasons 非敏感。

## 21. 测试要求

- 共同 contract suite；路由矩阵/健康/circuit/fallback。
- mid-stream 不拼接；每 attempt 审计/成本一次。
- 前端选择不可用状态与刷新保持。

## 22. 执行命令

- `pnpm test -- src/apps/agent/model-gateway/test/model-routing.spec.ts`
- `pnpm run build`
- `yarn --cwd ../client-code test agent-model-selector`

## 23. 验收标准

- 单 provider 故障在政策允许时可切换，历史可看见每 attempt。
- 能力/隐私/预算禁止项不会被 fallback 绕过。
- 切换模型不改历史消息/Run。

## 24. 完成定义

第二 adapter、router/health/circuit、API/UI、合同/故障/安全测试和供应商决策记录合入。

## 25. 回滚方案

配置只启用首 provider，保留第二 adapter/历史审计；无需 DB 回滚。

## 26. 后续批次

- Batch 025 纳入多 provider 评测。
- Batch 026 生产密钥/灰度。
