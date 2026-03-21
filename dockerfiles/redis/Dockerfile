FROM redis:7.4

# 复制配置文件（ACL 文件在容器启动时由 entrypoint 动态生成，避免明文密码入库）
COPY ./redis.conf /usr/local/etc/redis/redis.conf

# 创建日志目录并赋权
RUN mkdir -p /var/log/redis && chmod a+rwx /var/log/redis

# entrypoint：根据 REDIS_PASSWORD 环境变量生成 redis.acl，再启动 redis-server
COPY ./docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["redis-server", "/usr/local/etc/redis/redis.conf"]

EXPOSE 6379
