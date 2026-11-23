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
# npm silently skips an optional dependency whose download fails, and Astro's native
# compiler is one (@astrojs/compiler-binding-<platform>). Check it loads, so a flaky
# registry fails here (and is not cached) instead of at `astro build`; retry once.
RUN npm ci && node -e "require('@astrojs/compiler-binding')" \
 || (echo "Astro native compiler missing after npm ci; retrying" \
     && rm -rf node_modules && npm ci && node -e "require('@astrojs/compiler-binding')")
COPY web .
COPY content /app/content
# Only the public bundle crosses into the site build.
COPY --from=content /app/build/public /app/build/public
# Public seller details and prices for the static pricing and legal pages.
ARG PUBLIC_SELLER_NAME="" PUBLIC_SELLER_INN="" PUBLIC_CONTACT_EMAIL=""
ARG PUBLIC_PRICE_MONTH_KOP="" PUBLIC_PRICE_SEASON_KOP=""
ARG PUBLIC_TUTOR_PAID_MONTHLY_BUDGET_KOP=""
ENV PUBLIC_SELLER_NAME=$PUBLIC_SELLER_NAME PUBLIC_SELLER_INN=$PUBLIC_SELLER_INN \
    PUBLIC_CONTACT_EMAIL=$PUBLIC_CONTACT_EMAIL PUBLIC_PRICE_MONTH_KOP=$PUBLIC_PRICE_MONTH_KOP \
    PUBLIC_PRICE_SEASON_KOP=$PUBLIC_PRICE_SEASON_KOP \
    PUBLIC_TUTOR_PAID_MONTHLY_BUDGET_KOP=$PUBLIC_TUTOR_PAID_MONTHLY_BUDGET_KOP
RUN npm run build:site


FROM caddy:2.10-alpine
COPY infra/Caddyfile /etc/caddy/Caddyfile
COPY --from=site /app/web/dist /srv
