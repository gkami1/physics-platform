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
   - `build/private/` — answers, solutions, hint ladders, tutor notes. Baked into the API image and served from memory (`ContentStore`); on start the API mirrors public task metadata into the `tasks` table so attempts have a foreign key. `content_version` is a SHA-256 of the `content/` tree. *(Changed in M2: no `task_private` table — the content is immutable per deploy, so a DB copy only adds sync work.)*
4. Astro reads theory Markdown directly (no secrets there) and tasks only from `build/public/`.

**Invariant: answers never reach the browser before the server decides to reveal them.** A test asserts that no private field appears in `build/public/` or in the built site.

### Figures and interactive models (decided 2026-10-31)
Nothing is drawn by hand. Two mechanisms, no new dependencies:
- **Generated SVG figures.** A YAML spec in `content/<exam>/figures/<name>.yaml` (kinds: `graph` — axes, grid, polylines, shaded areas, notes; `diagram` — primitives in viewBox coordinates: lines, arrows, circles, rects, hatched surfaces, springs, angle arcs, sine waves, dots, circuit elements, labels with `*italic*`, `_sub`, `^{sup}` markup) is rendered by `content_schema.figures` to `assets/<name>.svg` with `content-build figures`. The spec holds the same numbers the task's answer was computed from; `content-build validate` fails if a committed SVG is stale. SVGs use `currentColor` + `fig-*` classes (tones `force`/`vel`/`accent`/`muted` are groups whose CSS `color` the theme sets; a named `color` attribute is only a standalone fallback) and are **inlined** into the HTML (content-build for task statements/solutions, a remark plugin in `web/markdown.config.mjs` for theory), because an `<img>` cannot follow the light/dark theme. Markdown keeps the usual `![alt](../../assets/x.svg)` on its own line; `alt` becomes the figure's `aria-label`. One-off diagrams can be hand-written SVG in `assets/` with the same conventions.
- **Interactive models** are vanilla custom elements (`<pp-projectile v0="20" angle="30">`, `web/src/lib/sims/`), written into theory Markdown as plain HTML with no-JS fallback text inside. The theory page imports a model's module only if the element is present, so other pages ship no extra JS. Light DOM, styled by `.sim*` rules in `global.css`. Physics uses the EGE convention g = 10 м/с².
- **Theory as a ladder with step tasks** *(decided 2026-11-01)*. A theory page is a sequence of `## Шаг N. Title (9 класс)` sections (the grade renders as a badge; validate requires steps numbered in order with grades 7–11 that never go down) that go from the 7th-grade idea to the EGE level (order follows Перышкин 7–9 → Мякишев 10–11; prose is our own, never copied). After a step comes a task that needs only what is above it, written as `<pp-task id="…"></pp-task>` on its own line. Step tasks live in `tasks/steps/`, have no `ege_task`, are scored by `exam.yaml: practice`, count toward topic mastery like any attempt, and are never in variants (the API rejects them there). `content-build validate` checks every embed exists, is tagged with the page's topic and appears once, and that every step task is embedded. The site renders the statement from `build/public` (remark plugin `remarkTaskEmbeds` in `web/markdown.config.mjs`, so answers still never reach Astro) plus the same `<task-answer>` form as the task page; `build/public` theory entries list embedded ids, and the page's «Практика» list skips them. Astro caches rendered theory, so `npm run content` deletes `web/node_modules/.astro/data-store.json` (and `web/.astro/`) to pick up edited statements.
- Rejected: AI image generators (physically wrong diagrams), Manim/video (heavy, hard to update), Preact for sims (a dependency for what fits in plain DOM code). PhET HTML5 sims (CC-BY) may be **self-hosted** later for sandbox-style exploration; never embedded from their servers (152-ФЗ, no third-party requests).

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

Step tasks (theory ladders) omit `ege_task` and live in `tasks/steps/`.

`sequence` answers: `value: "13"`, `ordered: true|false`. Scoring (1 point, or 2 points with 1 for a single error) comes from `exam.yaml`, not the task.

### Site structure and design (decided 2026-10-28)
Dark-first app shell (light theme toggle, `pp:theme` in localStorage), three tabs; the layout borrows the familiar «roadmap + problem list» pattern of coding-prep sites, with its own look.
- **Роадмап** (`/`): topics as one numbered path in study order (`orderedTopics`: sections as authored, prerequisites first), mastery per node, «Продолжить» to the first topic below 80 %.
- **Практика** (`/<exam>/practice/`): task table with solve status (`GET /api/tasks/status`), filters (part, number, topic, status) in the URL, «Случайная задача» preferring unsolved ones; the filtered pool goes to sessionStorage so the task page offers «Ещё задача». `/<exam>/tasks/` redirects here.
- **Варианты** (`/<exam>/variants/[n]/`): synthetic full variants composed **at build time**, one task per EGE number: each number's pool (published first) is shuffled with a seeded PRNG and variant k takes item k mod pool size; up to 20 variants, static and shareable. Timer = `exam.yaml: duration_minutes`, run in the browser (deadline in localStorage; survives reloads; auto-submit at zero). `POST /api/variants/runs` checks Part 1 on the server and records each answer as an ordinary attempt; Part 2 is self-assessed afterwards (`PUT …/self-assessment`) next to the revealed reference solution. Runs are owned like attempts (`variant_runs`, merged on sign-in). The client-reported duration is informational; nothing high-stakes depends on it.

## 6. Data model (Postgres)

| Table | Key fields |
|---|---|
| `users` | id, email (normalised, unique), consented_at, created_at; more consent flags and birth year in M7 |
| `auth_identities` | user_id, provider (yandex/vk/telegram), subject — *added with the first OAuth provider; email sign-in uses `users.email`* |
| `sessions` | id (sha256 of the cookie token), user_id, expires_at |
| `login_codes` | email, code_hash, ip, tries, expires_at, used_at (also the rate-limit ledger) |
| `tasks` | public metadata mirrored from content on API start; `active=false` when removed |
| `attempts` | anon_id (M2) / user_id (M3), task_id, outcome (correct/partial/wrong/revealed), raw_answer, points, max_points, content_version, created_at |
| `topic_mastery` | *not a table yet:* computed on read from `attempts` (see §7). Materialise if `/api/progress` gets slow |
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
- Invalid input (unparseable) returns `invalid` and is not stored — a typo never costs points.
- Solution reveal (`policy.can_reveal_solution`): Part 1 after at least one graded attempt; Part 2 always. A reveal is stored once as a `revealed` attempt (analytics).
- Mastery (`mastery.compute_mastery`, pure): evidence is the **first graded attempt per task** (points / max); retries and reveals are practice, not evidence. Per topic, an EMA with α = max(1/n, 0.3): early results average equally, later ones weigh more so the score follows improvement. Computed on read (`GET /api/progress`) for both anonymous visitors and users.
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
*(M4: `hints.py`. One level up per "hint" request, or after 3 turns once the student has attempted the task; level 3 only on explicit request and when the solution-reveal policy allows it. Theory threads have no level.)*

### Guardrails
- Leak filter on the output stream (sentence-buffered): matches final answer (numeric within precision, unit variants) or sequence before level 3 → regenerate/mask. *(M4: `leak.py` strips `<think>` blocks, releases text sentence by sentence and stops before the leaking sentence with a fixed note; no regeneration yet. Given data and allowed hints are exempt.)*
- Student text wrapped in delimiters and declared as data; pasted text cannot change rules.
- Tutor coaches from the author's solution rather than solving from scratch (physics correctness).
- Theory-page questions outside the page: say so and point to the roadmap.
- No PII in prompts (only an opaque user id and the dialogue).

### Model routing
Cheap model by default; strong model for flagged-hard theory explanations, Part 2 "why is my solution wrong", and when a self-check fails. Provider adapters behind one interface (`complete`, `stream`), OpenAI-compatible where possible. Candidates: GigaChat (Lite/Pro/Max), YandexGPT (Lite/Pro), open models (Qwen, DeepSeek) on Yandex AI Studio / Cloud.ru. Final choice is made by eval results and ₽/1k tokens.
*(M4: one OpenAI-compatible streaming client. Primary: self-hosted Qwen3-8B on vLLM, thinking off; fallback: DeepSeek, used only if the primary fails before the first token. No PII in prompts, so the foreign fallback receives only page content and dialogue. With neither configured the API uses a scripted dev model. Every provider attempt is a row in `llm_calls` with TTFT, latency, tokens, cost in kopecks and prompt version.)*

### Development model (decided 2026-10-28)
While building, the tutor and the evals run on **Google AI Studio's free tier** (Gemini Flash via its OpenAI-compatible endpoint, `.env.example`). Allowed because prompts hold only content and the developer's own test messages; never configured for a deployment with real students (free-tier prompts may be used for training; servers outside Russia). Production stays vLLM/Qwen + DeepSeek fallback; the final choice still comes from evals. Provider-specific request fields go in `API_LLM_EXTRA_BODY` (JSON).

### Access (M4)
Signed-in users only; one thread per user and page (`tutor_threads`), 50 messages per 24 h (`API_TUTOR_DAILY_MESSAGES`) until plans arrive in M7. The chat island renders model output through DOMPurify (`renderUntrusted`).

### Streaming
SSE from FastAPI. Client renders Markdown + KaTeX incrementally, deferring unclosed `$…$`.

### Evals (from day one)
`evals/`: YAML cases (persona × task × scripted turns). Deterministic metrics: answer-leak rate, hint-level adherence, language, length. LLM-judge metrics: hint quality, physics correctness vs reference solution — judge calibrated on ~50 author-labelled cases. Runs in CI on prompt/model changes; weekly sample of anonymised real threads. Results stored per commit for comparison.

*(M5 v0, `evals/`, `tutor-eval run`.)* Runs in-process through the same ladder/context/prompt/guard code as the API (`turn.py`), without HTTP or DB. `suite.yaml` holds personas (honest, impatient, injection, correct guess, wrong attempt → full solution, theory on-topic/off-topic/injection) played against every task and theory page. Leak rate is measured on the **raw** model output, before the guard: the guard keeps students safe either way, but each stop is a broken reply. Other deterministic checks: Russian share outside formulas, CJK characters, stray think tags, empty, length per page kind. Thresholds in `suite.yaml` gate the run. CI: `.github/workflows/evals.yml` on PRs touching tutor code or `evals/`, or by hand; needs `EVAL_LLM_*` secrets, otherwise skips; the JSON report is a 90-day artifact. LLM judge (hint quality, physics correctness, rule adherence) comes after ~50 author-labelled cases.

## 9. Auth

Email one-time code now (M3); Yandex ID / VK ID (OAuth) and optional Telegram Login later, as `auth_identities`. No SMS, no passwords.

- **Codes:** 6 digits, 10 min, single use, 5 wrong tries per code; at most 1/min and 5/hour per address and 20/hour per IP. The same response for new and existing addresses (no enumeration). Stored as sha256(email:code).
- **Mail:** plain SMTP via a Russian provider (e.g. Yandex 360). Without `API_SMTP_HOST` the code is written to the API log (local runs).
- **Sessions:** opaque token in an `HttpOnly; SameSite=Lax` cookie (`Secure` in prod), `path=/api`; only its sha256 stored; 60 days, renewed when used in the second half.
- **Anonymous practice:** an opaque `pp_anon` cookie (HttpOnly, `path=/api`) keys server-side attempts. On sign-in those rows get the user_id and the cookie is cleared; anonymous queries exclude merged rows, so signing out on a shared device hides the account's history. *(Changed in M2 from localStorage: one code path for history, nothing to merge client-side.)*
- **Consent:** sign-in requires the personal-data consent checkbox; `users.consented_at` records it. Legal texts and the parental path come in M7.
- **CSRF:** state-changing requests with an `Origin` that doesn't match `Host` are rejected (on top of SameSite=Lax). Requires the proxy to keep `Host` (Caddy does; the Vite dev proxy is set to).
- **Abuse:** 30 graded attempts per minute per actor.

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
