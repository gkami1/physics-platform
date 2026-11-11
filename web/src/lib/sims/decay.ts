// <pp-decay> — radioactive decay as chance. A grid of N₀ nuclei (accent dots) decays at random: a
// decayed nucleus becomes a hollow muted circle. Below, a live graph of the number left N(t) in this
// run (a step line in the text colour) against the law N₀·2^(−t/T) (dashed accent), with the first
// halvings at T, 2T, 3T marked. Sliders set the half-life T (1…10 с) and N₀ (10…1000); a third
// slider shows the moment t (0…20 с). Buttons: «Пуск»/«Пауза» and «Новый опыт» (other nuclei).
//
// The chance is exact and does not depend on the frame rate: each nucleus gets a seeded lifetime
// τ = T·s, s = −log₂(1 − u) with u uniform in [0, 1) (rng() from random.ts), so the probability to
// outlive t is P(s > t/T) = 2^(−t/T) — the law. N(t) counts the nuclei with τ > t. Changing T scales
// every lifetime; changing N₀ takes the first N₀ of the same 1000 draws. With few nuclei the steps
// scatter around the curve, with many they follow it: the law holds for large numbers.
//
// Without reduced motion the run plays in real time (1 с per second) once the model is on screen
// and stops at 20 с; dragging the moment slider pauses it. With reduced motion nothing runs: the
// moment stands at the end of the graph, so the still shows the whole run. Defaults by attributes
// `n0` and `half` (400 nuclei, T = 5 с without them); the lessons set 400 and 5 с (5.5) and 20 and
// 5 с (5.7), clear of their pages' tasks.
//
// Written into theory Markdown as plain HTML; the theory page imports this module only when such an
// element is present. Light DOM, site CSS variables: follows the light/dark theme.

import { rng } from './random';

const SVG_NS = 'http://www.w3.org/2000/svg';
const NBSP = '\u00a0';

export const HALF = { min: 1, max: 10, step: 1, start: 5 } as const; // с
export const N0S = [10, 20, 50, 100, 200, 400, 1000];
export const N0_START = 400;
export const T_END = 20; // с, the graph's width and the run's length
export const T_STEP = 0.1; // с, the moment slider's step
export const SEED = 20261404;
const MAX = 1000;

/** Lifetimes in units of T for run k: s = −log₂(1 − u), so P(s > x) = 2^(−x). */
export function lifetimes(run: number): number[] {
  const r = rng(SEED + 7919 * run);
  return Array.from({ length: MAX }, () => -Math.log2(1 - r()));
}

/** Nuclei left at t (с) out of the first n0, half-life T (с). */
export function remaining(s: number[], n0: number, t: number, T: number): number {
  let n = 0;
  for (let i = 0; i < n0; i++) if (s[i] * T > t) n++;
  return n;
}

/** The law: N₀·2^(−t/T). */
export function law(n0: number, t: number, T: number): number {
  return n0 * 2 ** (-t / T);
}

/** A number with a decimal comma, `digits` decimals kept, with «≈» when rounded. */
export function num(x: number, digits: number): string {
  const r = Number(x.toFixed(digits));
  const text = Math.abs(r).toFixed(digits).replace('.', ',');
  return Math.abs(r - x) > 1e-9 * Math.max(1, Math.abs(x)) ? `≈${NBSP}${text}` : text;
}

/** The moment on the slider's grid. */
export function snap(t: number): number {
  return Math.round(Math.min(Math.max(t, 0), T_END) / T_STEP) * T_STEP;
}

/** Table rows [name, value, main?] at moment t (on the slider's grid). */
export function readout(s: number[], n0: number, T: number, t: number): [string, string, boolean][] {
  const n = remaining(s, n0, t, T);
  return [
    ['Время t', `${num(t, 1)}${NBSP}с`, false],
    ['Прошло периодов t/T', num(t / T, 2), false],
    ['Не распалось N (опыт)', String(n), true],
    ['Распалось N₀ − N', String(n0 - n), false],
    ['Доля N/N₀ (опыт)', num(n / n0, 3), false],
    ['По закону N₀·2^(−t/T)', num(law(n0, t, T), 1), true],
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

/** The grid of nuclei in (bx, by, bw, bh); the graph: t = 0 at gx, T_END at gx + gw, N = 0 at gy,
 * N₀ at gy − gh. */
const S = { w: 400, h: 340, bx: 14, by: 8, bw: 372, bh: 112, gx: 56, gy: 312, gw: 312, gh: 150 };

/** Cell centres and a dot radius for n nuclei filling the box. */
export function grid(n: number): { pts: [number, number][]; r: number } {
  const cols = Math.ceil(Math.sqrt((n * S.bw) / S.bh));
  const rows = Math.ceil(n / cols);
  const cell = Math.min(S.bw / cols, S.bh / rows);
  const x0 = S.bx + (S.bw - cols * cell) / 2 + cell / 2;
  const y0 = S.by + (S.bh - rows * cell) / 2 + cell / 2;
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) pts.push([x0 + (i % cols) * cell, y0 + Math.floor(i / cols) * cell]);
  return { pts, r: Math.min(cell * 0.36, 10) };
}

class DecaySim extends HTMLElement {
  private half: number = HALF.start;
  private n0 = N0_START;
  private run = 0;
  private s: number[] = [];
  private t = 0;
  private running = false;
  private frame = 0;
  private last = 0;
  private visible = false;
  private still = false; // prefers reduced motion: nothing runs by itself
  private built = false;
  private observer: IntersectionObserver | null = null;
  private dots: SVGCircleElement[] = [];
  private nuclei!: SVGGElement;
  private plot!: SVGGElement;
  private play: HTMLButtonElement | null = null;
  private sliders: { out: HTMLOutputElement; input: HTMLInputElement }[] = [];
  private table!: HTMLTableSectionElement;

  connectedCallback(): void {
    if (this.built) return;
    this.built = true;
    this.still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const n0 = Number(this.getAttribute('n0'));
    const half = Number(this.getAttribute('half'));
    if (N0S.includes(n0)) this.n0 = n0;
    if (Number.isInteger(half) && half >= HALF.min && half <= HALF.max) this.half = half;
    this.s = lifetimes(this.run);
    this.t = this.still ? T_END : 0;
    this.running = !this.still;
    this.replaceChildren(); // drop the no-JS fallback text
    this.classList.add('sim', 'dec');
    this.build();
    this.layout();
    this.update();
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
      this.update();
    });
    this.sliders.push({ out, input });
    label.append(span, out, input);
    return label;
  }

  private build(): void {
    const top = document.createElement('div');
    top.className = 'dec-top';
    if (!this.still) {
      this.play = this.button('Пауза', () => {
        this.running = !this.running;
        if (this.running) {
          if (this.t >= T_END) this.t = 0;
          if (this.visible) this.start();
        } else cancelAnimationFrame(this.frame);
        this.update();
      });
      top.append(this.play);
    }
    top.append(
      this.button('Новый опыт', () => {
        this.run += 1;
        this.s = lifetimes(this.run);
        if (!this.still) {
          this.t = 0;
          this.running = true;
          if (this.visible) this.start();
        }
        this.update();
      }),
    );

    const svg = el('svg', {
      viewBox: `0 0 ${S.w} ${S.h}`,
      class: 'sim-svg',
      role: 'img',
      'aria-label':
        'Модель распада: вверху сетка ядер, нераспавшиеся — закрашенные точки, распавшиеся — пустые ' +
        'кружки. Внизу график числа нераспавшихся ядер от времени: ступеньки — этот опыт, пунктир — ' +
        'закон N₀·2^(−t/T)',
    });
    this.nuclei = el('g');
    this.plot = el('g');
    svg.append(this.nuclei, this.plot);

    const controls = document.createElement('div');
    controls.className = 'sim-controls';
    controls.append(
      this.slider('Период полураспада T', HALF.max - HALF.min, (v) => (this.half = HALF.min + v)),
      this.slider('Ядер вначале N₀', N0S.length - 1, (v) => {
        this.n0 = N0S[v] ?? N0_START;
        this.layout();
      }),
      this.slider('Момент времени t', Math.round(T_END / T_STEP), (v) => {
        this.running = false;
        cancelAnimationFrame(this.frame);
        this.t = v * T_STEP;
      }),
    );

    const table = document.createElement('table');
    table.className = 'dec-table';
    this.table = document.createElement('tbody');
    table.append(this.table);
    this.append(top, svg, controls, table);
  }

  /** The grid of nuclei for the current N₀. */
  private layout(): void {
    const { pts, r } = grid(this.n0);
    this.dots = pts.map(([x, y]) => el('circle', { cx: f1(x), cy: f1(y), r: f1(r) }));
    this.nuclei.replaceChildren(...this.dots);
  }

  private start(): void {
    cancelAnimationFrame(this.frame);
    this.last = performance.now();
    const tick = (now: number) => {
      // a hidden tab must not jump; the first frame may be stamped before start()
      const dt = Math.max(0, Math.min((now - this.last) / 1000, 0.1));
      this.last = now;
      this.t = Math.min(this.t + dt, T_END);
      if (this.t >= T_END) this.running = false;
      this.update();
      if (this.running && this.visible) this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  private update(): void {
    const t = snap(this.t);
    const T = this.half;
    if (this.play) this.play.textContent = this.running ? 'Пауза' : 'Пуск';
    const values = [this.half - HALF.min, N0S.indexOf(this.n0), Math.round(t / T_STEP)];
    const shown = [`${T}${NBSP}с`, String(this.n0), `${num(t, 1)}${NBSP}с`];
    this.sliders.forEach(({ out, input }, i) => {
      input.value = String(values[i]);
      out.textContent = shown[i];
    });
    this.dots.forEach((d, i) => d.setAttribute('class', this.s[i] * T > t ? 'dec-alive' : 'dec-gone'));
    this.table.replaceChildren(
      ...readout(this.s, this.n0, T, t).map(([name, value, main]) => {
        const tr = document.createElement('tr');
        if (main) tr.className = 'dec-main';
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
    return el('text', { x: f1(x), y: f1(y), 'text-anchor': anchor, class: `dec-label ${cls}` }, s);
  }

  private draw(t: number): void {
    const { gx, gy, gw, gh } = S;
    const T = this.half;
    const n0 = this.n0;
    const X = (v: number): number => gx + (v / T_END) * gw;
    const Y = (v: number): number => gy - (v / n0) * gh;
    const parts: SVGElement[] = [];
    // axes
    parts.push(el('path', { d: `M${gx} ${gy}H${gx + gw + 14}`, class: 'dec-axis' }));
    parts.push(el('path', { d: `M${gx + gw + 20} ${gy}l-9 -4v8z`, class: 'dec-axis-tip' }));
    parts.push(el('path', { d: `M${gx} ${gy}V${gy - gh - 14}`, class: 'dec-axis' }));
    parts.push(el('path', { d: `M${gx} ${gy - gh - 20}l-4 9h8z`, class: 'dec-axis-tip' }));
    parts.push(this.text(gx + gw + 18, gy + 17, 't, с', 'end'));
    parts.push(this.text(gx + 9, gy - gh - 8, 'N', 'start'));
    for (const v of [0, 5, 10, 15, 20]) {
      if (v) parts.push(el('path', { d: `M${f1(X(v))} ${gy}v4`, class: 'dec-axis' }));
      parts.push(this.text(X(v), gy + 17, String(v), 'middle', 'dec-small'));
    }
    // halvings on the law: N₀/2, N₀/4, N₀/8 at T, 2T, 3T
    const ys: [number, string][] = [[n0, 'N₀']];
    for (let k = 1; k <= 3; k++) {
      const x = k * T;
      const y = n0 / 2 ** k;
      ys.push([y, `N₀/${2 ** k}`]);
      if (x > T_END) continue;
      parts.push(el('path', { d: `M${gx} ${f1(Y(y))}H${f1(X(x))}V${gy}`, class: 'dec-guide' }));
    }
    for (const [y, s] of ys) {
      parts.push(el('path', { d: `M${gx - 4} ${f1(Y(y))}h4`, class: 'dec-axis' }));
      parts.push(this.text(gx - 7, Y(y) + 4, s, 'end', 'dec-small'));
    }
    // the law, dashed accent
    const lawPts: string[] = [];
    for (let k = 0; k <= 200; k++) {
      const v = (T_END * k) / 200;
      lawPts.push(`${f1(X(v))} ${f1(Y(law(n0, v, T)))}`);
    }
    parts.push(el('path', { d: `M${lawPts.join('L')}`, class: 'dec-law' }));
    // this run up to t: a step line
    const times = this.s
      .slice(0, n0)
      .map((v) => v * T)
      .filter((v) => v <= t)
      .sort((p, q) => p - q);
    let n = n0;
    let d = `M${gx} ${f1(Y(n0))}`;
    for (const v of times) {
      n -= 1;
      d += `H${f1(X(v))}V${f1(Y(n))}`;
    }
    d += `H${f1(X(t))}`;
    parts.push(el('path', { d, class: 'dec-run' }));
    parts.push(el('circle', { cx: f1(X(t)), cy: f1(Y(n)), r: 4, class: 'dec-dot' }));
    // legend
    const lx = gx + gw - 100;
    const ly = gy - gh + 2;
    parts.push(el('path', { d: `M${lx} ${ly}h22`, class: 'dec-run' }));
    parts.push(this.text(lx + 28, ly + 4, 'опыт', 'start', 'dec-small'));
    parts.push(el('path', { d: `M${lx} ${ly + 18}h22`, class: 'dec-law' }));
    parts.push(this.text(lx + 28, ly + 22, 'закон', 'start', 'dec-small dec-accent'));
    this.plot.replaceChildren(...parts);
  }
}

if (!customElements.get('pp-decay')) customElements.define('pp-decay', DecaySim);
