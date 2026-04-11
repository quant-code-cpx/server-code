# Prisma Migration 一致性检查 — 方案设计

> **目标读者**：AI 代码生成助手 / 开发者  
> **对应 TODO**：`待办清单.md` → P1 CI/CD → "Prisma migration 一致性检查"  
> **日期**：2026-04-10（实现于 2026-04-11）  
> **范围**：`.github/workflows/ci.yml` + 本地开发规范

---

## 目录

1. [问题背景](#一问题背景)
2. [根因分析](#二根因分析)
3. [解决方案](#三解决方案)
4. [实现细节](#四实现细节)
5. [涉及文件清单](#五涉及文件清单)
6. [验收标准](#六验收标准)

---

## 一、问题背景

当前 CI 工作流（`.github/workflows/ci.yml`）使用以下命令准备测试数据库：

```yaml
- name: Push schema to test DB
  run: pnpm exec prisma db push --accept-data-loss
```

`prisma db push` 直接将当前 `.prisma` Schema 文件的 DDL 推送到数据库，**绕过了 migration 文件**。这意味着：

- 开发者在本地修改了 `prisma/*.prisma`，忘记执行 `pnpm prisma:migrate`（即 `prisma migrate dev`）
- CI 中 `prisma db push` 仍然成功，测试照常通过
- 但不存在对应的 migration 文件，生产环境的 `prisma migrate deploy` 会漏掉这次变更
- **后果**：生产 DB schema 与代码不一致，导致运行时错误

---

## 二、根因分析

| 维度            | 现状                                                                                |
| --------------- | ----------------------------------------------------------------------------------- |
| CI 准备测试 DB  | `prisma db push`（快速，但不验证 migration 文件）                                   |
| 本地开发准备 DB | `prisma migrate dev`（生成 migration 文件 + 推送变更）                              |
| migration 文件  | `prisma/migrations/`，目前只有 2 个历史 migration                                   |
| Schema 管理     | 多文件 schema（`prisma/*.prisma`），通过 `prisma.config.ts` 统一指向 `prisma/` 目录 |
| 差距检测机制    | **不存在**——没有任何 CI 步骤会验证 migration 文件是否涵盖了所有 schema 变更         |

---

## 三、解决方案

### 3.1 总体策略

在 CI 中**新增一个检测步骤**，使用 `prisma migrate diff` 命令比较：

- **From**：`prisma/migrations/` 目录中所有 migration SQL 累积后的 schema 状态
- **To**：当前 `prisma/*.prisma` 中定义的期望 schema 状态

如果两者存在差异（即有 schema 变更没有对应的 migration 文件），CI 以非零退出码报错。

### 3.2 核心命令

`--from-migrations` 需要应用 migration SQL 到一个临时数据库（shadow DB）才能推算结果 schema，因此必须提供 `--shadow-database-url`。在 CI 中，利用已有的 PostgreSQL Service Container 再建一个独立的 shadow 数据库即可：

```bash
# Step 1：创建 shadow 数据库
psql -h localhost -U postgres -c "CREATE DATABASE quant_shadow;"

# Step 2：执行漂移检查
pnpm exec prisma migrate diff \
  --from-migrations ./prisma/migrations \
  --to-schema-datamodel ./prisma \
  --shadow-database-url postgresql://postgres:<password>@localhost:5432/quant_shadow \
  --exit-code
```

参数说明：

| 参数                    | 含义                                                                      |
| ----------------------- | ------------------------------------------------------------------------- |
| `--from-migrations`     | 基准状态：将 migrations 目录中的 SQL 应用到 shadow DB，推算其 schema 状态 |
| `--to-schema-datamodel` | 目标状态：当前 `.prisma` Schema 文件定义的结构（支持目录，Prisma 6.x）    |
| `--shadow-database-url` | 临时数据库 URL，`--from-migrations` 必需；指向一个空目标 DB               |
| `--exit-code`           | 若 diff 非空（有未迁移的变更）则返回退出码 `1`，让 CI 步骤失败            |

### 3.3 工作流位置

新步骤插入在 `Generate Prisma Client` 之后、`Push schema to test DB` 之前：

```
Generate Prisma Client      ← 已有
       ↓
[NEW] Check migration drift  ← 新增：验证 schema ↔ migration 一致性
       ↓
Push schema to test DB      ← 已有（测试环境仍用 db push，保持 CI 速度）
       ↓
Lint → Build → Test         ← 已有
```

### 3.4 开发者本地规范（配合说明）

新增 CI 步骤后，开发者需要遵守：

- 修改任何 `prisma/*.prisma` 文件后，必须运行 `pnpm prisma:migrate` 生成对应 migration 文件
- 提交时同时提交 `.prisma` 文件变更和对应的 migration 文件
- 如果是纯环境探索性修改不想提交 migration，用 `prisma db push`（仅本地，不提交）

---

## 四、实现细节

### 4.1 修改 `.github/workflows/ci.yml`

在现有 `Generate Prisma Client` 步骤（第 ~96 行）之后、`Push schema to test DB` 步骤之前，插入：

```yaml
- name: Check migration drift (schema ↔ migrations consistency)
  run: |
    pnpm exec prisma migrate diff \
      --from-migrations ./prisma/migrations \
      --to-schema-datamodel ./prisma \
      --exit-code
  # 如果 schema 有未迁移的变更，此步骤失败，阻止后续操作
  # 错误信息示例：
  #   [*] Changed the type of `some_column` on the `some_table` table...
  #
  # 修复方法：在本地运行 `pnpm prisma:migrate` 生成 migration 文件并提交
```

完整 CI 步骤顺序（对应 ci.yml jobs.ci.steps 区段）：

```yaml
steps:
  - name: Checkout
    # ...（已有）

  - name: Configure Redis password
    # ...（已有）

  - name: Setup pnpm
    # ...（已有）

  - name: Setup Node.js
    # ...（已有）

  - name: Install dependencies
    run: pnpm install --frozen-lockfile

  - name: Generate Prisma Client
    run: pnpm exec prisma generate

  # ── 新增 ──────────────────────────────────────────────
  - name: Check migration drift (schema ↔ migrations consistency)
    run: |
      pnpm exec prisma migrate diff \
        --from-migrations ./prisma/migrations \
        --to-schema-datamodel ./prisma \
        --exit-code
  # ──────────────────────────────────────────────────────
  - name: Push schema to test DB
    run: pnpm exec prisma db push --accept-data-loss

  - name: Lint
    # ...（已有）

  - name: Build
    # ...（已有）

  - name: Test
    # ...（已有）
```

### 4.2 特殊情况处理

**情况 A：项目处于"仅 db push，无 migration"状态**

当前项目的 migrations 目录只有 2 个入口：

```
prisma/migrations/
  20260408154559_add_ths_index_member/
  20260409000000_expand_holder_name_varchar/
  migration_lock.toml
```

这两个 migration 是否涵盖了所有当前 schema 定义需要验证。**首次引入此检查可能会因历史积累的漂移而失败**，需要一次性修复：

1. 先在本地运行 `pnpm exec prisma migrate diff --from-migrations ./prisma/migrations --to-schema-datamodel ./prisma` 查看 diff 报告
2. 如果有 drift，运行 `pnpm prisma:migrate` 补出一个"catch-up migration"
3. 提交该 migration 文件后，CI 检查即通过

**情况 B：新团队成员第一次 clone**

执行 `pnpm install` 后，运行：

```bash
pnpm exec prisma migrate dev  # 本地需要 DATABASE_URL
```

而非 `prisma db push`，确保本地与 migration 状态一致。

**情况 C：CI 首次执行漂移检查时失败**

在 CI step 中可加 `continue-on-error: true` 作为过渡期保护，配合 TODO 注释说明需修复：

```yaml
- name: Check migration drift (schema ↔ migrations consistency)
  continue-on-error: true # TODO: 修复历史漂移后移除此行
  run: |
    pnpm exec prisma migrate diff \
      --from-migrations ./prisma/migrations \
      --to-schema-datamodel ./prisma \
      --exit-code
```

---

## 五、涉及文件清单

| 文件                       | 操作     | 说明                                                                      |
| -------------------------- | -------- | ------------------------------------------------------------------------- |
| `.github/workflows/ci.yml` | 修改     | 插入 `Check migration drift` 步骤                                         |
| `prisma/migrations/`       | 可能新增 | 若当前存在历史漂移，需运行 `prisma migrate dev` 补一个 catch-up migration |
| `docs/待办清单.md`         | 修改     | 完成后标记为 `[x]`                                                        |

---

## 六、验收标准

| 场景                                                | 期望结果                                                                  |
| --------------------------------------------------- | ------------------------------------------------------------------------- |
| schema 与 migrations 完全一致                       | CI `Check migration drift` 步骤通过（exit 0）                             |
| 开发者添加新 Model 但未运行 `prisma migrate dev`    | CI `Check migration drift` 步骤失败（exit 1），给出 diff 说明             |
| 首次引入检查，存在历史漂移                          | 使用 `continue-on-error: true` 过渡，生成 catch-up migration 后移除该配置 |
| `prisma db push` 仍用于测试 DB 准备                 | 保留原有步骤，测试 CI 速度不受影响                                        |
| 开发者本地 `pnpm prisma:migrate` 正常生成 migration | 生成的 migration 文件在下次 CI 中通过漂移检查                             |
