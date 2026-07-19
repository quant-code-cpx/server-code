# 量化计算服务

## 1. 决策

MVP 继续在当前 NestJS/TypeScript 中执行确定性计算，并通过 BullMQ 承载长任务；不直接接入同级 `../data-service`。该 FastAPI/AkShare/SQLAlchemy 原型使用另一套数据访问和运行方式，没有统一认证、CI、审计与可观测性。拆分条件与理由见 [ADR-003](../decisions/adr-003-typescript-python-boundary.md)。

模型不计算收益、波动、回撤、比率、分位或风险暴露，只负责选择合法计算 Tool、生成参数和解释程序结果。

## 2. 当前可复用能力

| 能力                          | 真实实现                                                                                              | 现状与改造                                                                                                                                          |
| ----------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 回测绩效                      | `src/apps/backtest/services/backtest-metrics.service.ts`                                              | 已算总/年化/基准/超额收益、波动、最大回撤、Sharpe、Sortino、Calmar、Alpha、Beta、信息比率、胜率、换手；需把 252 日与 2% 无风险利率变成版本化 policy |
| 回测执行                      | `BacktestEngineService`、`BacktestExecutionService`、`src/queue/backtesting/backtesting.processor.ts` | 可继续用于明确创建的回测任务；不是 MVP 模型自由 Tool                                                                                                |
| 回测结果                      | `BacktestRunService.getRunDetail/getEquity/getTrades/getPositions`                                    | 已 owner-scoped；封装为 `get_backtest_result`，先修复 null 被转 0                                                                                   |
| 组合风险                      | `src/apps/portfolio/portfolio-risk.service.ts`                                                        | 行业、持仓集中度、市值、Beta 与聚合快照可复用；快照允许子维度失败，Tool 必须把 partial 明确暴露                                                     |
| 因子分析                      | `src/apps/factor/services/factor-analysis.service.ts`、`factor-compute.service.ts`                    | 公式可复用；自定义因子租户与 attribution 越权修复前不对 Agent 开放                                                                                  |
| 技术指标                      | `src/apps/stock/stock-analysis.service.ts`、`src/apps/stock/utils/technical-indicators.ts`            | 可作为后续确定性 Tool；必须固定调整方式、窗口和算法版本                                                                                             |
| 行业估值分位                  | `src/apps/industry-rotation/industry-rotation.service.ts`                                             | 可复用分位思路；股票历史估值 Tool 需独立、测试化实现                                                                                                |
| Monte Carlo/Walk-forward/归因 | `src/apps/backtest/services/` 对应 Service                                                            | 长任务，放后续受控 Workflow；不在交互请求线程执行                                                                                                   |

## 3. MVP 计算边界

### `compute_performance_metrics`

输入/输出以 [Tool 目录](../tools/README.md) 为准。实现由 `BacktestToolFacade` 调用一个纯 `PerformanceMetricsCalculator`，显式固定：

- 输入序列日期、频率、收益 scale、基准对齐方式、无风险利率、年化交易日数和缺失策略。
- 只输出 canonical `metrics` 中被请求的总收益、CAGR、年化波动、Sharpe、Sortino、最大回撤、Calmar、胜率、VaR95/CVaR95；Alpha/Beta/信息比率属于现有回测结果或后续 Schema，不在此 Tool 中暗加字段。
- `algorithmVersion`、`dataVersion`、实际样本数、首尾日期、排除数据点和 warnings。

不能直接把任意模型生成的百万点数组送进 Node 进程。优先让输入引用同一 Run 已取得的 Tool result；若允许内联，Schema 设置严格点数和字节上限。

### `compute_valuation_percentile`

从 `DailyBasic` / `stock_daily_valuation_metrics` 读取 Tool Schema 指定的 PE/PB/PS/股息率历史窗口，用确定性排序/插值计算当前值分位。规则：

- 先通过 `resolve_security` 得到 canonical `tsCode`；窗口按交易日而非自然日样本。
- 只使用不晚于 snapshot `asOf` 的数据；非正/无意义估值值按指标 policy 过滤并返回排除数。
- MVP Schema 固定为“单股历史分位”；截面分位若后续需要必须新建/升版 Schema，两者不可用同一字段混淆。
- 输出当前值、有效样本数、历史起止、percentile scale、算法版本和实际数据截止日。

### `get_portfolio_risk` 与 `get_backtest_result`

它们是查询 Tool，不是计算 Tool，但返回确定性结果。所有权先校验；PortfolioRisk 快照某个子维度失败时返回 `partial=true` 与 component errors，模型不得把缺失维度解释为零风险。

## 4. 计算状态与执行选择

| 类型         | 例子                                            | 执行位置                                      | 状态                               |
| ------------ | ----------------------------------------------- | --------------------------------------------- | ---------------------------------- |
| 轻量纯计算   | 受限序列绩效、估值分位                          | Agent Worker 内同步节点                       | ToolCall 状态                      |
| 中量计算     | 多股票相关性、事件窗口、组合风险重算            | Agent Worker 的受限 worker pool/BullMQ 子 job | Step + ToolCall checkpoint         |
| 长任务       | 完整回测、Walk-forward、Monte Carlo、大规模因子 | 专用 BullMQ queue/processor                   | 独立业务 Run + Agent 等待/查询节点 |
| 高级科学计算 | 优化、百万点矩阵、scipy/cvxpy/sklearn           | 第二阶段无状态 Python 服务                    | ComputeJob + 可复现 artifact       |

不要在 HTTP Controller 同步生成报告或运行长回测。Agent Run 等待长任务时保存 checkpoint，释放执行槽；由队列完成事件重新唤醒，而不是轮询占用 Worker。

## 5. 可复现计算契约

每个结果必须带：

```ts
type ComputeProvenance = {
  algorithmKey: string
  algorithmVersion: string
  codeVersion: string
  dataVersion: string
  asOf: string
  parameters: Record<string, unknown>
  sample: { start: string; end: string; count: number; excluded: number }
  units: Record<string, string>
  warnings: string[]
}
```

`codeVersion` 使用构建 commit/image digest；不能用“当前代码”。相同输入 snapshot、算法版本和参数必须产生相同结果。随机算法保存 seed，禁止默认使用系统随机数而不记录。

当前回测结果存在已确认的复现阻断：`BacktestDataService.getAllListedStocks()` 使用当前 `listStatus='L'`，排除了历史退市股且不会纳入后续 IPO；指数换仓只加载新代码而未剔除离开成分；`ScreeningRotationStrategy` 与 `FactorScreeningRotationStrategy` 忽略配置 universe；`FactorRankingStrategy` 以 `endDate` 而非公告日选择财务因子；复权因子查询还缺稳定排序。修复前 `get_backtest_result` 必须返回 `BACKTEST_BIAS_UNVERIFIED`，不得把历史指标标为点时可复现。

金融口径：

- 所有收益的内部 scale 固定为 DECIMAL，展示时再转 PERCENT。
- 波动和 Sharpe 说明样本方差、交易日数与无风险利率。
- 最大回撤保留负值还是绝对值必须由算法版本固定；不能在 UI/模型层二次猜测。
- Alpha/Beta 要求日期内连接与有效基准；基准不足则为 null，不回退 0。
- 历史财务/事件计算只使用当时已公告数据，防止前视。
- 回测 universe 必须保留当时上市/退市状态，避免幸存者偏差。

## 6. 取消、资源和失败

- 纯计算每个批次检查 AbortSignal；CPU 密集计算放 worker thread/独立进程，避免阻塞 Node event loop。
- 长任务使用确定性 jobId、步骤幂等键和数据库 checkpoint。现有 `BacktestRunService.cancelRun()` 对 active job 只尝试 remove，必须增加合作式 cancel token，防止取消后 Worker 回写完成。
- 每个任务限制股票数、日期跨度、数据点、内存、CPU 时间、队列并发和用户成本；超限返回 canonical `RESULT_TOO_LARGE` 或对应公共范围错误，不自动扩容。
- 数据缺失、基准不对齐、方差为零、收益小于等于 -100%、NaN/Infinity 都是显式边缘场景；输出 JSON 前必须 finite-number 校验。
- 公式异常不交给模型修正；返回稳定错误和已确认的样本诊断。

## 7. Python 服务边界（第二阶段条件项）

满足任一条件才启动拆分：单任务 CPU 超过 30 秒、数据点超过 100 万、Node 内存成为瓶颈、或明确需要 scipy/cvxpy/sklearn。

重构目标不是让 Agent 直连现有 `../data-service`，而是建立无状态 `QuantComputeService`：

- NestJS 仍持有 JWT、userId、任务状态、Tool policy、审计和数据库写入。
- Python 接收已授权的数据快照引用或受限数据包，不接收用户 JWT，不直接访问用户表。
- 协议包含 `jobId/inputHash/algorithmVersion/dataVersion/seed/deadline`；结果带 checksum、环境/依赖版本和 provenance。
- mTLS/服务身份、请求签名、大小限制、超时、幂等和网络隔离为必需项。
- TypeScript 与 Python 同一算法版本使用黄金样例做逐项容差测试；一个版本只能有一个权威实现。

## 8. 文件落点

MVP 新增：

```text
src/apps/backtest/performance-metrics.calculator.ts
src/apps/backtest/backtest-tool.facade.ts
src/apps/factor/valuation-percentile.calculator.ts
src/apps/factor/factor-tool.facade.ts
src/apps/agent/tools/adapters/compute-performance-metrics.tool.ts
src/apps/agent/tools/adapters/compute-valuation-percentile.tool.ts
src/apps/agent/tools/adapters/get-portfolio-risk.tool.ts
src/apps/agent/tools/adapters/get-backtest-result.tool.ts
```

修改：

- `src/apps/backtest/services/backtest-metrics.service.ts`：委托纯 Calculator，保留现有 API 兼容层。
- `src/apps/backtest/backtest.module.ts`、`src/apps/factor/factor.module.ts`、`src/apps/portfolio/portfolio.module.ts`：只导出稳定 Facade。
- `src/queue/backtesting/backtesting.processor.ts` 与回测 Service：加入协作取消和 checkpoint。
- `prisma/research/factor.prisma` 与相关 Service：在开放因子能力前完成 owner/visibility 模型改造。

## 9. 测试与验收

```text
src/apps/backtest/test/performance-metrics.calculator.spec.ts
src/apps/factor/test/valuation-percentile.calculator.spec.ts
src/apps/agent/test/tools/quant-tools.integration.spec.ts
src/apps/backtest/test/backtest-cooperative-cancel.integration.spec.ts
```

必须用手算/外部独立脚本生成的黄金数据，不以当前函数输出为真值。覆盖常数序列、单点、零方差、全亏损、-100% 边界、缺失日、非对齐基准、不同 scale、样本/总体方差、最大回撤、无风险利率、估值负值/空值、窗口边界、前视/幸存者偏差、随机 seed、取消和重放。性能测试记录 1 万/10 万/100 万点阈值，据实决定是否进入 Python 批次。
