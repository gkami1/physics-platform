// <pp-brownian t="20"> — Brownian motion. A large particle (accent) floats among small molecules
// that fly in straight lines and bounce off the walls and off the particle. Every hit pushes the
// particle a little; hits from different sides do not balance, so it jerks about. Its position is
// marked every half second and the marks are joined by straight lines, as Perrin drew them.
// «Молекулы: не видны» hides the molecules, as in a microscope: the particle still jerks, and the
// reason is no longer visible. The temperature slider scales every molecular speed by √(T/293 К):
// the same disorder, only faster.
//
// The motion is seeded-deterministic: one fixed seed for the start, a fixed step of 1/240 с, exact
// elastic collisions of discs (molecules with the particle and with the walls; molecules do not
// collide with each other here, which does not change the picture of the hits). The model is
// slowed enormously: the readout gives the real mean speed of air molecules. With reduced motion
// every press moves on by two seconds (four new marks) instead of animating.
//
// Written into theory Markdown as plain HTML; the theory page imports this module only when such
// an element is present. Light DOM, site CSS variables: follows the light/dark theme.

import { gaussian, rng } from './random';

const SVG_NS = 'http://www.w3.org/2000/svg';

export const BOX = { w: 400, h: 240 }; // px, the vessel
export const N = 240; // molecules
export const R_MOL = 2; // px
export const R_BIG = 12; // px
export const MASS_RATIO = 8; // particle mass / molecule mass
export const V0 = 150; // px/s, mean molecular speed at 20 °C in the model
export const H = 1 / 240; // с, fixed step
export const MARK_DT = 0.5; // с between marks of the trace
export const RUN = 30; // с, a run
export const SEED = 20261106;
const T_RANGE = { min: -100, max: 500, step: 20 }; // °C
const STEP_REDUCED = 2; // с per press with reduced motion

/** Molecular speeds scale as √T: the factor relative to 20 °C. */
export function speedScale(tC: number): number {
  return Math.sqrt((tC + 273) / 293);
}

/** Real mean speed of air molecules, м/с: √(8RT/πM), M = 0,029 кг/моль. */
export function meanSpeedAir(tC: number): number {
  return Math.sqrt((8 * 8.31 * (tC + 273)) / (Math.PI * 0.029));
}

export interface State {
  k: number; // steps done; t = k·H
  x: Float64Array;
  y: Float64Array;
  vx: Float64Array;
  vy: Float64Array;
  X: number;
  Y: number;
  VX: number;
  VY: number;
  hits: number;
}

/** Start: the particle at rest in the middle, molecules scattered with 2D Maxwell velocities. */
export function create(tC: number, seed = SEED): State {
  const r = rng(seed);
  const gauss = gaussian(r);
  // mean speed of a 2D Maxwell distribution is σ√(π/2)
  const sigma = (V0 * speedScale(tC)) / Math.sqrt(Math.PI / 2);
  const s: State = {
    k: 0,
    x: new Float64Array(N),
    y: new Float64Array(N),
    vx: new Float64Array(N),
    vy: new Float64Array(N),
    X: BOX.w / 2,
    Y: BOX.h / 2,
    VX: 0,
    VY: 0,
    hits: 0,
  };
  for (let i = 0; i < N; i++) {
    let x = 0;
    let y = 0;
    do {
      x = R_MOL + r() * (BOX.w - 2 * R_MOL);
      y = R_MOL + r() * (BOX.h - 2 * R_MOL);
    } while (Math.hypot(x - s.X, y - s.Y) < R_BIG + R_MOL + 4);
    s.x[i] = x;
    s.y[i] = y;
    s.vx[i] = sigma * gauss();
    s.vy[i] = sigma * gauss();
  }
  return s;
}

function bounce(p: number, v: number, lo: number, hi: number): [number, number] {
  if (p < lo) return [2 * lo - p, Math.abs(v)];
  if (p > hi) return [2 * hi - p, -Math.abs(v)];
  return [p, v];
}

/** One fixed step: move, bounce off the walls, elastic hits of molecules on the particle. */
export function step(s: State): void {
  const m = 1;
  const M = MASS_RATIO;
  const touch = R_BIG + R_MOL;
  for (let i = 0; i < N; i++) {
    [s.x[i], s.vx[i]] = bounce(s.x[i] + s.vx[i] * H, s.vx[i], R_MOL, BOX.w - R_MOL);
    [s.y[i], s.vy[i]] = bounce(s.y[i] + s.vy[i] * H, s.vy[i], R_MOL, BOX.h - R_MOL);
  }
  [s.X, s.VX] = bounce(s.X + s.VX * H, s.VX, R_BIG, BOX.w - R_BIG);
  [s.Y, s.VY] = bounce(s.Y + s.VY * H, s.VY, R_BIG, BOX.h - R_BIG);
  for (let i = 0; i < N; i++) {
    const dx = s.x[i] - s.X;
    const dy = s.y[i] - s.Y;
    const d2 = dx * dx + dy * dy;
    if (d2 >= touch * touch || d2 === 0) continue;
    const d = Math.sqrt(d2);
    const nx = dx / d;
    const ny = dy / d;
    const vn = (s.vx[i] - s.VX) * nx + (s.vy[i] - s.VY) * ny;
    if (vn >= 0) continue; // already separating
    const j = ((2 * m * M) / (m + M)) * vn; // impulse along the line of centres
    s.vx[i] -= (j / m) * nx;
    s.vy[i] -= (j / m) * ny;
    s.VX += (j / M) * nx;
    s.VY += (j / M) * ny;
    s.hits += 1;
  }
  s.k += 1;
}

/** Advance to time t (с) in whole fixed steps, so the result does not depend on the frame rate. */
export function advanceTo(s: State, t: number): void {
  const target = Math.round(t / H);
  while (s.k < target) step(s);
}

/** Total kinetic energy in model units (conserved by every step). */
export function energy(s: State): number {
  let e = (MASS_RATIO * (s.VX * s.VX + s.VY * s.VY)) / 2;
  for (let i = 0; i < N; i++) e += (s.vx[i] * s.vx[i] + s.vy[i] * s.vy[i]) / 2;
  return e;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

/** Russian signed integer: real minus. */
const ruInt = (n: number) => String(Math.round(n)).replace('-', '−');

let instances = 0;

class BrownianSim extends HTMLElement {
  private tC = 20;
  private show = true;
  private s!: State;
  private marks: [number, number][] = [];
  private running = false;
  private frame = 0;
  private built = false;
  private mols: SVGCircleElement[] = [];
  private molLayer!: SVGGElement;
  private big!: SVGCircleElement;
  private trace!: SVGPolylineElement;
  private dots!: SVGGElement;
  private go!: HTMLButtonElement;
  private out!: HTMLOutputElement;
  private readout!: HTMLElement;

  connectedCallback(): void {
    if (this.built) return;
    this.built = true;
    const t = Number(this.getAttribute('t') ?? 20);
    this.tC = Number.isFinite(t)
      ? Math.min(T_RANGE.max, Math.max(T_RANGE.min, Math.round(t / T_RANGE.step) * T_RANGE.step))
      : 20;
    this.show = this.getAttribute('molecules') !== 'hidden';
    this.replaceChildren(); // drop the no-JS fallback text
    this.classList.add('sim', 'brn');
    this.build();
    this.reset();
  }

  disconnectedCallback(): void {
    cancelAnimationFrame(this.frame);
  }

  private build(): void {
    const svg = el('svg', {
      viewBox: `0 0 ${BOX.w + 8} ${BOX.h + 8}`,
      class: 'sim-svg',
      role: 'img',
      'aria-label':
        'Сосуд с молекулами и одной крупной частицей. Молекулы ударяют частицу со всех сторон, ' +
        'и она беспорядочно дёргается; её положения через каждые полсекунды соединены линиями',
    });
    const g = el('g', { transform: 'translate(4 4)' });
    g.append(el('rect', { x: 0, y: 0, width: BOX.w, height: BOX.h, class: 'brn-box' }));
    this.molLayer = el('g', { class: 'brn-mols' });
    for (let i = 0; i < N; i++) {
      const c = el('circle', { r: R_MOL });
      this.mols.push(c);
      this.molLayer.append(c);
    }
    this.trace = el('polyline', { class: 'brn-trace' });
    this.dots = el('g', { class: 'brn-dots' });
    this.big = el('circle', { r: R_BIG, class: 'brn-big' });
    g.append(this.molLayer, this.trace, this.dots, this.big);
    svg.append(g);

    const controls = document.createElement('div');
    controls.className = 'sim-controls';
    const label = document.createElement('label');
    label.className = 'sim-slider';
    const name = document.createElement('span');
    name.innerHTML = 'Температура <i>t</i>';
    this.out = document.createElement('output');
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(T_RANGE.min);
    input.max = String(T_RANGE.max);
    input.step = String(T_RANGE.step);
    input.value = String(this.tC);
    input.addEventListener('input', () => {
      this.tC = round3(Number(input.value));
      this.reset();
    });
    label.append(name, this.out, input);
    controls.append(label);

    const id = ++instances;
    const box = document.createElement('fieldset');
    box.className = 'pfx-chips brn-chips';
    const legend = document.createElement('legend');
    legend.textContent = 'Молекулы';
    box.append(legend);
    for (const [key, text] of [
      ['shown', 'видны'],
      ['hidden', 'не видны, как в микроскоп'],
    ] as const) {
      const l = document.createElement('label');
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = `brn-mols-${id}`;
      radio.value = key;
      radio.checked = (key === 'shown') === this.show;
      radio.addEventListener('change', () => {
        this.show = key === 'shown';
        this.molLayer.style.display = this.show ? '' : 'none';
      });
      const span = document.createElement('span');
      span.textContent = text;
      l.append(radio, span);
      box.append(l);
    }

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
    again.addEventListener('click', () => this.reset());
    row.append(this.go, again);

    this.readout = document.createElement('p');
    this.readout.className = 'sim-readout';
    this.readout.setAttribute('aria-live', 'polite');
    this.append(svg, controls, box, row, this.readout);
  }

  private reset(): void {
    cancelAnimationFrame(this.frame);
    this.running = false;
    this.s = create(this.tC);
    this.marks = [[this.s.X, this.s.Y]];
    this.out.textContent = `${ruInt(this.tC)} °C`;
    this.molLayer.style.display = this.show ? '' : 'none';
    this.go.textContent = 'Пуск';
    this.draw();
    this.readout.innerHTML =
      `При ${ruInt(this.tC)} °C молекулы воздуха летают в среднем со скоростью около ` +
      `${ruInt(Math.round(meanSpeedAir(this.tC) / 10) * 10)} м/с. В модели всё сильно замедлено. ` +
      'Нажми «Пуск».';
  }

  private reduced(): boolean {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  private t(): number {
    return this.s.k * H;
  }

  /** Advance to time t, recording a mark every MARK_DT. */
  private moveTo(t: number): void {
    let next = this.marks.length * MARK_DT;
    while (next <= t + 1e-9) {
      advanceTo(this.s, next);
      this.marks.push([this.s.X, this.s.Y]);
      next = this.marks.length * MARK_DT;
    }
    advanceTo(this.s, t);
  }

  private run(): void {
    if (this.reduced()) {
      if (this.t() >= RUN - 1e-9) {
        this.reset();
        return;
      }
      this.moveTo(Math.min(RUN, this.t() + STEP_REDUCED));
      this.go.textContent = this.t() >= RUN - 1e-9 ? 'Сначала' : 'Дальше';
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
    if (this.t() >= RUN - 1e-9) this.reset();
    this.running = true;
    this.go.textContent = 'Пауза';
    let prev = performance.now();
    const tick = (now: number) => {
      const t = Math.min(RUN, this.t() + Math.min(0.05, (now - prev) / 1000));
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
    const t = this.t();
    let text = `<i>t</i> = ${Math.floor(t)} с, отмечено положений: ${this.marks.length}. `;
    text += this.show
      ? 'Удары молекул с разных сторон не уравновешивают друг друга — частицу толкает то туда, то сюда.'
      : 'Молекул не видно, а частица всё равно дёргается: так броуновское движение выглядит в микроскоп.';
    this.readout.innerHTML = text;
  }

  private draw(): void {
    const s = this.s;
    for (let i = 0; i < N; i++) {
      this.mols[i].setAttribute('cx', s.x[i].toFixed(1));
      this.mols[i].setAttribute('cy', s.y[i].toFixed(1));
    }
    this.big.setAttribute('cx', s.X.toFixed(1));
    this.big.setAttribute('cy', s.Y.toFixed(1));
    this.trace.setAttribute('points', this.marks.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' '));
    if (this.dots.childElementCount !== this.marks.length) {
      this.dots.replaceChildren(
        ...this.marks.map(([x, y]) => el('circle', { cx: x.toFixed(1), cy: y.toFixed(1), r: 2.2 })),
      );
    }
  }
}

if (!customElements.get('pp-brownian')) customElements.define('pp-brownian', BrownianSim);
