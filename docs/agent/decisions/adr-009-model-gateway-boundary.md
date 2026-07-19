# ADR-009：模型网关边界

## 背景

系统需支持 OpenAI、Anthropic、Gemini、DeepSeek、Qwen、GLM、Kimi 和 OpenAI-compatible API。不同供应商 Tool Call、流式、结构化输出、usage 和推理状态不同。

## 问题

直接散落 SDK 调用、使用单厂商 Agent SDK，还是构建统一网关？网关是否独立部署？

## 可选方案

1. 业务 Service 直接调用供应商 SDK。
2. NestJS 内独立 `ModelGatewayModule`。
3. 独立网关微服务。
4. 绑定单厂商 Agent SDK；例如 [OpenAI Agents SDK TypeScript](https://openai.github.io/openai-agents-js/) 提供 Tool、Session 和 tracing，但核心抽象仍以 OpenAI 生态为中心。

## 最终决策

采用方案 2。定义规范化 `ModelRequest/ModelEvent/ToolCall/Usage`，用 DI token 注册 Provider Adapter；首期实现 OpenAI-compatible Adapter 和一个主模型配置，随后独立实现 Anthropic/Gemini。业务层只依赖内部协议。暂不拆独立进程。

## 选择理由

多模型是明确需求；内部模块可统一超时、重试、熔断、成本、Tool ID 映射和脱敏，同时保留 NestJS 事务/traceId。

## 放弃其他方案原因

散落 SDK 无法治理；独立微服务首期增加网络和密钥运维；单厂商 SDK 不满足供应商隔离。

## 正面影响

切换模型不丢内部状态；统一审计和成本；Provider 差异被隔离。

## 负面影响

需维护适配层，无法暴露所有厂商专有能力。

## 风险

“最小公分母”限制能力。内部协议保留 capability profile 和 providerExtensions，但工作流不得依赖未声明能力。

## 后续复审条件

模型调用量/团队边界要求独立扩容；多个应用共享网关；密钥隔离必须进程级；网关网络开销可接受。
