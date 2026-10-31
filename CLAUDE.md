# CLAUDE.md

AI-powered EGE physics learning platform (Russian). Solo developer; optimise for simplicity, low ops burden and low running cost over scale-out elegance.

Read `docs/ARCHITECTURE.md` (decisions), `docs/MVP_PLAN.md` (milestones) and, for anything server-side, `docs/DEPLOY.md` (runbook) before non-trivial work. Update them when a decision changes — they are the source of truth, not chat history.

## Layout

- `content/<exam>/` — authored Markdown + YAML content (theory, tasks, `roadmap.yaml`, `exam.yaml`). The author edits these by hand; do not reformat or rewrite content prose unless asked.
- `packages/content_schema/` — Pydantic content models, answer checker, `content-build` CLI.
- `api/` — FastAPI service (`api` package).
- `web/` — Astro static site + Preact islands.
- `evals/` — tutor eval harness.
- `infra/` — docker-compose, Caddy, deploy.

## Commands

Python (uv workspace, run from repo root):
- `uv sync` — install
- `uv run pytest` — all Python tests
- `uv run ruff check . && uv run ruff format --check .` — lint/format
- `uv run mypy` — type-check
- `uv run content-build validate` — validate `content/`
- `uv run content-build build` — emit `build/public` and `build/private`
- `uv run content-build figures` — regenerate `assets/*.svg` from `content/<exam>/figures/*.yaml` (validate fails on stale SVGs)
- `uv run alembic -c api/alembic.ini upgrade head` — migrate (URL from `API_DATABASE_URL`)
- `uv run alembic -c api/alembic.ini revision --autogenerate -m "..."` — new migration; review it and keep it dialect-neutral (`sa.func.now()`, not SQLite/PG literals)
- `uv run uvicorn platform_api.main:app --reload` — run API locally
- `uv run tutor-eval run` — tutor evals against the models in `API_LLM_*` (scripted dev model if none; `--provider`, `--persona`, `--repeats`, `--compare old.json`). Suite: `evals/suite.yaml`; reports in `evals/results/` (gitignored)

Local dev without Docker: copy `.env.example` to `.env` (SQLite + Google AI Studio free-tier key for the tutor; dev only, never for real students), migrate, run the API, then `cd web && npm run dev -- --host 127.0.0.1` (the dev server proxies `/api` to :8000). Tests use SQLite unless `API_TEST_DATABASE_URL` points at Postgres (CI does). To sign in locally, request a code and read it from the API log (no SMTP configured → `email not sent` log line; in Docker: `docker compose -f infra/compose.yaml logs api`).

Web (`cd web`):
- `npm ci`, `npm run dev`, `npm run build` (runs `content-build build` first), `npm run check`

Full stack: `docker compose -f infra/compose.yaml up --build`.

Smoke test (CI runs it in the docker job): `API_ENV=dev HTTP_PORT=8180 docker compose -p pp-check -f infra/compose.yaml up --build -d --wait`, then `uv run python infra/smoke.py http://localhost:8180 pp-check`, then `docker compose -p pp-check -f infra/compose.yaml down -v`. A separate project name keeps it away from your own running stack.

## Invariants (do not break)

1. **Answers, solutions and hints never ship to the browser** unless the server decides to reveal them. Astro reads tasks only from `build/public/`. A test enforces this — keep it passing and extend it when adding fields.
2. **Per-task points and scoring rules live in `content/<exam>/exam.yaml`**, never hardcoded.
3. **Hint-ladder level is decided server-side**, never by the LLM.
4. **No PII in LLM prompts** — opaque ids and dialogue only.
5. Personal data stays in Russian infrastructure (152-ФЗ). Don't add third-party SaaS that receives user data without discussing it.
6. Money is integer kopecks; timestamps are UTC `timestamptz`.

## Conventions

- Python 3.13, type hints everywhere, Pydantic v2 models, `ruff` + `mypy --strict` clean.
- Pure logic (checking, mastery, hint escalation, context assembly) is plain functions with table-driven tests; I/O stays at the edges.
- UI text is Russian; code, comments, commits and docs are English.
- Keep dependencies few; justify new ones in the commit message.
- Frontend: static-first. Ship JS only in islands that need interactivity. Mobile-first; math must not overflow narrow screens.

## Gotchas

- **LaTeX in YAML frontmatter must be single-quoted** (`'$\frac{a}{2}$'`). In double quotes `\f`, `\t`, `\n` become control characters silently; the validator rejects them.
- The Python API package is `platform_api` (not `api`): the repo's `api/` folder would shadow it as a namespace package.
- Astro 7 defaults to the Sätteri Markdown processor; we set `markdown.processor: unified(...)` for remark-math/rehype-katex. Don't add `markdown.remarkPlugins` at the top level.
- `katex` is pinned via npm `overrides` so the HTML from rehype-katex and the CSS we import come from one version.
- Keep Astro `trailingSlash: 'ignore'`: `'always'` makes `astro dev` 404 `/api/*` before the proxy.
- Figures are inline SVG, not `<img>`, so they follow the theme: draw with `currentColor` / `fig-*` classes, never hard-coded colours. Generated ones come from `figures/*.yaml` — edit the spec, not the SVG. Interactive models are custom elements in `web/src/lib/sims/`, loaded by the theory page only when present.
- Client-side `renderMarkdown` does not sanitize. Fine for author content; LLM output must be sanitized first.
- State-changing API requests must carry an `Origin` matching `Host` (CSRF check). Any proxy in front of the API must keep `Host`: Caddy does by default; the Vite dev proxy needs `changeOrigin: false` (its string shorthand rewrites it).
- SQLite returns naive datetimes. Compare times in SQL, or wrap with `actor.as_utc` before Python arithmetic or JSON output.
- On Windows, httpx picks up the system proxy from the registry: local test clients need `trust_env=False`, or localhost requests come back 503.
- With `from __future__ import annotations`, FastAPI dependency aliases (`Annotated[..., Depends(...)]`) must be module-level, or params silently become body/query fields.

## Workflow

- Commit small and often, Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`). Run lint + tests before committing.
- Work on feature branches (`feat/...`); `main` stays deployable.
- Every change touching tutor prompts or model choice must run the evals.
