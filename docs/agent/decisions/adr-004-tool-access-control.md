# ADR-004：Tool 数据访问控制

## 背景

Prisma 下有一百余个 Model，既含公开金融数据，也含 User、Portfolio、Watchlist、审计和策略数据。模型不可获得通用 Prisma/数据库句柄。

## 问题

固定 Tool、Service 封装、语义层、受控 SQL、Text-to-SQL 如何组合？

## 可选方案

1. 模型直接 SQL/Text-to-SQL。
2. 仅固定参数化 Tool。
3. 固定 Tool + 领域语义层；后期独立只读 SQL Explorer。
4. 独立数据微服务。

## 最终决策

MVP 采用固定 JSON Schema Tool，优先调用现有 Service；复杂只读查询封装在 Agent Repository/语义层。Text-to-SQL 不进入 MVP。探索性 SQL 仅作为后期管理员能力，使用只读副本/账号、表字段白名单、AST 校验、EXPLAIN 成本、强制 LIMIT/timeout 和完整审计。

## 选择理由

金融口径、时点、复权、单位和权限无法只靠 Prompt 保证；固定 Tool 能测试、缓存、限行、审计并复用现有服务。

## 放弃其他方案原因

直接 SQL 风险过大；仅固定 Tool 长期覆盖不足；独立数据服务首期重复 Prisma 与领域逻辑。

## 正面影响

最小权限、可追踪、失败明确，模型不能越过用户隔离。

## 负面影响

新增问题需开发 Tool；Tool 清单和 Schema 要版本治理。

## 风险

Service 原返回结构未携带完整来源/口径。Adapter 必须补 `asOf/source/unit/citation`，不得静默猜测。

## 后续复审条件

受控探索请求占比超过 20%，且固定 Tool 组合仍无法覆盖；只读副本、AST 校验和查询预算全部就绪后再启用 SQL Explorer。
