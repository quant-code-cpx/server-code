FROM postgres:17

# ─── 环境变量（开发默认值，生产请通过 docker-compose 或 secrets 覆盖）────────
ENV POSTGRES_DB=quant_db
ENV POSTGRES_USER=postgres
ENV POSTGRES_PASSWORD=password

# 使用自定义 postgresql.conf
COPY postgresql.conf /etc/postgresql/postgresql.conf

# 数据持久化目录
VOLUME /var/lib/postgresql/data

# 使用自定义配置文件启动
CMD ["postgres", "-c", "config_file=/etc/postgresql/postgresql.conf"]

EXPOSE 5432
