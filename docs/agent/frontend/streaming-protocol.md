# POST Fetch SSE 客户端设计

> SSE 公开事件、顺序、恢复与终态规则的唯一规范是 [SSE 事件](../api/sse-events.md)。本文只规定浏览器端实现。

## 1. 为什么使用 Fetch，而不是 EventSource

Agent 运行需要以 POST 携带结构化输入、幂等信息与页面上下文，并复用现有 Bearer 访问令牌。浏览器原生 `EventSource` 只适合 GET，不能可靠满足这些要求。因此使用 `fetch()` 获取 `text/event-stream`，再通过 `ReadableStream` 自行增量解析。

`../client-code/src/api/client.ts` 目前会把成功响应直接读取为 JSON，不能复用其响应消费逻辑。应抽取共享鉴权执行器，再保留两个终端：JSON 终端与流终端。

## 2. 模块拆分

建议新增：

- `../client-code/src/api/agent-stream.ts`：构造 POST、鉴权、AbortSignal、响应头校验和重连入口。
- `../client-code/src/api/sse-parser.ts`：纯字节/文本解析器，不依赖 React。
- `../client-code/src/sections/agent/lib/stream-event-adapter.ts`：把已验证的公开事件转换为内部 reducer action。
- `../client-code/src/sections/agent/hooks/use-agent-run.ts`：管理单次运行生命周期。

解析器只处理 SSE 帧语义；事件 adapter 才理解 Agent 业务。两者分离后，可以用分片字节、CRLF、UTF-8 多字节字符和断线片段做确定性测试。

## 3. 解析算法

实现必须满足以下行为：

1. 使用 `response.body.getReader()` 循环读取 `Uint8Array`。
2. 使用一个持续存在的 `TextDecoder` 流式解码，防止中文字符被切在两个 chunk 后损坏。
3. 同时接受 LF 与 CRLF；空行才结束一帧。
4. 同一帧多行数据按 SSE 规则拼接；忽略注释行，但将其视为连接仍活跃。
5. 未知字段忽略；缺失必需业务字段或 JSON 无法解析时交给恢复层，不把原始内容渲染到 DOM。
6. 流自然 EOF 后刷新 decoder 缓冲；若没有规范终态，则归类为“连接中断”，不能当成功。

解析器输出前须通过 `src/api/generated/agent-api.ts` 的类型和运行时守卫。公开字段不在本文复制，避免文档漂移。

## 4. 生命周期与取消

`use-agent-run` 为每次运行持有独立 `AbortController`：

- 用户点击停止：先记录取消意图，再调用服务端取消命令，随后中止当前 reader。
- 路由切换：按产品策略关闭当前视图 reader，但不默认取消服务端运行。
- Provider 卸载或用户退出：中止所有 reader，并清除内存中的鉴权相关状态。
- 401：走一次共享的单飞刷新；刷新成功后从已确认恢复点重新建立流，不复用已消费 response。

组件不得直接调用 `reader.cancel()`。所有结束路径统一进入 hook，保证计时器、controller、live region 与 reducer 状态一起清理。

## 5. 顺序、去重与恢复

前端对每个运行维护：最后确认位置、已处理事件身份的有界集合、最近活动时间和连接代次。接收事件时按规范校验所属运行和顺序：

- 重复事件直接丢弃，但刷新最近活动时间。
- 出现可补齐的间断时暂停展示后续增量并发起恢复。
- 浏览器离线、休眠、代理重置或 EOF 无终态时，以退避策略从最后确认位置重连。
- 服务端判定恢复位置过旧或历史不可用时，改拉运行与会话权威快照，再决定是否继续流。

事件身份集合必须有界，例如按连续确认位置淘汰旧项，避免长运行无限占用内存。具体恢复参数与服务端响应以 [SSE 事件](../api/sse-events.md) 为准。

## 6. 心跳、超时与退避

每次收到字节、注释或业务帧都更新活动时间。超过协议允许的静默窗口后先标记“连接不稳定”，再主动断开并恢复；不要在尚有活动时用固定请求超时杀死长分析。

自动重连采用带抖动的指数退避，设置最大间隔和总尝试预算；浏览器 `online` 事件可触发一次立即尝试。以下情况不自动循环：权限失败、请求校验失败、显式取消、服务端确定性业务失败。错误分类与 UI 文案见 [错误与恢复](./error-and-recovery.md)。

## 7. 渲染背压

网络事件频率与 React 渲染频率解耦：

- 文本增量先写入运行级内存缓冲，再用 `requestAnimationFrame` 或 30–60ms 节流批量 dispatch。
- 工具状态、终态和错误不延迟；收到后先冲刷文本缓冲。
- 消息列表只更新受影响实体，选择器保持其他消息引用稳定。
- 标签页隐藏时降低刷新频率；重新可见时一次性合并。

不得把每个 token 写入 `localStorage`，也不得为每个 token 触发 Markdown 全量解析。渲染层应在批次边界更新，并对历史消息做 memo/虚拟化。

## 8. WebSocket 的边界

Socket.IO 只负责后台运行完成、跨设备失效、报告与通知，不承载当前回答的逐 token 内容。现有工程需同步修复：

- `../client-code/src/lib/socket.ts` 未在握手携带访问令牌；
- 后端当前对无效令牌连接未强制断开；
- 前端发出的错过事件重放请求尚无对应服务端处理；
- 现有异常扫描监听名与后端实际广播名不一致；
- 多实例缺少 Socket.IO Redis adapter。

修复后的行为以 [WebSocket 事件](../api/websocket-events.md) 为准。若 Socket 不可用，当前 SSE 回答仍应工作，后台状态通过重新进入页面或轮询恢复。

## 9. 测试矩阵

Vitest 至少覆盖：任意 chunk 边界、中文 UTF-8 切分、CRLF、多行数据、注释、空帧、未知字段、畸形 JSON、重复与乱序、EOF 无终态、Abort、401 刷新、退避预算。使用 fake timers 验证心跳与重连。

MSW/测试服务器应真实返回分块流，而非一次性字符串。Playwright 覆盖：慢速流、停止、网络离线再上线、页面刷新恢复、令牌过期、单块渲染失败不影响后续内容。实施归入 [batch-015](../tasks/batches/batch-015-frontend-stream-client-and-contracts.md)。
