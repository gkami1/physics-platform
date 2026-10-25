# Build context: repository root. Produces a Caddy image serving the static site
# and proxying /api to the api service.
FROM python:3.13-slim AS content
COPY --from=ghcr.io/astral-sh/uv:0.11.7 /uv /bin/uv
ENV UV_FROZEN=1 UV_PYTHON_DOWNLOADS=never
WORKDIR /app
COPY pyproject.toml uv.lock ./
COPY packages packages
COPY api/pyproject.toml api/
RUN mkdir -p api/src/platform_api && touch api/src/platform_api/__init__.py \
 && uv sync --no-dev --package content-schema
COPY content content
RUN uv run --no-sync content-build build --content content --out build


FROM node:24-slim AS site
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web .
COPY content /app/content
# Only the public bundle crosses into the site build.
COPY --from=content /app/build/public /app/build/public
RUN npm run build:site


FROM caddy:2.10-alpine
COPY infra/Caddyfile /etc/caddy/Caddyfile
COPY --from=site /app/web/dist /srv
