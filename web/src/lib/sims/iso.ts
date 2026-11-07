// <pp-iso process="T"> — isoprocesses of a gas under a piston. A fixed mass of ideal gas sits in a
// cylinder; the chips choose what stays constant (temperature, pressure or volume) and one slider
// changes the free quantity: the volume for T = const (the piston is pushed in a water bath), the
// temperature for p = const (a load on a free piston) and for V = const (the piston is pinned).
// Three live graphs, p–V, p–T and V–T, show the current state as an accent dot, the whole line of
// the current process dashed (lines through the origin drawn from the origin) and the part already
// travelled in accent; earlier processes stay in the text colour, so a cycle can be built from
// pieces. The readout gives p, V, T and the ratios since the start of the current process.
//
// Units: p in p₀ and V in V₀, the pressure and volume of the start state A at T₀ = 250 К. The mass
// does not change, so every state has pV/T = p₀V₀/T₀ exactly: the states are computed from the
// gas laws in closed form, nothing is integrated. The molecules are decoration: points that never
// meet, each coordinate a reflected straight line in the current box, their speed ∝ √T. With
// reduced motion they stand still; everything else changes only when the slider moves.
//
// With the `work` attribute (thermo.internal-energy lessons) the model counts energy: p₀ = 100 кПа
// and V₀ = 1 л, so p₀V₀ = 100 Дж and the gas is monatomic. Only the p–V graph is drawn, in кПа and
// л; under each process since A the work of the gas is shaded, an accent tint where it is positive
// (expansion) and accent hatching where it is negative (compression). Below, two bars from a zero
// line give the work A and the change of internal energy ΔU = (3/2)Δ(pV) since A (green, like the
// molecules' velocities); the readout gives both for the current process and since A. The work is
// exact too: p·ΔV at constant pressure, (pV)·ln(V₂/V₁) at constant temperature, 0 at constant volume.
//
// Written into theory Markdown as plain HTML; the theory page imports this module only when such
// an element is present. Light DOM, site CSS variables: follows the light/dark theme.

import { fold } from './box';
import { gaussian, rng } from './random';

const SVG_NS = 'http://www.w3.org/2000/svg';

export type Process = 'T' | 'p' | 'V';
export type Quantity = 'p' | 'V' | 'T';

/** p in p₀, V in V₀, T in К. */
export interface State {
  p: number;
  V: number;
  T: number;
}

export const T0 = 250; // К, the start state A: p₀, V₀, T₀
export const START: State = { p: 1, V: 1, T: T0 };
/** The states the model can reach: they all fit on the graphs. */
export const LIMITS: Record<Quantity, [number, number]> = { p: [0.4, 3], V: [0.4, 3], T: [100, 750] };
export const STEP: Record<Quantity, number> = { p: 0.05, V: 0.05, T: 10 };
const MOLS = 30;
const SEED = 20261108;

/** The quantity the slider moves in each process. */
export function free(proc: Process): Quantity {
  return proc === 'T' ? 'V' : 'T';
}

/** The state on the process through `a` where the free quantity equals x. */
export function stateAt(proc: Process, a: State, x: number): State {
  if (proc === 'T') return { T: a.T, V: x, p: a.T / T0 / x };
  if (proc === 'p') return { p: a.p, T: x, V: x / T0 / a.p };
  return { V: a.V, T: x, p: x / T0 / a.V };
}

/** pV/T in p₀V₀/T₀: 1 for every state of this gas. */
export function invariant(s: State): number {
  return (s.p * s.V * T0) / s.T;
}

/** Range of the free quantity that keeps p, V and T within LIMITS on the process through a. */
export function freeRange(proc: Process, a: State): [number, number] {
  const [pl, ph] = LIMITS.p;
  const [vl, vh] = LIMITS.V;
  const [tl, th] = LIMITS.T;
  let lo: number;
  let hi: number;
  if (proc === 'T') {
    const c = a.T / T0; // pV
    lo = Math.max(vl, c / ph);
    hi = Math.min(vh, c / pl);
  } else if (proc === 'p') {
    lo = Math.max(tl, vl * T0 * a.p);
    hi = Math.min(th, vh * T0 * a.p);
  } else {
    lo = Math.max(tl, pl * T0 * a.V);
    hi = Math.min(th, ph * T0 * a.V);
  }
  return [lo, hi];
}

/** The range on the slider's grid (inside the exact range). */
export function sliderRange(proc: Process, a: State): [number, number] {
  const st = STEP[free(proc)];
  const [lo, hi] = freeRange(proc, a);
  const grid = (k: number) => Number((k * st).toFixed(6));
  return [grid(Math.ceil(lo / st - 1e-9)), grid(Math.floor(hi / st + 1e-9))];
}

/** Sample the process line through a for x from x1 to x2. */
export function curve(proc: Process, a: State, x1: number, x2: number, n = 48): State[] {
  const out: State[] = [];
  for (let i = 0; i <= n; i++) out.push(stateAt(proc, a, x1 + ((x2 - x1) * i) / n));
  return out;
}

/** Does this process draw a line through the origin on graph (x, y)? (V = const on p–T, p = const on V–T.) */
export function throughOrigin(proc: Process, x: Quantity, y: Quantity): boolean {
  return x === 'T' && ((proc === 'V' && y === 'p') || (proc === 'p' && y === 'V'));
}

/** p₀V₀ in joules in the `work` mode: p₀ = 100 кПа, V₀ = 1 л. */
export const PV0 = 100;

/** Work of the gas, in p₀V₀, along the process through a from a to the state where the free quantity is x. */
export function work(proc: Process, a: State, x: number): number {
  const b = stateAt(proc, a, x);
  if (proc === 'V') return 0;
  if (proc === 'p') return a.p * (b.V - a.V);
  return (a.p * a.V) * Math.log(b.V / a.V); // pV is constant on the isotherm
}

/** Change of internal energy of the monatomic gas from a to b, in p₀V₀: (3/2)Δ(pV). */
export function deltaU(a: State, b: State): number {
  return 1.5 * (b.p * b.V - a.p * a.V);
}

/** Joules rounded to whole numbers, signed, with a real minus; never «−0» or «+0». */
export function joules(j: number): string {
  const n = Math.round(j);
  if (n === 0) return '0 Дж';
  return `${n > 0 ? '+' : '−'}${Math.abs(n)} Дж`;
}

interface Segment {
  proc: Process;
  a: State;
  lo: number;
  hi: number;
  x: number; // the free quantity where the process is now (or ended)
}

function el<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
  text?: string,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  if (text !== undefined) node.textContent = text;
  return node;
}

const ru2 = (n: number) => n.toFixed(2).replace('.', ',');
const kelvin = (t: number) => `${Math.round(t)} К (${Math.round(t) - 273} °C)`.replace('-', '−');

// Layout: the cylinder top left, p–V top right, p–T and V–T below.
const CYL = { x: 50, w: 70, bottom: 150, perV: 40, piston: 8 };
const MAX: Record<Quantity, number> = { p: 3.2, V: 3.2, T: 800 };

interface Graph {
  x: Quantity;
  y: Quantity;
  ox: number; // screen origin
  oy: number;
  w: number;
  h: number;
  full: SVGPolylineElement;
  areas: SVGGElement;
  past: SVGGElement;
  now: SVGPolylineElement;
  dot: SVGCircleElement;
}

const GRAPHS: [Quantity, Quantity, number, number, number, number][] = [
  // x, y, left, top, width, height of the cell
  ['V', 'p', 150, 0, 245, 172],
  ['T', 'p', 0, 182, 195, 158],
  ['T', 'V', 205, 182, 195, 158],
];

const tickLabel = (q: Quantity, v: number, joulesMode = false): string =>
  q === 'T' ? String(v) : joulesMode ? String(q === 'p' ? v * 100 : v) : `${v === 1 ? '' : v}${q}₀`;

// The energy bars of the `work` mode: zero line at BAR.zero, BAR.k px per joule, clamped.
const BAR = { zero: 230, k: 0.2, max: 160, aY: 226, uY: 278, h: 18 };

class IsoSim extends HTMLElement {
  private proc: Process = 'T';
  private s: State = { ...START };
  private segs: Segment[] = [];
  private phase = 0;
  private frame = 0;
  private visible = false;
  private observer: IntersectionObserver | null = null;
  private built = false;
  private x0: number[] = [];
  private y0: number[] = [];
  private vx: number[] = [];
  private vy: number[] = [];
  private mols: SVGCircleElement[] = [];
  private gasRect!: SVGRectElement;
  private piston!: SVGRectElement;
  private rod!: SVGLineElement;
  private load!: SVGRectElement;
  private stops!: SVGGElement;
  private bath!: SVGGElement;
  private arrow!: SVGGElement;
  private caption!: SVGTextElement;
  private graphs: Graph[] = [];
  private radios: HTMLInputElement[] = [];
  private input!: HTMLInputElement;
  private name!: HTMLElement;
  private out!: HTMLOutputElement;
  private readout!: HTMLElement;
  private joulesMode = false;
  private hatchId = '';
  private barA!: SVGRectElement;
  private barU!: SVGRectElement;

  connectedCallback(): void {
    if (this.built) return;
    this.built = true;
    this.joulesMode = this.hasAttribute('work');
    const p = this.getAttribute('process');
    this.proc = p === 'p' || p === 'V' ? p : 'T';
    const r = rng(SEED);
    const g = gaussian(r);
    for (let i = 0; i < MOLS; i++) {
      this.x0.push(r());
      this.y0.push(r());
      this.vx.push(0.35 * g());
      this.vy.push(0.35 * g());
    }
    this.replaceChildren(); // drop the no-JS fallback text
    this.classList.add('sim', 'iso');
    this.build();
    this.reset();
    this.observer = new IntersectionObserver((entries) => {
      this.visible = entries.some((e) => e.isIntersecting);
      this.loop();
    });
    this.observer.observe(this);
  }

  disconnectedCallback(): void {
    cancelAnimationFrame(this.frame);
    this.observer?.disconnect();
  }

  private build(): void {
    const id = Math.random().toString(36).slice(2, 8);
    const choice = document.createElement('fieldset');
    choice.className = 'pfx-chips iso-procs';
    const legend = document.createElement('legend');
    legend.textContent = 'Постоянна';
    choice.append(legend);
    for (const [key, html] of [
      ['T', 'температура <i>T</i>'],
      ['p', 'давление <i>p</i>'],
      ['V', 'объём <i>V</i>'],
    ] as [Process, string][]) {
      const label = document.createElement('label');
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = `iso-${id}`;
      radio.value = key;
      radio.addEventListener('change', () => {
        if (radio.checked) this.start(key);
      });
      const span = document.createElement('span');
      span.innerHTML = html;
      label.append(radio, span);
      choice.append(label);
      this.radios.push(radio);
    }

    const svg = el('svg', {
      viewBox: this.joulesMode ? '0 0 400 310' : '0 0 400 340',
      class: 'sim-svg',
      role: 'img',
      'aria-label': this.joulesMode
        ? 'Газ в цилиндре под поршнем и график давления от объёма. Под линией процесса закрашена ' +
          'работа газа: сплошной заливкой — положительная, штриховкой — отрицательная. Внизу полосы: ' +
          'работа газа и изменение его внутренней энергии с точки A'
        : 'Газ в цилиндре под поршнем и три графика его состояния: давление от объёма, давление от ' +
          'температуры и объём от температуры. Точка на графиках — текущее состояние, линия — процесс',
    });
    if (this.joulesMode) {
      this.hatchId = `iso-hatch-${id}`;
      const defs = el('defs');
      const pat = el('pattern', {
        id: this.hatchId,
        patternUnits: 'userSpaceOnUse',
        width: 7,
        height: 7,
        patternTransform: 'rotate(45)',
        class: 'iso-hatch',
      });
      pat.append(el('line', { x1: 0, y1: 0, x2: 0, y2: 7 }));
      defs.append(pat);
      svg.append(defs);
    }

    // the cylinder
    const cyl = el('g', { class: 'iso-cyl' });
    this.bath = el('g', { class: 'iso-bath' });
    this.bath.append(
      el('rect', { x: CYL.x - 12, y: 40, width: 96, height: CYL.bottom - 34, rx: 4 }),
      el('path', { d: `M${CYL.x - 12} 52q6 -5 12 0t12 0t12 0t12 0t12 0t12 0t12 0t12 0` }),
    );
    this.gasRect = el('rect', { x: CYL.x, width: CYL.w, class: 'iso-gas' });
    const walls = el('path', {
      d: `M${CYL.x} 14V${CYL.bottom}H${CYL.x + CYL.w}V14`,
      class: 'iso-walls',
    });
    const mols = el('g', { class: 'iso-mols' });
    for (let i = 0; i < MOLS; i++) {
      const c = el('circle', { r: 2.5 });
      this.mols.push(c);
      mols.append(c);
    }
    this.rod = el('line', { x1: CYL.x + CYL.w / 2, x2: CYL.x + CYL.w / 2, y1: 2, class: 'iso-rod' });
    this.piston = el('rect', { x: CYL.x + 1, width: CYL.w - 2, height: CYL.piston, class: 'iso-piston' });
    this.load = el('rect', { x: CYL.x + 15, width: CYL.w - 30, height: 14, rx: 2, class: 'iso-load' });
    this.stops = el('g', { class: 'iso-stops' });
    this.arrow = el('g', { class: 'iso-force' });
    this.caption = el('text', { x: CYL.x + CYL.w / 2, y: 168, 'text-anchor': 'middle', class: 'iso-caption' });
    cyl.append(this.bath, this.gasRect, mols, walls, this.rod, this.piston, this.load, this.stops, this.arrow, this.caption);
    svg.append(cyl);

    // the graphs
    for (const [xq, yq, left, top, w, h] of this.joulesMode ? GRAPHS.slice(0, 1) : GRAPHS) {
      const ox = left + 30;
      const oy = top + h - 20;
      const gw = w - 30 - 12;
      const gh = h - 20 - 16;
      const grid = el('g', { class: 'sim-grid iso-axes' });
      grid.append(
        el('path', { d: `M${ox} ${oy}H${ox + gw + 6}M${ox} ${oy}V${oy - gh - 6}`, class: 'iso-axis' }),
        el('path', {
          d: `M${ox + gw + 10} ${oy}l-8 -3.5v7zM${ox} ${oy - gh - 10}l-3.5 8h7z`,
          class: 'iso-axis-head',
        }),
      );
      const ticks = (q: Quantity): number[] => (q === 'T' ? [250, 500, 750] : [1, 2, 3]);
      for (const v of ticks(xq)) {
        const x = ox + (v / MAX[xq]) * gw;
        grid.append(el('line', { x1: x, x2: x, y1: oy, y2: oy + 4 }));
        grid.append(el('text', { x, y: oy + 14, 'text-anchor': 'middle' }, tickLabel(xq, v, this.joulesMode)));
      }
      for (const v of ticks(yq)) {
        const y = oy - (v / MAX[yq]) * gh;
        grid.append(el('line', { x1: ox - 4, x2: ox, y1: y, y2: y }));
        grid.append(el('text', { x: ox - 6, y: y + 4, 'text-anchor': 'end' }, tickLabel(yq, v, this.joulesMode)));
      }
      grid.append(el('text', { x: ox - 6, y: oy + 14, 'text-anchor': 'end' }, '0'));
      const units: Record<Quantity, string> = this.joulesMode
        ? { p: ', кПа', V: ', л', T: ', К' }
        : { p: '', V: '', T: ', К' };
      const name = (q: Quantity, attrs: Record<string, string | number>) => {
        const t = el('text', { ...attrs, class: 'iso-name' });
        t.append(el('tspan', { 'font-style': 'italic' }, q));
        if (units[q]) t.append(units[q]);
        return t;
      };
      grid.append(name(xq, { x: ox + gw + 10, y: oy - 7, 'text-anchor': 'end' }));
      grid.append(name(yq, { x: ox + 8, y: oy - gh - 2 }));
      const start = el('g', { class: 'iso-start' });
      const [sx, sy] = [ox + (START[xq] / MAX[xq]) * gw, oy - (START[yq] / MAX[yq]) * gh];
      start.append(el('circle', { cx: sx, cy: sy, r: 2.5 }), el('text', { x: sx - 5, y: sy - 5, 'text-anchor': 'end' }, 'A'));
      const full = el('polyline', { class: 'iso-full', points: '' });
      const areas = el('g', { class: 'iso-work' });
      const past = el('g', { class: 'iso-past' });
      const now = el('polyline', { class: 'iso-now', points: '' });
      const dot = el('circle', { r: 4, class: 'iso-dot' });
      svg.append(areas, grid, full, past, start, now, dot);
      this.graphs.push({ x: xq, y: yq, ox, oy, w: gw, h: gh, full, areas, past, now, dot });
    }

    if (this.joulesMode) {
      const bars = el('g', { class: 'iso-bars' });
      const label = (y: number, html: [string, boolean][]) => {
        const t = el('text', { x: 4, y, class: 'iso-bar-label' });
        for (const [s, it] of html) t.append(it ? el('tspan', { 'font-style': 'italic' }, s) : s);
        return t;
      };
      this.barA = el('rect', { y: BAR.aY, height: BAR.h, class: 'iso-bar-a' });
      this.barU = el('rect', { y: BAR.uY, height: BAR.h, class: 'iso-bar-u' });
      bars.append(
        el('text', { x: 396, y: 200, 'text-anchor': 'end', class: 'iso-bar-note' }, 'с точки A'),
        label(BAR.aY - 6, [['работа газа ', false], ['A', true]]),
        label(BAR.uY - 6, [['изменение внутренней энергии Δ', false], ['U', true]]),
        this.barA,
        this.barU,
        el('line', { x1: BAR.zero, x2: BAR.zero, y1: 206, y2: BAR.uY + BAR.h + 6, class: 'iso-bar-zero' }),
        el('text', { x: BAR.zero, y: BAR.uY + BAR.h + 20, 'text-anchor': 'middle', class: 'iso-bar-note' }, '0'),
        el('text', { x: BAR.zero - 40, y: BAR.uY + BAR.h + 20, 'text-anchor': 'middle', class: 'iso-bar-note' }, '−'),
        el('text', { x: BAR.zero + 40, y: BAR.uY + BAR.h + 20, 'text-anchor': 'middle', class: 'iso-bar-note' }, '+'),
      );
      svg.append(bars);
    }

    const controls = document.createElement('div');
    controls.className = 'sim-controls';
    const label = document.createElement('label');
    label.className = 'sim-slider';
    this.name = document.createElement('span');
    this.out = document.createElement('output');
    this.input = document.createElement('input');
    this.input.type = 'range';
    this.input.addEventListener('input', () => this.move(Number(this.input.value)));
    label.append(this.name, this.out, this.input);
    controls.append(label);

    const row = document.createElement('div');
    row.className = 'sim-row';
    const again = document.createElement('button');
    again.type = 'button';
    again.className = 'btn small ghost';
    again.textContent = 'Заново';
    again.addEventListener('click', () => this.reset());
    row.append(again);

    this.readout = document.createElement('p');
    this.readout.className = 'sim-readout';
    this.readout.setAttribute('aria-live', 'polite');
    this.append(choice, svg, controls, row, this.readout);
  }

  /** Back to state A with the element's own process and no history. */
  private reset(): void {
    const p = this.getAttribute('process');
    this.s = { ...START };
    this.segs = [];
    this.start(p === 'p' || p === 'V' ? p : 'T');
  }

  /** Start a new process from the current state; the finished one stays on the graphs. */
  private start(proc: Process): void {
    const last = this.segs[this.segs.length - 1];
    if (last && last.lo === last.hi) this.segs.pop(); // nothing travelled: drop it
    this.proc = proc;
    for (const r of this.radios) r.checked = r.value === proc;
    const q = free(proc);
    const x = this.s[q];
    this.segs.push({ proc, a: { ...this.s }, lo: x, hi: x, x });
    const [lo, hi] = sliderRange(proc, this.s);
    this.input.min = String(lo);
    this.input.max = String(hi);
    this.input.step = String(STEP[q]);
    this.input.value = String(x);
    this.name.innerHTML = q === 'V' ? 'Объём <i>V</i>' : 'Температура <i>T</i>';
    this.update();
  }

  private move(x: number): void {
    const seg = this.segs[this.segs.length - 1];
    this.s = stateAt(seg.proc, seg.a, x);
    seg.x = x;
    seg.lo = Math.min(seg.lo, x);
    seg.hi = Math.max(seg.hi, x);
    this.update();
  }

  private reduced(): boolean {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  private loop(): void {
    cancelAnimationFrame(this.frame);
    if (!this.visible || this.reduced()) return;
    let prev = performance.now();
    const tick = (now: number) => {
      this.phase += Math.min(0.05, (now - prev) / 1000) * Math.sqrt(this.s.T / T0);
      prev = now;
      this.drawMolecules();
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  private gasTop(): number {
    return CYL.bottom - this.s.V * CYL.perV;
  }

  private drawMolecules(): void {
    const top = this.gasTop();
    const lx = CYL.w - 6;
    const ly = CYL.bottom - top - 6;
    for (let i = 0; i < MOLS; i++) {
      const x = CYL.x + 3 + fold(this.x0[i] + this.vx[i] * this.phase, 1) * lx;
      const y = top + 3 + fold(this.y0[i] + this.vy[i] * this.phase, 1) * ly;
      this.mols[i].setAttribute('cx', x.toFixed(1));
      this.mols[i].setAttribute('cy', y.toFixed(1));
    }
  }

  private pt(g: Graph, s: State): string {
    const x = g.ox + (s[g.x] / MAX[g.x]) * g.w;
    const y = g.oy - (s[g.y] / MAX[g.y]) * g.h;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }

  private line(g: Graph, seg: Segment, lo: number, hi: number): string {
    return curve(seg.proc, seg.a, lo, hi)
      .map((s) => this.pt(g, s))
      .join(' ');
  }

  private update(): void {
    const s = this.s;
    const seg = this.segs[this.segs.length - 1];

    // the cylinder
    const top = this.gasTop();
    this.gasRect.setAttribute('y', top.toFixed(1));
    this.gasRect.setAttribute('height', (CYL.bottom - top).toFixed(1));
    const py = top - CYL.piston;
    this.piston.setAttribute('y', py.toFixed(1));
    this.rod.setAttribute('y2', py.toFixed(1));
    this.load.style.display = this.proc === 'p' ? '' : 'none';
    this.load.setAttribute('y', (py - 14).toFixed(1));
    this.bath.style.display = this.proc === 'T' ? '' : 'none';
    this.stops.replaceChildren();
    if (this.proc === 'V') {
      for (const [x, d] of [
        [CYL.x, 1],
        [CYL.x + CYL.w, -1],
      ]) {
        this.stops.append(el('path', { d: `M${x} ${py - 1}h${7 * d}v-6h${-7 * d}z` }));
      }
    }
    this.caption.textContent =
      this.proc === 'T' ? 'сосуд в воде: T = const' : this.proc === 'p' ? 'груз на поршне: p = const' : 'поршень закреплён: V = const';
    // the gas pushes the wall out: a red arrow, longer for a larger pressure
    const len = 10 + 10 * s.p;
    const ay = (top + CYL.bottom) / 2;
    this.arrow.replaceChildren(
      el('line', { x1: CYL.x - 2, y1: ay, x2: CYL.x - len + 7, y2: ay }),
      el('path', { d: `M${(CYL.x - 2 - len).toFixed(1)} ${ay.toFixed(1)}l9 -4v8z` }),
    );
    this.drawMolecules();

    // the graphs
    for (const g of this.graphs) {
      const [lo, hi] = freeRange(seg.proc, seg.a);
      const from = throughOrigin(seg.proc, g.x, g.y) ? 0 : lo;
      g.full.setAttribute('points', this.line(g, seg, from, hi));
      g.past.replaceChildren(
        ...this.segs
          .slice(0, -1)
          .map((p) => el('polyline', { points: this.line(g, p, p.lo, p.hi) })),
      );
      g.now.setAttribute('points', seg.hi > seg.lo ? this.line(g, seg, seg.lo, seg.hi) : '');
      const [cx, cy] = this.pt(g, s).split(',');
      g.dot.setAttribute('cx', cx);
      g.dot.setAttribute('cy', cy);
      if (this.joulesMode) {
        g.areas.replaceChildren(
          ...this.segs.map((p) => this.area(g, p)).filter((a): a is SVGPolygonElement => a !== null),
        );
      }
    }

    if (this.joulesMode) {
      this.energy(seg);
      return;
    }

    // the readout
    const q = free(this.proc);
    this.out.textContent = q === 'V' ? `${ru2(s.V)} V₀` : kelvin(s.T);
    const a = seg.a;
    const ratio = (k: Quantity) => `×${ru2(s[k] / a[k])}`;
    const since =
      this.proc === 'T'
        ? `объём ${ratio('V')}, давление ${ratio('p')} — произведение <i>pV</i> не меняется`
        : this.proc === 'p'
          ? `температура ${ratio('T')}, объём ${ratio('V')} — отношение <i>V</i>/<i>T</i> не меняется`
          : `температура ${ratio('T')}, давление ${ratio('p')} — отношение <i>p</i>/<i>T</i> не меняется`;
    this.readout.innerHTML =
      `<i>p</i> = ${ru2(s.p)} <i>p</i>₀, <i>V</i> = ${ru2(s.V)} <i>V</i>₀, <i>T</i> = ${kelvin(s.T)}. ` +
      `С начала процесса: ${since}.`;
  }

  /** The work of one process as the area under it on p–V: tint if positive, hatching if negative. */
  private area(g: Graph, seg: Segment): SVGPolygonElement | null {
    const a = Math.round(work(seg.proc, seg.a, seg.x) * PV0);
    if (a === 0) return null; // V = const, or nothing travelled: no area, as the readout says 0
    const b = stateAt(seg.proc, seg.a, seg.x);
    const pts = curve(seg.proc, seg.a, seg.a[free(seg.proc)], seg.x).map((s) => this.pt(g, s));
    const base = (v: number) => `${(g.ox + (v / MAX.V) * g.w).toFixed(1)},${g.oy}`;
    const poly = el('polygon', { points: [...pts, base(b.V), base(seg.a.V)].join(' ') });
    if (a > 0) poly.setAttribute('class', 'iso-work-pos');
    else {
      poly.setAttribute('class', 'iso-work-neg');
      poly.setAttribute('fill', `url(#${this.hatchId})`);
    }
    return poly;
  }

  /** Bars and readout of the `work` mode. */
  private energy(seg: Segment): void {
    const s = this.s;
    const total = this.segs.reduce((sum, p) => sum + work(p.proc, p.a, p.x), 0) * PV0;
    const dU = deltaU(START, s) * PV0;
    const bar = (r: SVGRectElement, j: number) => {
      const n = Math.round(j);
      const w = Math.min(BAR.max, Math.abs(n) * BAR.k);
      r.setAttribute('x', (n < 0 ? BAR.zero - w : BAR.zero).toFixed(1));
      r.setAttribute('width', w.toFixed(1));
    };
    bar(this.barA, total);
    bar(this.barU, dU);
    if (Math.round(total) < 0) {
      this.barA.style.fill = `url(#${this.hatchId})`; // inline: beats the class's accent fill
      this.barA.classList.add('neg');
    } else {
      this.barA.style.fill = '';
      this.barA.classList.remove('neg');
    }

    const q = free(this.proc);
    const kelvinNb = (t: number) => kelvin(t).replace(/ (К|°C)/g, ' $1');
    this.out.textContent = q === 'V' ? `${ru2(s.V)} л` : kelvinNb(s.T);
    const kpa = `${Math.round(s.p * 100)} кПа`;
    const nowA = joules(work(seg.proc, seg.a, seg.x) * PV0);
    const nowU = joules(deltaU(seg.a, s) * PV0);
    let text =
      `<i>p</i> = ${kpa}, <i>V</i> = ${ru2(s.V)} л, <i>T</i> = ${kelvinNb(s.T)}. ` +
      `В этом процессе работа газа <i>A</i> = ${nowA}, Δ<i>U</i> = ${nowU}.`;
    if (this.segs.length > 1) {
      text += ` С точки A: <i>A</i> = ${joules(total)}, Δ<i>U</i> = ${joules(dU)}.`;
    }
    this.readout.innerHTML = text;
  }
}

if (!customElements.get('pp-iso')) customElements.define('pp-iso', IsoSim);
