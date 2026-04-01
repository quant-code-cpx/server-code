# 后端仓库 (server-code) — 优化与缺失功能 TODO List

> 基于对整个仓库的全面审视，按优先级和分类整理。与 `TODO.md` 中的功能规划互补，本文档侧重于**工程质量、架构优化、安全加固和运维能力**。
>
> 格式：`- [ ]` 待完成，`- [x]` 已完成。

---

## 一、测试覆盖（当前覆盖率 ~5%，仅 4 个 spec 文件）

- [ ] 补充 Auth 模块单元测试（登录、注册、Token 刷新、验证码、账户锁定）
- [ ] 补充 User 模块单元测试（CRUD、角色权限校验、密码重置）
- [ ] 补充 Stock 模块单元测试（列表查询、搜索、详情接口）
- [ ] 补充 Backtest 模块单元测试（任务提交、引擎计算、指标计算）
- [ ] 补充 Tushare Client 单元测试（Mock HTTP、频控重试逻辑）
- [ ] 补充 Market / Factor / Heatmap 模块单元测试
- [ ] 添加 E2E 测试套件（至少覆盖 Auth 流程、股票查询、回测提交等关键路径）
- [ ] 配置 Jest 覆盖率阈值（建议 >60%），集成到 CI

---

## 二、CI/CD（当前无 GitHub Actions 工作流）

- [ ] 添加 CI 工作流：lint → build → test（`.github/workflows/ci.yml`）
- [ ] 添加 Docker 镜像构建工作流（推送到 GHCR / Docker Hub）
- [ ] 添加 Prisma migration 检查（确保 schema 与 migration 一致）
- [ ] 添加代码质量门禁（覆盖率、lint 通过率）
- [ ] 修复 pre-push hook 依赖 Redis 的问题（`swagger:generate` 启动完整 NestJS 应用）

---

## 三、TypeScript 类型安全

- [ ] 清理 `any` 类型使用（当前约 182 处，ESLint 规则已禁用）
- [ ] 启用 ESLint `@typescript-eslint/no-explicit-any` 规则（至少 warn 级别）
- [ ] 审查并消除 Tushare API 响应中的 `any` 类型（添加明确接口定义）
- [ ] 审查 Backtest 模块中策略配置 JSON 的类型定义

---

## 四、错误处理一致性

- [ ] 统一所有 `throw new Error()` 为 `BusinessException`（当前 10+ 处使用原生 Error）
  - `src/tushare/sync/` 多个文件
  - `src/apps/backtest/` 策略注册和引擎服务
  - `src/queue/` 回测处理器
- [ ] 为 Tushare API 错误添加专用错误码（当前 response-code.constant 无 Tushare 相关码）
- [ ] class-validator 校验错误映射到标准错误码（当前使用默认消息）
- [ ] 添加请求参数边界校验：
  - K 线图日期范围上限
  - 分页参数上限（page/pageSize）
  - 搜索关键词长度限制

---

## 五、数据库性能优化

- [ ] 为 Tushare 数据表添加索引（高频查询字段）：
  - `daily` / `weekly` / `monthly`：`ts_code` + `trade_date` 联合索引
  - `stock_basic`：`name`、`industry`、`market` 索引
  - `moneyflow_dc`：`ts_code` + `trade_date` 索引
  - `balance_sheet` / `cashflow` / `income`：`ts_code` + `end_date` 索引
- [ ] 审查大表查询性能（`stock.service.ts` 1,500+ 行，多个全表扫描风险）
- [ ] 配置 Prisma 连接池参数（当前使用默认值）
- [ ] 添加数据库查询超时设置
- [ ] 考虑对历史行情数据做分区表（按年份）

---

## 六、缓存策略

- [ ] 为高频只读接口添加 Redis 缓存层：
  - 股票列表 / 搜索结果（TTL 5-10 分钟）
  - 股票详情总览（TTL 10 分钟）
  - 交易日历（TTL 24 小时）
  - 行业板块列表（TTL 1 小时）
- [ ] 缓存失效机制：Tushare 同步完成后清除相关缓存
- [ ] 添加缓存命中率监控

---

## 七、安全加固

- [ ] JWT Secret 不应有代码级默认值，缺失时应启动报错
- [ ] 添加每接口 / 每用户级别的细粒度限流（当前仅全局 20 req/10s）
- [ ] Redis ACL 密码从硬编码 entrypoint 改为环境变量注入
- [ ] 审查 CORS 生产环境配置（`false` 是 falsy，不等于空白名单）
- [ ] 添加请求体大小限制（防止大 JSON 攻击）
- [ ] 管理员操作添加审计日志（用户创建/删除/角色变更/密码重置）
- [ ] 邮箱变更需要邮件确认

---

## 八、生产部署与运维

- [ ] 添加生产环境 Dockerfile（当前仅 dev 版本，使用 `start:dev`）
- [ ] 添加健康检查端点（`/health`、`/ready`），集成 `@nestjs/terminus`
- [ ] 实现优雅关闭（Graceful Shutdown）：
  - 停止接受新请求
  - 等待进行中的回测任务完成
  - 关闭 Redis / DB 连接
- [ ] 添加 Kubernetes 部署清单（Deployment + Service + ConfigMap + Secret）
- [ ] 配置 PostgreSQL 连接池上限和超时
- [ ] 添加容器资源限制（CPU / Memory limits）

---

## 九、日志与监控

- [ ] 生产环境添加请求/响应日志（当前仅 dev 环境有 LoggingInterceptor）
- [ ] 添加结构化日志格式（JSON），便于日志聚合工具解析
- [ ] 添加接口响应时间监控（P50 / P95 / P99）
- [ ] 添加数据库查询性能日志（慢查询告警）
- [ ] 集成 APM 工具（Datadog / New Relic / Prometheus + Grafana）
- [ ] WebSocket 连接数监控
- [ ] Tushare 同步任务执行耗时和成功率监控

---

## 十、架构优化

- [ ] 拆分 `stock.service.ts`（1,507 行）为多个子服务：
  - `StockListService` — 列表 / 搜索
  - `StockDetailService` — 详情总览 / K线 / 资金流
  - `StockFinancialService` — 财务数据
  - `StockAnalysisService` — 技术指标（已拆分，保持）
- [ ] WebSocket 推送添加用户/角色过滤（当前广播给所有连接，同步状态应仅推给管理员）
- [ ] Tushare 同步失败后支持断点续传（当前部分失败需全量重做）
- [ ] 回测任务添加超时机制（防止长时间挂起）
- [ ] 回测策略配置 JSON 添加 Schema 校验

---

## 十一、Tushare 数据同步增强

- [ ] 同步前添加数据校验/清洗（防止脏数据入库）
- [ ] 支持并行批量调用 Tushare API（当前串行 350ms 间隔，可按不同数据集并行）
- [ ] 同步进度添加百分比估算（基于已知总量）
- [ ] 失败任务自动重试队列（独立于主同步流程）
- [ ] 同步日志查询接口（管理端可查看历史同步记录和错误详情）

---

## 十二、缺失的功能模块（与 TODO.md 互补）

- [ ] 系统健康检查接口（`@nestjs/terminus`）
- [ ] 数据同步日志查询接口（管理端）
- [ ] 手动触发单表同步（当前仅全量触发）
- [ ] 用户操作审计日志
- [ ] 数据导出功能（CSV / Excel）
- [ ] API 版本管理（v1/v2 路由前缀）

---

## 十三、文档与开发体验

- [ ] 添加 `CONTRIBUTING.md`（开发环境搭建、代码规范、提交规范）
- [ ] 补充 `.env.example` 中各变量的注释说明
- [ ] 添加 API 接口变更日志（CHANGELOG）
- [ ] Swagger 文档补充更多响应示例
- [ ] 添加架构决策记录（ADR）

---

*最后更新：2026-04-01*
