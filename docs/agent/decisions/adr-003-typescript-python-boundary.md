# ADR-003：TypeScript 与 Python 边界

## 背景

现有 TypeScript 已实现回测、因子分析、组合风险、行业轮动和事件研究。`../data-service` 有 FastAPI/pandas/numpy/AkShare，但独立数据库、开发热重载、无认证/CI/观测，也未被前后端引用。

## 问题

量化计算继续在 NestJS，还是立即使用/新建 Python 服务？

## 可选方案

1. 全 TypeScript。
2. 直接复用旧 `data-service`。
3. MVP TypeScript；阶段二将旧目录重构为无状态 Python Compute Service。
4. 全量迁移 Python。

## 最终决策

MVP 复用 TypeScript 确定性计算；不接旧 Python 服务。高级矩阵、优化、组合蒙特卡洛或大规模事件计算达到阈值后，把 `../data-service` 重构为独立无状态计算服务，数据由受控请求或只读账号获取，NestJS 仍持有用户权限、任务状态和审计。

## 选择理由

避免重复公式和数据访问；现有 `BacktestMetricsService`、`FactorAnalysisService`、`PortfolioRiskService` 可直接封装；Python 的 numpy/pandas/scipy 优势留给真正重计算。

## 放弃其他方案原因

旧服务不具生产边界；全 TypeScript 会限制后续科学计算生态；全 Python 迁移破坏已验证能力。

## 正面影响

MVP 快、结果口径一致；后续可按负载独立扩容 Python Worker。

## 负面影响

阶段二存在双语言契约、镜像和故障排查成本。

## 风险

同一指标两套实现漂移。要求指标定义有版本、黄金样例与跨语言一致性测试；一个版本仅一个权威实现。

## 后续复审条件

单任务 CPU 超过 30 秒、数据点超过 100 万、需要 scipy/cvxpy/sklearn，或 TypeScript 内存成为瓶颈时启动 Python 批次。
