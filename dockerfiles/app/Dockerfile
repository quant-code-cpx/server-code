# ─────────────────────────────────────────────────────────────────────────────
# 开发镜像 - NestJS（热重载模式）
#
# 与生产镜像的主要区别：
#   - 不复制源码（由 docker-compose 以 volume 挂载，支持热重载）
#   - 安装 devDependencies
#   - 以 pnpm start:dev 启动（ts-node + watch 模式）
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine

# 安装 pnpm
RUN npm install -g pnpm

WORKDIR /app

# 先复制 package 描述文件以利用 Docker 层缓存：
# 只要 package.json / pnpm-lock.yaml 不变，依赖层就不会重建。
COPY package.json pnpm-lock.yaml ./

# 安装全部依赖（含 devDependencies）
RUN pnpm install

# 源码由 docker-compose 以 bind-mount 挂载到 /app，
# node_modules 通过匿名 volume 保持容器内不被主机目录覆盖。

# 生成 Prisma Client → 同步 schema 到 DB（首次启动自动建表，无需迁移文件）→ 启动开发服务器
CMD ["sh", "-c", "pnpm exec prisma generate && pnpm exec prisma db push --accept-data-loss && pnpm start:dev"]

EXPOSE 3000
