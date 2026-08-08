FROM python:3.12.11-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

WORKDIR /app
COPY --from=ghcr.io/astral-sh/uv:0.8.3 /uv /uvx /bin/
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev
COPY app ./app

USER 65532:65532
EXPOSE 8080
CMD [".venv/bin/gunicorn", "app.main:app", "--bind", "0.0.0.0:8080", "--workers", "2", "--worker-class", "uvicorn.workers.UvicornWorker", "--timeout", "60", "--graceful-timeout", "15", "--max-requests", "500", "--max-requests-jitter", "50", "--access-logfile", "-"]
