// <pp-heat> — ice on a heater. A vessel holds m кг of ice at −30 °C on a heater of constant power N
// (sliders: 0,1…0,5 кг and 200…1000 Вт); all the heat goes into the vessel's contents. «Пуск» runs
// 10 minutes of heating, 30 times faster than real time. Four stages, one after another: the ice
// warms to 0 °C (c_л m Δt), melts at 0 °C (λm), the water warms to 100 °C (c_в m Δt) and boils at
// 100 °C (Lm; the vessel is open and the vapour leaves). A live graph t(τ) with the whole curve for
// the current m and N dashed and the travelled part accent; four bars show the heat each stage
// needs (outline) and how much it has got (filled).
//
// The physics is exact and piecewise-linear: after time τ the contents have got Q = Nτ, and the
// state is a closed-form function of Q (stateAt), so nothing depends on the frame rate. With
// reduced motion «Пуск» does not animate: each press jumps to the next stage boundary.
//
// Written into theory Markdown as plain HTML; the theory page imports this module only when such
// an element is present. Light DOM, site CSS variables: follows the light/dark theme. Colours as in
// the topic's figures: heat accent, liquid water an accent tint with an accent surface, ice the
// surface fill with a text-colour outline, the heater muted.

const SVG_NS = 'http://www.w3.org/2000/svg';

export const C_ICE = 2100; // Дж/(кг·°C)
export const C_WATER = 4200;
export const LAMBDA = 3.3e5; // Дж/кг
export const L_VAP = 2.3e6; // Дж/кг
export const T_START = -30; // °C
export const T_END = 600; // с of heating shown
export const M_RANGE: [number, number] = [0.1, 0.5]; // кг
export const N_RANGE: [number, number] = [200, 1000]; // Вт
export const START = { m: 0.25, N: 400 };
const SPEED = 30; // simulated seconds per real second

export type Stage = 'ice' | 'melt' | 'water' | 'boil' | 'gone';
export const STAGES: Exclude<Stage, 'gone'>[] = ['ice', 'melt', 'water', 'boil'];

/** Heat each stage needs for m кг, Дж: ice to 0 °C, melting, water to 100 °C, boiling away. */
export function needs(m: number): Record<Exclude<Stage, 'gone'>, number> {
  return {
    ice: C_ICE * m * (0 - T_START),
    melt: LAMBDA * m,
    water: C_WATER * m * 100,
    boil: L_VAP * m,
  };
}

/** Heat received by the end of each stage, Дж. */
export function bounds(m: number): number[] {
  const n = needs(m);
  let sum = 0;
  return STAGES.map((s) => (sum += n[s]));
}

export interface HeatState {
  Q: number; // Дж received
  stage: Stage;
  t: number; // °C
  ice: number; // кг
  water: number; // кг (liquid)
  boiled: number; // кг gone as vapour
  got: Record<Exclude<Stage, 'gone'>, number>; // Дж received in each stage
}

/** The state after the contents have received Q Дж. A boundary belongs to the next stage. */
export function stateAt(Q: number, m: number): HeatState {
  const n = needs(m);
  const [b1, b2, b3, b4] = bounds(m);
  const got = {
    ice: Math.min(Q, b1),
    melt: Math.max(0, Math.min(Q, b2) - b1),
    water: Math.max(0, Math.min(Q, b3) - b2),
    boil: Math.max(0, Math.min(Q, b4) - b3),
  };
  if (Q < b1) return { Q, stage: 'ice', t: T_START + Q / (C_ICE * m), ice: m, water: 0, boiled: 0, got };
  if (Q < b2) {
    const melted = (Q - b1) / LAMBDA;
    return { Q, stage: 'melt', t: 0, ice: m - melted, water: melted, boiled: 0, got };
  }
  if (Q < b3) return { Q, stage: 'water', t: (Q - b2) / (C_WATER * m), ice: 0, water: m, boiled: 0, got };
  if (Q < b4) {
    const boiled = (Q - b3) / L_VAP;
    return { Q, stage: 'boil', t: 100, ice: 0, water: m - boiled, boiled, got };
  }
  got.boil = n.boil;
  return { Q, stage: 'gone', t: 100, ice: 0, water: 0, boiled: m, got };
}

/** The next moment, с, after τ at which a stage ends (or the shown time runs out). */
export function nextEvent(tau: number, m: number, N: number): number {
  for (const b of bounds(m)) {
    const at = b / N;
    if (at > tau + 1e-9) return Math.min(at, T_END);
  }
  return T_END;
}

/** Corners of the curve t(τ) from 0 to T_END с, for drawing. */
export function curve(m: number, N: number): [number, number][] {
  const pts: [number, number][] = [[0, T_START]];
  for (const b of bounds(m)) {
    const at = b / N;
    if (at >= T_END) break;
    pts.push([at, stateAt(b, m).t]);
  }
  const end = Math.min(T_END, bounds(m)[3] / N);
  pts.push([end, stateAt(end * N, m).t]);
  return pts;
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

const ru = (n: number, d: number) => n.toFixed(d).replace('.', ',').replace('-', '−');
/** Temperature for the readout: one decimal, rounded down, so a warming body never reads the
 * temperature of the next stage (99,96 °C is «99,9», −0,04 °C is «−0,1») before it gets there. */
export const tShow = (t: number): string => ru(Math.floor(t * 10 + 1e-9) / 10, 1);
/** Keep a number with its unit on one line in the readout. */
const nbsp = (s: string) => s.replace(/(\d) (°C|г|с|кДж|Дж)(?=[\s.,:]|$)/g, '$1 $2');
const kJ = (q: number) => ru(q / 1000, q < 10000 ? 2 : 1);

// Layout
const VES = { x: 22, w: 76, bottom: 172, top: 52 };
const MASS_PX = 190; // px of height per кг (water and ice alike)
const G = { ox: 176, oy0: 148, w: 210, kx: 210 / T_END, ky: 1.1 }; // oy0: the 0 °C level
const BAR = { x: 132, y: 210, w: 150, h: 12, gap: 20 };
const NAMES: Record<Exclude<Stage, 'gone'>, string> = {
  ice: 'лёд греется',
  melt: 'лёд тает',
  water: 'вода греется',
  boil: 'вода кипит',
};

class HeatSim extends HTMLElement {
  private m = START.m;
  private N = START.N;
  private tau = 0;
  private running = false;
  private frame = 0;
  private built = false;
  private water!: SVGRectElement;
  private surface!: SVGLineElement;
  private ice!: SVGRectElement;
  private bubbles!: SVGGElement;
  private flow!: SVGGElement;
  private preview!: SVGPolylineElement;
  private trace!: SVGPolylineElement;
  private dot!: SVGCircleElement;
  private bars: { need: SVGRectElement; got: SVGRectElement; val: SVGTextElement }[] = [];
  private mInput!: HTMLInputElement;
  private nInput!: HTMLInputElement;
  private mOut!: HTMLOutputElement;
  private nOut!: HTMLOutputElement;
  private go!: HTMLButtonElement;
  private readout!: HTMLElement;

  connectedCallback(): void {
    if (this.built) return;
    this.built = true;
    this.replaceChildren(); // drop the no-JS fallback text
    this.classList.add('sim', 'heat');
    this.build();
    this.reset();
  }

  disconnectedCallback(): void {
    cancelAnimationFrame(this.frame);
  }

  private gx(tau: number): number {
    return G.ox + tau * G.kx;
  }

  private gy(t: number): number {
    return G.oy0 - t * G.ky;
  }

  private build(): void {
    const svg = el('svg', {
      viewBox: '0 0 400 296',
      class: 'sim-svg',
      role: 'img',
      'aria-label':
        'Сосуд со льдом на нагревателе, график температуры от времени и полосы: сколько теплоты ' +
        'нужно каждому этапу — нагреву льда, плавлению, нагреву воды и кипению — и сколько он уже получил',
    });

    // the vessel on its heater
    const v = el('g', { class: 'heat-vessel' });
    this.water = el('rect', { x: VES.x + 1, width: VES.w - 2, class: 'heat-water' });
    this.surface = el('line', { x1: VES.x + 1, x2: VES.x + VES.w - 1, class: 'heat-surface' });
    this.ice = el('rect', { x: VES.x + 6, width: VES.w - 12, rx: 3, class: 'heat-ice' });
    this.bubbles = el('g', { class: 'heat-bubbles' });
    for (const [bx, by, r] of [[38, 12, 3], [58, 26, 4], [78, 10, 3], [48, 40, 2.5], [70, 46, 3]]) {
      this.bubbles.append(el('circle', { cx: bx, cy: by, r, 'data-dy': by }));
    }
    this.flow = el('g', { class: 'heat-flow' });
    for (const x of [44, 60, 76]) {
      this.flow.append(
        el('line', { x1: x, x2: x, y1: VES.bottom + 22, y2: VES.bottom + 8 }),
        el('path', { d: `M${x - 4} ${VES.bottom + 10}l4 -7l4 7z` }),
      );
    }
    v.append(
      this.water,
      this.surface,
      this.ice,
      this.bubbles,
      el('path', { d: `M${VES.x} ${VES.top}V${VES.bottom}H${VES.x + VES.w}V${VES.top}`, class: 'heat-walls' }),
      el('rect', { x: VES.x - 8, y: VES.bottom + 22, width: VES.w + 16, height: 9, rx: 2, class: 'heat-plate' }),
      this.flow,
    );
    svg.append(v);

    // the graph t(τ)
    const g = el('g', { class: 'sim-grid heat-axes' });
    const top = this.gy(110);
    const bottom = this.gy(-40);
    g.append(
      el('path', { d: `M${G.ox} ${G.oy0}H${G.ox + G.w + 8}M${G.ox} ${bottom}V${top}`, class: 'heat-axis' }),
      el('path', {
        d: `M${G.ox + G.w + 12} ${G.oy0}l-8 -3.5v7zM${G.ox} ${top - 4}l-3.5 8h7z`,
        class: 'heat-axis-head',
      }),
      el('line', { x1: G.ox, x2: this.gx(T_END), y1: this.gy(100), y2: this.gy(100), class: 'heat-guide' }),
    );
    for (const min of [2, 4, 6, 8, 10]) {
      const x = this.gx(min * 60);
      g.append(el('line', { x1: x, x2: x, y1: G.oy0, y2: G.oy0 + 4 }));
      g.append(el('text', { x, y: G.oy0 + 15, 'text-anchor': 'middle' }, String(min)));
    }
    for (const t of [-20, 50, 100]) {
      const y = this.gy(t);
      g.append(el('line', { x1: G.ox - 4, x2: G.ox, y1: y, y2: y }));
      g.append(el('text', { x: G.ox - 6, y: y + 4, 'text-anchor': 'end' }, ru(t, 0)));
    }
    g.append(el('text', { x: G.ox - 6, y: G.oy0 + 4, 'text-anchor': 'end' }, '0'));
    const xname = el('text', { x: G.ox + G.w + 12, y: G.oy0 - 7, 'text-anchor': 'end', class: 'heat-name' });
    xname.append(el('tspan', { 'font-style': 'italic' }, 'τ'), ', мин');
    const yname = el('text', { x: G.ox + 8, y: top + 4, class: 'heat-name' });
    yname.append(el('tspan', { 'font-style': 'italic' }, 't'), ', °C');
    g.append(xname, yname);
    this.preview = el('polyline', { class: 'heat-preview', points: '' });
    this.trace = el('polyline', { class: 'heat-trace', points: '' });
    this.dot = el('circle', { r: 4, class: 'heat-dot' });
    svg.append(g, this.preview, this.trace, this.dot);

    // the bars
    const bars = el('g', { class: 'heat-bars' });
    STAGES.forEach((s, i) => {
      const y = BAR.y + i * BAR.gap;
      const need = el('rect', { x: BAR.x, y, height: BAR.h, class: 'heat-need' });
      const got = el('rect', { x: BAR.x, y, height: BAR.h, class: 'heat-got' });
      const val = el('text', { y: y + BAR.h - 2, class: 'heat-val' });
      bars.append(el('text', { x: BAR.x - 8, y: y + BAR.h - 2, 'text-anchor': 'end', class: 'heat-label' }, NAMES[s]));
      bars.append(need, got, val);
      this.bars.push({ need, got, val });
    });
    svg.append(bars);

    const controls = document.createElement('div');
    controls.className = 'sim-controls';
    const slider = (name: string, [lo, hi]: [number, number], step: number) => {
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
      input.addEventListener('input', () => this.reset(false));
      label.append(span, out, input);
      controls.append(label);
      return [input, out] as const;
    };
    [this.mInput, this.mOut] = slider('Масса льда <i>m</i>', M_RANGE, 0.05);
    [this.nInput, this.nOut] = slider('Мощность <i>N</i>', N_RANGE, 50);

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
    this.append(svg, controls, row, this.readout);
  }

  /** Back to τ = 0; with `toStart` the sliders go back to their start values too. */
  private reset(toStart = true): void {
    cancelAnimationFrame(this.frame);
    this.running = false;
    if (toStart) {
      this.mInput.value = String(START.m);
      this.nInput.value = String(START.N);
    }
    this.m = Number(this.mInput.value);
    this.N = Number(this.nInput.value);
    this.mOut.textContent = `${ru(this.m, 2)} кг`;
    this.nOut.textContent = `${this.N} Вт`;
    this.tau = 0;
    this.go.textContent = 'Пуск';
    this.preview.setAttribute('points', curve(this.m, this.N).map(([x, t]) => `${this.gx(x).toFixed(1)},${this.gy(t).toFixed(1)}`).join(' '));
    const n = needs(this.m);
    const scale = BAR.w / n.boil;
    STAGES.forEach((s, i) => {
      const w = n[s] * scale;
      this.bars[i].need.setAttribute('width', w.toFixed(1));
      this.bars[i].val.setAttribute('x', (BAR.x + w + 6).toFixed(1));
    });
    this.draw();
  }

  private reduced(): boolean {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  private finished(): boolean {
    return this.tau >= T_END - 1e-9 || stateAt(this.tau * this.N, this.m).stage === 'gone';
  }

  private run(): void {
    if (this.finished()) {
      this.reset(false);
      if (this.reduced()) return; // show the start again; the next press steps on
    }
    if (this.reduced()) {
      this.tau = nextEvent(this.tau, this.m, this.N);
      this.go.textContent = this.finished() ? 'Пуск' : 'Дальше';
      this.draw();
      return;
    }
    if (this.running) {
      this.running = false;
      cancelAnimationFrame(this.frame);
      this.go.textContent = 'Пуск';
      this.draw();
      return;
    }
    this.running = true;
    this.go.textContent = 'Пауза';
    let prev = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - prev) / 1000);
      prev = now;
      const end = Math.min(T_END, bounds(this.m)[3] / this.N);
      this.tau = Math.min(end, this.tau + dt * SPEED);
      if (this.finished() || this.tau >= end) {
        this.tau = end;
        this.running = false;
        this.go.textContent = 'Пуск';
        this.draw();
        return;
      }
      this.draw();
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  private draw(): void {
    const s = stateAt(this.tau * this.N, this.m);

    // the vessel: water from the bottom, ice floating (or resting on the bottom)
    const wh = s.water * MASS_PX;
    const surf = VES.bottom - wh;
    this.water.setAttribute('y', surf.toFixed(1));
    this.water.setAttribute('height', wh.toFixed(1));
    this.surface.style.display = s.water > 0 ? '' : 'none';
    this.surface.setAttribute('y1', surf.toFixed(1));
    this.surface.setAttribute('y2', surf.toFixed(1));
    const ih = (s.ice * MASS_PX * VES.w) / (VES.w - 12);
    const iceBottom = wh > 0.9 * ih ? surf + 0.9 * ih : VES.bottom;
    this.ice.style.display = s.ice > 0 ? '' : 'none';
    this.ice.setAttribute('y', (iceBottom - ih).toFixed(1));
    this.ice.setAttribute('height', Math.max(0, ih).toFixed(1));
    const boiling = s.stage === 'boil';
    this.bubbles.style.display = boiling ? '' : 'none';
    for (const c of this.bubbles.querySelectorAll('circle')) {
      const dy = Number(c.dataset.dy);
      c.setAttribute('cy', (VES.bottom - 4 - Math.min(dy, Math.max(0, wh - 8))).toFixed(1));
    }
    this.flow.style.display = s.stage === 'gone' || this.tau >= T_END ? 'none' : '';

    // the graph
    const pts = curve(this.m, this.N).filter(([x]) => x < this.tau);
    pts.push([this.tau, s.t]);
    const sp = pts.map(([x, t]) => `${this.gx(x).toFixed(1)},${this.gy(t).toFixed(1)}`);
    this.trace.setAttribute('points', this.tau > 0 ? sp.join(' ') : '');
    this.dot.setAttribute('cx', this.gx(this.tau).toFixed(1));
    this.dot.setAttribute('cy', this.gy(s.t).toFixed(1));

    // the bars
    const n = needs(this.m);
    const scale = BAR.w / n.boil;
    STAGES.forEach((st, i) => {
      const b = this.bars[i];
      b.got.setAttribute('width', (s.got[st] * scale).toFixed(1));
      b.val.textContent = s.got[st] > 0 && s.got[st] < n[st] ? `${kJ(s.got[st])} из ${kJ(n[st])} кДж` : `${kJ(n[st])} кДж`;
    });

    this.readout.innerHTML = this.say(s);
  }

  private say(s: HeatState): string {
    const g = (kg: number) => `${Math.floor(kg * 1000 + 1e-6)} г`;
    const total = `${Math.round(this.m * 1000)} г`;
    const time = `<i>τ</i> = ${Math.floor(this.tau + 1e-6)} с`;
    const got = `получено <i>Q</i> = <i>Nτ</i> = ${kJ(s.Q)} кДж`;
    if (this.tau === 0) {
      return nbsp(
        `${total} льда при ${ru(T_START, 0)} °C. Нагреватель даёт ${this.N} Дж каждую секунду, ` +
          'и всё это тепло идёт в сосуд. Нажми «Пуск».',
      );
    }
    let what: string;
    if (s.stage === 'ice') what = `Лёд греется: <i>t</i> = ${tShow(s.t)} °C.`;
    else if (s.stage === 'melt') {
      const melted = Math.floor(s.water * 1000 + 1e-6);
      what =
        melted === 0
          ? 'Лёд нагрелся до 0 °C и начинает таять. Пока он тает, температура 0 °C.'
          : `Лёд тает при 0 °C: растаяло ${g(s.water)} из ${total}.`;
    } else if (s.stage === 'water') {
      what = s.t === 0 ? 'Весь лёд растаял. Теперь греется вода.' : `Весь лёд растаял, вода греется: <i>t</i> = ${tShow(s.t)} °C.`;
    } else if (s.stage === 'boil') {
      const boiled = Math.floor(s.boiled * 1000 + 1e-6);
      what =
        boiled === 0
          ? 'Вода нагрелась до 100 °C и закипает. Пока она кипит, температура 100 °C.'
          : `Вода кипит при 100 °C: выкипело ${g(s.boiled)} из ${total}.`;
    } else what = 'Вся вода выкипела, сосуд пуст.';
    const end = this.tau >= T_END && s.stage !== 'gone' ? ' Прошло 10 минут.' : '';
    return nbsp(`${time}, ${got}. ${what}${end}`);
  }
}

if (!customElements.get('pp-heat')) customElements.define('pp-heat', HeatSim);
