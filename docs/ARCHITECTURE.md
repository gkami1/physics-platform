# Architecture

Status: **agreed — option C** (static content site + thin Python API). Last updated 2026-10-25.

This document records *decisions and their reasons*. Implementation details live in code; keep this file short and current.

## 1. Product scope (MVP)

EGE physics, Russian only. Roadmap of topics → theory pages → practice tasks with auto-checking → AI tutor on every page → progress/mastery → accounts + freemium.

Future exams (AP Physics), languages and subjects must be *additions* (new content folders, `exam`/`locale` fields), not rewrites. We do **not** build for them now.

### EGE physics structure (verify every season)

- 26 tasks, 235 minutes. Tasks 1–20 short answer (Part 1), 21–26 extended written solution (Part 2). Max primary score 45 (Part 1: 28, Part 2: 17).
- 2027: FIPI published the *draft* demo/spec/codifier in Aug 2026; reported changes are thematic only (tasks 21 and 23). **Per-task max points and scoring rules must be taken from the approved 2027 specification** (expected Nov 2026) and recorded in `content/ege-physics/exam.yaml`. That file is the single source of truth; code never hardcodes per-task points.

## 2. Options considered

| | A. Next.js monolith | B. FastAPI + Jinja + HTMX | **C. Astro static + FastAPI** |
|---|---|---|---|
| Language | TS everywhere | Python only | Python API, Astro, a few Preact islands |
| Content pages | SSR | SSR | **Prebuilt HTML, KaTeX rendered at build** |
| Tutor/LLM code | TS | Python | Python |
| Rich chat UI | Excellent | Awkward | Island |
| Ops | 1 service | 1 service | 2 containers, 1 VM |

**Chosen: C.** ~80% of the product is authored content, which should be static, fast on cheap phones and CDN-cacheable. The dynamic 20% (checking, tutor, progress, billing) is where the author's strengths (Python, LLMs) are. B remains the fallback if frontend work proves too costly; the API contract is identical.

## 3. System overview

```
             ┌──────────── Caddy (TLS, routing) ────────────┐
 browser ──► │  /*        → static files (Astro build)       │
             │  /api/*    → api (FastAPI, uvicorn)           │
             └───────────────────────────┬──────────────────┘
                                         │
                         Postgres 17 ◄───┤───► LLM providers (RU)
                                         │
                                  S3 (RU) backups, images
```

Single VM in a Russian cloud (Yandex Cloud / Selectel / Timeweb) running docker-compose: `caddy`, `web` (static, may be served directly by Caddy), `api`, `postgres`.

## 4. Repository layout

```
content/<exam>/            # authored content, the product's core asset
  exam.yaml                # task numbers → part, answer kind, max points, scoring rule
  roadmap.yaml             # topic graph
  theory/<topic-id>.md
  tasks/<ege-no>/<task-id>.md
  assets/
packages/content_schema/   # Pydantic models + `content-build` CLI (validate, split public/private)
api/                       # FastAPI service
web/                       # Astro site + Preact islands
evals/                     # tutor eval harness
infra/                     # compose, Caddyfile, deploy scripts
docs/
```

Python is a **uv workspace** (root `pyproject.toml`; members `packages/content_schema`, `api`, later `evals`). The web app is a standalone npm project.

## 5. Content pipeline

1. Author edits Markdown + YAML frontmatter + LaTeX (`$…$`, `$$…$$`) in `content/`.
2. `content-build validate` (CI and pre-commit): schema validation, referential integrity (topic ids, prerequisites form a DAG, task topics exist, task numbers exist in `exam.yaml`), answer spec consistent with the task number's answer kind, referenced assets exist.
3. `content-build build` emits:
   - `build/public/` — topics, roadmap, task statements and metadata. Consumed by Astro. **Contains no answers, solutions or hints.**
   - `build/private/` — answers, solutions, hint ladders, tutor notes. Loaded into Postgres by the API on deploy (keyed by `content_version` = git SHA of `content/`).
4. Astro reads theory Markdown directly (no secrets there) and tasks only from `build/public/`.

**Invariant: answers never reach the browser before the server decides to reveal them.** A test asserts that no private field appears in `build/public/` or in the built site.

### Task file format

```markdown
---
id: kin-0001
ege_task: 1
topics: [kinematics.uniform-accel]
difficulty: 2                 # 1–5
answer:
  type: numeric               # numeric | sequence | text
  value: 12.5
  unit: "м/с"                 # shown next to the input; units are not parsed
  precision: 0.1              # EGE-style: answer rounded to this step
source: {kind: original}      # original | adapted | fipi-bank | book (with ref)
hints:
  - "Какая величина здесь постоянна?"
  - "Свяжите скорость и время через ускорение."
  - "Используйте $v = v_0 + at$."
---
Условие…

## Решение
Полное решение…
```

`sequence` answers: `value: "13"`, `ordered: true|false`. Scoring (1 point, or 2 points with 1 for a single error) comes from `exam.yaml`, not the task.

## 6. Data model (Postgres)

| Table | Key fields |
|---|---|
| `users` | id, email, display_name, birth_year, consent flags, created_at |
| `auth_identities` | user_id, provider (email/yandex/vk/telegram), subject |
| `sessions` | id (opaque token hash), user_id, expires_at |
| `topics`, `tasks`, `task_private` | loaded from content; `content_version` |
| `attempts` | user_id, task_id, raw_answer, verdict, points, hints_used, duration_ms, created_at |
| `topic_mastery` | user_id, topic_id, score, n_evidence, updated_at |
| `tutor_threads` | user_id, context_kind (theory/task), context_id, hint_level, created_at |
| `tutor_messages` | thread_id, role, content, model, tokens_in/out, cost_kop, flags |
| `plans`, `entitlements` | user_id, plan, valid_until |
| `payments` | provider, provider_payment_id (unique), status, amount_kop, raw |
| `usage_daily` | user_id, date, messages, tokens_in/out, cost_kop |
| `llm_calls` | trace of every LLM call (request hash, model, latency, tokens, cost, error) |

Money is stored as integer kopecks. All timestamps are `timestamptz`, UTC.

## 7. Answer checking

A pure function `check(spec, scoring, raw) -> Verdict(correct, points, max_points, normalized)` in `content_schema.checking` (shared by API and tests).

- Numeric: accepts `,`/`.` decimal separators, spaces, `e`/`·10^n` notation. The student's value must equal the reference value rounded to `precision` (EGE convention), with a float-epsilon guard. No unit parsing — the unit is displayed.
- Sequence: digits only, whitespace and separators stripped. `ordered` decides positional vs multiset comparison. Two-point tasks give 1 point for exactly one error (per `exam.yaml` rule).
- Part 2 (MVP): no auto-grading. Student self-assesses against the reference solution and the FIPI criteria; recorded as an attempt with `verdict=self_assessed`. AI feedback on Part 2 is post-MVP.

## 8. AI tutor

### Context assembly (cache-friendly order: static → slow-changing → fast-changing)
1. System prompt (fixed per version): role, Socratic rules, hint ladder, output format (Markdown + `$…$`), Russian, injection policy.
2. Page context: theory section ± neighbours (~2k tokens, no RAG); or task statement + authored hints up to the allowed level + reference solution.
3. Student state: attempts with verdicts, current hint level.
4. Last N turns + rolling summary.

Budget ≈ 4–6k input / ≤400 output tokens per turn.

### Hint ladder — enforced by the server
`hint_level`: 0 nudge → 1 key idea → 2 partial step → 3 full solution. Escalation is decided by server rules (exchanges since last escalation, wrong attempts, explicit request + ≥1 attempt for level 3), never by the model. Each turn states the ceiling.

### Guardrails
- Leak filter on the output stream (sentence-buffered): matches final answer (numeric within precision, unit variants) or sequence before level 3 → regenerate/mask.
- Student text wrapped in delimiters and declared as data; pasted text cannot change rules.
- Tutor coaches from the author's solution rather than solving from scratch (physics correctness).
- Theory-page questions outside the page: say so and point to the roadmap.
- No PII in prompts (only an opaque user id and the dialogue).

### Model routing
Cheap model by default; strong model for flagged-hard theory explanations, Part 2 "why is my solution wrong", and when a self-check fails. Provider adapters behind one interface (`complete`, `stream`), OpenAI-compatible where possible. Candidates: GigaChat (Lite/Pro/Max), YandexGPT (Lite/Pro), open models (Qwen, DeepSeek) on Yandex AI Studio / Cloud.ru. Final choice is made by eval results and ₽/1k tokens.

### Streaming
SSE from FastAPI. Client renders Markdown + KaTeX incrementally, deferring unclosed `$…$`.

### Evals (from day one)
`evals/`: YAML cases (persona × task × scripted turns). Deterministic metrics: answer-leak rate, hint-level adherence, language, length. LLM-judge metrics: hint quality, physics correctness vs reference solution — judge calibrated on ~50 author-labelled cases. Runs in CI on prompt/model changes; weekly sample of anonymised real threads. Results stored per commit for comparison.

## 9. Auth

Email one-time code + Yandex ID + VK ID (OAuth), optional Telegram Login. Opaque session token in an `HttpOnly; Secure; SameSite=Lax` cookie; only its hash stored. No SMS. Anonymous practice allowed (attempts in `localStorage`, merged on sign-up).

## 10. Payments and metering

Provider: YooKassa or Robokassa (Robokassa can auto-issue «Мой налог» receipts for самозанятые). Webhook → `payments` (idempotent on provider id) → extend `entitlements.valid_until`. Plans: 30-day pass, season pass (until end of June). Before each tutor call: check daily message cap (free) / monthly token budget (paid, fair use); after: record actual tokens and cost in `usage_daily`.

## 11. Compliance (152-ФЗ) — summary

- Primary storage of personal data in Russia (DB, backups, logs).
- Roskomnadzor operator notification; privacy policy; public offer; explicit consent; parental consent path for minors (legal review before taking payments).
- No PII to LLM providers; foreign providers would require cross-border transfer notification — avoided by default.

## 12. Hosting, deploy, observability

- One VM (2 vCPU / 4 GB to start), docker-compose, Caddy auto-TLS. Nightly `pg_dump` to RU S3 with a tested restore.
- GitHub Actions: lint, type-check, tests, content validation, web build → images to registry → SSH deploy (`compose pull && up -d`). Migrations (Alembic) and content load on API start.
- Structured JSON logs; `llm_calls` table as LLM trace store; GlitchTip (self-hosted) for errors; uptime pinger; Metabase over Postgres for product metrics (DAU, ₽ LLM per active user, leak flags, conversion).

## 13. Cost model (rough, to be replaced by measured numbers)

Assumptions: active tutor user ≈ 100 msgs/month × 6k tokens ≈ 600k tokens; blended ≈ 0.15 ₽/1k with routing (≈ 90 ₽/user/month, budget 150–250 ₽). All-Max routing (0.3–0.8 ₽/1k) breaks the budget.

| MAU | Infra | LLM (~30% use tutor) | Total/month |
|---|---|---|---|
| 100 | 2–3k ₽ | ~3k ₽ | ~5–6k ₽ |
| 1,000 | 5–8k ₽ | 25–30k ₽ | ~30–40k ₽ |
| 10,000 | 25–40k ₽ | 250–300k ₽ | ~300k ₽ |

## 14. Key risks

1. Content volume (1,000+ tasks with solutions and hint ladders ≈ 400–600 h). Mitigate: parametric generators, LLM-drafted hints reviewed by the author, depth before breadth.
2. Task copyright — prefer original/adapted tasks; record `source`.
3. самозанятый cap 2.4M ₽/year (~170 paying users) — plan ИП before spring 2027.
4. Seasonality: revenue near zero Jun–Aug, load spike in May.
5. LLM physics errors and weak domestic models on multi-step reasoning — grounded coaching + evals.
6. Minors' data/consent.
7. Mobile math overflow — horizontal scroll wrappers, test on low-end Android.

## 15. Open questions

1. LLM providers: domestic-only, or a legitimate foreign option?
2. Existing content volume/format and sources.
3. Weekly hours and launch date.
4. Part 2: paper photos or typed?
5. Beta cohort size; who pays (parents?); consent flow.
6. Tolerance for TypeScript in islands.
7. Recurring billing at launch vs one-off passes.
8. Diagram tooling (TikZ/GeoGebra/SVG); interactive sims later?
