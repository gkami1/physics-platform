// <pp-atom> — the hydrogen atom by Bohr. The levels E_n = −13,6/n² эВ, n = 1…6 and ∞ (E = 0), are
// drawn to scale on an energy axis. Three modes:
//  - «Излучение»: sliders (or a click on a level) pick the upper level n and the lower m < n; the atom
//    drops n → m and emits a photon hν = E_n − E_m. Every line the atom can emit from n, n(n − 1)/2 of
//    them, is drawn as a muted arrow, the chosen one accent.
//  - «Поглощение»: the atom on m absorbs a photon of exactly E_n − E_m and rises to n; the upper level
//    may be ∞: ionisation from m needs 13,6/m² эВ.
//  - «Фотон»: the atom sits on level m and a photon of a chosen energy arrives. An accent arrow of that
//    length rises from m: it is absorbed only if it ends exactly on a level (up to n = 6 here), passes if
//    it ends between levels, and ionises the atom if it crosses E = 0, the rest becoming the electron's
//    kinetic energy. The energies on the slider are a 0,5 эВ grid plus every exact difference from m.
// Below, a spectrum strip 50…1000 нм (ultraviolet and infrared muted, the visible band as lettered
// cells: a colour is named, never painted) with the Balmer lines in the text colour, the lines from n
// as muted marks and the photon's line accent; lines beyond 1000 нм get an arrow at the edge.
//
// The table: the transition, the energies of the levels, hν in эВ and Дж, ν, λ, the band (and the
// colour), the number of lines from n. Constants as in the tasks: h = 6,6·10⁻³⁴ Дж·с, c = 3·10⁸ м/с,
// 1 эВ = 1,6·10⁻¹⁹ Дж (so the red line comes out ≈ 655 нм; measured, 656 нм).
//
// Nothing moves on its own, so there is no animation and reduced motion changes nothing. The default,
// emission 6 → 2 (≈ 3,02 эВ, ≈ 409 нм, 15 lines), avoids the answers and intermediates of the step
// tasks (10,2; 13,6 → 2,4 and 91 нм; n = 10; 6 lines from n = 4).
//
// Written into theory Markdown as plain HTML; the theory page imports this module only when such an
// element is present. Light DOM, site CSS variables: follows the light/dark theme.

const SVG_NS = 'http://www.w3.org/2000/svg';
const NBSP = '\u00a0';
const MINUS = '\u2212';

export const H = 6.6e-34;
export const C = 3e8;
export const EV = 1.6e-19;
export const RY = 13.6;
/** The highest level drawn. */
export const NMAX = 6;
export const INF = Infinity;

export type Mode = 'emit' | 'absorb' | 'shine';
export const MODES: [Mode, string][] = [
  ['emit', 'Излучение'],
  ['absorb', 'Поглощение'],
  ['shine', 'Фотон'],
];

/** Energy of level n, эВ (0 at n = ∞). */
export function level(n: number): number {
  return n === INF ? 0 : -RY / (n * n);
}

/** Photon energy for a transition between levels a and b, эВ. */
export function photonEv(a: number, b: number): number {
  return Math.abs(level(a) - level(b));
}

export function joules(ev: number): number {
  return ev * EV;
}

export function frequency(ev: number): number {
  return joules(ev) / H;
}

export function wavelengthNm(ev: number): number {
  return ((H * C) / joules(ev)) * 1e9;
}

export function lineCount(n: number): number {
  return (n * (n - 1)) / 2;
}

/** Energy needed to ionise from level m, эВ. */
export function ionisation(m: number): number {
  return RY / (m * m);
}

/** All transitions down from n: [from, to], from the top. */
export function cascade(n: number): [number, number][] {
  const out: [number, number][] = [];
  for (let a = n; a >= 2; a--) for (let b = a - 1; b >= 1; b--) out.push([a, b]);
  return out;
}

/** The visible colours, [from, to) нм, name, letter on the strip (as in <pp-photons>). */
export const COLOURS: [number, number, string, string][] = [
  [380, 440, 'фиолетовый', 'ф'],
  [440, 485, 'синий', 'с'],
  [485, 500, 'голубой', 'г'],
  [500, 565, 'зелёный', 'з'],
  [565, 590, 'жёлтый', 'ж'],
  [590, 625, 'оранжевый', 'о'],
  [625, 761, 'красный', 'к'],
];

export function band(nm: number): string {
  if (nm < 380) return 'ультрафиолет';
  if (nm > 760) return 'инфракрасное';
  const c = COLOURS.find(([a, b]) => nm >= a && nm < b);
  return `видимый свет, ${c ? c[2] : ''}`;
}

/** Photon energies on the slider for an atom on level m: a 0,5 эВ grid plus the exact differences. */
export function shineEnergies(m: number): number[] {
  const set: number[] = [];
  // grid values just below the ionisation energy would hit levels above n = 6 that are not drawn
  const crowd = photonEv(m, NMAX + 1) - 0.02;
  for (let k = 1; k <= 32; k++) if (k / 2 < crowd || k / 2 >= ionisation(m)) set.push(k / 2);
  for (let n = m + 1; n <= NMAX; n++) set.push(photonEv(m, n));
  set.push(ionisation(m));
  set.sort((a, b) => a - b);
  return set.filter((v, i) => i === 0 || v - (set[i - 1] ?? 0) > 1e-6);
}

export type Outcome = { kind: 'absorb'; to: number } | { kind: 'pass' } | { kind: 'ionise'; ek: number };

/** What a photon of energy e (эВ) does to an atom on level m (levels up to NMAX). */
export function outcome(m: number, e: number): Outcome {
  const ion = ionisation(m);
  if (e >= ion - 1e-6) return { kind: 'ionise', ek: Math.max(0, e - ion) };
  for (let n = m + 1; n <= NMAX; n++) if (Math.abs(photonEv(m, n) - e) < 1e-6) return { kind: 'absorb', to: n };
  return { kind: 'pass' };
}

/** A number with a decimal comma and a true minus, rounded to `digits`, with «≈» when rounded. */
export function num(x: number, digits = 2): string {
  const r = Number(x.toFixed(digits));
  const text = String(Math.abs(r)).replace('.', ',');
  const sign = r < 0 ? MINUS : '';
  return Math.abs(r - x) > 1e-9 * Math.max(1, Math.abs(x)) ? `≈${NBSP}${sign}${text}` : sign + text;
}

const SUP: Record<string, string> = {
  '-': '⁻',
  '0': '⁰',
  '1': '¹',
  '2': '²',
  '3': '³',
  '4': '⁴',
  '5': '⁵',
  '6': '⁶',
  '7': '⁷',
  '8': '⁸',
  '9': '⁹',
};
const SUB = '₀₁₂₃₄₅₆₇₈₉';

/** Scientific notation with a decimal comma: «≈ 4,84·10⁻¹⁹», two decimals at most. */
export function sci(x: number): string {
  let e = Math.floor(Math.log10(Math.abs(x)));
  let m = Number((x / 10 ** e).toFixed(2));
  if (m >= 10) {
    m = Number((m / 10).toFixed(2));
    e += 1;
  }
  const exact = Math.abs(m * 10 ** e - x) <= 1e-9 * Math.abs(x);
  const pow = `10${[...String(e)].map((ch) => SUP[ch]).join('')}`;
  const text = m === 1 ? pow : `${String(m).replace('.', ',')}·${pow}`;
  return exact ? text : `≈${NBSP}${text}`;
}

/** «E₆», «E∞». */
export function eName(n: number): string {
  return n === INF ? 'E∞' : `E${[...String(n)].map((d) => SUB[Number(d)]).join('')}`;
}

function nText(n: number): string {
  return n === INF ? '∞' : String(n);
}

function ev(x: number): string {
  return `${num(x)}${NBSP}эВ`;
}

/** The photon's rows: energy in Дж, frequency, wavelength and band. */
function photonRows(e: number): [string, string, boolean][] {
  const nm = wavelengthNm(e);
  return [
    ['То же в джоулях', `${sci(joules(e))}${NBSP}Дж`, false],
    ['Частота ν = hν/h', `${sci(frequency(e))}${NBSP}Гц`, false],
    ['Длина волны λ = c/ν', `${num(nm, 0)}${NBSP}нм`, true],
    ['Диапазон', band(nm), false],
  ];
}

/** Table rows [name, value, main?]. In shine mode `upper` is ignored and `e` is the photon energy. */
export function readout(mode: Mode, upper: number, lower: number, e = 0): [string, string, boolean][] {
  if (mode === 'shine') {
    const res = outcome(lower, e);
    const rows: [string, string, boolean][] = [
      ['Атом на уровне', `m = ${lower}, ${eName(lower)} = ${ev(level(lower))}`, false],
      ['Энергия фотона', ev(e), false],
      [`Энергия ионизации с уровня ${lower}`, ev(ionisation(lower)), false],
    ];
    if (res.kind === 'absorb') {
      rows.push(['Результат', `поглощён: переход ${lower} → ${res.to}`, true]);
    } else if (res.kind === 'ionise') {
      rows.push(['Результат', `ионизация, электрон уносит E${NBSP}=${NBSP}${ev(res.ek)}`, true]);
    } else {
      rows.push(['Результат', `не поглощён: уровня с энергией ${ev(level(lower) + e)} нет`, true]);
    }
    rows.push(['Длина волны фотона', `${num(wavelengthNm(e), 0)}${NBSP}нм`, false]);
    return rows;
  }
  const down = mode === 'emit';
  const [a, b] = down ? [upper, lower] : [lower, upper];
  if (upper === INF) {
    const ion = ionisation(lower);
    return [
      ['Переход', `${lower} → ∞ (ионизация)`, false],
      [`Энергия уровня ${eName(lower)}`, ev(level(lower)), false],
      ['Нужна энергия фотона', `не меньше ${ev(ion)}`, true],
      ['Наибольшая длина волны', `${num(wavelengthNm(ion), 0)}${NBSP}нм`, false],
      ['Диапазон', band(wavelengthNm(ion)), false],
    ];
  }
  const e0 = photonEv(upper, lower);
  return [
    ['Переход', `${nText(a)} → ${nText(b)}`, false],
    [`Энергия уровня ${eName(upper)}`, ev(level(upper)), false],
    [`Энергия уровня ${eName(lower)}`, ev(level(lower)), false],
    [`Энергия фотона hν = ${eName(upper)} − ${eName(lower)}`, ev(e0), true],
    ...photonRows(e0),
    [`Линий из уровня ${upper}`, `${upper}·${upper - 1}/2 = ${lineCount(upper)}`, false],
  ];
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

/** Layout: E = 0 at y0, k px per эВ; levels from xl to xr; the strip 50…1000 нм at sy. */
const G = { w: 400, h: 372, y0: 50, k: 17, ax: 40, xl: 78, xr: 252, sy: 314, sh: 18, sx0: 20, sx1: 380 };
const Y = (e: number): number => G.y0 - e * G.k;
const SX = (nm: number): number => G.sx0 + ((nm - 50) / 950) * (G.sx1 - G.sx0);

export const UPPERS = [2, 3, 4, 5, 6];
export const UPPERS_ABS = [2, 3, 4, 5, 6, INF];
export const LOWERS = [1, 2, 3, 4, 5];
export const SHINE_LEVELS = [1, 2, 3, 4, 5, 6];

let instances = 0;

class AtomSim extends HTMLElement {
  private mode: Mode = 'emit';
  private upper = 6;
  private lower = 2;
  private energy = 11;
  private built = false;
  private scene!: SVGGElement;
  private table!: HTMLTableSectionElement;
  private sliders: { box: HTMLLabelElement; name: HTMLSpanElement; out: HTMLOutputElement; input: HTMLInputElement }[] =
    [];
  private radios: HTMLInputElement[] = [];

  connectedCallback(): void {
    if (this.built) return;
    this.built = true;
    const mode = this.getAttribute('mode');
    if (mode === 'absorb' || mode === 'shine') this.mode = mode;
    const up = Number(this.getAttribute('upper'));
    const low = Number(this.getAttribute('lower'));
    if (UPPERS.includes(up)) this.upper = up;
    if (LOWERS.includes(low) && low < this.upper) this.lower = low;
    else if (this.mode === 'shine' && !this.hasAttribute('lower')) this.lower = 1; // the ground state
    const e = Number((this.getAttribute('energy') ?? '').replace(',', '.'));
    if (e > 0) this.energy = this.nearest(e);
    this.replaceChildren(); // drop the no-JS fallback text
    this.classList.add('sim', 'atm');
    this.build();
    this.update();
  }

  disconnectedCallback(): void {
    this.built = false;
  }

  private uppers(): number[] {
    return this.mode === 'absorb' ? UPPERS_ABS : UPPERS;
  }

  private lowers(): number[] {
    return this.mode === 'shine' ? SHINE_LEVELS : LOWERS;
  }

  private nearest(e: number): number {
    const list = shineEnergies(this.lower);
    return list.reduce((best, v) => (Math.abs(v - e) < Math.abs(best - e) ? v : best), list[0] ?? e);
  }

  private setUpper(n: number): void {
    this.upper = n;
    if (this.lower >= n) this.lower = n - 1;
  }

  private setLower(m: number): void {
    this.lower = m;
    if (this.mode === 'shine') {
      this.energy = this.nearest(this.energy);
    } else if (this.upper <= m) {
      this.upper = m + 1;
    }
  }

  /** Values, current value and setter of slider i in the current mode. */
  private sliderSpec(i: number): [string, number[], number, (v: number) => void, (v: number) => string] {
    if (this.mode === 'shine') {
      return i === 0
        ? ['Уровень атома m', this.lowers(), this.lower, (v) => this.setLower(v), String]
        : ['Энергия фотона', shineEnergies(this.lower), this.energy, (v) => (this.energy = v), (v) => ev(v)];
    }
    return i === 0
      ? ['Верхний уровень n', this.uppers(), this.upper, (v) => this.setUpper(v), nText]
      : ['Нижний уровень m', this.lowers(), this.lower, (v) => this.setLower(v), String];
  }

  private build(): void {
    const id = ++instances;
    const set = document.createElement('fieldset');
    set.className = 'pfx-chips atm-chips';
    const legend = document.createElement('legend');
    legend.textContent = 'Режим';
    set.append(legend);
    const group = `atm-${id}`;
    for (const [mode, name] of MODES) {
      const label = document.createElement('label');
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = group;
      radio.value = mode;
      radio.checked = mode === this.mode;
      radio.addEventListener('change', () => {
        if (!radio.checked) return;
        this.mode = mode;
        if (mode === 'shine') this.energy = this.nearest(this.energy);
        if (mode !== 'absorb' && this.upper === INF) this.upper = NMAX;
        if (mode !== 'shine' && this.lower >= NMAX) this.lower = NMAX - 1;
        if (mode !== 'shine' && this.upper <= this.lower) this.upper = this.lower + 1;
        this.update();
      });
      const span = document.createElement('span');
      span.textContent = name;
      label.append(radio, span);
      set.append(label);
      this.radios.push(radio);
    }

    const svg = el('svg', {
      viewBox: `0 0 ${G.w} ${G.h}`,
      class: 'sim-svg',
      role: 'img',
      'aria-label':
        'Уровни энергии атома водорода в масштабе, от минус 13,6 электронвольта у первого уровня до нуля. ' +
        'Стрелки — переходы между уровнями, выбранный переход выделен. Внизу шкала длин волн с видимой ' +
        'полосой, линиями серии Бальмера и линией выбранного фотона',
    });
    this.scene = el('g');
    svg.append(this.scene);
    svg.addEventListener('click', (ev2) => {
      const t = ev2.target as Element | null;
      const n = Number(t?.getAttribute('data-level'));
      if (!n) return;
      const lvl = n > NMAX ? INF : n;
      if (this.mode === 'shine') {
        if (lvl !== INF) this.setLower(lvl);
      } else if (lvl === INF) {
        if (this.mode === 'absorb') this.setUpper(INF);
      } else if (lvl > this.lower) {
        this.setUpper(lvl);
      } else if (lvl < NMAX) {
        this.setLower(lvl);
      }
      this.update();
    });

    const controls = document.createElement('div');
    controls.className = 'sim-controls';
    for (let i = 0; i < 2; i++) {
      const box = document.createElement('label');
      box.className = 'sim-slider';
      const name = document.createElement('span');
      const out = document.createElement('output');
      const input = document.createElement('input');
      input.type = 'range';
      input.min = '0';
      input.step = '1';
      input.addEventListener('input', () => {
        const [, values, current, setv] = this.sliderSpec(i);
        setv(values[Number(input.value)] ?? current);
        this.update();
      });
      box.append(name, out, input);
      controls.append(box);
      this.sliders.push({ box, name, out, input });
    }

    const table = document.createElement('table');
    table.className = 'atm-table';
    this.table = document.createElement('tbody');
    table.append(this.table);
    this.append(set, svg, controls, table);
  }

  private update(): void {
    this.sliders.forEach(({ name, out, input }, i) => {
      const [title, values, current, , show] = this.sliderSpec(i);
      name.textContent = title;
      input.max = String(values.length - 1);
      input.value = String(Math.max(0, values.indexOf(current)));
      out.textContent = show(current);
    });
    this.table.replaceChildren(
      ...readout(this.mode, this.upper, this.lower, this.energy).map(([name, value, main]) => {
        const tr = document.createElement('tr');
        if (main) tr.className = 'atm-main';
        const th = document.createElement('th');
        th.scope = 'row';
        th.textContent = name;
        const td = document.createElement('td');
        td.textContent = value;
        tr.append(th, td);
        return tr;
      }),
    );
    this.draw();
  }

  private label(x: number, y: number, text: string, anchor = 'start', cls = ''): SVGTextElement {
    return el('text', { x: f1(x), y: f1(y), 'text-anchor': anchor, class: `atm-label ${cls}` }, text);
  }

  private arrow(x: number, y1: number, y2: number, cls: string, dashed = false): SVGElement[] {
    const dir = y2 > y1 ? 1 : -1;
    const tip = `M${f1(x)} ${f1(y2)}l-4 ${f1(-9 * dir)}h8z`;
    return [
      el('path', { d: `M${f1(x)} ${f1(y1)}V${f1(y2 - 8 * dir)}`, class: `${cls}${dashed ? ' atm-dash' : ''}` }),
      el('path', { d: tip, class: `${cls}-tip` }),
    ];
  }

  /** A short accent wave (a photon) from (x1, y1) to (x2, y2) with an arrowhead. */
  private packet(x1: number, y1: number, x2: number, y2: number): SVGElement[] {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    const ux = dx / len;
    const uy = dy / len;
    const pts: string[] = [];
    for (let s = 0; s <= len - 10; s += 1) {
      const w = 4 * Math.sin((2 * Math.PI * s) / 9);
      pts.push(`${pts.length ? 'L' : 'M'}${f1(x1 + s * ux - w * uy)} ${f1(y1 + s * uy + w * ux)}`);
    }
    const bx = x2 - 9 * ux;
    const by = y2 - 9 * uy;
    return [
      el('path', { d: pts.join(''), class: 'atm-wave' }),
      el('path', {
        d: `M${f1(x2)} ${f1(y2)}L${f1(bx - 4 * uy)} ${f1(by + 4 * ux)}L${f1(bx + 4 * uy)} ${f1(by - 4 * ux)}z`,
        class: 'atm-accent-tip',
      }),
    ];
  }

  private draw(): void {
    const { y0, ax, xl, xr, sy, sh, sx0, sx1 } = G;
    const parts: SVGElement[] = [];
    const shine = this.mode === 'shine';
    // the energy axis
    parts.push(el('path', { d: `M${ax} ${f1(Y(-14.4))}V${y0 - 30}`, class: 'atm-axis' }));
    parts.push(el('path', { d: `M${ax} ${y0 - 34}l-4 9h8z`, class: 'atm-axis-tip' }));
    parts.push(this.label(ax + 6, y0 - 26, 'E, эВ', 'start', 'atm-small'));
    for (const e of [0, -4, -8, -12]) {
      parts.push(el('path', { d: `M${ax - 4} ${f1(Y(e))}h4`, class: 'atm-axis' }));
      parts.push(this.label(ax - 7, Y(e) + 4, e ? MINUS + String(-e) : '0', 'end', 'atm-small'));
    }
    // the levels (clickable through invisible hit strips)
    const chosen = shine ? [this.lower] : [this.upper, this.lower];
    const res = shine ? outcome(this.lower, this.energy) : null;
    if (res?.kind === 'absorb') chosen.push(res.to);
    parts.push(el('path', { d: `M${xl} ${y0}H${xr}`, class: `atm-guide${chosen.includes(INF) ? ' atm-chosen' : ''}` }));
    parts.push(this.label(xl - 4, y0 + 4, 'n = ∞', 'end', 'atm-small'));
    parts.push(this.label(xr + 4, y0 + 4, '0', 'start', 'atm-small atm-muted'));
    const names: Record<number, string> = { 1: `${MINUS}13,6`, 2: `${MINUS}3,4`, 3: `${MINUS}1,51`, 4: `${MINUS}0,85` };
    for (let n = 1; n <= NMAX; n++) {
      const y = Y(level(n));
      parts.push(el('path', { d: `M${xl} ${f1(y)}H${xr}`, class: `atm-level${chosen.includes(n) ? ' atm-chosen' : ''}` }));
      if (n <= 4) {
        parts.push(this.label(xl - 4, y + 4, `n = ${n}`, 'end', 'atm-small'));
        parts.push(this.label(xr + 4, y + 4, names[n] ?? '', 'start', 'atm-small'));
      }
    }
    for (let n = 1; n <= NMAX + 1; n++) {
      const y = Y(level(n <= NMAX ? n : INF));
      const above = n === 1 ? 10 : Math.min(10, (Y(level(n)) - Y(level(n + 1 <= NMAX ? n + 1 : INF))) / 2);
      parts.push(
        el('rect', {
          x: xl,
          y: f1(y - above),
          width: xr - xl,
          height: f1(above + 4),
          class: 'atm-hit',
          'data-level': n <= NMAX ? n : NMAX + 1,
        }),
      );
    }

    // transitions
    let lineNm: number | null = null;
    const marks: number[] = [];
    if (this.mode === 'emit') {
      const all = cascade(this.upper);
      const step = Math.min(14, 150 / all.length);
      all.forEach(([a, b], i) => {
        const x = xl + 16 + i * step;
        const isChosen = a === this.upper && b === this.lower;
        parts.push(...this.arrow(x, Y(level(a)), Y(level(b)), isChosen ? 'atm-accent' : 'atm-faint'));
        marks.push(wavelengthNm(photonEv(a, b)));
        if (isChosen) {
          // the photon leaves through open space: just below the lower level, or above n = 1
          const ym = b >= 2 ? Y(level(b)) + 18 : Y(level(1)) - 30;
          parts.push(...this.packet(x + 6, ym, x + 52, ym + 10));
        }
      });
      lineNm = wavelengthNm(photonEv(this.upper, this.lower));
      parts.push(this.label(G.w - 4, y0 - 26, `линий из уровня ${this.upper}: ${lineCount(this.upper)}`, 'end', 'atm-small atm-muted'));
    } else if (this.mode === 'absorb') {
      const x = 170;
      const ya = Y(level(this.lower));
      parts.push(...this.packet(x - 56, ya + 30, x - 4, ya + 2));
      parts.push(...this.arrow(x, ya, Y(level(this.upper)), 'atm-accent'));
      lineNm = wavelengthNm(this.upper === INF ? ionisation(this.lower) : photonEv(this.upper, this.lower));
      if (this.upper === INF) {
        parts.push(el('path', { d: `M${x + 4} ${y0 - 2}l30 -14`, class: 'atm-vel' }));
        parts.push(this.label(x + 36, y0 - 18, 'электрон свободен', 'start', 'atm-small'));
      }
    } else {
      const x = 170;
      const ya = Y(level(this.lower));
      const top = Y(level(this.lower) + this.energy);
      parts.push(...this.packet(x - 56, ya + 30, x - 4, ya + 2));
      parts.push(...this.arrow(x, ya, top, 'atm-accent', res?.kind === 'pass'));
      parts.push(this.label(x + 8, (ya + top) / 2, ev(this.energy), 'start', 'atm-small atm-accent-text'));
      if (res?.kind === 'ionise') {
        parts.push(el('path', { d: `M${x + 4} ${f1(top)}l30 -12`, class: 'atm-vel' }));
        parts.push(this.label(x + 36, top - 10, `E = ${ev(res.ek)}`, 'start', 'atm-small atm-vel-text'));
      }
      const msg = res?.kind === 'absorb' ? `поглощён: ${this.lower} → ${res.to}` : res?.kind === 'ionise' ? 'ионизация' : 'не поглощён';
      parts.push(this.label(G.w - 4, y0 - 26, msg, 'end', 'atm-small atm-muted'));
      lineNm = wavelengthNm(this.energy);
    }

    // the spectrum strip, 50…1000 нм
    parts.push(el('rect', { x: sx0, y: sy, width: f1(SX(380) - sx0), height: sh, class: 'atm-zone' }));
    parts.push(el('rect', { x: f1(SX(760)), y: sy, width: f1(sx1 - SX(760)), height: sh, class: 'atm-zone' }));
    parts.push(this.label((sx0 + SX(380)) / 2, sy + 13, 'УФ', 'middle', 'atm-tiny atm-muted'));
    parts.push(this.label((SX(760) + sx1) / 2, sy + 13, 'ИК', 'middle', 'atm-tiny atm-muted'));
    for (const [a, b, , letter] of COLOURS) {
      const x1 = SX(a);
      const x2 = SX(Math.min(b, 760));
      parts.push(el('rect', { x: f1(x1), y: sy, width: f1(x2 - x1), height: sh, class: 'atm-cell' }));
      if (x2 - x1 >= 8) parts.push(this.label((x1 + x2) / 2, sy + 13, letter, 'middle', 'atm-tiny'));
    }
    for (let n = 3; n <= NMAX; n++) {
      const x = SX(wavelengthNm(photonEv(n, 2)));
      parts.push(el('path', { d: `M${f1(x)} ${sy}v${sh}`, class: 'atm-balmer' }));
    }
    for (const nm of [200, 500, 800, 1000]) {
      parts.push(el('path', { d: `M${f1(SX(nm))} ${sy + sh}v4`, class: 'atm-axis' }));
      parts.push(this.label(SX(nm), sy + sh + 16, nm === 1000 ? '1000 нм' : String(nm), nm === 1000 ? 'end' : 'middle', 'atm-tiny'));
    }
    let off = 0;
    for (const nm of marks) {
      if (nm > 1000) off++;
      else parts.push(el('path', { d: `M${f1(SX(nm))} ${sy - 8}v7`, class: 'atm-mark' }));
    }
    if (lineNm !== null) {
      const text = `${num(lineNm, 0)}${NBSP}нм`;
      if (lineNm <= 1000) {
        const x = SX(lineNm);
        parts.push(el('path', { d: `M${f1(x)} ${sy - 12}v${sh + 14}`, class: 'atm-line' }));
        parts.push(this.label(Math.min(Math.max(x, 40), 360), sy - 16, text, 'middle', 'atm-small atm-accent-text'));
      } else {
        parts.push(el('path', { d: `M${sx1 - 10} ${sy - 10}h12`, class: 'atm-line' }));
        parts.push(el('path', { d: `M${sx1 + 8} ${sy - 10}l-8 -4v8z`, class: 'atm-accent-tip' }));
        parts.push(this.label(sx1 - 14, sy - 6, text, 'end', 'atm-small atm-accent-text'));
      }
    }
    if (off) parts.push(this.label(sx1, sy + sh + 30, `ещё в ИК, дальше 1000 нм: ${off}`, 'end', 'atm-tiny atm-muted'));
    this.scene.replaceChildren(...parts);
  }
}

if (!customElements.get('pp-atom')) customElements.define('pp-atom', AtomSim);
