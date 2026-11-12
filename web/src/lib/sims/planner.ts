// <pp-planner> — an experiment planner for EGE task 20. Chips pick a study (a pendulum's period
// against the thread's length, the buoyant force against the liquid, a wire's resistance against
// its cross-section, the heating time against the water's mass, a ball's time down a chute against
// the chute's height). Each study has the quantity under test and two other factors that could
// matter. A seeded generator lays out a table of 5 or 6 setups, the columns in a seeded order,
// with exactly one pair that differs only in the quantity under test, at least one pair that
// differs in it and one more factor (the usual trap), and at least one pair where it is the same.
// «Новая таблица» draws the next one.
//
// The student ticks two rows. Every cell where the two differ is marked: accent in the column
// under test, warning in any other. The readout says what differs and whether the pair tests the
// dependence, and how many of the table's pairs do (always one). «Показать пару» ticks it.
//
// Nothing moves, so there is no animation loop and reduced motion changes nothing. Attributes:
// `study` (a key below), `table` (how many «Новая таблица» clicks to start from, for QA) and
// `pick` (two row numbers, for QA). The lesson sets none of them beyond `study`: its default
// table's pair (5 и 6 for the pendulum) is clear of the page's tasks, the later lessons' tasks,
// the lesson's worked example and the bank's task-20 answers (checked in Node for every study).
//
// Written into theory Markdown as plain HTML; the theory page imports this module only when such an
// element is present. Light DOM, site CSS variables: follows the light/dark theme.

import { rng } from './random';

const NBSP = '\u00a0';

export interface Factor {
  name: string; // the column heading
  values: string[];
}

export interface Study {
  key: string;
  chip: string;
  question: string; // after «зависит ли»
  factors: [Factor, Factor, Factor]; // [0] is the quantity under test
}

const u = (x: string, unit: string): string => `${x}${NBSP}${unit}`;

export const STUDIES: Study[] = [
  {
    key: 'pendulum',
    chip: 'маятник',
    question: 'период колебаний маятника от длины нити',
    factors: [
      { name: 'Длина нити', values: [u('0,5', 'м'), u('1', 'м'), u('1,5', 'м')] },
      { name: 'Масса груза', values: [u('50', 'г'), u('100', 'г'), u('200', 'г')] },
      { name: 'Угол отклонения', values: ['5°', '10°'] },
    ],
  },
  {
    key: 'buoyancy',
    chip: 'сила Архимеда',
    question: 'выталкивающая сила от плотности жидкости',
    factors: [
      { name: 'Жидкость', values: ['вода', 'масло', 'спирт'] },
      { name: 'Объём тела', values: [u('50', 'см³'), u('100', 'см³'), u('200', 'см³')] },
      { name: 'Материал тела', values: ['сталь', 'алюминий'] },
    ],
  },
  {
    key: 'wire',
    chip: 'проволока',
    question: 'сопротивление проволоки от площади её сечения',
    factors: [
      { name: 'Площадь сечения', values: [u('0,5', 'мм²'), u('1', 'мм²'), u('2', 'мм²')] },
      { name: 'Длина', values: [u('1', 'м'), u('2', 'м'), u('3', 'м')] },
      { name: 'Материал', values: ['медь', 'алюминий'] },
    ],
  },
  {
    key: 'heating',
    chip: 'нагревание',
    question: 'время нагревания воды до кипения от массы воды',
    factors: [
      { name: 'Масса воды', values: [u('0,5', 'кг'), u('1', 'кг'), u('1,5', 'кг')] },
      { name: 'Мощность', values: [u('500', 'Вт'), u('1000', 'Вт'), u('1500', 'Вт')] },
      { name: 'Температура в начале', values: [u('20', '°C'), u('30', '°C')] },
    ],
  },
  {
    key: 'chute',
    chip: 'желоб',
    question: 'время скатывания шарика от высоты желоба',
    factors: [
      { name: 'Высота желоба', values: [u('10', 'см'), u('20', 'см'), u('30', 'см')] },
      { name: 'Длина желоба', values: [u('1', 'м'), u('1,5', 'м'), u('2', 'м')] },
      { name: 'Шарик', values: ['стальной', 'стеклянный'] },
    ],
  },
];

export const SEED = 20520699;

export interface Table {
  order: number[]; // the columns: factor indices left to right
  rows: number[][]; // per row, a value index for each factor (in factor order)
}

/** The factors where rows i and j differ (factor indices, ascending). */
export function diffs(t: Table, i: number, j: number): number[] {
  const a = t.rows[i] as number[];
  const b = t.rows[j] as number[];
  return [0, 1, 2].filter((f) => a[f] !== b[f]);
}

/** All pairs (i < j, 0-based) that differ only in the quantity under test. */
export function correctPairs(t: Table): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < t.rows.length; i++)
    for (let j = i + 1; j < t.rows.length; j++) {
      const d = diffs(t, i, j);
      if (d.length === 1 && d[0] === 0) out.push([i, j]);
    }
  return out;
}

/** Whether a table is a fair exercise: one correct pair, a trap pair, a pair with the tested quantity equal. */
export function fair(t: Table): boolean {
  let trap = false;
  let same = false;
  for (let i = 0; i < t.rows.length; i++)
    for (let j = i + 1; j < t.rows.length; j++) {
      const d = diffs(t, i, j);
      if (d.length === 0) return false; // two equal rows
      if (d.length === 2 && d[0] === 0) trap = true;
      if (d[0] !== 0) same = true;
    }
  return correctPairs(t).length === 1 && trap && same;
}

/** The seeded table for a study after `clicks` presses of «Новая таблица». */
export function makeTable(study: Study, clicks: number): Table {
  const idx = STUDIES.indexOf(study);
  const r = rng(SEED + 7919 * clicks + 104729 * idx);
  const pick = (n: number): number => Math.floor(r() * n);
  const n = r() < 0.5 ? 5 : 6;
  for (;;) {
    const order = [0, 1, 2];
    for (let k = 2; k > 0; k--) {
      const m = pick(k + 1);
      [order[k], order[m]] = [order[m] as number, order[k] as number];
    }
    const rows = Array.from({ length: n }, () => study.factors.map((f) => pick(f.values.length)));
    const t = { order, rows };
    if (fair(t)) return t;
  }
}

const lower = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);

/** «длина нити», «длина нити и угол отклонения». */
function names(study: Study, fs: number[]): string {
  const list = fs.map((f) => lower(study.factors[f]?.name ?? ''));
  return list.length < 2 ? (list[0] ?? '') : `${list.slice(0, -1).join(', ')} и ${list[list.length - 1]}`;
}

export type Grade = 'none' | 'ok' | 'extra' | 'same';

/** How a pair does: none picked, tests the dependence, differs in more, or the tested quantity is the same. */
export function grade(t: Table, pick: number[]): Grade {
  if (pick.length < 2) return 'none';
  const d = diffs(t, pick[0] as number, pick[1] as number);
  if (d[0] !== 0) return 'same';
  return d.length === 1 ? 'ok' : 'extra';
}

export const ROWS = ['Исследуют', 'Выбраны', 'Различаются', 'Вывод', 'Подходящих пар'];

/** The readout rows for a table and the picked rows (0-based). */
export function readout(study: Study, t: Table, pick: number[]): string[] {
  const n = t.rows.length;
  const all = (n * (n - 1)) / 2;
  const count = `${correctPairs(t).length} из ${all} пар таблицы`;
  const q = `зависит ли ${study.question}`;
  if (pick.length < 2) {
    const chosen = pick.length === 1 ? `установка ${(pick[0] as number) + 1}, отметь ещё одну` : 'отметь две установки';
    return [q, chosen, '—', '—', count];
  }
  const [a, b] = [...pick].sort((x, y) => x - y) as [number, number];
  const d = diffs(t, a, b);
  const tested = lower(study.factors[0].name);
  const others = d.filter((f) => f !== 0);
  const g = grade(t, pick);
  const verdict =
    g === 'ok'
      ? `подходит: различается только ${tested}, остальное одинаковое`
      : g === 'extra'
        ? `не подходит: кроме величины «${tested}», различается ${names(study, others)} — непонятно, что повлияло`
        : `не подходит: ${tested} одинаковая — зависимость от неё не увидеть`;
  return [q, `установки ${a + 1} и ${b + 1}`, names(study, d), verdict, count];
}

/** The two row numbers (1-based) from an attribute such as «2 5», or []. */
export function parsePick(text: string | null, n: number): number[] {
  if (!text) return [];
  const nums = text
    .split(/[\s,]+/)
    .map(Number)
    .filter((k) => Number.isInteger(k) && k >= 1 && k <= n);
  const out = [...new Set(nums)].slice(0, 2).map((k) => k - 1);
  return out.length === 2 ? out : [];
}

let instances = 0;

class PlannerSim extends HTMLElement {
  private study: Study = STUDIES[0] as Study;
  private clicks = 0;
  private tbl!: Table;
  private pick: number[] = [];
  private built = false;
  private head!: HTMLTableRowElement;
  private body!: HTMLTableSectionElement;
  private cells: HTMLTableCellElement[] = [];
  private verdictRow!: HTMLTableRowElement;

  connectedCallback(): void {
    if (this.built) return;
    this.built = true;
    this.replaceChildren(); // drop the no-JS fallback text
    this.classList.add('sim', 'pln');
    const want = this.getAttribute('study');
    this.study = STUDIES.find((s) => s.key === want) ?? (STUDIES[0] as Study);
    const start = Number(this.getAttribute('table') ?? 0);
    this.clicks = Number.isInteger(start) && start > 0 ? start : 0;
    this.tbl = makeTable(this.study, this.clicks);
    this.pick = parsePick(this.getAttribute('pick'), this.tbl.rows.length);
    this.build();
    this.update();
  }

  disconnectedCallback(): void {
    this.built = false;
  }

  private build(): void {
    const id = ++instances;
    const set = document.createElement('fieldset');
    set.className = 'pfx-chips pln-chips';
    const lg = document.createElement('legend');
    lg.textContent = 'Опыт';
    set.append(lg);
    for (const s of STUDIES) {
      const label = document.createElement('label');
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = `pln-s-${id}`;
      radio.value = s.key;
      radio.checked = s === this.study;
      radio.addEventListener('change', () => {
        if (!radio.checked) return;
        this.study = s;
        this.clicks = 0;
        this.renew();
      });
      const span = document.createElement('span');
      span.textContent = s.chip;
      label.append(radio, span);
      set.append(label);
    }

    const wrap = document.createElement('div');
    wrap.className = 'pln-wrap';
    const table = document.createElement('table');
    table.className = 'pln-table';
    const thead = document.createElement('thead');
    this.head = document.createElement('tr');
    thead.append(this.head);
    this.body = document.createElement('tbody');
    table.append(thead, this.body);
    wrap.append(table);

    const row = document.createElement('div');
    row.className = 'pln-row';
    const again = document.createElement('button');
    again.type = 'button';
    again.className = 'btn small';
    again.textContent = 'Новая таблица';
    again.addEventListener('click', () => {
      this.clicks += 1;
      this.renew();
    });
    const show = document.createElement('button');
    show.type = 'button';
    show.className = 'btn small';
    show.textContent = 'Показать пару';
    show.addEventListener('click', () => {
      const p = correctPairs(this.tbl)[0];
      if (p) this.pick = [p[0], p[1]];
      this.update();
    });
    row.append(again, show);

    const out = document.createElement('table');
    out.className = 'pln-readout';
    const ob = document.createElement('tbody');
    ROWS.forEach((name, i) => {
      const tr = document.createElement('tr');
      if (i === 3) this.verdictRow = tr;
      const th = document.createElement('th');
      th.scope = 'row';
      th.textContent = name;
      const td = document.createElement('td');
      tr.append(th, td);
      ob.append(tr);
      this.cells.push(td);
    });
    out.append(ob);
    this.append(set, wrap, row, out);
    this.fill();
  }

  /** A new table for the current study and clicks; the picks are cleared. */
  private renew(): void {
    this.tbl = makeTable(this.study, this.clicks);
    this.pick = [];
    this.fill();
    this.update();
  }

  /** Rebuild the table's heading and rows. */
  private fill(): void {
    const th = (text: string, cls = ''): HTMLTableCellElement => {
      const c = document.createElement('th');
      c.scope = 'col';
      c.textContent = text;
      if (cls) c.className = cls;
      return c;
    };
    this.head.replaceChildren(
      th('№'),
      ...this.tbl.order.map((f) => th(this.study.factors[f]?.name ?? '', f === 0 ? 'pln-key' : '')),
    );
    const rows = this.tbl.rows.map((vals, i) => {
      const tr = document.createElement('tr');
      const first = document.createElement('td');
      const label = document.createElement('label');
      label.className = 'pln-check';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.setAttribute('aria-label', `Установка ${i + 1}`);
      box.addEventListener('change', () => this.toggle(i, box.checked));
      label.append(box, document.createTextNode(String(i + 1)));
      first.append(label);
      tr.append(first);
      for (const f of this.tbl.order) {
        const td = document.createElement('td');
        td.textContent = this.study.factors[f]?.values[vals[f] as number] ?? '';
        td.dataset.factor = String(f);
        tr.append(td);
      }
      return tr;
    });
    this.body.replaceChildren(...rows);
  }

  private toggle(i: number, on: boolean): void {
    this.pick = this.pick.filter((k) => k !== i);
    if (on) this.pick.push(i);
    if (this.pick.length > 2) this.pick.shift(); // a third tick drops the oldest
    this.update();
  }

  private update(): void {
    const d = this.pick.length === 2 ? diffs(this.tbl, this.pick[0] as number, this.pick[1] as number) : [];
    Array.from(this.body.rows).forEach((tr, i) => {
      const picked = this.pick.includes(i);
      tr.classList.toggle('pln-picked', picked);
      const box = tr.querySelector('input');
      if (box) box.checked = picked;
      for (const td of Array.from(tr.cells).slice(1)) {
        const f = Number(td.dataset.factor);
        const differs = picked && d.includes(f);
        td.classList.toggle('pln-diff', differs && f === 0);
        td.classList.toggle('pln-warn', differs && f !== 0);
      }
    });
    readout(this.study, this.tbl, this.pick).forEach((v, i) => {
      const cell = this.cells[i];
      if (cell) cell.textContent = v;
    });
    const g = grade(this.tbl, this.pick);
    this.verdictRow.className = g === 'ok' ? 'pln-ok' : g === 'none' ? '' : 'pln-bad';
  }
}

if (!customElements.get('pp-planner')) customElements.define('pp-planner', PlannerSim);
