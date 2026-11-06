// <pp-gas n="100" t="300"> — gas pressure from molecular hits. N molecules fly in a box and
// bounce off the walls; the right wall (accent) is a pressure sensor. Every hit gives it the
// impulse 2m|vₓ| (mechanics 10.5), drawn as a short red flash; the model adds the impulses up,
// divides by the time and shows the pressure on a bar in units of p₀, the pressure at N = 100 and
// T = 300 К. Sliders: the number of molecules (the volume is fixed, so this is the concentration
// n) and the absolute temperature, which scales every speed by √(T/300 К). The bar keeps a mark
// of the previous run, so twice the molecules or twice the temperature shows as twice the
// pressure.
//
// Ideal gas: the molecules are points that do not meet each other, so every molecule moves
// exactly — x(t) is a reflected straight line — and the number of its hits on the sensor up to
// any time is counted exactly, without time steps: the readout does not depend on the frame
// rate. The seeded start has its velocity components normalised so that Σvₓ² = Σv_y² = Nσ²(T):
// the long-run pressure of the sample is then exactly (N/100)(T/300) p₀. With reduced motion every
// press moves on by five seconds instead of animating.
//
// Written into theory Markdown as plain HTML; the theory page imports this module only when such
// an element is present. Light DOM, site CSS variables: follows the light/dark theme.

import { fold } from './box';
import { gaussian, rng } from './random';

export { fold };

const SVG_NS = 'http://www.w3.org/2000/svg';

export const BOX = { w: 360, h: 200 }; // px, the vessel
export const R_MOL = 2.5; // px
export const LX = BOX.w - 2 * R_MOL; // the free run of a molecule's centre across the box
export const LY = BOX.h - 2 * R_MOL;
export const SIGMA0 = 190; // px/s, σ of each velocity component at T₀ in the model
export const T0 = 300; // К
export const N0 = 100;
export const RUN = 20; // с, a run
export const SEED = 20261107;
export const N_RANGE = { min: 20, max: 200, step: 20 };
export const T_RANGE = { min: 150, max: 600, step: 50 }; // К
const STEP_REDUCED = 5; // с per press with reduced motion
const FLASH = 0.25; // с a hit stays visible
const P_MAX = 4; // the bar's end, in p₀
const SETTLED = 2; // с: before this the average of a few hits says little, so show none

export interface Gas {
  n: number;
  x0: Float64Array; // start positions of the centres, measured from R_MOL
  y0: Float64Array;
  vx: Float64Array;
  vy: Float64Array;
}

/** The seeded gas: N molecules, Maxwell velocities for temperature T (К), normalised. */
export function create(n: number, tK: number, seed = SEED): Gas {
  const r = rng(seed);
  const gauss = gaussian(r);
  const g: Gas = {
    n,
    x0: new Float64Array(n),
    y0: new Float64Array(n),
    vx: new Float64Array(n),
    vy: new Float64Array(n),
  };
  for (let i = 0; i < n; i++) {
    g.x0[i] = r() * LX;
    g.y0[i] = r() * LY;
    g.vx[i] = gauss();
    g.vy[i] = gauss();
  }
  // Same disorder at every temperature, only faster: σ ∝ √T. Normalise each component so that
  // the sample's Σvₓ² is exactly Nσ²: then the pressure is exactly proportional to N and T.
  const sigma = SIGMA0 * Math.sqrt(tK / T0);
  for (const v of [g.vx, g.vy]) {
    let s2 = 0;
    for (let i = 0; i < n; i++) s2 += v[i] * v[i];
    const k = sigma * Math.sqrt(n / s2);
    for (let i = 0; i < n; i++) v[i] *= k;
  }
  return g;
}

/** Position of molecule i at time t (px, centre, inside the box drawn from 0). */
export function position(g: Gas, i: number, t: number): [number, number] {
  return [R_MOL + fold(g.x0[i] + g.vx[i] * t, LX), R_MOL + fold(g.y0[i] + g.vy[i] * t, LY)];
}

/** Hits of molecule i on the right wall in (t1, t2]: the unfolded x passes L, 3L, 5L… */
export function hitsBetween(g: Gas, i: number, t1: number, t2: number): number {
  const a = g.x0[i] + g.vx[i] * t1;
  const b = g.x0[i] + g.vx[i] * t2;
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  // right-wall crossings are at u = (2k + 1)L
  return Math.floor((hi + LX) / (2 * LX)) - Math.floor((lo + LX) / (2 * LX));
}

/** Times of molecule i's hits on the right wall in (t1, t2]. */
export function hitTimes(g: Gas, i: number, t1: number, t2: number): number[] {
  const v = g.vx[i];
  if (v === 0) return [];
  const out: number[] = [];
  const a = g.x0[i] + v * t1;
  const b = g.x0[i] + v * t2;
  const k1 = Math.ceil((Math.min(a, b) - LX) / (2 * LX));
  const k2 = Math.floor((Math.max(a, b) - LX) / (2 * LX));
  for (let k = k1; k <= k2; k++) {
    const t = ((2 * k + 1) * LX - g.x0[i]) / v;
    if (t > t1 && t <= t2) out.push(t);
  }
  return out;
}

/** Impulse given to the right wall in (0, t], molecule mass 1: Σ 2|vₓ| per hit. */
export function impulse(g: Gas, t: number): number {
  let j = 0;
  for (let i = 0; i < g.n; i++) j += 2 * Math.abs(g.vx[i]) * hitsBetween(g, i, 0, t);
  return j;
}

/** Long-run force on the wall: each molecule hits every 2L/|vₓ| with 2|vₓ| → vₓ²/L. */
export function meanForce(g: Gas): number {
  let f = 0;
  for (let i = 0; i < g.n; i++) f += (g.vx[i] * g.vx[i]) / LX;
  return f;
}

/** p₀'s force: N₀ molecules at T₀ — exactly N₀σ₀²/L by the normalisation. */
export const F0 = (N0 * SIGMA0 * SIGMA0) / LX;

/** Measured pressure in p₀: impulse over time (the wall length is the same for every run). */
export function measured(g: Gas, t: number): number {
  return t > 0 ? impulse(g, t) / t / F0 : 0;
}

/** The ideal-gas value p = nkT in p₀. */
export function expected(n: number, tK: number): number {
  return (n / N0) * (tK / T0);
}

/** Total kinetic energy (mass 1): constant, since walls reflect without loss. */
export function energy(g: Gas): number {
  let e = 0;
  for (let i = 0; i < g.n; i++) e += (g.vx[i] * g.vx[i] + g.vy[i] * g.vy[i]) / 2;
  return e;
}

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

/** One decimal with a Russian comma. */
const ru1 = (n: number) => (Math.round(n * 10) / 10).toFixed(1).replace('.', ',');

const clamp = (v: number, r: { min: number; max: number; step: number }) =>
  Math.min(r.max, Math.max(r.min, Math.round(v / r.step) * r.step));

// Layout of the SVG: the box at (4, 4), the pressure bar below it.
const BAR = { x: 34, y: BOX.h + 26, w: 320, h: 14 };
const barX = (p: number) => BAR.x + (Math.min(p, P_MAX) / P_MAX) * BAR.w;

class GasSim extends HTMLElement {
  private nMol = N0;
  private tK = T0;
  private g!: Gas;
  private t = 0;
  private previous: number | null = null;
  private recent: [number, number][] = []; // [time, y] of hits still flashing
  private running = false;
  private frame = 0;
  private built = false;
  private mols: SVGCircleElement[] = [];
  private flashes!: SVGGElement;
  private bar!: SVGRectElement;
  private prevMark!: SVGLineElement;
  private go!: HTMLButtonElement;
  private outN!: HTMLOutputElement;
  private outT!: HTMLOutputElement;
  private readout!: HTMLElement;

  connectedCallback(): void {
    if (this.built) return;
    this.built = true;
    const n = Number(this.getAttribute('n') ?? N0);
    const t = Number(this.getAttribute('t') ?? T0);
    this.nMol = Number.isFinite(n) ? clamp(n, N_RANGE) : N0;
    this.tK = Number.isFinite(t) ? clamp(t, T_RANGE) : T0;
    this.replaceChildren(); // drop the no-JS fallback text
    this.classList.add('sim', 'gas');
    this.build();
    this.reset(false);
  }

  disconnectedCallback(): void {
    cancelAnimationFrame(this.frame);
  }

  private build(): void {
    const svg = el('svg', {
      viewBox: `0 0 ${BOX.w + 30} ${BAR.y + BAR.h + 24}`,
      class: 'sim-svg',
      role: 'img',
      'aria-label':
        'Сосуд с молекулами газа. Молекулы летают и ударяются о стенки; правая стенка — датчик: ' +
        'каждый удар о неё отмечен красной вспышкой. Под сосудом — полоска давления на эту стенку',
    });
    const g = el('g', { transform: 'translate(4 4)' });
    g.append(el('rect', { x: 0, y: 0, width: BOX.w, height: BOX.h, class: 'gas-box' }));
    g.append(el('line', { x1: BOX.w, y1: 0, x2: BOX.w, y2: BOX.h, class: 'gas-sensor' }));
    const mols = el('g', { class: 'gas-mols' });
    for (let i = 0; i < N_RANGE.max; i++) {
      const c = el('circle', { r: R_MOL });
      this.mols.push(c);
      mols.append(c);
    }
    this.flashes = el('g', { class: 'gas-hits' });
    g.append(mols, this.flashes);

    // the pressure bar, in p₀
    const bar = el('g', { class: 'gas-bar' });
    const label = el('text', { x: BAR.x - 8, y: BAR.y + BAR.h - 2, 'text-anchor': 'end', class: 'gas-p' });
    label.textContent = 'p';
    bar.append(label, el('rect', { x: BAR.x, y: BAR.y, width: BAR.w, height: BAR.h, class: 'gas-track' }));
    this.bar = el('rect', { x: BAR.x, y: BAR.y, width: 0, height: BAR.h, class: 'gas-fill' });
    bar.append(this.bar);
    for (let k = 1; k <= P_MAX; k++) {
      const x = barX(k);
      bar.append(el('line', { x1: x, y1: BAR.y + BAR.h, x2: x, y2: BAR.y + BAR.h + 5, class: 'gas-tick' }));
      const tx = el('text', { x, y: BAR.y + BAR.h + 17, 'text-anchor': 'middle', class: 'gas-tick-label' });
      tx.textContent = k === 1 ? 'p₀' : `${k}p₀`;
      bar.append(tx);
    }
    this.prevMark = el('line', { y1: BAR.y - 5, y2: BAR.y + BAR.h + 5, class: 'gas-previous' });
    bar.append(this.prevMark);
    g.append(bar);
    svg.append(g);

    const controls = document.createElement('div');
    controls.className = 'sim-controls';
    const slider = (
      html: string,
      r: { min: number; max: number; step: number },
      value: number,
      set: (v: number) => void,
    ): HTMLOutputElement => {
      const l = document.createElement('label');
      l.className = 'sim-slider';
      const name = document.createElement('span');
      name.innerHTML = html;
      const out = document.createElement('output');
      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(r.min);
      input.max = String(r.max);
      input.step = String(r.step);
      input.value = String(value);
      input.addEventListener('input', () => {
        set(Number(input.value));
        this.reset(true);
      });
      l.append(name, out, input);
      controls.append(l);
      return out;
    };
    this.outN = slider('Молекул в сосуде <i>N</i>', N_RANGE, this.nMol, (v) => (this.nMol = v));
    this.outT = slider('Температура <i>T</i>', T_RANGE, this.tK, (v) => (this.tK = v));

    const row = document.createElement('div');
    row.className = 'sim-row';
    this.go = document.createElement('button');
    this.go.type = 'button';
    this.go.className = 'btn small';
    this.go.addEventListener('click', () => this.run());
    const again = document.createElement('button');
    again.type = 'button';
    again.className = 'btn small ghost';
    again.textContent = 'Заново';
    again.addEventListener('click', () => this.reset(true));
    row.append(this.go, again);

    this.readout = document.createElement('p');
    this.readout.className = 'sim-readout';
    this.readout.setAttribute('aria-live', 'polite');
    this.append(svg, controls, row, this.readout);
  }

  /** New gas for the current sliders; keep the finished run's pressure as the mark. */
  private reset(keep: boolean): void {
    cancelAnimationFrame(this.frame);
    this.running = false;
    if (keep && this.t >= SETTLED) this.previous = measured(this.g, this.t);
    this.g = create(this.nMol, this.tK);
    this.t = 0;
    this.recent = [];
    this.outN.textContent = String(this.nMol);
    this.outT.textContent = `${this.tK} К (${this.tK - 273} °C)`.replace('-', '−');
    this.go.textContent = 'Пуск';
    this.draw();
    this.readout.innerHTML =
      `Нажми «Пуск»: модель сосчитает удары молекул о правую стенку и давление на неё. ` +
      `<i>p</i>₀ — давление при ${N0} молекулах и ${T0} К.`;
  }

  private reduced(): boolean {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  private moveTo(t: number): void {
    for (let i = 0; i < this.g.n; i++) {
      for (const th of hitTimes(this.g, i, this.t, t)) this.recent.push([th, position(this.g, i, th)[1]]);
    }
    this.t = t;
    this.recent = this.recent.filter(([th]) => th > t - FLASH);
  }

  private run(): void {
    if (this.reduced()) {
      if (this.t >= RUN - 1e-9) {
        this.reset(true);
        return;
      }
      this.moveTo(Math.min(RUN, this.t + STEP_REDUCED));
      this.go.textContent = this.t >= RUN - 1e-9 ? 'Сначала' : 'Дальше';
      this.draw();
      this.say();
      return;
    }
    if (this.running) {
      cancelAnimationFrame(this.frame);
      this.running = false;
      this.go.textContent = 'Дальше';
      return;
    }
    if (this.t >= RUN - 1e-9) this.reset(true);
    this.running = true;
    this.go.textContent = 'Пауза';
    let prev = performance.now();
    const tick = (now: number) => {
      const t = Math.min(RUN, this.t + Math.min(0.05, (now - prev) / 1000));
      prev = now;
      this.moveTo(t);
      this.draw();
      this.say();
      if (t >= RUN - 1e-9) {
        this.running = false;
        this.go.textContent = 'Пуск';
        return;
      }
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  private say(): void {
    const t = this.t;
    let hits = 0;
    for (let i = 0; i < this.g.n; i++) hits += hitsBetween(this.g, i, 0, t);
    const done = t >= RUN - 1e-9;
    const p = t >= SETTLED ? `${ru1(measured(this.g, t))} <i>p</i>₀` : 'считаем…';
    this.readout.innerHTML =
      `<i>t</i> = ${Math.floor(t)} с. Ударов о правую стенку: ${hits}, ` +
      `около ${Math.round(hits / t)} в секунду. Давление на неё: ${p}.` +
      (done ? ' Измени число молекул или температуру и запусти снова: пунктир — прошлый запуск.' : '');
  }

  private draw(): void {
    for (let i = 0; i < this.mols.length; i++) {
      const c = this.mols[i];
      if (i >= this.g.n) {
        c.style.display = 'none';
        continue;
      }
      c.style.display = '';
      const [x, y] = position(this.g, i, this.t);
      c.setAttribute('cx', x.toFixed(1));
      c.setAttribute('cy', y.toFixed(1));
    }
    this.flashes.replaceChildren(
      ...this.recent.map(([th, y]) => {
        const f = el('path', { d: `M${BOX.w + 2} ${y.toFixed(1)}h14m-5 -4l5 4l-5 4` });
        f.style.opacity = (1 - (this.t - th) / FLASH).toFixed(2);
        return f;
      }),
    );
    const p = this.t >= SETTLED ? measured(this.g, this.t) : 0;
    this.bar.setAttribute('width', (barX(p) - BAR.x).toFixed(1));
    if (this.previous === null) {
      this.prevMark.style.display = 'none';
    } else {
      const x = barX(this.previous).toFixed(1);
      this.prevMark.style.display = '';
      this.prevMark.setAttribute('x1', x);
      this.prevMark.setAttribute('x2', x);
    }
  }
}

if (!customElements.get('pp-gas')) customElements.define('pp-gas', GasSim);
