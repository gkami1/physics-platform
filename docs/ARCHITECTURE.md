# Architecture

Status: **agreed — option C** (static content site + thin Python API). Last updated 2026-10-25.

This document records *decisions and their reasons*. Implementation details live in code; keep this file short and current.

## 1. Product scope (MVP)

EGE physics, Russian only. Roadmap of topics → theory pages → practice tasks with auto-checking → AI tutor on every page → progress/mastery → accounts + freemium.

Future exams (AP Physics), languages and subjects must be *additions* (new content folders, `exam`/`locale` fields), not rewrites. We do **not** build for them now.

### EGE physics structure (verify every season)

- 26 tasks, 235 minutes. Tasks 1–20 short answer (Part 1), 21–26 extended written solution (Part 2). Max primary score 45 (Part 1: 28, Part 2: 17).
- 2027: FIPI published the *draft* demo/spec/codifier in Aug 2026 and the **approved** ones on 2026-11-13 (`doc.fipi.ru/ege/demoversii-specifikacii-kodifikatory/2027/fi_11_2027.zip`). Per-task max points and scoring rules are recorded in `content/ege-physics/exam.yaml` (`verified: true` since 2026-11-13). That file is the single source of truth; code never hardcodes per-task points. Each new season: reset `verified` to false and re-check against that season's approved spec.
- *(checked 2026-11-13 against the approved 2027 specification)* It matches the draft: section 11 says «Изменения структуры КИМ отсутствуют. Внесены коррективы в тематику заданий 21 и 23». Points per task, the partial-credit rules (6/10/15/17 ordered, one wrong position = 1 point; 5/9/14/18 two or three true answers in any order; 20 in any order), levels (Б 17, П 6, В 3), 45 points and 235 minutes are as in 2026; every content code in the generalised plan is the same, and the codifier's element list is unchanged. Row 22 is reworded «Решать расчётные практико-ориентированные задачи с явно заданной физической моделью…» (still area 1, «П», 2 points; the 2027 demo keeps the 2026 croquet-ball task). The 2027 demo's Part 2: №21 a DC circuit with diodes and two keys, №23 argon leaking from a rigid vessel (p–T graph), №24 humid air after a partition is removed, №25 a nickeline-wire rectangle with a diagonal, №26 two plasticine balls colliding in the air — none of them is in our bank.
- *(checked 2026-11-12 against the 2027 draft specification)* Parts, answer kinds, points and scoring are as in the approved 2026 spec; tasks 5, 9, 14 and 18 read «выберите все верные утверждения» with two or three true answers (one wrong, extra or missing digit = 1 point). The thematic change is in the generalised plan: №21 (qualitative, 3 points) narrows from content areas 2, 3 to 3 — electrodynamics; №23 (calculation, 2 points) from 2, 3 to 2 — molecular physics and thermodynamics. (In the 2026 demo №21 was a thermodynamic cycle and №23 an LC circuit.) The spec's Table 1 still lists broader topics for both; the plan is taken as decisive. The approved spec keeps this plan; bank tasks that no longer fit carry `last_season: 2026` (see «Варианты»).

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
- **Theory as a ladder with step tasks** *(decided 2026-11-01)*. A theory page is a sequence of `## Шаг N. Title (9 класс)` sections (the grade renders as a badge; validate requires steps numbered in order with grades 7–11 that never go down) that go from the 7th-grade idea to the EGE level (order follows Перышкин 7–9 → Мякишев 10–11; prose is our own, never copied). After a step comes a task that needs only what is above it, written as `<pp-task id="…"></pp-task>` on its own line. Step tasks live in `tasks/steps/`, have no `ege_task`, are scored by `exam.yaml: practice`, count toward topic mastery like any attempt, and are never in variants (the API rejects them there). `content-build validate` checks every embed exists, is tagged with the page's topic and appears once, and that every step task is embedded. The site renders the statement from `build/public` (remark plugin `remarkTaskEmbeds` in `web/markdown.config.mjs`, so answers still never reach Astro) plus the same `<task-answer>` form as the task page; `build/public` theory entries list embedded ids, and the page's «Практика» list skips them. The theory tutor sees the statements (not the answers) in place of the tags (§8). Astro caches rendered theory, so `npm run content` deletes `web/node_modules/.astro/data-store.json` (and `web/.astro/`) to pick up edited statements.
- **Topics as lessons** *(decided 2026-11-03)*. A ladder page covers a topic in 9 short steps — reviewed, not explained, and hard to follow. A topic can instead be a folder `theory/<topic>/`: `_topic.md` (intro, «what you'll be able to do») and lessons `01-slug.md`… with `grade`, `summary` and plain `##` sections (no «Шаг N»: the lesson is the step). Each lesson explains one idea slowly: phenomenon → picture → definition → worked example → «Проверь себя» (`<details>`) → typical mistake → step tasks. The roadmap, mastery and EGE numbers stay per topic. Page ids are `<topic>/<slug>` (URL `/theory/<topic>/<slug>/`, tutor `context_id`); numbers «1.2» come from the topic's place in its roadmap section and the file order, never written by hand. The topic page lists lessons with «решено N из M» (`/tasks/status`) and has no chat; each lesson has the docked tutor with its own thread. Validation: lessons 01..N, unique slugs, grades never go down, every step task embedded once across the topic's lessons. Whole-topic pages keep working, so topics move over one at a time; pilot: «Основы кинематики» (6 lessons).
- **Animated figures without JS** *(2026-11-03)*: figure specs can `animate: draw` a path (with a `mover` dot riding along, SMIL `animateMotion`) and `animate: appear` any item, on one shared 6 s CSS loop. The resting state is the finished picture, which reduced-motion readers see.
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
Dark-first app shell (light theme toggle, `pp:theme` in localStorage), five tabs (on phones they share one scrollable row); the layout borrows the familiar «roadmap + problem list» pattern of coding-prep sites, with its own look.
- **Траектория** (`/`): topics as one numbered path in study order (`orderedTopics`: sections as authored, prerequisites first), mastery per node, «Продолжить» to the first topic below 80 %.
- **Каталог заданий** (`/<exam>/catalog/`, decided 2026-11-19): the bank split by EGE number. A grid of all numbers from `exam.yaml` (grouped by part, task count, solved count from `GET /api/tasks/status`); each opens `/<exam>/catalog/<n>/` with every task that counts as that number this season (`tasksOfNumber`: `inSeason`, easiest first), full statements rendered at build time, «Решить →» to the task page. Clicking through stores the number's pool in sessionStorage like Практика does, so the task page's back link returns to the number and «Ещё задача» stays within it.
- **Практика** (`/<exam>/practice/`): task table with solve status (`GET /api/tasks/status`), filters (part, number, topic, status) in the URL, «Случайная задача» preferring unsolved ones; the filtered pool goes to sessionStorage so the task page offers «Ещё задача». `/<exam>/tasks/` redirects here.
- **Варианты** (`/<exam>/variants/[n]/`): synthetic full variants composed **at build time**, one task per EGE number: each number's pool (published first) is shuffled with a seeded PRNG and variant k takes item k mod pool size; up to 20 variants, static and shareable. A task with `last_season: Y` in its frontmatter fits its number only up to season Y (the plan moved that number to other topics, e.g. №21/№23 in 2027): in later seasons it is left out of variants and the practice list's «№» filter, keeps its page (headed «Задание № N (ЕГЭ Y)») and still counts for topic practice. Timer = `exam.yaml: duration_minutes`, run in the browser (deadline in localStorage; survives reloads; auto-submit at zero). `POST /api/variants/runs` checks Part 1 on the server and records each answer as an ordinary attempt; Part 2 is self-assessed afterwards (`PUT …/self-assessment`) next to the revealed reference solution. Runs are owned like attempts (`variant_runs`, merged on sign-in). The client-reported duration is informational; nothing high-stakes depends on it.
- **Блиц** (`/<exam>/blitz/`, decided 2026-11-14): a timed formula game. The player sees a formula's title and left side and types the right side, with a palette of quantities (the formula's own plus three decoys from its section), symbols, Greek letters and functions. Score, current streak (5 in a row = +5 s) and a per-section/duration record in localStorage. Content is `content/<exam>/formulas.yaml` (roadmap topic → `{grade, title, ask: 'lhs = rhs', also}`), validated by `content-build` and emitted into `build/public` — formulas are the theory's own, so they are public and **checked in the browser**; nothing is sent to the API, scored or counted for mastery. `web/src/lib/blitz/expr.ts` parses both the author's strict syntax and the student's loose input (implicit multiplication binding tighter than `/`, so `mv^2/2R` is (mv²)/(2R); optional `_`; Cyrillic lookalikes = Latin; `²`, `√`, `·`), renders TeX for a live preview, and decides equality by evaluating both sides at random positive values (angles in 0.2–1.3 rad; points where the reference is undefined are skipped) — any algebraically equal form counts, no CAS. `npm test` (`node --test`, no new dependency) checks the parser and that every authored formula accepts itself and rejects ×2.

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
2. Page context: the whole theory page or lesson (≤14k chars, ~3–4k tokens, no RAG; a lesson also lists its topic's lessons so the tutor can point to the right one, `tutor-v3`) with each step task's **statement** inlined where it is embedded — never its answer, solution, hints or notes; or task statement + authored hints up to the allowed level + reference solution. *(2026-11-03: whole page instead of «section ± neighbours»: the longest page is 13.2k chars with statements, students ask about steps they scrolled past, and a per-section context would break prefix caching every turn.)*
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
- Theory step tasks count toward mastery, so the theory prompt says to coach them with questions and send the student to the answer field, and the server guards their answers too: `plan_theory_turn` combines one `LeakDetector` per embedded step task (`AnyLeak`) with its own note. Numbers printed anywhere on the page or in a statement are exempt so the tutor can quote the text; that leaves 121 of 311 step answers (2026-11-03) guarded, because small numbers recur in examples and headings. Exempting only the task's own statement would guard 86% but cut replies that quote the page on 45 of 47 pages; a unit-aware match (~76%) is the next step if evals show raw step leaks.
- No PII in prompts (only an opaque user id and the dialogue).

### Model routing
Cheap model by default; strong model for flagged-hard theory explanations, Part 2 "why is my solution wrong", and when a self-check fails. Provider adapters behind one interface (`complete`, `stream`), OpenAI-compatible where possible. Candidates: GigaChat (Lite/Pro/Max), YandexGPT (Lite/Pro), open models (Qwen, DeepSeek) on Yandex AI Studio / Cloud.ru. Final choice is made by eval results and ₽/1k tokens.
*(M4: one OpenAI-compatible streaming client. Primary: self-hosted Qwen3-8B on vLLM, thinking off; fallback: DeepSeek, used only if the primary fails before the first token. No PII in prompts, so the foreign fallback receives only page content and dialogue. With neither configured the API uses a scripted dev model. Every provider attempt is a row in `llm_calls` with TTFT, latency, tokens, cost in kopecks and prompt version.)*

### Development model (decided 2026-10-28, provider changed 2026-11-03)
While building, the tutor and the evals run on a **free tier**: first Google AI Studio (Gemini Flash; needed a proxy from Russia), since 2026-11-03 **OpenRouter free models**, pinned to one model (`nvidia/nemotron-3-ultra-550b-a55b:free`, not the random `openrouter/free` router) so eval runs stay comparable (`.env.example`). The free quota (~50 requests/day) fits `evals/suite-theory-quick.yaml` or `--persona` subsets, not the full suite. Allowed because prompts hold only content and the developer's own test messages; never configured for a deployment with real students (free-tier prompts may be used for training; servers outside Russia). Production stays vLLM/Qwen + DeepSeek fallback; the final choice still comes from evals. Provider-specific request fields go in `API_LLM_EXTRA_BODY` (JSON).

### Access (M4)
Signed-in users only; one thread per user and page (`tutor_threads`), 50 messages per 24 h (`API_TUTOR_DAILY_MESSAGES`) until plans arrive in M7. The chat island renders model output through DOMPurify (`renderUntrusted`). *(2026-11-19: a turn is written only after the reply. If every model fails before answering, only the `llm_calls` traces are kept: no quota, no ladder step, no unanswered message in the thread, and the client restores its level and counter. If the model dies mid-answer, the shown part is saved with a fixed «Ответ оборвался» note (`truncated`). If the student disconnects mid-stream, a shielded cleanup saves what was shown (`interrupted`); a disconnect before any text still counts toward the quota (the model call happened) as a `no_reply` message that later prompts skip.)* *(2026-11-19: output cap per reply: 600 tokens for coaching and theory, 1500 at hint level 3, where 600 cut off 3 of 32 full Part 2 solutions in the baseline (`max_reply_tokens`). A reply that stops at the cap (`finish_reason: length`) ends with «Ответ не поместился целиком… «продолжи»» (`cut_at_limit`); the evals report it as `cut_off` and skip the length check at level 3.)*

### Theory chat (decided 2026-11-03)
On theory pages the chat is always at hand (`TutorChat variant="docked"`; task pages keep the inline button). From 64rem: a 42rem reading column plus a sticky chat column of viewport height whose log scrolls on its own; below 64rem a floating «Спросить» button opens it as a bottom sheet kept above the on-screen keyboard (`visualViewport`). A line encourages questions («Глупые вопросы рождают глубокое понимание»). Cost per page view is zero tutor requests: the sign-in state comes from the header's `/api/me` answer (`session()`), and the thread loads on the first focus — or at once on wide screens if this browser has talked on the page before (`pp:tutor:theory:<topic>` in localStorage). Signed-out readers see the panel with a «Войти, чтобы спросить» button instead of the compose box. Follow-up: select text → «Спросить об этом» quotes it into the chat.

### Streaming
SSE from FastAPI. Client renders Markdown + KaTeX incrementally, deferring unclosed `$…$`.

### Evals (from day one)
`evals/`: YAML cases (persona × task × scripted turns). Deterministic metrics: answer-leak rate, hint-level adherence, language, length. LLM-judge metrics: hint quality, physics correctness vs reference solution — judge calibrated on ~50 author-labelled cases. Runs in CI on prompt/model changes; weekly sample of anonymised real threads. Results stored per commit for comparison.

*(M5 v0, `evals/`, `tutor-eval run`.)* Runs in-process through the same ladder/context/prompt/guard code as the API (`turn.py`), without HTTP or DB. `suite.yaml` holds personas (honest, impatient, injection, correct guess, wrong attempt → full solution, theory on-topic/off-topic/injection/step-task answer) played against every task and theory page; theory turns are leak-checked against the page's step answers. Leak rate is measured on the **raw** model output, before the guard: the guard keeps students safe either way, but each stop is a broken reply. Other deterministic checks: Russian share outside formulas, CJK characters, stray think tags, empty, length per page kind. Thresholds in `suite.yaml` gate the run. CI: `.github/workflows/evals.yml` on PRs touching tutor code or `evals/`, or by hand; needs `EVAL_LLM_*` secrets, otherwise skips; the JSON report is a 90-day artifact. LLM judge (hint quality, physics correctness, rule adherence) comes after ~50 author-labelled cases. `suite-baseline.yaml` (2026-11-19) is the routine run against the real model: one task per Part 1 number, two per Part 2 number, six theory lessons (~540 calls); the full suite (~22.8k calls) is for rare, deliberate runs.

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
