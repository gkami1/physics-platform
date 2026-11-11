// <pp-chain> — a chain reaction in a block of uranium-235. Nuclei (text-colour dots) fill a round
// block; neutrons (accent dots) fly generation by generation. A neutron either splits a nucleus
// (which turns into a hollow muted circle and sends out 2 or 3 new neutrons), escapes through the
// block's surface, or is caught by a control rod (muted bars). Below, a graph of the number of
// neutrons per generation in this run (text colour) against N·k^g (dashed accent). Sliders: the
// block's radius (6…27 см) and the number of control rods (0…6). Buttons: «Пуск»/«Пауза»,
// «Сначала», «Новый опыт».
//
// The statistics are exact: every neutron gets a fixed seeded fate. With rods absorbing a = 10 % each
// and a share p = 5,4 см / R escaping (a big block loses fewer neutrons: less surface per volume — a
// simplification), a neutron splits a nucleus with probability (1 − a)(1 − p), and a split gives 2 or
// 3 neutrons with equal chance, 2,5 on average. So the expected multiplication factor is
// k = 2,5·(1 − a)(1 − p); with no rods the critical radius is 9 см (p = 0,6, k = 1), where a sphere of
// uranium-235 weighs ≈ 58 кг — near the real critical mass of ≈ 50 кг. Changing a slider replays
// the run with the same seed. A run stops after 10 generations, when no neutron is left, or before a
// generation that needs more nuclei than remain.
//
// Without reduced motion a generation flies in 1,2 с once the model is on screen. With reduced motion
// nothing runs: the run stands at its end, so the still shows every split nucleus and the whole graph.
// Defaults by attributes `size` (см) and `rods`; without them R = 18 см, no rods (k = 1,75). The
// lessons set 18 см without rods (6.5) and 27 см with 5 rods (6.6, k = 1), clear of their tasks.
//
// Written into theory Markdown as plain HTML; the theory page imports this module only when such an
// element is present. Light DOM, site CSS variables: follows the light/dark theme.

import { rng } from './random';

const SVG_NS = 'http://www.w3.org/2000/svg';
const NBSP = '\u00a0';
const MINUS = '\u2212';

export const SIZES = [6, 9, 12, 18, 27]; // см, the block's radius
export const ESCAPE = [0.9, 0.6, 0.45, 0.3, 0.2]; // p = 5,4 см / R
export const SIZE_START = 18;
export const RODS_MAX = 6;
export const ROD_PCT = 10; // each rod catches 10 % of the neutrons
export const NU_MEAN = 2.5; // 2 or 3 neutrons per fission, equally likely
export const N_START = 10; // neutrons from the source in generation 0
export const G_END = 10;
export const MEV = 200; // per fission
export const SEED = 20261358;
export const GEN_S = 1.2; // seconds per generation
const PX = 5.2; // px per см
const CX = 200;
const CY = 152;
const GAP = 10; // the nuclei lattice step, px

/** The share of neutrons caught by the rods. */
export function absorbed(rods: number): number {
  return (rods * ROD_PCT) / 100;
}

/** The expected multiplication factor k = 2,5·(1 − a)(1 − p). */
export function kFormula(si: number, rods: number): number {
  return NU_MEAN * (1 - absorbed(rods)) * (1 - (ESCAPE[si] ?? 0));
}

/** The rods' x positions, evenly across the block. */
export function rodXs(size: number, rods: number): number[] {
  const R = size * PX;
  return Array.from({ length: rods }, (_, i) => CX + R * 0.86 * ((2 * (i + 1)) / (rods + 1) - 1));
}

/** Nuclei on a hexagonal lattice inside the block, none under a rod — unless the rods would take
 * more than half of a small block, then all of them (drawn over the rods). */
export function nuclei(size: number, rods: number): [number, number][] {
  const R = size * PX - 5;
  const rx = rodXs(size, rods);
  const h = (GAP * Math.sqrt(3)) / 2;
  const all: [number, number][] = [];
  const kept: [number, number][] = [];
  for (let j = -16; j <= 16; j++) {
    for (let i = -15; i <= 15; i++) {
      const x = (i + (Math.abs(j) % 2) / 2) * GAP;
      const y = j * h;
      if (x * x + y * y > R * R) continue;
      if (x * x + y * y < 36) continue; // the source sits at the centre
      all.push([CX + x, CY + y]);
      if (!rx.some((r) => Math.abs(CX + x - r) < 4)) kept.push([CX + x, CY + y]);
    }
  }
  return 2 * kept.length >= all.length ? kept : all;
}

export type Fate = 'fission' | 'escape' | 'absorb';
export interface Flight {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  fate: Fate;
  nu: number; // neutrons born, 0 unless fission
  target: number; // the nucleus split, −1 otherwise
}
export interface Run {
  gens: Flight[][];
  split: number[]; // the generation whose neutron split nucleus j, −1 if whole
  stop: 'end' | 'fuel' | 'dead';
  count: number; // nuclei in the block
}

/** One run: generation by generation, each neutron with a seeded fate. */
export function simulate(si: number, rods: number, run: number): Run {
  const size = SIZES[si] ?? SIZE_START;
  const pe = ESCAPE[si] ?? 0;
  const a = absorbed(rods);
  const R = size * PX;
  const pts = nuclei(size, rods);
  const rx = rodXs(size, rods);
  const r = rng(SEED + 7919 * run);
  const split = pts.map(() => -1);
  let free = pts.length;
  let births: [number, number][] = Array.from({ length: N_START }, () => [CX, CY]);
  const gens: Flight[][] = [];
  let stop: Run['stop'] = 'end';
  for (let g = 0; g < G_END; g++) {
    if (births.length === 0) {
      stop = 'dead';
      break;
    }
    const draws = births.map(() => [r(), r(), r(), r()] as const);
    const fissions = draws.filter(([u]) => u >= a + (1 - a) * pe).length;
    if (fissions > free) {
      stop = 'fuel';
      break;
    }
    const flights: Flight[] = [];
    const next: [number, number][] = [];
    births.forEach(([x0, y0], i) => {
      const [u, v, w, q] = draws[i] ?? [0, 0, 0, 0];
      const th = 2 * Math.PI * v;
      const cos = Math.cos(th);
      const sin = Math.sin(th);
      if (u < a) {
        let best = rx[0] ?? CX;
        for (const x of rx) if (Math.abs(x - x0) < Math.abs(best - x0)) best = x;
        const half = Math.sqrt(Math.max(R * R - (best - CX) ** 2, 0)) - 8;
        const y1 = Math.min(Math.max(y0 + (w - 0.5) * 40, CY - half), CY + half);
        flights.push({ x0, y0, x1: best, y1, fate: 'absorb', nu: 0, target: -1 });
      } else if (u < a + (1 - a) * pe) {
        const dx = x0 - CX;
        const dy = y0 - CY;
        const b = dx * cos + dy * sin;
        const t = -b + Math.sqrt(Math.max(b * b - (dx * dx + dy * dy - R * R), 0)) + 16;
        flights.push({ x0, y0, x1: x0 + t * cos, y1: y0 + t * sin, fate: 'escape', nu: 0, target: -1 });
      } else {
        const d = 14 + 46 * w;
        const px = x0 + d * cos;
        const py = y0 + d * sin;
        let target = -1;
        let best = Infinity;
        pts.forEach(([x, y], j) => {
          if (split[j] !== -1) return;
          const dd = (x - px) ** 2 + (y - py) ** 2;
          if (dd < best) {
            best = dd;
            target = j;
          }
        });
        split[target] = g;
        free -= 1;
        const nu = q < 0.5 ? 2 : 3;
        const [x1, y1] = pts[target] ?? [CX, CY];
        for (let k = 0; k < nu; k++) next.push([x1, y1]);
        flights.push({ x0, y0, x1, y1, fate: 'fission', nu, target });
      }
    });
    gens.push(flights);
    births = next;
  }
  if (stop === 'end' && births.length === 0) stop = 'dead';
  return { gens, split, stop, count: pts.length };
}

/** Totals over the generations completed by time t (in generations). */
export function totals(run: Run, t: number): { fissions: number; flown: number; born: number } {
  const done = Math.min(Math.floor(t + 1e-9), run.gens.length);
  let fissions = 0;
  let flown = 0;
  let born = 0;
  for (const flights of run.gens.slice(0, done)) {
    flown += flights.length;
    for (const f of flights) {
      if (f.fate === 'fission') fissions += 1;
      born += f.nu;
    }
  }
  return { fissions, flown, born };
}

/** A number with a decimal comma, `digits` decimals kept, with «≈» when rounded. */
export function num(x: number, digits: number): string {
  const r = Number(x.toFixed(digits));
  const text = Math.abs(r).toFixed(digits).replace('.', ',');
  const sign = r < 0 ? MINUS : '';
  return Math.abs(r - x) > 1e-9 * Math.max(1, Math.abs(x)) ? `≈${NBSP}${sign}${text}` : `${sign}${text}`;
}

/** An integer with thin groups of three digits from 10 000 on. */
export function int(n: number): string {
  const s = String(Math.round(n));
  return s.length < 5 ? s : s.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
}

/** Table rows [name, value, main?] at time t (in generations). */
export function readout(run: Run, si: number, rods: number, t: number): [string, string, boolean][] {
  const k = kFormula(si, rods);
  const last = run.gens.length;
  const g = Math.min(Math.floor(t + 1e-9), last - 1);
  const { fissions, flown, born } = totals(run, t);
  const mode = Math.abs(k - 1) < 1e-9 ? 'равен 1' : k > 1 ? 'больше 1' : 'меньше 1';
  let state = `поколение ${g} в полёте`;
  if (t >= last - 1e-9) {
    state =
      run.stop === 'fuel'
        ? 'остановлен: в блоке кончаются ядра'
        : run.stop === 'dead'
          ? 'все нейтроны потеряны, цепочка оборвалась'
          : `прошло ${G_END} поколений`;
  }
  return [
    ['Вылетают наружу p', `${num((ESCAPE[si] ?? 0) * 100, 0)}${NBSP}%`, false],
    ['Ловят стержни a', `${rods * ROD_PCT}${NBSP}%`, false],
    ['k = 2,5·(1 − a)·(1 − p)', `${num(k, 3)} (${mode})`, true],
    ['Опыт', state, false],
    ['Нейтронов в поколении', g >= 0 ? String(run.gens[g]?.length ?? 0) : '0', false],
    ['Делений всего', String(fissions), false],
    ['Энергия: деления × 200 МэВ', `${int(fissions * MEV)}${NBSP}МэВ`, true],
    ['k в опыте: родилось / пролетело', flown ? num(born / flown, 2) : '—', false],
  ];
}

/** The smallest of 10, 20, 50, 100, … not below v. */
export function nice(v: number): number {
  for (let p = 10; ; p *= 10) for (const m of [1, 2, 5]) if (m * p >= v) return m * p;
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

/** The graph: g = 0 at gx, G_END at gx + gw; N = 0 at gy, the top at gy − gh. */
const S = { w: 400, h: 470, gx: 56, gy: 446, gw: 312, gh: 112 };

class ChainSim extends HTMLElement {
  private si = SIZES.indexOf(SIZE_START);
  private rods = 0;
  private run = 0;
  private sim!: Run;
  private pts: [number, number][] = [];
  private t = 0;
  private running = false;
  private frame = 0;
  private last = 0;
  private visible = false;
  private still = false; // prefers reduced motion: nothing runs by itself
  private built = false;
  private observer: IntersectionObserver | null = null;
  private dots: SVGCircleElement[] = [];
  private shownGen = -2;
  private block!: SVGGElement;
  private flying!: SVGGElement;
  private plot!: SVGGElement;
  private play: HTMLButtonElement | null = null;
  private sliders: { out: HTMLOutputElement; input: HTMLInputElement }[] = [];
  private table!: HTMLTableSectionElement;

  connectedCallback(): void {
    if (this.built) return;
    this.built = true;
    this.still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const size = Number(this.getAttribute('size'));
    const rods = Number(this.getAttribute('rods'));
    if (SIZES.includes(size)) this.si = SIZES.indexOf(size);
    if (Number.isInteger(rods) && rods >= 0 && rods <= RODS_MAX) this.rods = rods;
    this.replaceChildren(); // drop the no-JS fallback text
    this.classList.add('sim', 'chn');
    this.build();
    this.reset();
    if (!this.still) {
      this.observer = new IntersectionObserver((entries) => {
        this.visible = entries.some((e) => e.isIntersecting);
        if (this.visible && this.running) this.start();
        else cancelAnimationFrame(this.frame);
      });
      this.observer.observe(this);
    }
  }

  disconnectedCallback(): void {
    cancelAnimationFrame(this.frame);
    this.observer?.disconnect();
    this.observer = null;
    this.built = false;
  }

  /** A new simulation for the current settings: from the start, or at the end with reduced motion. */
  private reset(): void {
    cancelAnimationFrame(this.frame);
    this.sim = simulate(this.si, this.rods, this.run);
    this.layout();
    this.t = this.still ? this.sim.gens.length : 0;
    this.running = !this.still;
    if (this.running && this.visible) this.start();
    this.update();
  }

  private button(text: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn small';
    b.textContent = text;
    b.addEventListener('click', onClick);
    return b;
  }

  private slider(name: string, max: number, set: (v: number) => void): HTMLLabelElement {
    const label = document.createElement('label');
    label.className = 'sim-slider';
    const span = document.createElement('span');
    span.textContent = name;
    const out = document.createElement('output');
    const input = document.createElement('input');
    input.type = 'range';
    input.min = '0';
    input.max = String(max);
    input.step = '1';
    input.addEventListener('input', () => {
      set(Number(input.value));
      this.reset();
    });
    this.sliders.push({ out, input });
    label.append(span, out, input);
    return label;
  }

  private build(): void {
    const top = document.createElement('div');
    top.className = 'chn-top';
    if (!this.still) {
      this.play = this.button('Пауза', () => {
        this.running = !this.running;
        if (this.running) {
          if (this.t >= this.sim.gens.length) this.t = 0;
          if (this.visible) this.start();
        } else cancelAnimationFrame(this.frame);
        this.update();
      });
      top.append(this.play, this.button('Сначала', () => this.reset()));
    }
    top.append(
      this.button('Новый опыт', () => {
        this.run += 1;
        this.reset();
      }),
    );

    const svg = el('svg', {
      viewBox: `0 0 ${S.w} ${S.h}`,
      class: 'sim-svg',
      role: 'img',
      'aria-label':
        'Модель цепной реакции: круглый блок урана-235, ядра — точки, разделившиеся ядра — пустые ' +
        'кружки, нейтроны — маленькие точки, регулирующие стержни — полосы. Внизу график числа ' +
        'нейтронов в каждом поколении: точки — этот опыт, пунктир — N·k в степени номера поколения',
    });
    this.block = el('g');
    this.flying = el('g');
    this.plot = el('g');
    svg.append(this.block, this.flying, this.plot);

    const controls = document.createElement('div');
    controls.className = 'sim-controls';
    controls.append(
      this.slider('Радиус блока R', SIZES.length - 1, (v) => (this.si = v)),
      this.slider('Регулирующие стержни', RODS_MAX, (v) => (this.rods = v)),
    );

    const table = document.createElement('table');
    table.className = 'chn-table';
    this.table = document.createElement('tbody');
    table.append(this.table);
    this.append(top, svg, controls, table);
  }

  /** The block, the rods, the source and the nuclei for the current settings. */
  private layout(): void {
    const size = SIZES[this.si] ?? SIZE_START;
    const R = size * PX;
    this.pts = nuclei(size, this.rods);
    const parts: SVGElement[] = [el('circle', { cx: CX, cy: CY, r: f1(R), class: 'chn-block' })];
    for (const x of rodXs(size, this.rods)) {
      const half = Math.sqrt(Math.max(R * R - (x - CX) ** 2, 0)) - 2;
      parts.push(el('rect', { x: f1(x - 2), y: f1(CY - half), width: 4, height: f1(2 * half), class: 'chn-rod' }));
    }
    this.dots = this.pts.map(([x, y]) => el('circle', { cx: f1(x), cy: f1(y), r: 3, class: 'chn-nuc' }));
    parts.push(...this.dots);
    parts.push(el('path', { d: `M${CX - 5} ${CY}h10M${CX} ${CY - 5}v10`, class: 'chn-src' }));
    parts.push(this.text(CX + R * 0.72 + 6, CY + R * 0.72 + 14, `R = ${size}${NBSP}см`, 'start', 'chn-small'));
    // legend
    parts.push(el('circle', { cx: 14, cy: 14, r: 3, class: 'chn-nuc' }));
    parts.push(this.text(22, 18, 'уран-235', 'start', 'chn-small'));
    parts.push(el('circle', { cx: 14, cy: 32, r: 3, class: 'chn-split' }));
    parts.push(this.text(22, 36, 'разделилось', 'start', 'chn-small'));
    parts.push(el('circle', { cx: 14, cy: 50, r: 2.4, class: 'chn-n' }));
    parts.push(this.text(22, 54, 'нейтрон', 'start', 'chn-small'));
    if (this.rods) {
      parts.push(el('rect', { x: 12, y: 63, width: 4, height: 12, class: 'chn-rod' }));
      parts.push(this.text(22, 73, 'стержень', 'start', 'chn-small'));
    }
    this.block.replaceChildren(...parts);
    this.shownGen = -2;
  }

  private start(): void {
    cancelAnimationFrame(this.frame);
    this.last = performance.now();
    const tick = (now: number) => {
      // a hidden tab must not jump; the first frame may be stamped before start()
      const dt = Math.max(0, Math.min((now - this.last) / 1000, 0.1));
      this.last = now;
      const end = this.sim.gens.length;
      this.t = Math.min(this.t + dt / GEN_S, end);
      if (this.t >= end) this.running = false;
      this.update();
      if (this.running && this.visible) this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  private update(): void {
    const t = this.t;
    if (this.play) this.play.textContent = this.running ? 'Пауза' : 'Пуск';
    const values = [this.si, this.rods];
    const a = this.rods * ROD_PCT;
    const shown = [`${SIZES[this.si] ?? SIZE_START}${NBSP}см`, this.rods ? `${this.rods} (${a}${NBSP}%)` : 'нет'];
    this.sliders.forEach(({ out, input }, i) => {
      input.value = String(values[i]);
      out.textContent = shown[i] ?? '';
    });
    // nuclei: split once their neutron arrives; the latest ones ringed
    const done = Math.floor(t + 1e-9);
    if (done !== this.shownGen) {
      this.shownGen = done;
      this.dots.forEach((d, j) => {
        const g = this.sim.split[j] ?? -1;
        const cls = g === -1 || g + 1 > done ? 'chn-nuc' : g + 1 === done ? 'chn-split chn-new' : 'chn-split';
        d.setAttribute('class', cls);
      });
    }
    // neutrons of the generation in flight
    const flights = done < this.sim.gens.length ? (this.sim.gens[done] ?? []) : [];
    const f = t - done;
    this.flying.replaceChildren(
      ...flights.map((n) =>
        el('circle', {
          cx: f1(n.x0 + (n.x1 - n.x0) * f),
          cy: f1(n.y0 + (n.y1 - n.y0) * f),
          r: 2.4,
          class: 'chn-n',
        }),
      ),
    );
    this.table.replaceChildren(
      ...readout(this.sim, this.si, this.rods, t).map(([name, value, main]) => {
        const tr = document.createElement('tr');
        if (main) tr.className = 'chn-main';
        const th = document.createElement('th');
        th.scope = 'row';
        th.textContent = name;
        const td = document.createElement('td');
        td.textContent = value;
        tr.append(th, td);
        return tr;
      }),
    );
    this.draw(t);
  }

  private text(x: number, y: number, s: string, anchor = 'middle', cls = ''): SVGTextElement {
    return el('text', { x: f1(x), y: f1(y), 'text-anchor': anchor, class: `chn-label ${cls}` }, s);
  }

  private draw(t: number): void {
    const { gx, gy, gw, gh } = S;
    const k = kFormula(this.si, this.rods);
    const counts = this.sim.gens.map((g) => g.length);
    const last = Math.min(Math.floor(t + 1e-9), counts.length - 1);
    const law = (g: number): number => N_START * k ** g;
    const top = nice(Math.max(...counts, law(Math.max(counts.length - 1, 0))));
    const X = (g: number): number => gx + (g / G_END) * gw;
    const Y = (n: number): number => gy - (n / top) * gh;
    const parts: SVGElement[] = [];
    parts.push(el('path', { d: `M${gx} ${gy}H${gx + gw + 14}`, class: 'chn-axis' }));
    parts.push(el('path', { d: `M${gx + gw + 20} ${gy}l-9 -4v8z`, class: 'chn-axis-tip' }));
    parts.push(el('path', { d: `M${gx} ${gy}V${gy - gh - 14}`, class: 'chn-axis' }));
    parts.push(el('path', { d: `M${gx} ${gy - gh - 20}l-4 9h8z`, class: 'chn-axis-tip' }));
    parts.push(this.text(gx + gw + 18, gy + 17, 'поколение', 'end', 'chn-small'));
    parts.push(this.text(gx + 9, gy - gh - 8, 'нейтронов', 'start', 'chn-small'));
    for (const v of [0, 2, 4, 6, 8, 10]) {
      if (v) parts.push(el('path', { d: `M${f1(X(v))} ${gy}v4`, class: 'chn-axis' }));
      parts.push(this.text(X(v), gy + 17, String(v), 'middle', 'chn-small'));
    }
    parts.push(el('path', { d: `M${gx - 4} ${f1(Y(top))}h4`, class: 'chn-axis' }));
    parts.push(this.text(gx - 7, Y(top) + 4, String(top), 'end', 'chn-small'));
    parts.push(this.text(gx - 7, gy + 4, '0', 'end', 'chn-small'));
    // the law N·k^g, dashed accent, clipped at the top
    const lawPts: string[] = [];
    for (let i = 0; i <= G_END * 10; i++) {
      const g = i / 10;
      const n = law(g);
      if (n > top) {
        const gt = Math.log(top / N_START) / Math.log(k);
        lawPts.push(`${f1(X(gt))} ${f1(Y(top))}`);
        break;
      }
      lawPts.push(`${f1(X(g))} ${f1(Y(n))}`);
    }
    parts.push(el('path', { d: `M${lawPts.join('L')}`, class: 'chn-law' }));
    // this run up to the generation in flight
    if (last >= 0) {
      const pts = counts.slice(0, last + 1).map((n, g) => `${f1(X(g))} ${f1(Y(n))}`);
      parts.push(el('path', { d: `M${pts.join('L')}`, class: 'chn-run' }));
      counts.slice(0, last + 1).forEach((n, g) => {
        parts.push(el('circle', { cx: f1(X(g)), cy: f1(Y(n)), r: 3.5, class: 'chn-dot' }));
      });
    }
    // legend
    const lx = gx + gw - 110;
    const ly = gy - gh + 2;
    parts.push(el('path', { d: `M${lx} ${ly}h22`, class: 'chn-run' }));
    parts.push(this.text(lx + 28, ly + 4, 'опыт', 'start', 'chn-small'));
    parts.push(el('path', { d: `M${lx} ${ly + 18}h22`, class: 'chn-law' }));
    parts.push(this.text(lx + 28, ly + 22, `${N_START}·k^g`, 'start', 'chn-small chn-accent'));
    this.plot.replaceChildren(...parts);
  }
}

if (!customElements.get('pp-chain')) customElements.define('pp-chain', ChainSim);
