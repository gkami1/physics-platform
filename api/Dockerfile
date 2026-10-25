# Build context: repository root.
FROM python:3.13-slim AS build
COPY --from=ghcr.io/astral-sh/uv:0.11.7 /uv /bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_FROZEN=1 UV_PYTHON_DOWNLOADS=never
WORKDIR /app

# Dependencies first, for layer caching.
COPY pyproject.toml uv.lock ./
COPY packages/content_schema/pyproject.toml packages/content_schema/
COPY api/pyproject.toml api/
RUN uv sync --no-dev --no-install-workspace

COPY packages packages
COPY api api
RUN uv sync --no-dev

COPY content content
RUN uv run --no-sync content-build build --content content --out build


FROM python:3.13-slim
RUN useradd --system --uid 10001 app
WORKDIR /app
COPY --from=build --chown=app /app/.venv .venv
COPY --from=build --chown=app /app/packages packages
COPY --from=build --chown=app /app/api api
COPY --from=build --chown=app /app/build/private build/private
ENV PATH="/app/.venv/bin:$PATH" PYTHONUNBUFFERED=1 API_ENV=prod
USER app
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health')"
# Migrations run on start; safe with one api replica (the MVP setup).
CMD ["sh", "-c", "alembic -c api/alembic.ini upgrade head && exec uvicorn platform_api.main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips '*' --no-server-header"]
