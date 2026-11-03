# Draft content report

Branch `feat/content-draft`. All new theory pages and tasks are `status: draft` and need review by the author before publishing. The five original tasks (`kin-0001`, `kin-0002`, `dyn-0001`, `dyn-0002`, `meas-0001`) are untouched: the API and content tests reference them by id and by exact text.

## Counts

- Roadmap: 47 topics in 6 sections (Механика 14, МКТ и термодинамика 8, Электродинамика 16, Основы СТО 1, Квантовая физика 6, Методология 2).
- Theory: 47 pages, one per topic (3 placeholders replaced, 44 new).
- Tasks: 207 in total (202 new + 5 existing). All new tasks are `source: {kind: original}`.

Tasks per EGE number (difficulty breakdown in brackets, `d:count`):

| № | Tasks | Difficulty |
|---|---|---|
| 1 | 9 | 1:3, 2:4, 3:1, 4:1 |
| 2 | 9 | 1:1, 2:3, 3:4, 4:1 |
| 3 | 9 | 1:1, 2:5, 3:3 |
| 4 | 11 | 1:3, 2:5, 3:3 |
| 5 | 8 | 2:2, 3:5, 4:1 |
| 6 | 8 | 2:3, 3:4, 4:1 |
| 7 | 8 | 1:2, 2:3, 3:2, 4:1 |
| 8 | 9 | 1:2, 2:3, 3:4 |
| 9 | 8 | 2:2, 3:5, 4:1 |
| 10 | 8 | 1:1, 2:1, 3:5, 4:1 |
| 11 | 10 | 1:2, 2:5, 3:3 |
| 12 | 9 | 1:2, 2:5, 3:1, 4:1 |
| 13 | 10 | 1:3, 2:3, 3:4 |
| 14 | 8 | 2:1, 3:7 |
| 15 | 8 | 2:3, 3:5 |
| 16 | 12 | 1:1, 2:6, 3:4, 4:1 |
| 17 | 9 | 1:1, 2:4, 3:4 |
| 18 | 8 | 2:3, 3:5 |
| 19 | 8 | 1:2, 2:5, 3:1 |
| 20 | 8 | 2:4, 3:4 |
| 21 | 5 | 2:1, 3:3, 4:1 |
| 22 | 5 | 2:1, 3:4 |
| 23 | 5 | 3:4, 4:1 |
| 24 | 5 | 3:2, 4:2, 5:1 |
| 25 | 5 | 3:1, 4:3, 5:1 |
| 26 | 5 | 4:3, 5:2 |

Overall difficulty: 1 — 24, 2 — 72, 3 — 88, 4 — 19, 5 — 4. Difficulty 4–5 is thin in Part 1; worth adding harder variants later.

Every topic has at least one task. Every numeric, measurement and sequence answer was recomputed with a script. Each "выберите два" item was checked to have exactly two true statements, and each task-20 table to have exactly one valid pair.

## Tasks adapted from the FIPI bank

**None.** fipi.ru (spec, codifier, demo, open bank) was unreachable from the drafting environment (connection reset / timeout), so no task is `adapted` and nothing was modelled on specific bank items. The task *types* follow the general 2025–2026 exam structure as I know it. Please check that each number's format matches the current demo variant.

## Things to check

### Codifier codes (all unconfirmed)

The codifier could not be downloaded. Codes in `roadmap.yaml` were filled from memory of the 2024–2026 codifier structure. **Treat every code as unverified.** Specific doubts:

- `mech.dynamics.newton` includes `1.2.2` (масса, плотность) — not sure it is a separate element.
- `mech.statics.hydrostatics` → `1.3.3–1.3.5`: the order of «давление жидкости / закон Паскаля / закон Архимеда» may differ.
- `thermo.*`: numbering inside 2.1 (especially 2.1.12–2.1.15, vapour and phase transitions) and 2.2 is from memory.
- `electro.*`: element boundaries in 3.2 (ток / ЭДС / соединения) and 3.6 (optics) are uncertain.
- `sr.basics` → `4.1–4.3`: format (two-level codes) unconfirmed.
- Left empty (`[]`), not even a guess: `thermo.heat`, `electro.optics.lenses`, `electro.optics.wave`, `method.measurement-error`, `method.experiment`.

The `ege_tasks` mapping per topic is also inferred from the 2025–2026 structure.

### Physics and wording I'd like a second look at

- `mkt-0011` (task 9), statement 4: after halving the volume the vapour is *exactly* saturated (φ = 100 %). It is correct but borderline; consider a factor that leaves no doubt.
- `thermo-0010` (task 9): now uses a generated heating-curve graph instead of a table; check that the grid (0,5 min × 20 °C) is readable on a phone.
- `mag-0011` (task 14), statement 5: relies on aluminium being practically non-magnetic. True at EGE level, but a pedantic reader could object.
- `el-0019` (task 25): fringe fields of the capacitor are neglected (stated in the task).
- `stat-0008` (task 26): standard ladder problem; check that the expected justification matches FIPI criteria.
- `method.measurement-error` theory: I deliberately did **not** state how to enter "(x ± Δx)" in the answer form, since I could not confirm the current instruction. Please add it.
- Task 19 answers with two decimals in the error (`meas-0004`, `meas-0006`) store `value: 2.4, error: 0.05`; I checked that the answer checker accepts both `2,40 0,05` and `2,4 0,05`.
- Theory pages: 9 pages (`electro.circuits.emf`, `electro.circuits.ohm`, `electro.field.coulomb`, `electro.field.strength`, `electro.magnetic.lorentz`, `electro.optics.lenses`, `electro.oscillations.lc`, `quantum.nucleus`, `quantum.photoeffect`) have 360–400 words of prose (over 400 counting formulas). I preferred not to pad them.
- `mech.dynamics.newton` keeps a section titled «Второй закон Ньютона», and `mech.kinematics.basics` keeps `ege_tasks: [1]` exactly: `packages/content_schema/tests/test_content.py` edits these strings in its scratch-copy tests.

### Figures

Every theory page now has one generated figure (`figures/theory-<topic>.yaml` → `assets/`), placed at the end of the section it illustrates. They were reviewed as rendered PNGs, not yet in a browser. The hydrogen level diagram is schematic (marked «не в масштабе»).

Pilot (branch `feat/figures-pilot`): `kin-0011` now uses a generated v(t) graph (statement 4 changed to «за первые 2 с прошло 8 м»; answer still 14), `thermo-0010` a heating curve, and the braking example in the uniform-acceleration theory page a v(t) graph; the free-fall page has an interactive throw model. Remaining candidates: `thermo-0021` (p–V cycle), the task-19 instrument readings (scale drawings), and `stat-0008` / `dyn-0016` (sketches of the setup). Real EGE tasks 5, 9, 14 and 19 use graphs and instrument photos much more often than this draft does.

### 2027 changes (tasks 21 and 23)

`exam.yaml` notes that the 2027 draft changes the themes of tasks 21 and 23. I could not read the 2027 drafts. Current content:

- 21: 5 qualitative tasks (humidity/dew point, adiabatic heating in a pump, induction braking in a copper pipe, electrostatic induction, refraction). The theme mix may need to change.
- 23: 2 DC/capacitor, 1 lens, 2 photoeffect. If 23 moves to a different topic area, these may need to be moved to other numbers.

## Possible mismatches between exam.yaml and the FIPI specification

I could not compare against the official document, so these are things to check, not confirmed errors:

- **Task 24 topic.** In my recollection of the 2025–2026 specification, task 24 is a molecular physics / thermodynamics problem. The existing task `dyn-0002` (mechanics) sits in `tasks/24/`, and `mech.dynamics.newton` lists 24. The new task-24 items are all thermodynamics.
- **Task 22 / 23 topic split.** I assumed 22 = mechanics or MKT and 23 = electrodynamics or quantum physics (2 points each). Please check the spec.
- **Task 18.** Titled «весь курс» in `exam.yaml`; the drafted tasks cover all sections, including СТО. If the official 18 has a narrower scope (e.g. includes astrophysics or excludes something), adjust.
- **Max score and duration** (45 points, 235 min) match my memory of 2025–2026; `verified: false` is still correct.
