#!/bin/sh
# 在容器启动时根据 REDIS_PASSWORD 环境变量动态生成 ACL 文件，
# 避免将明文密码写入 Git 版本控制。

set -e

: "${REDIS_PASSWORD:?环境变量 REDIS_PASSWORD 未设置，请在 .env 中配置后重启容器。}"

echo "user default on >${REDIS_PASSWORD} ~* +@all" \
  > /usr/local/etc/redis/redis.acl

exec "$@"
