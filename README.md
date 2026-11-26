# Траектория — EGE physics platform

A Russian-language platform for preparing for the EGE (ЕГЭ) in physics: a topic roadmap, step-by-step theory, a large bank of practice tasks with automatic checking, and an AI tutor that gives page-aware hints instead of answers.

Live at **[traektoria.pro](https://traektoria.pro)**.

## What's inside

- **Roadmap and theory** — 47 topics across mechanics, molecular physics and thermodynamics, electrodynamics and optics, special relativity, quantum physics, and experimental method. Each topic has graded lessons (from grade 9 to exam level), inline SVG figures and interactive models.
- **Task bank** — about 1,400 tasks, covering every EGE task number 1–26 plus short step tasks inside the lessons. Part 1 answers are checked automatically using the scoring rules of the current exam spec. Part 2 tasks come with worked solutions.
- **AI tutor** — on every theory and task page. It knows the page's context and leads the student through a server-controlled hint ladder. It does not just reveal the answer.
- **Progress and mastery** — per-topic mastery tracking and solve history.
- **Accounts and Премиум** — email + password sign-in, a freemium model and a paid plan (Robokassa).

The content targets the **2027** exam. The per-task points and scoring rules are checked against the approved FIPI specification and stored in [`content/ege-physics/exam.yaml`](content/ege-physics/exam.yaml).

## Architecture

```
             ┌──────────── Caddy (TLS, routing) ────────────┐
 browser ──► │  /*        → static files (Astro build)       │
             │  /api/*    → api (FastAPI, uvicorn)           │
             └───────────────────────────┬──────────────────┘
                                         │
                              Postgres ◄─┴─► LLM provider
```

- **Content** is hand-written in Markdown and YAML. It is validated and split into a public build (what the browser may see) and a private one (answers, solutions, hints).
- **Web**: Astro builds static pages. KaTeX is rendered at build time. JavaScript ships only where a page needs interactivity (plain TypeScript scripts and custom elements, no UI framework).
- **API**: FastAPI handles answer checking, the tutor, progress, auth and billing. It uses SQLAlchemy with Alembic and runs on Postgres in production and SQLite in development.
- **Deploy**: docker-compose on a single VM in Russia. Personal data stays in Russian infrastructure (152-ФЗ).

The reasons behind these choices are in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Repository layout

| Path | What |
|---|---|
| `content/ege-physics/` | Authored content: `exam.yaml`, `roadmap.yaml`, `theory/`, `tasks/`, `figures/`, `assets/` |
| `packages/content_schema/` | Pydantic content models, the answer checker and the `content-build` CLI |
| `api/` | FastAPI service (Python package `platform_api`) |
| `web/` | Astro site, interactive scripts and models (`src/lib/sims/`) |
| `evals/` | Tutor eval harness (`tutor-eval`) |
| `infra/` | Compose file, Caddyfile, deploy, backup and smoke-test scripts |
| `docs/` | Architecture, MVP plan, deploy runbook |

## Getting started

Requirements: Python 3.13 with [uv](https://docs.astral.sh/uv/), Node.js and npm, and Docker for the full stack.

### Local development (no Docker)

```sh
uv sync
cp .env.example .env                         # SQLite + an LLM key for the tutor (dev only)
uv run alembic -c api/alembic.ini upgrade head
uv run uvicorn platform_api.main:app --reload

# in another terminal
cd web
npm ci
npm run dev -- --host 127.0.0.1              # proxies /api to :8000
```

Locally, no email is sent. To sign in, request a code and copy it from the API log (look for the `email not sent` line).

### Full stack (Docker)

```sh
docker compose -f infra/compose.yaml up --build
```

## Common commands

```sh
uv run pytest                                 # Python tests
uv run ruff check . && uv run ruff format --check .
uv run mypy                                   # strict type-check
uv run content-build validate                 # validate content/
uv run content-build build                    # emit build/public and build/private
uv run content-build figures                  # regenerate SVGs from figures/*.yaml
uv run tutor-eval run                         # tutor evals (see evals/)

cd web && npm run build && npm run check      # site build + type-check
```

## Key invariants

1. Answers, solutions and hints never reach the browser unless the server decides to reveal them. A test enforces this.
2. Points and scoring rules live in `exam.yaml`, never in code.
3. The hint level is decided by the server, never by the LLM.
4. LLM prompts carry no personal data, only opaque ids and the dialogue.
5. Money is stored as integer kopecks, and timestamps are UTC.

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — the decisions and the reasons for them
- [`docs/MVP_PLAN.md`](docs/MVP_PLAN.md) — milestones
- [`docs/DEPLOY.md`](docs/DEPLOY.md) — server runbook
- [`CLAUDE.md`](CLAUDE.md) — conventions, commands and gotchas for contributors
