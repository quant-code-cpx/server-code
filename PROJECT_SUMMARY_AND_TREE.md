# 变更与目录快照

说明：此文件由开发助手在 2026-03-19 生成，包含本次会话中完成的变更摘要与项目目录树，便于后续检查。

## 变更摘要

- 修复：`src/apps/auth/auth.service.ts` 中使用字符串 `'ACTIVE'` 的地方改为 Prisma 枚举 `UserStatus.ACTIVE`（两处），并添加相应 import。
- Prisma：将单一 `prisma/schema.prisma` 拆分为多文件（`prisma/base.prisma`、`prisma/user.prisma`、`prisma/tushare.prisma`），并添加 `prisma.config.ts`（Prisma 6.6+ 多文件 schema 支持）。
- Docker：新增开发用 `docker-compose.yml`（包含 `database`、`redis`、`app` 服务）、以及 `dockerfiles/` 下的 PostgreSQL/Redis/App Dockerfiles 和配置文件。
- Shared 模块：为 `src/shared/` 下的 `prisma.service.ts`、`redis.provider.ts`、`token.service.ts`、`logger/*` 等文件补充 JSDoc/注释以提升可维护性。
- 依赖：安装/升级了缺失或兼容性包（例如 `@nestjs/schedule@6`、`cron`、`svg-captcha`、`cookie-parser` 等），并成功通过 `pnpm exec nest build` 编译。

## 构建验证

- 已运行 `pnpm exec prisma generate`（使用 `prisma.config.ts`），Prisma Client 成功生成。
- 已运行 `pnpm exec nest build`，确认 TypeScript 构建通过（无错误）。

## 项目目录树（摘录）

server-code/

├── prisma.config.ts # Prisma 多文件 schema 入口
├── docker-compose.yml # 开发环境 compose（postgres, redis, app）
├── .dockerignore
├── dockerfiles/
│ ├── app/Dockerfile
│ ├── postgresql/Dockerfile
│ ├── postgresql/postgresql.conf
│ ├── redis/Dockerfile
│ ├── redis/redis.conf
│ └── redis/redis.acl
├── prisma/
│ ├── base.prisma
│ ├── user.prisma
│ └── tushare.prisma
└── src/
├── main.ts
├── app.module.ts
├── config/
├── constant/
├── common/
├── lifecycle/
├── shared/
│ ├── shared.module.ts
│ ├── prisma.service.ts
│ ├── redis.provider.ts
│ ├── token.service.ts
│ └── logger/
├── apps/
│ ├── auth/ # 验证码、登录、刷新、登出、JWT 轮换
│ ├── user/ # 用户 CRUD、超管初始化、角色/状态管理
│ ├── stock/
│ ├── market/
│ └── heatmap/
├── tushare/ # Tushare API 封装与同步任务
├── queue/ # BullMQ 回测队列 + Worker
└── websocket/ # Socket.IO gateway

## 使用与注意事项

- Docker: 启动开发环境建议：

```bash
# 首次构建并启动
docker compose up --build

# 后台启动
docker compose up -d

# 停止并删除容器（保留数据卷）
docker compose down
```

- Prisma 多文件：编辑 `prisma/*.prisma` 后运行：

```bash
pnpm exec prisma generate
pnpm exec prisma migrate dev  # 如需迁移数据库
```

- `.env`：本地开发（直接运行）可使用现有 `.env`，但在 Docker 环境下 `docker-compose.yml` 的 environment 会覆盖相关连接字符串（`DATABASE_URL`、`REDIS_*`）。

## 文件位置

此文件已保存：

    /Users/chenpengxiang/Desktop/quant-code/server-code/PROJECT_SUMMARY_AND_TREE.md

结束。
