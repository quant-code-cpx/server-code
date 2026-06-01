# event-study测试方案-20260524

> 范围：`EventStudyController`（事件类型、事件查询、信号扫描）
> 设计原则：全新业务视角；契约优先；不以历史行为为正确性依据。
> 状态：✅ 已回归

## 核心风险与本轮覆盖

- 事件类型枚举非法值应返回 `400`。
- 管理员专属扫描接口应严格鉴权。
- 查询结果包含 `BigInt` 字段时，响应序列化不能 500。

## 本轮执行用例（fresh）

- `EST-V2-001` `/event-study/event-types/list` 返回 201 与数组 ✅
- `EST-V2-002` `/event-study/events` 无效 eventType 返回 400 ✅
- `EST-V2-003` 普通用户调用 `/event-study/signal-rules/scan` 返回 403 ✅
- `EST-V2-004` `BigInt` 字段序列化不应导致 500 ✅（本轮修复）

## 缺陷记录

| Bug ID | 严重度 | 优先级 | 标题 | 期望 | 实际 | 状态 | 修复 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| EST-BUG-001 | 高 | P0 | 测试应用缺失 BigInt JSON 序列化兼容导致事件查询 500 | 含 BigInt 的响应应正常返回 201 | `/event-study/events` 返回 500 | FIXED | 在 `test/helpers/create-test-app.ts` 与主应用对齐 BigInt `toJSON` 处理 |

## 回归结果

- `pnpm exec jest test/fresh/event-study-fresh-v2.spec.ts --runInBand` ✅
- `pnpm exec jest test/fresh --runInBand` ✅
- `pnpm build` ✅
