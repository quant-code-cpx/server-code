# ADR-002：SSE 与 WebSocket

## 背景

项目已有 Socket.IO `/ws`，但前端未在握手携带 Token，后端允许匿名连接、订阅未校验归属，事件回放契约也未闭合。

## 问题

聊天 Token、Tool 状态、后台通知分别使用 HTTP、SSE 或 WebSocket？

## 可选方案

1. 全 WebSocket：双向能力强，但重放、代理、扩容和鉴权复杂。
2. 原生 EventSource：浏览器重连好，但仅 GET 且不能按当前方式携带 Bearer Token。
3. POST fetch-SSE + WebSocket 通知：一条权威 Run 流，后台仅发失效通知。
4. 轮询：简单但首 Token 与 Tool 进度体验差。

## 最终决策

命令用 POST JSON；Run 过程用 `fetch` 发 POST 并读取 SSE；Socket.IO 仅发多端状态和后台完成通知；轮询作降级。

## 选择理由

符合仓库“所有 Controller 端点用带路径 `@Post`”规则；可带 JWT、AbortSignal、`Last-Event-ID`；单向响应匹配 Agent 输出；现有 WS 可在修复后继续复用。

## 放弃其他方案原因

全 WS 会形成第二套业务 RPC；EventSource 与 POST/Bearer 不兼容；纯轮询延迟和请求量差。

## 正面影响

协议简单、HTTP 基础设施兼容、事件可落库回放、Token 流与通知边界清晰。

## 负面影响

需自写 SSE 解析器与 `TransformInterceptor` 旁路；部分反向代理要关闭响应缓冲。

## 风险

代理 idle timeout、网络断流、Token 过期后重连。通过 heartbeat、事件序号、持久化重放和 refresh 后重连处理。

## 后续复审条件

需要实时语音/双向协作、单 Run 高频双向控制，或 POST-SSE 被目标网关禁止时复审。
