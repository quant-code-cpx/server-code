# Tool 开发标准

## 1. 分层与真实文件落点

```text
src/apps/agent/tools/
├── tool-registry.service.ts
├── tool-executor.service.ts
├── tool-policy.service.ts
├── tool-access-context.ts
├── contracts/
│   ├── tool-definition.ts
│   ├── tool-result.ts
│   └── tool-error.ts
├── schemas/
└── adapters/
```

已有领域按需新增 `*ToolFacade` 并由原 Module export，例如 `src/apps/stock/stock-tool.facade.ts`、`src/apps/market/market-tool.facade.ts`。Facade 复用已有 Service/Prisma 查询、固定字段和业务口径；Tool adapter 只做 schema 到 Facade DTO 的映射、Policy、provenance 和错误翻译。

## 2. 定义契约

```ts
interface ToolDefinition<TInput, TData> {
  key: ToolKey;
  version: number;
  description: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  policy: {
    requiredRole: 'USER' | 'ADMIN' | 'SUPER_ADMIN';
    sideEffect: 'READ' | 'WRITE' | 'DESTRUCTIVE';
    requiresConfirmation: boolean;
    idempotent: boolean;
    timeoutMs: number;
    maxAttempts: number;
    maxRows: number;
    costClass: 'LOW' | 'MEDIUM' | 'HIGH';
    allowedDataScopes: string[];
  };
  execute(input: TInput, context: ToolAccessContext): Promise<ToolResult<TData>>;
}

type ToolAccessContext = {
  userId: number;
  role: 'USER' | 'ADMIN' | 'SUPER_ADMIN';
  conversationId: string;
  runId: string;
  toolCallId: string;
  traceId: string;
  allowedScopes: string[];
  abortSignal: AbortSignal;
};
```

`ToolAccessContext` 由执行器创建，绝不进入模型可编辑 JSON。Schema 必须 `additionalProperties: false`，字符串/数组/日期跨度均给上限；金额/比率明确单位。

## 3. 执行流程

1. Registry 按 run 冻结的 `key/version` 解析定义。
2. Policy 检查用户状态、角色、scope、资源所有权、预算、次数、写确认。
3. JSON Schema 校验并做股票代码、日期、周期、枚举的语义校验。
4. 先持久化 `AiToolCall` attempt 与 sanitized input，再执行。
5. 使用 timeout + AbortSignal 调 Facade；只对幂等且 classified retryable 的错误重试。
6. 验证 output schema、行数、单位和 `asOf`，写 result hash/provenance/error。
7. 生成 `tool.completed` 或 `tool.failed` 持久事件；大结果只给模型有界事实包。

## 4. 数据与时间规范

- 日期 API 使用 ISO `YYYY-MM-DD`，进入现有 Tushare/Prisma 层时再转换 `YYYYMMDD`。
- 中国股票默认 `Asia/Shanghai`；时间戳用 UTC ISO，另外携带业务时区。
- 财务数据同时保留 `reportPeriod`、`announcementDate`、`availableAt`；回测只看当时可用记录。
- 行情输出声明 `frequency`、`adjustment`、price/volume/amount unit；禁止混合日/周/月 pct_chg 口径。
- `null` 表示缺失；0 只表示真实零。缺失率进入 warnings。
- 列表稳定排序；分页 cursor 不由模型任意构造。

## 5. 权限与副作用

资源所有权在 Facade/Repository 再校验一次，不能只靠 Orchestrator。只读 Tool 使用数据库 app role；未来可为 Agent 查询建立只读事务/副本。写 Tool 必须使用 `clientRequestId` 唯一键、显式确认记录、前后快照和 outbox；破坏性 Tool 不注册。

## 6. 错误、重试与降级

错误统一见 [Tool 错误](./schemas/tool-errors.md)。`NOT_FOUND`、`FORBIDDEN`、`INVALID_ARGUMENT`、`DATA_QUALITY` 不重试；`TIMEOUT`、provider 429/5xx、短暂连接故障可在上限内重试。每个 attempt 单独审计。Tool 不自行换股票、扩大日期、改复权或改数据源；需要替代方案交回 workflow 决定并向用户说明。

## 7. 可观测性

日志字段：`traceId/runId/toolCallId/toolKey/toolVersion/attempt/status/durationMs/rowCount/truncated/dataAsOf/errorClass`。不记录模型 key、token、完整持仓、网页全文或 Tool 原始 payload。指标至少包括调用量、成功率、p50/p95/p99、超时、重试、拒绝、结果大小、数据新鲜度和 cache hit。

## 8. 测试标准

- schema 合法/非法/未知字段属性测试；日期跨度、数组上限、枚举边界。
- 用户 A 不能访问用户 B 的组合、自选、回测和报告。
- 真实 Facade contract test；不把现有 controller 响应当 Tool contract。
- 金融 golden case：代码映射、复权、周/月单位、公告可用时点、停牌、缺失、幸存者偏差。
- timeout、取消、有限重试、worker crash 后幂等恢复。
- output provenance、引用、警告和审计完整性。
- 搜索 Tool 加 SSRF、重定向、MIME、超大响应和 prompt injection fixtures。

执行遵循仓库命令：`pnpm run lint`、`pnpm run build`、相关模块 `pnpm test -- <path>`；数据库 Tool 还需 fresh migration 和集成测试。
