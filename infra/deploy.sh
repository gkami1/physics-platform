#!/usr/bin/env bash
# Deploy a git ref to the server and check it came up.
#
#   infra/deploy.sh deploy@example.ru            # deploys origin/main
#   infra/deploy.sh deploy@example.ru feat/x     # any branch, tag or commit
#
# The server holds a clone in $APP_DIR with infra/.env (see docs/DEPLOY.md).
# Images are built on the server; the database volume survives redeploys, and the API
# runs migrations on start.
set -euo pipefail

HOST="${1:?usage: infra/deploy.sh user@host [ref]}"
REF="${2:-main}"
APP_DIR="${APP_DIR:-/opt/physics-platform}"

echo "→ deploying ${REF} to ${HOST}:${APP_DIR}"
# shellcheck disable=SC2087  # variables are meant to expand locally
ssh "$HOST" bash -euo pipefail <<EOF
cd "$APP_DIR"
git fetch --quiet --prune origin
git checkout --quiet --detach "origin/${REF}" 2>/dev/null || git checkout --quiet --detach "${REF}"
echo "  at \$(git log --oneline -1)"
test -f infra/.env || { echo "infra/.env missing (copy infra/.env.example)"; exit 1; }
docker compose -f infra/compose.yaml up -d --build --wait --remove-orphans
docker image prune -f >/dev/null
# First address of a possibly quoted, comma-separated list ("a.ru, www.a.ru").
SITE=\$(grep -E '^SITE_ADDRESS=' infra/.env | cut -d= -f2- | tr -d "\"' " | cut -d, -f1)
for i in \$(seq 1 30); do
  if curl -fsS "https://\${SITE}/api/health" >/dev/null 2>&1; then
    echo "  healthy: https://\${SITE}/api/health"; exit 0
  fi
  sleep 2
done
echo "  health check failed; recent logs:"
docker compose -f infra/compose.yaml logs --tail 80 api web
exit 1
EOF
echo "✓ deployed"
