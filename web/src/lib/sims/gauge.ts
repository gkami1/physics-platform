// <pp-gauge> — an instrument-reading trainer. Chips pick the instrument: a ruler, a measuring
// cylinder, a thermometer, a dynamometer, an ammeter with a milliampere scale or a voltmeter. Each
// has its own range, labelled marks and divisions; the scale is computed from them (tick i stands at
// min + i·division), so every reading lies on the grid. A slider moves the bar's end, the level, the
// column, the pointer or the needle one division at a time; «Новое показание» picks a seeded one.
// A second chip row sets the error rule: the division or half of it, «as the task says».
//
// The picture follows the figures' convention: instruments and objects in the text colour, guides
// muted, the pointer and the divisions counted from the nearest labelled mark in accent. The table
// gives the two labelled marks around the reading and the gaps between them, the price of a division
// (their difference ÷ gaps), the count from the nearest labelled mark, the reading, Δx, the record
// (x ± Δx) with the decimals of Δx (for the milliammeter also converted to amperes) and ε in %.
//
// Nothing moves on its own, so there is no animation loop and reduced motion changes nothing.
// Defaults by attributes `instrument`, `value` (in the scale's units) and `rule` (`full` | `half`);
// without them, each instrument starts at its own reading with the full division. The lessons set
// the cylinder at 38 мл (1.2), the voltmeter at 4,6 В with half a division (1.3) and the ammeter at
// 170 мА (1.4), clear of their tasks and of the bank's task-19 answers.
//
// Written into theory Markdown as plain HTML; the theory page imports this module only when such an
// element is present. Light DOM, site CSS variables: follows the light/dark theme.

import { rng } from './random';

const SVG_NS = 'http://www.w3.org/2000/svg';
const NBSP = '\u00a0';
const MINUS = '\u2212';

export type Kind = 'ruler' | 'cylinder' | 'thermo' | 'dyn' | 'dial';
export type Rule = 'full' | 'half';

export interface Instrument {
  key: string;
  name: string; // the chip
  kind: Kind;
  unit: string;
  min: number;
  per: number; // between neighbouring labelled marks, in the scale's units
  gaps: number; // gaps (divisions) between neighbouring labelled marks
  labels: number; // labelled intervals across the scale
  start: number; // the default reading, in divisions from min
  si?: { unit: string; shift: number }; // the record converted: value·10^−shift in `unit`
}

export const INSTRUMENTS: Instrument[] = [
  { key: 'ruler', name: 'линейка', kind: 'ruler', unit: 'см', min: 0, per: 1, gaps: 10, labels: 10, start: 63 },
  { key: 'cylinder', name: 'мензурка', kind: 'cylinder', unit: 'мл', min: 0, per: 10, gaps: 5, labels: 6, start: 19 },
  { key: 'thermo', name: 'термометр', kind: 'thermo', unit: '°C', min: 0, per: 10, gaps: 5, labels: 5, start: 16 },
  { key: 'dyn', name: 'динамометр', kind: 'dyn', unit: 'Н', min: 0, per: 1, gaps: 10, labels: 4, start: 27 },
  {
    key: 'amm',
    name: 'амперметр',
    kind: 'dial',
    unit: 'мА',
    min: 0,
    per: 50,
    gaps: 5,
    labels: 5,
    start: 17,
    si: { unit: 'А', shift: 3 },
  },
  { key: 'volt', name: 'вольтметр', kind: 'dial', unit: 'В', min: 0, per: 1, gaps: 5, labels: 6, start: 23 },
];

export const RULES: [Rule, string][] = [
  ['full', 'цена деления'],
  ['half', 'половина цены'],
];

export const SEED = 20261112;

const round6 = (x: number): number => Math.round(x * 1e6) / 1e6;

/** The number of divisions across the scale. */
export function total(ins: Instrument): number {
  return ins.gaps * ins.labels;
}

/** The price of a division. */
export function division(ins: Instrument): number {
  return round6(ins.per / ins.gaps);
}

/** The value of tick i: min + i·division. */
export function value(ins: Instrument, i: number): number {
  return round6(ins.min + (i * ins.per) / ins.gaps);
}

/** The absolute error under a rule. */
export function error(ins: Instrument, rule: Rule): number {
  return round6(rule === 'half' ? division(ins) / 2 : division(ins));
}

/** The fewest decimals that write x exactly (up to 6). */
export function places(x: number): number {
  for (let d = 0; d < 6; d++) {
    const s = x * 10 ** d;
    if (Math.abs(s - Math.round(s)) < 1e-6) return d;
  }
  return 6;
}

/** x with exactly d decimals, a decimal comma and a true minus. */
export function fixed(x: number, d: number): string {
  const text = Math.abs(x).toFixed(d).replace('.', ',');
  return x < 0 && Number(text.replace(',', '.')) !== 0 ? `${MINUS}${text}` : text;
}

/** x written exactly (its own decimals). */
export function exact(x: number): string {
  return fixed(x, places(x));
}

const u = (text: string, unit: string): string => `${text}${NBSP}${unit}`;

/** «1 деление», «2 деления», «5 делений». */
export function divisions(k: number): string {
  const m10 = k % 10;
  const m100 = k % 100;
  const word = m10 === 1 && m100 !== 11 ? 'деление' : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 'деления' : 'делений';
  return `${k}${NBSP}${word}`;
}

/** The nearest labelled mark (in divisions), the lower one on a tie. */
export function nearest(ins: Instrument, n: number): number {
  const lower = Math.floor(n / ins.gaps) * ins.gaps;
  const up = lower + ins.gaps;
  return n - lower <= up - n || up > total(ins) ? lower : up;
}

/** The two neighbouring labelled marks around reading n (in divisions). */
export function bracket(ins: Instrument, n: number): [number, number] {
  let lower = Math.floor(n / ins.gaps) * ins.gaps;
  if (lower + ins.gaps > total(ins)) lower -= ins.gaps;
  return [lower, lower + ins.gaps];
}

/** The relative error in %, written exactly or rounded to tenths with «≈»; null on zero. */
export function epsText(x: number, dx: number): string | null {
  if (Math.abs(x) < 1e-12) return null;
  const pct = round6((dx / Math.abs(x)) * 100);
  const r = Number(pct.toFixed(1));
  return Math.abs(r - pct) > 1e-9 ? `≈${NBSP}${fixed(pct, 1)}${NBSP}%` : `${exact(pct)}${NBSP}%`;
}

/** The record (x ± Δx) with the decimals of Δx, and for a milli-scale the same in base units. */
export function record(ins: Instrument, n: number, rule: Rule): string {
  const x = value(ins, n);
  const dx = error(ins, rule);
  const d = places(dx);
  let text = u(`(${fixed(x, d)} ± ${fixed(dx, d)})`, ins.unit);
  if (ins.si) {
    const k = 10 ** ins.si.shift;
    const ds = places(dx / k); // the decimals of Δx in the new unit
    text += ` = ${u(`(${fixed(x / k, ds)} ± ${fixed(dx / k, ds)})`, ins.si.unit)}`;
  }
  return text;
}

export const ROWS = [
  'Подписанные отметки',
  'Цена деления',
  'От ближайшей отметки',
  'Показание x',
  'Погрешность Δx',
  'Запись',
  'Относительная погрешность ε',
];

/** The readout rows for reading n under a rule. */
export function readout(ins: Instrument, n: number, rule: Rule): string[] {
  const div = division(ins);
  const [a, b] = bracket(ins, n);
  const va = exact(value(ins, a));
  const vb = exact(value(ins, b));
  const marks = `${u(va, ins.unit)} и ${u(vb, ins.unit)}, между ними ${ins.gaps}${NBSP}промежутков`;
  const price = `(${vb} ${MINUS} ${va})${NBSP}${ins.unit} : ${ins.gaps} = ${u(exact(div), ins.unit)}`;
  const m = nearest(ins, n);
  const k = n - m;
  const vm = u(exact(value(ins, m)), ins.unit);
  const count =
    k === 0
      ? `ровно на отметке ${vm}`
      : `${vm} ${k > 0 ? '+' : MINUS} ${Math.abs(k)} · ${u(exact(div), ins.unit)} (${divisions(Math.abs(k))})`;
  const x = value(ins, n);
  const dx = error(ins, rule);
  const reading = u(fixed(x, places(div)), ins.unit);
  const err = `${u(exact(dx), ins.unit)} — ${rule === 'half' ? 'половина цены деления' : 'цена деления'}`;
  const eps = epsText(x, dx);
  const epsRow = eps === null ? `${MINUS} (на нуле её не считают)` : `Δx / x · 100${NBSP}% ${eps.startsWith('≈') ? '' : '= '}${eps}`;
  return [marks, price, count, reading, err, record(ins, n, rule), epsRow];
}

/** The reading n for a value given in the scale's units (snapped to the grid), or null. */
export function parseValue(ins: Instrument, text: string | null): number | null {
  if (text === null || text.trim() === '') return null;
  const v = Number(text.replace(',', '.'));
  if (!Number.isFinite(v)) return null;
  const n = Math.round((v - ins.min) / division(ins));
  return Math.min(Math.max(n, 0), total(ins));
}

/** A seeded new reading, never the scale's ends and never the current one. */
export function draw(ins: Instrument, current: number, clicks: number): number {
  const idx = INSTRUMENTS.indexOf(ins);
  const r = rng(SEED + 7919 * clicks + 104729 * idx);
  const N = total(ins);
  for (let t = 0; t < 50; t++) {
    const n = 1 + Math.floor(r() * (N - 1));
    if (n !== current) return n;
  }
  return current === 1 ? 2 : 1;
}

/** A tick: its two ends and its label's place. */
export interface Tick {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  lx: number;
  ly: number;
  anchor: 'start' | 'middle' | 'end';
  major: boolean;
}

/** Scene geometry for each kind; every tick computed from its index. */
export const W = 400;
export const H = 280;
const RUL = { x0: 24, x1: 376, y: 150 };
const CYL = { left: 166, right: 236, y0: 236, step: 6 };
const THM = { x: 200, y0: 226, step: 7.2 };
const DYN = { x: 200, y0: 70, step: 4.2 };
const DIAL = { cx: 200, cy: 262, R: 190, from: 140, sweep: 100 };
const RAD = Math.PI / 180;

/** The angle of tick i on a dial (degrees, counter-clockwise from +x). */
export function dialAngle(ins: Instrument, i: number): number {
  return DIAL.from - (DIAL.sweep * i) / total(ins);
}

export function tick(ins: Instrument, i: number): Tick {
  const major = i % ins.gaps === 0;
  const mid = !major && ins.gaps % 2 === 0 && i % ins.gaps === ins.gaps / 2;
  const len = major ? 18 : mid ? 13 : 8;
  switch (ins.kind) {
    case 'ruler': {
      const x = RUL.x0 + ((RUL.x1 - RUL.x0) * i) / total(ins);
      return { x1: x, y1: RUL.y, x2: x, y2: RUL.y + len, lx: x, ly: RUL.y + 36, anchor: 'middle', major };
    }
    case 'cylinder': {
      const y = CYL.y0 - i * CYL.step;
      return { x1: CYL.left, y1: y, x2: CYL.left + len, y2: y, lx: CYL.left - 8, ly: y + 4.5, anchor: 'end', major };
    }
    case 'thermo': {
      const y = THM.y0 - i * THM.step;
      const x = THM.x + 14;
      return { x1: x, y1: y, x2: x + len, y2: y, lx: x + 26, ly: y + 4.5, anchor: 'start', major };
    }
    case 'dyn': {
      const y = DYN.y0 + i * DYN.step;
      return { x1: DYN.x, y1: y, x2: DYN.x - len, y2: y, lx: DYN.x - 26, ly: y + 4.5, anchor: 'end', major };
    }
    case 'dial': {
      const a = dialAngle(ins, i) * RAD;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const { cx, cy, R } = DIAL;
      return {
        x1: cx + R * c,
        y1: cy - R * s,
        x2: cx + (R - len) * c,
        y2: cy - (R - len) * s,
        lx: cx + (R - 34) * c,
        ly: cy - (R - 34) * s + 5,
        anchor: 'middle',
        major,
      };
    }
  }
}

function el<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
  text = '',
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  if (text) node.textContent = text;
  return node;
}

const f1 = (v: number): string => v.toFixed(1);

let instances = 0;

class GaugeSim extends HTMLElement {
  private ins: Instrument = INSTRUMENTS[1] as Instrument;
  private n = 0;
  private rule: Rule = 'full';
  private clicks = 0;
  private built = false;
  private scene!: SVGGElement;
  private slider!: HTMLInputElement;
  private out!: HTMLOutputElement;
  private cells: HTMLTableCellElement[] = [];

  connectedCallback(): void {
    if (this.built) return;
    this.built = true;
    this.replaceChildren(); // drop the no-JS fallback text
    this.classList.add('sim', 'gau');
    const want = this.getAttribute('instrument');
    this.ins = INSTRUMENTS.find((x) => x.key === want) ?? (INSTRUMENTS[1] as Instrument);
    this.n = parseValue(this.ins, this.getAttribute('value')) ?? this.ins.start;
    this.rule = this.getAttribute('rule') === 'half' ? 'half' : 'full';
    this.build();
    this.update();
  }

  disconnectedCallback(): void {
    this.built = false;
  }

  private chips<T extends string>(id: number, group: string, legend: string, items: [T, string][], current: T, pick: (v: T) => void): HTMLFieldSetElement {
    const set = document.createElement('fieldset');
    set.className = 'pfx-chips gau-chips';
    const lg = document.createElement('legend');
    lg.textContent = legend;
    set.append(lg);
    for (const [v, text] of items) {
      const label = document.createElement('label');
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = `gau-${group}-${id}`;
      radio.value = v;
      radio.checked = v === current;
      radio.addEventListener('change', () => {
        if (!radio.checked) return;
        pick(v);
        this.update();
      });
      const span = document.createElement('span');
      span.textContent = text;
      label.append(radio, span);
      set.append(label);
    }
    return set;
  }

  private build(): void {
    const id = ++instances;
    const kinds = this.chips(
      id,
      'i',
      'Прибор',
      INSTRUMENTS.map((x) => [x.key, x.name] as [string, string]),
      this.ins.key,
      (v) => {
        this.ins = INSTRUMENTS.find((x) => x.key === v) ?? this.ins;
        this.n = this.ins.start;
        this.slider.max = String(total(this.ins));
        this.slider.value = String(this.n);
      },
    );
    const rules = this.chips(id, 'r', 'Погрешность', RULES, this.rule, (v) => (this.rule = v));

    const svg = el('svg', {
      viewBox: `0 0 ${W} ${H}`,
      class: 'sim-svg',
      role: 'img',
      'aria-label':
        'Шкала прибора с подписанными отметками и делениями. Акцентом выделены указатель и деления, ' +
        'отсчитанные от ближайшей подписанной отметки до показания',
    });
    this.scene = el('g');
    svg.append(this.scene);

    const controls = document.createElement('div');
    controls.className = 'sim-controls';
    const label = document.createElement('label');
    label.className = 'sim-slider';
    const span = document.createElement('span');
    span.textContent = 'Показание';
    this.out = document.createElement('output');
    this.slider = document.createElement('input');
    this.slider.type = 'range';
    this.slider.min = '0';
    this.slider.max = String(total(this.ins));
    this.slider.step = '1';
    this.slider.value = String(this.n);
    this.slider.addEventListener('input', () => {
      this.n = Number(this.slider.value);
      this.update();
    });
    label.append(span, this.out, this.slider);
    const again = document.createElement('button');
    again.type = 'button';
    again.className = 'btn small';
    again.textContent = 'Новое показание';
    again.addEventListener('click', () => {
      this.clicks += 1;
      this.n = draw(this.ins, this.n, this.clicks);
      this.slider.value = String(this.n);
      this.update();
    });
    const row = document.createElement('div');
    row.className = 'gau-row';
    row.append(again);
    controls.append(label, row);

    const table = document.createElement('table');
    table.className = 'gau-table';
    const body = document.createElement('tbody');
    ROWS.forEach((name, i) => {
      const tr = document.createElement('tr');
      if (i === 3 || i === 5) tr.className = 'gau-main';
      const th = document.createElement('th');
      th.scope = 'row';
      th.textContent = name;
      const td = document.createElement('td');
      tr.append(th, td);
      body.append(tr);
      this.cells.push(td);
    });
    table.append(body);
    this.append(kinds, rules, svg, controls, table);
  }

  private update(): void {
    this.out.textContent = `${fixed(value(this.ins, this.n), places(division(this.ins)))}${NBSP}${this.ins.unit}`;
    readout(this.ins, this.n, this.rule).forEach((v, i) => {
      const cell = this.cells[i];
      if (cell) cell.textContent = v;
    });
    this.draw();
  }

  private draw(): void {
    const ins = this.ins;
    const N = total(ins);
    const n = this.n;
    const m = nearest(ins, n);
    const lo = Math.min(m, n);
    const hi = Math.max(m, n);
    const parts: SVGElement[] = [...this.body(ins, n)];
    for (let i = 0; i <= N; i++) {
      const t = tick(ins, i);
      const counted = n !== m && i > lo - (m < n ? 0 : 1) && i <= hi && i !== m;
      const cls = counted ? 'gau-tick gau-count' : t.major ? 'gau-tick gau-major' : 'gau-tick';
      parts.push(el('path', { d: `M${f1(t.x1)} ${f1(t.y1)}L${f1(t.x2)} ${f1(t.y2)}`, class: cls }));
      if (t.major) {
        const text = exact(value(ins, i));
        parts.push(el('text', { x: f1(t.lx), y: f1(t.ly), 'text-anchor': t.anchor, class: i === m ? 'gau-label gau-mark' : 'gau-label' }, text));
      }
    }
    parts.push(...this.pointer(ins, n));
    this.scene.replaceChildren(...parts);
  }

  /** The instrument's body and the object it measures (drawn under the ticks). */
  private body(ins: Instrument, n: number): SVGElement[] {
    const out: SVGElement[] = [];
    const unit = (x: number, y: number, anchor = 'middle'): SVGElement =>
      el('text', { x, y, 'text-anchor': anchor, class: 'gau-label gau-unit' }, ins.unit);
    switch (ins.kind) {
      case 'ruler': {
        const x = tick(ins, n).x1;
        out.push(el('rect', { x: RUL.x0 - 14, y: RUL.y, width: RUL.x1 - RUL.x0 + 28, height: 50, rx: 4, class: 'gau-body' }));
        out.push(el('rect', { x: RUL.x0, y: 100, width: f1(Math.max(x - RUL.x0, 0)), height: 30, rx: 3, class: 'gau-obj' }));
        out.push(el('text', { x: RUL.x0, y: 88, 'text-anchor': 'start', class: 'gau-label gau-small' }, 'брусок'));
        out.push(unit(RUL.x1 + 4, RUL.y + 70, 'end'));
        break;
      }
      case 'cylinder': {
        const { left, right, y0 } = CYL;
        const y = y0 - n * CYL.step;
        const rise = n > 0 ? 6 : 0;
        const mid = (left + right) / 2;
        const surface = `M${left} ${f1(y - rise)}Q${left + 9} ${f1(y)} ${mid} ${f1(y)}Q${right - 9} ${f1(y)} ${right} ${f1(y - rise)}`;
        out.push(el('path', { d: `M${left} ${y0}L${left} ${f1(y - rise)}${surface.slice(surface.indexOf('Q'))}L${right} ${y0}Z`, class: 'gau-liquid' }));
        out.push(el('path', { d: surface, class: 'gau-edge' }));
        out.push(el('path', { d: `M${left} 30L${left} ${y0}L${right} ${y0}L${right} 30`, class: 'gau-glass' }));
        out.push(el('path', { d: `M${left - 20} ${y0 + 8}H${right + 20}`, class: 'gau-glass gau-base' }));
        out.push(unit(left - 8, 26, 'end'));
        break;
      }
      case 'thermo': {
        const { x, y0 } = THM;
        const y = y0 - n * THM.step;
        out.push(el('rect', { x: x - 8, y: 28, width: 16, height: y0 + 14 - 28, rx: 8, class: 'gau-glass gau-tube' }));
        out.push(el('circle', { cx: x, cy: y0 + 24, r: 14, class: 'gau-bulb' }));
        out.push(el('rect', { x: x - 3, y: f1(y), width: 6, height: f1(y0 + 14 - y), class: 'gau-column' }));
        out.push(unit(x + 40, 22, 'start'));
        break;
      }
      case 'dyn': {
        const { x, y0 } = DYN;
        const y = y0 + n * DYN.step;
        out.push(el('rect', { x: x - 64, y: 34, width: 128, height: 222, rx: 8, class: 'gau-body' }));
        // the spring from the top to the pointer, as a zigzag
        const sx = x + 26;
        const top = 40;
        const coils = 9;
        let d = `M${sx} ${top}`;
        for (let k = 1; k <= 2 * coils; k++) {
          const yy = top + 6 + ((y - top - 12) * k) / (2 * coils);
          d += `L${sx + (k % 2 ? 7 : -7)} ${f1(yy)}`;
        }
        d += `L${sx} ${f1(y - 4)}L${sx} ${f1(y)}`;
        out.push(el('path', { d, class: 'gau-spring' }));
        // the hook below the pointer, through the body's bottom
        out.push(el('path', { d: `M${sx} ${f1(y)}V${264}q0 9 -8 9q-7 0 -7 -6`, class: 'gau-spring' }));
        out.push(unit(x - 26, 54, 'end'));
        break;
      }
      case 'dial': {
        const { cx, cy, R } = DIAL;
        out.push(el('rect', { x: 18, y: 26, width: 364, height: 248, rx: 12, class: 'gau-body' }));
        const a0 = dialAngle(ins, 0) * RAD;
        const a1 = dialAngle(ins, total(ins)) * RAD;
        out.push(
          el('path', {
            d: `M${f1(cx + R * Math.cos(a0))} ${f1(cy - R * Math.sin(a0))}A${R} ${R} 0 0 1 ${f1(cx + R * Math.cos(a1))} ${f1(cy - R * Math.sin(a1))}`,
            class: 'gau-arc',
          }),
        );
        out.push(el('text', { x: cx, y: cy - 70, 'text-anchor': 'middle', class: 'gau-label gau-big' }, ins.unit));
        break;
      }
    }
    return out;
  }

  /** What to look at: the bar's end, the meniscus, the column's top, the pointer or the needle. */
  private pointer(ins: Instrument, n: number): SVGElement[] {
    const t = tick(ins, n);
    switch (ins.kind) {
      case 'ruler':
        return [el('path', { d: `M${f1(t.x1)} 92V${RUL.y + 26}`, class: 'gau-ptr gau-dash' })];
      case 'cylinder': {
        const mid = (CYL.left + CYL.right) / 2;
        return [
          el('path', { d: `M${CYL.left} ${f1(t.y1)}H${mid}`, class: 'gau-ptr gau-dash' }),
          el('circle', { cx: mid, cy: f1(t.y1), r: 3.5, class: 'gau-dot' }),
        ];
      }
      case 'thermo':
        return [el('path', { d: `M${THM.x - 40} ${f1(t.y1)}H${THM.x - 10}`, class: 'gau-ptr' }), this.head(THM.x - 10, t.y1, 1, 0)];
      case 'dyn':
        return [el('path', { d: `M${DYN.x - 4} ${f1(t.y1)}H${DYN.x + 40}`, class: 'gau-ptr gau-thick' })];
      case 'dial': {
        const a = dialAngle(ins, n) * RAD;
        const { cx, cy, R } = DIAL;
        return [
          el('path', { d: `M${cx} ${cy}L${f1(cx + (R - 4) * Math.cos(a))} ${f1(cy - (R - 4) * Math.sin(a))}`, class: 'gau-ptr gau-needle' }),
          el('circle', { cx, cy, r: 7, class: 'gau-pivot' }),
        ];
      }
    }
  }

  /** A small arrowhead at (x, y) pointing along (ux, uy). */
  private head(x: number, y: number, ux: number, uy: number): SVGElement {
    const bx = x - ux * 9;
    const by = y - uy * 9;
    return el('path', { d: `M${f1(x)} ${f1(y)}L${f1(bx - uy * 5)} ${f1(by + ux * 5)}L${f1(bx + uy * 5)} ${f1(by - ux * 5)}Z`, class: 'gau-head' });
  }
}

if (!customElements.get('pp-gauge')) customElements.define('pp-gauge', GaugeSim);
