# 量化研究后端 — 文档导航

> **仓库**：`quant-code-cpx/server-code`
> **技术栈**：NestJS 11 · Prisma · PostgreSQL 17 · Redis 7.4 · BullMQ · Socket.IO

---

## 📁 目录结构

```
docs/
├── README.md                ← 本文件（文档导航索引）
├── TODO.md                  ← 统一 TODO List（功能 + 工程 + 产品痛点）
├── design/                  ← 功能设计文档（面向 AI 代码生成模型）
├── operations/              ← 部署与运维
└── archive/                 ← 历史快照（含已归档的旧规划文档）
```

---

## 📐 design/ — 功能设计文档

面向 AI 代码生成模型的详细实现规划，包含接口签名、字段定义、SQL 逻辑和 Prisma Schema。

| 文档 | 说明 | 状态 |
|------|------|------|
| [BACKTESTING_BACKEND.md](design/BACKTESTING_BACKEND.md) | 策略回测模块整体规划（API / Schema / 架构） | ✅ 已实现 |
| [BACKTEST_ENGINE_DETAIL_DESIGN.md](design/BACKTEST_ENGINE_DETAIL_DESIGN.md) | 回测撮合引擎增强与高级功能设计（复权 / Walk-Forward / 蒙特卡洛） | ✅ 已实现 |
| [CAPITAL_FLOW_BACKEND.md](design/CAPITAL_FLOW_BACKEND.md) | 资金动态模块后端实现规划 | ✅ 已实现 |
| [FACTOR_MARKET_BACKEND.md](design/FACTOR_MARKET_BACKEND.md) | 因子市场模块后端实现规划 | ✅ 已实现 |
| [MARKET_OVERVIEW_BACKEND.md](design/MARKET_OVERVIEW_BACKEND.md) | 市场概览模块后端实现规划 | ✅ 已实现 |
| [SCREENER_STRATEGY_SAVE_BACKEND.md](design/SCREENER_STRATEGY_SAVE_BACKEND.md) | 选股策略保存后端实现规划 | ✅ 已实现 |
| [STOCK_ANALYSIS_BACKEND.md](design/STOCK_ANALYSIS_BACKEND.md) | 股票详情 — 分析 Tab 后端实现规划 | ✅ 已实现 |
| [STOCK_MODULE_REQUIREMENTS.md](design/STOCK_MODULE_REQUIREMENTS.md) | 股票信息模块需求细化（讨论稿） | 📋 需求稿 |
| [STOCK_SCREENER_BACKEND.md](design/STOCK_SCREENER_BACKEND.md) | 选股器后端实现规划 | ✅ 已实现 |
| [DATA_LAYER_GAP_DESIGN.md](design/DATA_LAYER_GAP_DESIGN.md) | 数据层缺口开发方案设计（对应痛点一） | ✅ 已实现 |
| [FACTOR_RESEARCH_LOOP_DESIGN.md](design/FACTOR_RESEARCH_LOOP_DESIGN.md) | 因子研究闭环补全开发方案设计（对应痛点三） | ✅ Phase 1-4 已实现 |
| [WATCHLIST_RESEARCH_WORKBENCH_DESIGN.md](design/WATCHLIST_RESEARCH_WORKBENCH_DESIGN.md) | 自选股与研究工作台开发方案设计（对应痛点四） | 🔧 待实现 |

---

## 📋 规划与追踪

| 文档 | 说明 | 更新频率 |
|------|------|---------|
| [TODO.md](TODO.md) | 统一 TODO List（功能 + 工程质量 + 产品痛点），按优先级 P0-P3 组织 | 持续更新 |

---

## 🚀 operations/ — 部署与运维

| 文档 | 说明 |
|------|------|
| [PRODUCTION_DEPLOYMENT.md](operations/PRODUCTION_DEPLOYMENT.md) | 生产环境部署分析报告 |

---

## 📦 archive/ — 历史快照

| 文档 | 说明 |
|------|------|
| [PROJECT_SUMMARY_AND_TREE.md](archive/PROJECT_SUMMARY_AND_TREE.md) | 2026-03-19 项目变更与目录快照 |
| [planning_TODO_2026-04-01.md](archive/planning_TODO_2026-04-01.md) | 旧版功能规划 TODO（已合入 docs/TODO.md） |
| [SERVER_TODO_2026-04-01.md](archive/SERVER_TODO_2026-04-01.md) | 旧版工程质量 TODO（已合入 docs/TODO.md） |
| [FEATURE_GAP_ANALYSIS_2026-04-01.md](archive/FEATURE_GAP_ANALYSIS_2026-04-01.md) | 旧版产品痛点分析（已合入 docs/TODO.md） |

---

## 文档编写约定

1. **设计文档**（`design/`）面向 AI 代码生成模型，需包含：精确的文件路径、TypeScript 接口签名、Prisma Schema、SQL 逻辑和算法伪代码
2. **文件命名**：`<MODULE>_BACKEND.md`（功能设计）、`<MODULE>_REQUIREMENTS.md`（需求稿）
3. **状态标记**：✅ 已实现 / 🔧 待实现 / 📋 需求稿 / 🗓️ 规划中
4. **新增文档**时请同步更新本 README
