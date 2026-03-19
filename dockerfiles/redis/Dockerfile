FROM redis:7.4

# 复制配置文件及 ACL 文件
COPY ./redis.conf /usr/local/etc/redis/redis.conf
COPY ./redis.acl /usr/local/etc/redis/redis.acl

# 创建日志目录并赋权
RUN mkdir -p /var/log/redis && chmod a+rwx /var/log/redis

# 以自定义配置启动
CMD ["redis-server", "/usr/local/etc/redis/redis.conf"]

EXPOSE 6379
