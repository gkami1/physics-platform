// <pp-lc> — an ideal LC circuit: a capacitor charged to 12 V and a coil. Sliders set the coil's
// inductance and the capacitor's capacitance; a third slider shows the moment t after the circuit
// was closed. The capacitor's plates carry «+» and «−» in proportion to its charge, the tint between
// them (accent) shows the energy of its field; the tint around the coil (green) shows the energy of
// the coil's field; the current is an accent arrow on the top wire. Beside the circuit three bars:
// W_C (accent), W_L (green) and their sum, which keeps its height. Under them a live graph over
// 10 ms of the charge q(t) (accent) and the current I(t) (green), each to its own amplitude.
//
// The motion is exact: q = q_max cos ωt on the upper plate, ω = 1/√(LC), and the current along the
// top wire to the right is I = −Δq/Δt = q_max ω sin ωt (the discharge current of the upper plate).
// Energy: q²/(2C) + LI²/2 = CU²/2 at every moment.
//
// Without reduced motion the moment runs 1000 times slower than in a real circuit (10 ms in 10 s),
// starting again from zero, and the slider follows it; a button pauses it, dragging the slider
// pauses it too. With reduced motion nothing runs: the moment stands at the end of the graph and
// the slider moves it. The loop runs only while the model is on screen.
//
// Written into theory Markdown as plain HTML; the theory page imports this module only when
// such an element is present. Light DOM, site CSS variables: follows the light/dark theme.

const SVG_NS = 'http://www.w3.org/2000/svg';
const NBSP = ' ';

/** The charging voltage, В; the sliders' ranges for L (мГн) and C (мкФ). */
export const U0 = 12;
export const L_MH = { min: 10, max: 90, step: 10, start: 70 } as const;
export const C_UF = { min: 1, max: 9, step: 1, start: 7 } as const;
export const T_END = 0.01; // с, the graph's width
export const T_STEP = 0.0001; // с, the moment slider's step
export const SLOW = 1000; // the animation runs this many times slower than the circuit

/** The period of free oscillations, с: Thomson's formula. */
export function period(L: number, C: number): number {
  return 2 * Math.PI * Math.sqrt(L * C);
}

export interface State {
  q: number; // Кл, on the upper plate
  I: number; // А, along the top wire to the right (from the upper plate to the coil)
  qMax: number; // Кл
  IMax: number; // А
  WC: number; // Дж, the capacitor's field
  WL: number; // Дж, the coil's field
  W: number; // Дж, the whole circuit
}

/** The circuit t seconds after it was closed; L in Гн, C in Ф. */
export function state(L: number, C: number, t: number): State {
  const w = 1 / Math.sqrt(L * C);
  const qMax = C * U0;
  const IMax = qMax * w;
  const q = qMax * Math.cos(w * t);
  const I = IMax * Math.sin(w * t);
  return { q, I, qMax, IMax, WC: (q * q) / (2 * C), WL: (L * I * I) / 2, W: (C * U0 * U0) / 2 };
}

/** `digits` decimals with a decimal comma and «≈» when rounded. */
export function num(x: number, digits: number): string {
  const k = 10 ** digits;
  const r = Math.round(x * k) / k;
  const s = String(Object.is(r, -0) ? 0 : r).replace('.', ',');
  return Math.abs(r - x) > 1e-9 * Math.max(1, Math.abs(x)) ? `≈${s}` : s;
}

export function valueText(x: number, unit: string, digits = 0): string {
  return `${num(x, digits)}${NBSP}${unit}`;
}

/** The moment in ms, to 0,1 мс, without «≈»: it runs between the slider's steps. */
export function timeText(t: number): string {
  return `${String(Math.round(t * 1e4) / 10).replace('.', ',')}${NBSP}мс`;
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

/** The circuit: the capacitor at cx, the coil at lx, wires at yt and yb, elements centred at cy;
 * the bars from bx, standing on by, bh px for the whole energy; the graph: t = 0 at gx, T_END
 * at gx + gw, zero at gy, an amplitude gk px. */
const S = { w: 400, h: 330, cx: 64, lx: 196, yt: 34, yb: 146, cy: 90, bx: 262, by: 140, bh: 96, gx: 40, gy: 252, gw: 320, gk: 50 };

class LcSim extends HTMLElement {
  private lmh: number = L_MH.start;
  private cuf: number = C_UF.start;
  private t = 0;
  private running = false;
  private frame = 0;
  private last = 0;
  private visible = true;
  private still = false; // prefers reduced motion: nothing runs by itself
  private built = false;
  private observer: IntersectionObserver | null = null;
  private scene!: SVGGElement;
  private button: HTMLButtonElement | null = null;
  private tSlider!: HTMLInputElement;
  private outs: HTMLOutputElement[] = [];
  private cells: HTMLTableCellElement[] = [];

  connectedCallback(): void {
    if (this.built) return;
    this.built = true;
    this.still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.replaceChildren(); // drop the no-JS fallback text
    this.classList.add('sim', 'lcm');
    this.t = this.still ? T_END : 0;
    this.running = !this.still;
    this.build();
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

  private get L(): number {
    return this.lmh / 1000;
  }

  private get C(): number {
    return this.cuf / 1e6;
  }

  private slider(name: string, min: number, max: number, step: number, value: number, set: (v: number) => void): HTMLLabelElement {
    const label = document.createElement('label');
    label.className = 'sim-slider';
    const span = document.createElement('span');
    span.textContent = name;
    const out = document.createElement('output');
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    input.addEventListener('input', () => {
      set(Number(input.value));
      this.update();
    });
    this.outs.push(out);
    label.append(span, out, input);
    if (name === 'Момент времени') this.tSlider = input;
    return label;
  }

  private build(): void {
    const parts: HTMLElement[] = [];
    if (!this.still) {
      const top = document.createElement('div');
      top.className = 'lcm-top';
      this.button = document.createElement('button');
      this.button.type = 'button';
      this.button.className = 'btn small lcm-play';
      this.button.addEventListener('click', () => {
        this.running = !this.running;
        if (this.running) {
          if (this.t >= T_END) this.t = 0;
          if (this.visible) this.start();
        } else cancelAnimationFrame(this.frame);
        this.update();
      });
      const note = document.createElement('span');
      note.className = 'lcm-note';
      note.textContent = 'замедлено в 1000 раз';
      top.append(this.button, note);
      parts.push(top);
    }

    const svg = el('svg', {
      viewBox: `0 0 ${S.w} ${S.h}`,
      class: 'sim-svg',
      role: 'img',
      'aria-label':
        'Колебательный контур: конденсатор и катушка. Знаки на обкладках показывают заряд, подсветка — ' +
        'где запасена энергия, стрелка — ток. Справа столбики энергии конденсатора, энергии катушки и их ' +
        'суммы. Внизу графики заряда и тока от времени',
    });
    this.scene = el('g');
    svg.append(this.scene);

    const controls = document.createElement('div');
    controls.className = 'sim-controls';
    controls.append(
      this.slider('Индуктивность L', L_MH.min, L_MH.max, L_MH.step, this.lmh, (v) => (this.lmh = v)),
      this.slider('Ёмкость C', C_UF.min, C_UF.max, C_UF.step, this.cuf, (v) => (this.cuf = v)),
      this.slider('Момент времени', 0, Math.round(T_END / T_STEP), 1, Math.round(this.t / T_STEP), (v) => {
        this.running = false;
        cancelAnimationFrame(this.frame);
        this.t = v * T_STEP;
      }),
    );

    const table = document.createElement('table');
    table.className = 'lcm-table';
    const body = document.createElement('tbody');
    const rows = ['Напряжение зарядки', 'Период T = 2π√(LC)', 'Частота ν', 'Энергия конденсатора', 'Энергия катушки', 'Полная энергия'];
    rows.forEach((title, i) => {
      const tr = document.createElement('tr');
      if (i === 0) tr.className = 'lcm-fixed';
      if (i === 3) tr.className = 'lcm-wc';
      if (i === 4) tr.className = 'lcm-wl';
      const th = document.createElement('th');
      th.scope = 'row';
      th.textContent = title;
      const td = document.createElement('td');
      tr.append(th, td);
      body.append(tr);
      this.cells.push(td);
    });
    table.append(body);
    this.append(...parts, svg, controls, table);
  }

  private start(): void {
    cancelAnimationFrame(this.frame);
    this.last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min((now - this.last) / 1000, 0.1); // a hidden tab must not jump
      this.last = now;
      this.t += dt / SLOW;
      if (this.t >= T_END) this.t = 0;
      this.update();
      if (this.running && this.visible) this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  private update(): void {
    const s = state(this.L, this.C, this.t);
    const T = period(this.L, this.C);
    if (this.button) this.button.textContent = this.running ? 'Пауза' : 'Пуск';
    this.tSlider.value = String(Math.round(this.t / T_STEP));
    this.outs[0].textContent = valueText(this.lmh, 'мГн');
    this.outs[1].textContent = valueText(this.cuf, 'мкФ');
    this.outs[2].textContent = timeText(this.t);
    const values = [
      valueText(U0, 'В'),
      valueText(T * 1000, 'мс', 1),
      valueText(1 / T, 'Гц'),
      valueText(s.WC * 1e6, 'мкДж'),
      valueText(s.WL * 1e6, 'мкДж'),
      valueText(s.W * 1e6, 'мкДж'),
    ];
    values.forEach((v, i) => (this.cells[i].textContent = v));
    this.draw(s);
  }

  private arrow(x1: number, y1: number, x2: number, y2: number, cls: string, head: string): SVGElement[] {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const n = Math.hypot(dx, dy) || 1;
    const ux = dx / n;
    const uy = dy / n;
    const h = 8;
    const bx = x2 - ux * h;
    const by = y2 - uy * h;
    return [
      el('path', { d: `M${f1(x1)} ${f1(y1)}L${f1(x2 - ux * 5)} ${f1(y2 - uy * 5)}`, class: cls }),
      el('path', {
        d: `M${f1(x2)} ${f1(y2)}L${f1(bx - uy * 4)} ${f1(by + ux * 4)}L${f1(bx + uy * 4)} ${f1(by - ux * 4)}Z`,
        class: head,
      }),
    ];
  }

  private label(x: number, y: number, main: string, sub: string, cls: string, anchor = 'middle'): SVGTextElement {
    const t = el('text', { x: f1(x), y: f1(y), 'text-anchor': anchor, class: `lcm-label ${cls}` });
    t.append(el('tspan', { 'font-style': 'italic' }, main));
    if (sub) t.append(el('tspan', { 'baseline-shift': 'sub', 'font-size': '11' }, sub));
    return t;
  }

  private draw(s: State): void {
    const { cx, lx, yt, yb, cy } = S;
    const parts: SVGElement[] = [];
    const fc = s.WC / s.W;
    const fl = s.WL / s.W;
    // where the energy is: between the plates (accent), around the turns (green)
    parts.push(el('rect', { x: cx - 22, y: cy - 6, width: 44, height: 12, class: 'lcm-ec', 'fill-opacity': (0.6 * fc).toFixed(3) }));
    parts.push(el('rect', { x: lx - 8, y: cy - 30, width: 26, height: 60, rx: 6, class: 'lcm-el', 'fill-opacity': (0.5 * fl).toFixed(3) }));
    // wires, the plates, the coil
    parts.push(el('path', { d: `M${cx} ${cy - 6}V${yt}H${lx}V${cy - 20}M${cx} ${cy + 6}V${yb}H${lx}V${cy + 20}`, class: 'lcm-wire' }));
    parts.push(el('path', { d: `M${cx - 20} ${cy - 6}H${cx + 20}M${cx - 20} ${cy + 6}H${cx + 20}`, class: 'lcm-plate' }));
    const bumps = 'a5 5 0 0 1 0 10'.repeat(4);
    parts.push(el('path', { d: `M${lx} ${cy - 20}${bumps}`, class: 'lcm-wire' }));
    parts.push(this.label(cx - 30, cy + 5, 'C', '', '', 'end'));
    parts.push(this.label(lx + 18, cy + 5, 'L', '', '', 'start'));
    // charges: up to four signs on each plate
    const n = Math.round((4 * Math.abs(s.q)) / s.qMax);
    const upper = s.q >= 0 ? '+' : '−';
    const lower = s.q >= 0 ? '−' : '+';
    for (let k = 0; k < n; k++) {
      const x = cx - 15 + (30 * (k + 0.5)) / 4 + (n < 4 ? (30 * (4 - n)) / 8 : 0);
      parts.push(el('text', { x: f1(x), y: cy - 11, 'text-anchor': 'middle', class: 'lcm-sign' }, upper));
      parts.push(el('text', { x: f1(x), y: cy + 22, 'text-anchor': 'middle', class: 'lcm-sign' }, lower));
    }
    // the current: an accent arrow above the top wire, longer for more
    const fi = Math.abs(s.I) / s.IMax;
    if (fi > 0.04) {
      const m = (cx + lx) / 2;
      const half = 6 + 30 * fi;
      const d = Math.sign(s.I);
      parts.push(...this.arrow(m - d * half, yt - 12, m + d * half, yt - 12, 'lcm-i', 'lcm-i-head'));
      parts.push(this.label(m, yt + 20, 'I', '', 'lcm-il'));
    }
    parts.push(...this.bars(s), ...this.graph());
    this.scene.replaceChildren(...parts);
  }

  /** W_C, W_L and their sum (stacked), each to the same scale: the whole energy is bh px. */
  private bars(s: State): SVGElement[] {
    const { bx, by, bh } = S;
    const out: SVGElement[] = [];
    const hc = (bh * s.WC) / s.W;
    const hl = (bh * s.WL) / s.W;
    const col = [bx, bx + 42, bx + 84];
    out.push(el('path', { d: `M${bx - 6} ${by}H${bx + 112}`, class: 'lcm-base' }));
    out.push(el('path', { d: `M${bx - 6} ${by - bh}H${bx + 112}`, class: 'lcm-grid' }));
    out.push(el('rect', { x: col[0], y: f1(by - hc), width: 24, height: f1(hc), class: 'lcm-bc' }));
    out.push(el('rect', { x: col[1], y: f1(by - hl), width: 24, height: f1(hl), class: 'lcm-bl' }));
    out.push(el('rect', { x: col[2], y: f1(by - hc), width: 24, height: f1(hc), class: 'lcm-bc' }));
    out.push(el('rect', { x: col[2], y: f1(by - hc - hl), width: 24, height: f1(hl), class: 'lcm-bl' }));
    out.push(this.label(col[0] + 12, by + 20, 'W', 'C', 'lcm-lc'));
    out.push(this.label(col[1] + 12, by + 20, 'W', 'L', 'lcm-ll'));
    out.push(el('text', { x: col[2] + 12, y: by + 20, 'text-anchor': 'middle', class: 'lcm-tick' }, 'сумма'));
    return out;
  }

  /** q(t) and I(t) from 0 to the present moment, each to its own amplitude. */
  private graph(): SVGElement[] {
    const { gx, gy, gw, gk } = S;
    const out: SVGElement[] = [];
    const X = (t: number) => gx + (t / T_END) * gw;
    out.push(...this.arrow(gx, gy, gx + gw + 22, gy, 'lcm-axis', 'lcm-axis-head'));
    out.push(...this.arrow(gx, gy + gk + 10, gx, gy - gk - 18, 'lcm-axis', 'lcm-axis-head'));
    const tl = this.label(gx + gw + 18, gy + 18, 't', '', '', 'end');
    tl.append(el('tspan', {}, ', мс'));
    out.push(tl);
    out.push(this.label(gx + 10, gy - gk - 8, 'q', '', 'lcm-lc', 'start'));
    const il = this.label(gx + 24, gy - gk - 8, 'I', '', 'lcm-ll', 'start');
    out.push(el('text', { x: gx + 19, y: gy - gk - 8, 'text-anchor': 'middle', class: 'lcm-tick' }, ','), il);
    for (const ms of [2, 4, 6, 8, 10]) {
      const x = X(ms / 1000);
      out.push(el('path', { d: `M${f1(x)} ${gy}v4`, class: 'lcm-axis' }));
      out.push(el('text', { x: f1(x), y: gy + 16, 'text-anchor': 'middle', class: 'lcm-tick' }, String(ms)));
    }
    out.push(el('text', { x: gx - 6, y: gy + 4, 'text-anchor': 'end', class: 'lcm-tick' }, '0'));
    const steps = Math.max(1, Math.round(this.t / 0.00002));
    const pq: string[] = [];
    const pi: string[] = [];
    for (let k = 0; k <= steps; k++) {
      const t = (this.t * k) / steps;
      const m = state(this.L, this.C, t);
      pq.push(`${f1(X(t))} ${f1(gy - (m.q / m.qMax) * gk)}`);
      pi.push(`${f1(X(t))} ${f1(gy - (m.I / m.IMax) * gk)}`);
    }
    out.push(el('path', { d: `M${pi.join('L')}`, class: 'lcm-ci' }));
    out.push(el('path', { d: `M${pq.join('L')}`, class: 'lcm-cq' }));
    const m = state(this.L, this.C, this.t);
    const xt = X(this.t);
    out.push(el('circle', { cx: f1(xt), cy: f1(gy - (m.I / m.IMax) * gk), r: 3.5, class: 'lcm-di' }));
    out.push(el('circle', { cx: f1(xt), cy: f1(gy - (m.q / m.qMax) * gk), r: 3.5, class: 'lcm-dq' }));
    return out;
  }
}

if (!customElements.get('pp-lc')) customElements.define('pp-lc', LcSim);
