#!/bin/sh
# 在容器启动时根据 REDIS_PASSWORD 环境变量动态生成 ACL 文件，
# 避免将明文密码写入 Git 版本控制。

set -eu
umask 077

: "${REDIS_PASSWORD:?环境变量 REDIS_PASSWORD 未设置，请在 .env 中配置后重启容器。}"

# Redis ACL 的一行一个用户；强制至少 32 位 URL-safe 随机密码。空白或其他
# 特殊字符会改变 ACL 语法，拒绝启动而不是把意外权限或密码写入配置。
# 密码本身仍只存在于运行中容器与 Secret/.env。
if [ "${#REDIS_PASSWORD}" -lt 32 ]; then
  echo 'REDIS_PASSWORD must contain at least 32 URL-safe characters when Redis ACL is enabled' >&2
  exit 1
fi
case "$REDIS_PASSWORD" in
  *[!A-Za-z0-9_-]*)
    echo 'REDIS_PASSWORD must contain only URL-safe characters when Redis ACL is enabled' >&2
    exit 1
    ;;
esac

# 开发环境所有进程共用 default 账户，所以权限为 API、Worker、Scheduler、
# BullMQ 和 Socket.IO 的并集。移除管理与破坏性命令，保留 INFO 供客户端
# readiness/BullMQ 使用；生产环境继续使用更细粒度的独立 ACL 账户。
printf '%s\n' "user default on >${REDIS_PASSWORD} ~* &* +@all -@dangerous -@admin +INFO +CLIENT|ID +CLIENT|SETNAME +CLIENT|SETINFO +KEYS" \
  > /usr/local/etc/redis/redis.acl

exec "$@"
