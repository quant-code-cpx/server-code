# ADR-001：Agent 编排位置

## 背景

主系统是 NestJS 11 + Prisma + PostgreSQL，金融查询、用户权限、BullMQ、Redis、WebSocket、审计和指标均在 `src/`。另有未接线的 `../data-service` FastAPI/AkShare 原型。

## 问题

编排放前端、现有 NestJS、独立 TypeScript 服务，还是 Python/LangGraph 服务？

## 可选方案

1. 前端编排：延迟低，但泄露密钥、无法可信审计，排除。
2. NestJS 内自研确定性状态机：复用全部现有能力，部署最少。
3. 独立 TypeScript Agent 服务：隔离好，但首期产生跨服务事务和重复鉴权。
4. Python/LangGraph：具备持久化、流式和中断能力，但需重新封装 Prisma Service；[LangGraph 官方文档](https://docs.langchain.com/oss/javascript/langgraph/overview)也说明它是低层运行时，不会替代领域审计设计。

## 最终决策

MVP 在 NestJS 新增 `src/apps/agent/`，采用显式、可版本化、数据库检查点驱动的确定性工作流；不引入 LangGraph。BullMQ Worker 可从同代码库独立启动。未来仅在分支/中断/回放复杂度达到复审阈值时评估 LangGraph JS。

## 选择理由

- 通过现有领域 Module 导出的 `StockToolFacade`、`MarketToolFacade`、`PortfolioToolFacade`、`WatchlistToolFacade`、`BacktestToolFacade` 复用真实 Service，无内部 HTTP 回环，也不向 Agent 暴露 Prisma。
- JWT 用户上下文、Prisma 事务、现有日志/指标可复用。
- 金融场景需要步骤白名单、时点约束、版本固定和完整审计；显式状态机更易验证。

## 放弃其他方案原因

前端不可信；独立 Agent 服务首期收益小于运维成本；Python 服务会形成第二套数据访问和权限；LangGraph 首期增加框架状态与业务状态双写。

## 正面影响

部署简单、事务边界明确、复用高、测试可完全替换模型和 Tool。

## 负面影响

团队需维护工作流运行器；复杂分支、人工中断、图可视化能力需自行实现。

## 风险

编排器膨胀。约束：节点单一职责、WorkflowDefinition 版本化、Tool 经 Registry 调用、禁止 Orchestrator 直接查询 Prisma。

## 后续复审条件

任一满足即复审：生产工作流超过 15 个；单工作流节点超过 20；人工中断/恢复场景超过 3 类；自研检查点故障率无法达标；需要动态图编排编辑器。
