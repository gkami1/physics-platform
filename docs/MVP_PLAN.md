# MVP plan

Target: usable, paid MVP in ~8 weeks of evenings/weekends (≈10–12 h/week), i.e. late December 2026 — before the January–May exam-prep season. Content authoring runs in parallel every week.

Each milestone has a **definition of done**; a milestone is not finished until it is deployed.

## M1 — Foundation (week 1) — code done 2026-10-25; Docker stack verified 2026-10-28 (smoke test in CI); pending: VM deploy, 30 tasks
- Repo skeleton: uv workspace, `content_schema` package, `api` service, Astro `web`, `infra/`.
- Content schema + `content-build validate|build`; public/private split with a no-leak test.
- `exam.yaml` with EGE task structure (points marked *to verify* until the approved 2027 spec).
- Answer checker (pure function) with table-driven tests.
- Astro: roadmap list + theory pages with build-time KaTeX, mobile-first layout.
- docker-compose + Caddy; CI (lint, types, tests, content validation, web build).
- **Done:** 3 theory pages + 30 tasks validate; site deployed over HTTPS on a RU VM.

## M2 — Practice (week 2) — code done 2026-10-25; pending: deploy
- Task pages (statement from public build, answer input island).
- Postgres + Alembic; content loader (`task_private`); `POST /api/tasks/{id}/check`; `attempts`.
- Anonymous attempts in `localStorage`.
- **Done:** a student can solve Part 1 tasks on a phone and see verdicts.

## M3 — Accounts and progress (week 3) — code done 2026-10-25; pending: SMTP mailbox, deploy
- Email one-time code; sessions; anonymous → account merge. *Yandex ID deferred until an OAuth client is registered.*
- Attempt history; mastery rule (computed on read, no `topic_mastery` table yet); mastery badges on the roadmap.
- CSRF Origin check; rate limits on codes and attempts.
- **Done:** progress persists across devices.

## M4 — Tutor v0 (week 4) — code done 2026-10-28; pending: GPU/vLLM or DeepSeek key, deploy, evals in CI (M5)
- Provider adapter(s); context assembly; SSE streaming; chat island with incremental KaTeX.
- Server-side hint ladder; leak filter; `llm_calls` tracing.
- **Done:** own students use the tutor on task and theory pages (beta starts).

## M5 — Tutor quality (week 5) — started 2026-10-28: deterministic evals + CI workflow; pending: model secrets, LLM judge, routing
- Eval harness in CI (leak rate, hint adherence, language; LLM judge calibrated on ~50 labelled cases).
- Model routing; per-call cost recording; prompt iteration driven by evals.
- **Done:** leak rate ≈ 0 on eval set; measured ₽ per active student within budget.

## Web redesign + variants (2026-10-28, pulled forward) — code done; pending: browser QA, deploy
- Dark app shell; roadmap path; practice table with random task; timed synthetic variants with Part 2 self-assessment (see ARCHITECTURE §5 «Site structure»).
- Covers M6's «roadmap page» and the Part 2 self-assessment for variants.

## Theory ladders (2026-11-01) — pilot: kinematics
- Theory pages rewritten as steps from 7th grade to EGE level, each followed by an embedded step task (see ARCHITECTURE «Theory as a ladder»). Pilot: the four kinematics topics, 32 step tasks.
- **Next:** author review of style and pacing → roll out section by section (dynamics, conservation, thermo first).

## M6 — Roadmap and guidance (week 6)
- Roadmap graph page (prerequisites, EGE task numbers per topic).
- "What to practise next" (weakest mastered-enough prerequisites first).
- Part 2 self-assessment against criteria.
- **Done:** a student can navigate by roadmap and gets a next-step suggestion.

## M7 — Money and compliance (week 7)
- Payment provider integration (webhooks, idempotency), entitlements, plans.
- Daily caps (free), fair-use token budget (paid), "messages left" UI.
- Legal pages (offer, privacy policy, consent incl. parental), Roskomnadzor notification.
- **Done:** a real payment unlocks the paid tier; limits enforced.

## M8 — Launch hardening (week 8)
- Error tracking, uptime, Metabase dashboard; backup + restore drill.
- Content push: ~150 tasks, ~15 topics.
- **Done:** paid launch to the beta cohort.

## Post-MVP backlog
AI feedback on Part 2 (typed first, photos later) · parametric task generators · Telegram login · season analytics · teacher view · AP Physics content.
