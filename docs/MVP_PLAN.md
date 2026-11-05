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

## Theory ladders (2026-11-01) — mechanics, thermo and electrodynamics done
- Theory pages rewritten as steps from 7th grade to EGE level, each tagged with a grade badge and followed by an embedded step task (see ARCHITECTURE «Theory as a ladder»).
- Done: kinematics (4 topics, 32 step tasks), dynamics (Newton, forces, gravity — 22 step tasks), statics (moments, hydrostatics — 15 step tasks), conservation laws (momentum, work and power, energy — 23 step tasks), oscillations and waves (15 step tasks), molecular physics (MKT basics, ideal gas, gas laws, humidity — 25 step tasks), thermodynamics (heat, internal energy, first law, heat engines — 26 step tasks), electrostatics (Coulomb, field, conductors, capacitors — 25 step tasks), DC circuits (Ohm, EMF, power — 20 step tasks), magnetism (Ampère, Lorentz — 12 step tasks), induction (Faraday, self-induction — 11 step tasks), EM oscillations and waves (LC circuit, AC and EM waves — 13 step tasks), optics (refraction, lenses, wave optics — 18 step tasks), special relativity (6 step tasks).
- **Next:** author review → quantum, method.

## Theory chat (2026-11-03) — code done; pending: browser QA, deploy
- Tutor docked beside the theory text (sticky column from 64rem, bottom sheet on phones), always visible, with a line encouraging questions; zero tutor requests per page view (see ARCHITECTURE §8 «Theory chat»).
- Theory context: whole page with step-task statements inlined (`tutor-v2`); step answers guarded server-side. Evals (quick theory suite, Nemotron 3 Ultra on OpenRouter free): 0 leaks in 23 checked turns, Russian 100%, length unchanged.
- Also fixed: chat bubble styles never applied (runtime `<li>` lacked Astro's scope attribute).
- **Next:** «Спросить об этом» (quote a selection into the chat); unit-aware step-answer guard if evals show raw leaks.

## Theory lessons (2026-11-03) — pilot approved by the author (2026-11-04); rolling out to every topic; pending: evals of `tutor-v3`
- Topics can be split into lessons that explain one idea each (see ARCHITECTURE «Topics as lessons»); topic page with a lesson list, lesson pages with the docked tutor, per-lesson tutor context (`tutor-v3`).
- Animated figures without JavaScript; models `<pp-prefix>` (SI prefixes: ladder of powers of ten, comma moving digit by digit), `<pp-uniform>` (car and live s(t) graph), `<pp-path>` (path vs displacement on four routes).
- Pilot «Основы кинематики», six lessons written in full: 1.1 motion and SI, 1.2 speed and uniform motion, 1.3 average speed, 1.4 frame of reference and displacement, 1.5 coordinates and the equation of motion, 1.6 relative motion; 12 new figures (7 animated), 9 new step tasks (ks-basics-10…18, 18 in all).
- Rollout (2026-11-04), one topic per batch of commits, on `feat/lessons-mechanics`:
  - «Равноускоренное движение», five lessons: 2.1 acceleration, 2.2 acceleration as a vector, 2.3 path as the area under v(t), 2.4 braking distance and the timeless formula, 2.5 the coordinate equation and graphs; model `<pp-accel>` (v₀ and a sliders, strobe marks, live v(t) with shaded area; a braking car stops and stays); 7 new figures; step tasks ks-accel-09…14 (14 in all).
  - Graph figures with negative values draw a zero line and shade areas from it (vₓ(t) below the axis).
  - Content tests no longer lean on a real ladder page: they write one into the scratch copy.
  - «Свободное падение и движение тела, брошенного под углом», six lessons (`feat/lessons-mech.kinematics.free-fall`): 3.1 all bodies fall alike (tube without air, g, v = gt), 3.2 height and time of a fall (1 : 3 : 5 : 7, v = √(2gh)), 3.3 throw up (g down all the way, symmetry, path vs displacement), 3.4 horizontal throw (independence of motions, speed by Pythagoras), 3.5 throw at an angle (components, top point, height), 3.6 time of flight and range (45°, complementary angles, throws from a height via x(t), y(t)); model `<pp-drop>` (a dropped and a thrown ball stay level and land together), `<pp-projectile>` reused in 3.6; 7 new figures; step tasks ks-fall-09…17 (17 in all).
  - «Движение по окружности», six lessons (`feat/lessons-mech.kinematics.circular`): 4.1 period and frequency (equal arcs in equal times, rpm → Hz), 4.2 linear speed (v = 2πR/T, along the tangent, a released stone flies straight on), 4.3 centripetal acceleration (Δv points to the centre, a = v²/R, why it feels like an outward pull), 4.4 angular speed (radians, ω = 2π/T, v = ωR, a = ω²R and which formula to use), 4.5 belts, chains and gears (equal rim speeds; one axle, one ω), 4.6 the rolling wheel (rotation + motion of the axis: 0, v, 2v, v√2; the cycloid); model `<pp-circle>` (two points on one spoke with velocity and acceleration arrows, «Отпустить» sends a point off along the tangent); 7 new figures; step tasks ks-circ-08…15 (15 in all).
  - «Законы Ньютона», six lessons (`feat/lessons-mech.dynamics.newton`): 5.1 inertia and mass (a puck on asphalt, snow and ice; v₁/v₂ = m₂/m₁), 5.2 force and the resultant (a vector, mg, forces along a line, balance), 5.3 the first law (constant velocity ⇔ ΣF = 0, inertial frames), 5.4 the second law (a = F/m, forces → motion and back), 5.5 the third law (pairs on different bodies; mg and N are not a pair), 5.6 vectors and connected bodies (Pythagoras, projections, the solving plan, a load on a rope, blocks on a thread, ΣF = mv²/R closes lesson 4.3); model `<pp-cart>` (force, mass and v₀ sliders; force, velocity and acceleration arrows; marks every second, the previous run dimmed); 9 new figures; step tasks ks-newton-09…15 (15 in all).
  - «Силы в механике — упругость, трение, вес», seven lessons (`feat/lessons-mech.dynamics.forces`; seven, not six: the ladder had eight steps and spring connections is its own idea at grade 10): 6.1 elastic force and Hooke's law (Δl is not the length; k from an F(Δl) graph), 6.2 support, tension and weight (the support deforms; P acts on the support; P = mg only without acceleration), 6.3 sliding friction (F = μN, against the velocity, not the area; a = μg and the braking distance), 6.4 static friction (equals the push up to μN; check whether the body moves first; friction that pushes us forward), 6.5 the incline and a pull at an angle (mg sin α, N = mg cos α, a = g sin α, N = mg − F sin α), 6.6 weight in a lift and weightlessness (direction of the acceleration, not the velocity; the convex bridge), 6.7 springs in parallel and in series (a half spring is twice as stiff); model `<pp-friction>` (pull, mass and μ sliders; static friction follows the pull up to μmg, then the block slides; live F_тр(F) graph with the current point); 9 new figures, the ladder's incline figure reused in 6.5; step tasks ks-forces-09…20 (20 in all).
- **Next:** the remaining 41 topics in roadmap order: dynamics (gravity), then statics.

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
