# CLAUDE.md

AI-powered EGE physics learning platform (Russian). Solo developer; optimise for simplicity, low ops burden and low running cost over scale-out elegance.

Read `docs/ARCHITECTURE.md` (decisions) and `docs/MVP_PLAN.md` (milestones) before non-trivial work. Update them when a decision changes — they are the source of truth, not chat history.

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
- `uv run uvicorn platform_api.main:app --reload` — run API locally

Web (`cd web`):
- `npm ci`, `npm run dev`, `npm run build` (runs `content-build build` first), `npm run check`

Full stack: `docker compose -f infra/compose.yaml up --build`.

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

## Workflow

- Commit small and often, Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`). Run lint + tests before committing.
- Work on feature branches (`feat/...`); `main` stays deployable.
- Every change touching tutor prompts or model choice must run the evals.
