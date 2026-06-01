# EventStudy 测试方案-20260523

> 范围：Event-study 事件驱动研究模块（事件分析 + 信号规则 CRUD）
> 设计原则：全新开始；业务场景优先；黑盒推导期望结果；不以现有实现或现有测试为正确性依据。
> 状态：🔧 执行中

---

## 1. 全新测试声明

- [x] 本轮用例从业务场景和接口契约重新设计，不继承现有 spec 的覆盖结论。
- [x] 设计用例前未读取现有 `*.spec.ts` 的断言、mock 返回值或测试结论。
- [x] 现有测试仅可在本文档定稿后用于自动化落地参考。
- [x] 若现有测试与本文档业务期望冲突，以本文档的业务推导为准。

---

## 2. 测试范围

| 项目 | 内容 |
| ---- | ---- |
| 模块 | Event-study - 事件驱动研究 |
| 相关页面/业务入口 | 事件研究页、信号规则管理页 |
| 接口列表 | event-types/list, event-schemas/get, events, events/calendar, analyze, signal-rules CRUD, signal-rules/preview, signal-rules/scan, signals |
| 用户角色 | 普通用户（JWT），SUPER_ADMIN（scan 端点） |
| 依赖数据 | forecast, dividend, stkHolderTrade, shareFloat, repurchase, finaAudit, disclosureDate, daily, indexDaily, tradeCal |
| 外部依赖 | 无（Tushare 数据已同步到本地 DB） |
| 不在本轮范围 | EventSignalScheduler 定时任务、WebSocket 推送 |
