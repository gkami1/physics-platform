// <pp-vapour> — water vapour under a piston. A cylinder in a water bath holds 40 mg of water and
// nothing else; two sliders set the bath temperature (10…40 °C) and the volume (0,5…5 л). While
// the vapour is unsaturated it is an ideal gas, p = mRT/(MV). It cannot get above the
// saturated-vapour pressure p_н(t) from the table: compressed further, the extra vapour condenses
// and the pressure stays at p_н while liquid collects at the bottom; heated, the liquid evaporates
// again. Two live graphs: p–V with the isotherm of the current temperature (a hyperbola, then flat
// at p_н) dashed, and p–t with the curve p_н(t) in the text colour; on both the states visited
// since «Заново» are an accent trace and the current state an accent dot. The readout gives p,
// p_н, φ = p/p_н and how much water is vapour and how much liquid.
//
// Every state is computed in closed form from (t, V); nothing is integrated, so the result never
// depends on how fast the sliders move. The molecules are decoration: their number ∝ the vapour
// mass, each coordinate a reflected straight line in the current gas space (fold() from box.ts),
// seeded so they are the same on every load; with reduced motion they stand still.
//
// Written into theory Markdown as plain HTML; the theory page imports this module only when such
// an element is present. Light DOM, site CSS variables: follows the light/dark theme.

import { fold } from './box';
import { gaussian, rng } from './random';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Saturated water vapour pressure, кПа, at 0, 1, … 45 °C (30 and 40 °C as in school tables). */
export const PSAT = [
  0.61, 0.66, 0.71, 0.76, 0.81, 0.87, 0.94, 1.0, 1.07, 1.15, 1.23, 1.31, 1.4, 1.5, 1.6, 1.71, 1.82,
  1.94, 2.06, 2.2, 2.34, 2.49, 2.65, 2.81, 2.99, 3.17, 3.36, 3.57, 3.78, 4.01, 4.24, 4.5, 4.76, 5.04,
  5.33, 5.63, 5.95, 6.28, 6.63, 7.0, 7.38, 7.79, 8.21, 8.65, 9.11, 9.6,
];

export const MASS = 40; // мг of water in the cylinder
export const MOLAR = 18; // г/моль
export const R = 8.31;
export const T_RANGE: [number, number] = [10, 40]; // °C, slider
export const V_RANGE: [number, number] = [0.5, 5]; // л, slider
export const START = { t: 25, V: 4 };

/** p_н at t °C, кПа (linear between table rows). */
export function psat(t: number): number {
  const c = Math.max(0, Math.min(PSAT.length - 1, t));
  const i = Math.min(PSAT.length - 2, Math.floor(c));
  return PSAT[i] + (PSAT[i + 1] - PSAT[i]) * (c - i);
}

/** Pressure of all the water as vapour (ideal gas) in V л at t °C, кПа. */
export function pIdeal(t: number, V: number): number {
  // m/M in mol = MASS·10⁻³ г / MOLAR; V·10⁻³ м³; Pa → кПа: ·10⁻³. The powers cancel to 10⁻³.
  return ((MASS / MOLAR) * R * (t + 273)) / V / 1000;
}

/** The volume at which all the water is just saturated vapour at t °C, л. */
export function vSat(t: number): number {
  return ((MASS / MOLAR) * R * (t + 273)) / psat(t) / 1000;
}

export interface VapourState {
  t: number;
  V: number;
  p: number; // кПа
  ps: number; // кПа
  phi: number; // 0…1
  vapour: number; // мг
  liquid: number; // мг
}

export function state(t: number, V: number): VapourState {
  const ps = psat(t);
  const pi = pIdeal(t, V);
  if (pi <= ps) return { t, V, p: pi, ps, phi: pi / ps, vapour: MASS, liquid: 0 };
  const vapour = (MASS * ps) / pi; // the vapour left is saturated: its mass ∝ its pressure
  return { t, V, p: ps, ps, phi: 1, vapour, liquid: MASS - vapour };
}

/** The isotherm at t °C on the p–V graph from V1 to V2 л: a hyperbola, flat at p_н below vSat. */
export function isotherm(t: number, V1: number, V2: number, n = 60): [number, number][] {
  const out: [number, number][] = [];
  const vs = vSat(t);
  for (let i = 0; i <= n; i++) {
    const V = V1 + ((V2 - V1) * i) / n;
    out.push([V, state(t, V).p]);
  }
  // put the corner exactly on the curve
  if (vs > V1 && vs < V2) {
    out.push([vs, psat(t)]);
    out.sort((a, b) => a[0] - b[0]);
  }
  return out;
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

const ru = (n: number, d: number) => n.toFixed(d).replace('.', ',');
/** φ in whole percent; an unsaturated vapour never reads 100 %. */
export const percent = (phi: number): number => (phi < 1 ? Math.min(99, Math.round(phi * 100)) : 100);

// Layout: the cylinder in its bath on the left, p–V top right, p–t below it.
const CYL = { x: 26, w: 64, bottom: 258, perV: 40, piston: 8 };
const MOLS = 32;
const SEED = 20261107;
const LIQ_MAX = 16; // px of liquid for all 40 mg

interface Graph {
  x: 'V' | 't';
  ox: number;
  oy: number;
  w: number;
  h: number;
  xmax: number;
  ymax: number;
  trace: SVGPolylineElement;
  dot: SVGCircleElement;
}

class VapourSim extends HTMLElement {
  private s: VapourState = state(START.t, START.V);
  private visited: VapourState[] = [];
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
  private liquid!: SVGRectElement;
  private surface!: SVGLineElement;
  private piston!: SVGRectElement;
  private rod!: SVGLineElement;
  private caption!: SVGTextElement;
  private iso!: SVGPolylineElement;
  private graphs: Graph[] = [];
  private tInput!: HTMLInputElement;
  private vInput!: HTMLInputElement;
  private tOut!: HTMLOutputElement;
  private vOut!: HTMLOutputElement;
  private readout!: HTMLElement;

  connectedCallback(): void {
    if (this.built) return;
    this.built = true;
    const r = rng(SEED);
    const g = gaussian(r);
    for (let i = 0; i < MOLS; i++) {
      this.x0.push(r());
      this.y0.push(r());
      this.vx.push(0.35 * g());
      this.vy.push(0.35 * g());
    }
    this.replaceChildren(); // drop the no-JS fallback text
    this.classList.add('sim', 'vap');
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

  private axes(ox: number, oy: number, w: number, h: number, x: 'V' | 't', xmax: number, ymax: number): SVGGElement {
    const grid = el('g', { class: 'sim-grid vap-axes' });
    grid.append(
      el('path', { d: `M${ox} ${oy}H${ox + w + 6}M${ox} ${oy}V${oy - h - 6}`, class: 'vap-axis' }),
      el('path', { d: `M${ox + w + 10} ${oy}l-8 -3.5v7zM${ox} ${oy - h - 10}l-3.5 8h7z`, class: 'vap-axis-head' }),
    );
    const xt = x === 'V' ? [1, 2, 3, 4, 5] : [10, 20, 30, 40];
    for (const v of xt) {
      const sx = ox + (v / xmax) * w;
      grid.append(el('line', { x1: sx, x2: sx, y1: oy, y2: oy + 4 }));
      grid.append(el('text', { x: sx, y: oy + 14, 'text-anchor': 'middle' }, String(v)));
    }
    for (const v of [2, 4, 6, 8]) {
      const sy = oy - (v / ymax) * h;
      grid.append(el('line', { x1: ox - 4, x2: ox, y1: sy, y2: sy }));
      grid.append(el('text', { x: ox - 6, y: sy + 4, 'text-anchor': 'end' }, String(v)));
    }
    grid.append(el('text', { x: ox - 6, y: oy + 14, 'text-anchor': 'end' }, '0'));
    const xname = el('text', { x: ox + w + 10, y: oy - 7, 'text-anchor': 'end', class: 'vap-name' });
    xname.append(el('tspan', { 'font-style': 'italic' }, x), x === 'V' ? ', л' : ', °C');
    const yname = el('text', { x: ox + 8, y: oy - h - 2, class: 'vap-name' });
    yname.append(el('tspan', { 'font-style': 'italic' }, 'p'), ', кПа');
    grid.append(xname, yname);
    return grid;
  }

  private build(): void {
    const svg = el('svg', {
      viewBox: '0 0 400 290',
      class: 'sim-svg',
      role: 'img',
      'aria-label':
        'Водяной пар в цилиндре под поршнем в баке с водой и два графика: давление пара от объёма ' +
        'и от температуры с кривой давления насыщенного пара. Точка на графиках — текущее состояние',
    });

    // the cylinder in its bath
    const cyl = el('g', { class: 'vap-cyl' });
    const bath = el('g', { class: 'vap-bath' });
    bath.append(
      el('rect', { x: CYL.x - 14, y: 40, width: CYL.w + 28, height: CYL.bottom - 32, rx: 4 }),
      el('path', { d: `M${CYL.x - 14} 52q6 -5 12 0t12 0t12 0t12 0t12 0t12 0t12 0t12 0` }),
    );
    this.gasRect = el('rect', { x: CYL.x, width: CYL.w, class: 'vap-gas' });
    this.liquid = el('rect', { x: CYL.x, width: CYL.w, class: 'vap-liquid' });
    this.surface = el('line', { x1: CYL.x, x2: CYL.x + CYL.w, class: 'vap-surface' });
    const walls = el('path', { d: `M${CYL.x} 22V${CYL.bottom}H${CYL.x + CYL.w}V22`, class: 'vap-walls' });
    const mols = el('g', { class: 'vap-mols' });
    for (let i = 0; i < MOLS; i++) {
      const c = el('circle', { r: 2.5 });
      this.mols.push(c);
      mols.append(c);
    }
    this.rod = el('line', { x1: CYL.x + CYL.w / 2, x2: CYL.x + CYL.w / 2, y1: 2, class: 'vap-rod' });
    this.piston = el('rect', { x: CYL.x + 1, width: CYL.w - 2, height: CYL.piston, class: 'vap-piston' });
    this.caption = el('text', { x: CYL.x + CYL.w / 2, y: 282, 'text-anchor': 'middle', class: 'vap-caption' });
    cyl.append(bath, this.gasRect, this.liquid, this.surface, mols, walls, this.rod, this.piston, this.caption);
    svg.append(cyl);

    // the graphs: p–V (with the current isotherm) and p–t (with the curve p_н(t))
    const specs: [Graph['x'], number, number, number, number, number][] = [
      // x, left, top, width, height, x max
      ['V', 128, 0, 272, 140, 5.5],
      ['t', 128, 148, 272, 140, 45],
    ];
    for (const [x, left, top, cw, ch, xmax] of specs) {
      const ox = left + 26;
      const oy = top + ch - 20;
      const w = cw - 26 - 14;
      const h = ch - 20 - 14;
      const ymax = 8.8;
      svg.append(this.axes(ox, oy, w, h, x, xmax, ymax));
      const g: Graph = {
        x,
        ox,
        oy,
        w,
        h,
        xmax,
        ymax,
        trace: el('polyline', { class: 'vap-trace', points: '' }),
        dot: el('circle', { r: 4, class: 'vap-dot' }),
      };
      if (x === 'V') {
        this.iso = el('polyline', { class: 'vap-iso', points: '' });
        svg.append(this.iso);
      } else {
        const pts: string[] = [];
        for (let t = 0; t <= 45; t += 0.5) {
          if (psat(t) > ymax) break;
          pts.push(this.pt(g, t, psat(t)));
        }
        const end = pts[pts.length - 1].split(',');
        const label = el('text', { x: Number(end[0]) - 8, y: Number(end[1]) + 4, 'text-anchor': 'end', class: 'vap-curve-name' });
        label.append(el('tspan', { 'font-style': 'italic' }, 'p'), el('tspan', { dy: 3, 'font-size': 9 }, 'н'));
        label.append(el('tspan', { dy: -3 }, '('), el('tspan', { 'font-style': 'italic' }, 't'), ')');
        svg.append(el('polyline', { class: 'vap-curve', points: pts.join(' ') }), label);
      }
      svg.append(g.trace, g.dot);
      this.graphs.push(g);
    }

    const controls = document.createElement('div');
    controls.className = 'sim-controls';
    const slider = (name: string, [lo, hi]: [number, number], step: number, on: () => void) => {
      const label = document.createElement('label');
      label.className = 'sim-slider';
      const span = document.createElement('span');
      span.innerHTML = name;
      const out = document.createElement('output');
      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(lo);
      input.max = String(hi);
      input.step = String(step);
      input.addEventListener('input', on);
      label.append(span, out, input);
      controls.append(label);
      return [input, out] as const;
    };
    [this.tInput, this.tOut] = slider('Температура <i>t</i>', T_RANGE, 1, () => this.move());
    [this.vInput, this.vOut] = slider('Объём <i>V</i>', V_RANGE, 0.1, () => this.move());

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
    this.append(svg, controls, row, this.readout);
  }

  private reset(): void {
    this.tInput.value = String(START.t);
    this.vInput.value = String(START.V);
    this.visited = [];
    this.move();
  }

  private move(): void {
    this.s = state(Number(this.tInput.value), Number(this.vInput.value));
    this.visited.push(this.s);
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
      this.phase += Math.min(0.05, (now - prev) / 1000) * Math.sqrt((this.s.t + 273) / 298);
      prev = now;
      this.drawMolecules();
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  private liquidTop(): number {
    return CYL.bottom - (this.s.liquid > 0 ? 2 + (LIQ_MAX - 2) * (this.s.liquid / MASS) : 0);
  }

  private drawMolecules(): void {
    const top = CYL.bottom - this.s.V * CYL.perV;
    const floor = this.liquidTop();
    const shown = Math.round((MOLS * this.s.vapour) / MASS);
    const lx = CYL.w - 6;
    const ly = Math.max(0, floor - top - 6);
    for (let i = 0; i < MOLS; i++) {
      const m = this.mols[i];
      m.style.display = i < shown ? '' : 'none';
      const x = CYL.x + 3 + fold(this.x0[i] + this.vx[i] * this.phase, 1) * lx;
      const y = top + 3 + fold(this.y0[i] + this.vy[i] * this.phase, 1) * ly;
      m.setAttribute('cx', x.toFixed(1));
      m.setAttribute('cy', y.toFixed(1));
    }
  }

  private pt(g: Graph, x: number, p: number): string {
    const sx = g.ox + (x / g.xmax) * g.w;
    const sy = g.oy - (p / g.ymax) * g.h;
    return `${sx.toFixed(1)},${sy.toFixed(1)}`;
  }

  private update(): void {
    const s = this.s;

    // the cylinder
    const top = CYL.bottom - s.V * CYL.perV;
    this.gasRect.setAttribute('y', top.toFixed(1));
    this.gasRect.setAttribute('height', (CYL.bottom - top).toFixed(1));
    const lt = this.liquidTop();
    this.liquid.setAttribute('y', lt.toFixed(1));
    this.liquid.setAttribute('height', (CYL.bottom - lt).toFixed(1));
    this.surface.style.display = s.liquid > 0 ? '' : 'none';
    this.surface.setAttribute('y1', lt.toFixed(1));
    this.surface.setAttribute('y2', lt.toFixed(1));
    const py = top - CYL.piston;
    this.piston.setAttribute('y', py.toFixed(1));
    this.rod.setAttribute('y2', py.toFixed(1));
    this.caption.textContent = `вода в баке: ${s.t} °C`;
    this.drawMolecules();

    // the graphs
    for (const g of this.graphs) {
      const x = (v: VapourState) => (g.x === 'V' ? v.V : v.t);
      g.trace.setAttribute('points', this.visited.length > 1 ? this.visited.map((v) => this.pt(g, x(v), v.p)).join(' ') : '');
      const [cx, cy] = this.pt(g, x(s), s.p).split(',');
      g.dot.setAttribute('cx', cx);
      g.dot.setAttribute('cy', cy);
    }
    const gv = this.graphs[0];
    this.iso.setAttribute('points', isotherm(s.t, 0.3, 5.4).map(([V, p]) => this.pt(gv, V, p)).join(' '));

    // the readout
    this.tOut.textContent = `${s.t} °C`;
    this.vOut.textContent = `${ru(s.V, 1)} л`;
    const head =
      `<i>p</i> = ${ru(s.p, 2)} кПа, <i>p</i><sub>н</sub>(${s.t} °C) = ${ru(s.ps, 2)} кПа, ` +
      `<i>φ</i> = ${percent(s.phi)} %. `;
    let tail: string;
    if (s.liquid === 0) tail = `Пар ненасыщенный: все ${MASS} мг воды — пар, жидкости нет.`;
    else if (s.liquid < 0.05) tail = 'Пар только что стал насыщенным: на дне появляются первые капли.';
    else tail = `Пар насыщенный: паром осталось ${ru(s.vapour, 1)} мг, ${ru(s.liquid, 1)} мг сконденсировалось в воду.`;
    this.readout.innerHTML = head + tail;
  }
}

if (!customElements.get('pp-vapour')) customElements.define('pp-vapour', VapourSim);
