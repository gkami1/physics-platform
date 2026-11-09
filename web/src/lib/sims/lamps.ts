// <pp-lamps> — the two-lamp experiment of self-induction. A battery and a key on top; two equal
// parallel branches: lamp 1 with a resistor, lamp 2 with a coil (the resistor is matched to the
// coil's wire, so each branch has the same resistance). A button closes and opens the key, chips
// put the iron core in or take it out (L ten times smaller), a slider shows the moment after the
// last switch. Under the circuit a live graph of the two currents, I₁ (text colour) and I₂
// (accent), from the switch to that moment.
//
// Closing: lamp 1's current is there at once, the coil's grows smoothly,
// I₂ = I₀ + (I₂(0) − I₀)·e^(−t/τ), τ = L/R. Opening: the battery is cut off, the two branches
// make one loop, the coil keeps its current going through both lamps (through lamp 1 the other
// way) and it dies away with τ′ = L/(2R). The EMF of self-induction ℰ_si = −L·ΔI/Δt is against
// the current while it grows and along it while it falls; at the opening it is twice the source's.
// The lamps glow (warm colour) in proportion to I².
//
// Without reduced motion the moment runs from 0 to 2 s after each switch and the slider follows
// it; with reduced motion a switch shows the moment 2 s later at once. The slider can always be
// dragged back. The loop runs only while the model is on screen.
//
// Written into theory Markdown as plain HTML; the theory page imports this module only when
// such an element is present. Light DOM, site CSS variables: follows the light/dark theme.

const SVG_NS = 'http://www.w3.org/2000/svg';
const NBSP = ' ';

/** The source, the resistance of each branch and the coil with and without its core. */
export const LAMPS = { E: 6, R: 15, Lcore: 6, Lair: 0.3 } as const;
export const I0 = LAMPS.E / LAMPS.R; // the steady current of each branch, А
export const T_END = 2; // с, how long the graph runs after a switch
export const T_STEP = 0.05; // с, the slider's step

export interface Moment {
  I1: number; // А, through lamp 1, + left to right (as the source drives it)
  I2: number; // А, through lamp 2 and the coil
  emf: number; // В, ℰ_si; + along the coil's current, − against it
}

/**
 * The currents t seconds after the key was closed (closed = true) or opened, when the coil's
 * current at that switch was c. The branches are equal, R each; the source has no internal
 * resistance.
 */
export function moment(closed: boolean, t: number, c: number, L: number): Moment {
  const { R } = LAMPS;
  if (closed) {
    const tau = L / R;
    const e = Math.exp(-t / tau);
    const I2 = I0 + (c - I0) * e;
    const dI = ((I0 - c) / tau) * e; // ΔI/Δt
    return { I1: I0, I2, emf: -L * dI };
  }
  const tau = L / (2 * R);
  const e = Math.exp(-t / tau);
  const I2 = c * e;
  const dI = (-c / tau) * e;
  return { I1: -I2, I2, emf: -L * dI };
}

/** `digits` decimals with a decimal comma and «≈» when rounded. */
export function num(x: number, digits: number): string {
  const k = 10 ** digits;
  const r = Math.round(x * k) / k;
  const s = String(Object.is(r, -0) ? 0 : r).replace('.', ',');
  return Math.abs(r - x) > 1e-9 * Math.max(1, Math.abs(x)) ? `≈${s}` : s;
}

export function valueText(x: number, unit: string, digits = 2): string {
  return `${num(x, digits)}${NBSP}${unit}`;
}

/** A lamp's current: its size, and «обратно» when it goes against the source's direction. */
export function currentText(I: number): string {
  if (Math.abs(I) < 0.005) return valueText(0, 'А');
  const v = valueText(Math.abs(I), 'А');
  return I < 0 ? `${v}, обратно` : v;
}

/** ℰ_si: its size and whether it is against or along the coil's current. */
export function emfText(emf: number): string {
  if (Math.abs(emf) < 1e-9) return valueText(0, 'В');
  const v = valueText(Math.abs(emf), 'В', 1);
  // a value that rounds to zero gets no direction
  if (Math.round(Math.abs(emf) * 10) === 0) return v;
  return `${v}, ${emf < 0 ? 'против тока' : 'по току'}`;
}

/** The moment after a switch, to 0,01 с, without «≈»: it runs between the slider's steps. */
export function timeText(t: number): string {
  return `${String(Math.round(t * 100) / 100).replace('.', ',')}${NBSP}с`;
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

/** The circuit: wires at xl and xr, the source row at top, the branches at y1 and y2; the
 * graph below: its time axis at gy (zero current), 2 s over gw px, 0,5 А over gk px. */
const S = { w: 400, h: 350, xl: 40, xr: 360, top: 36, y1: 104, y2: 176, xa: 130, xb: 270, gx: 46, gy: 284, gw: 296, gk: 46 };

let instances = 0;

class LampsSim extends HTMLElement {
  private isClosed = false;
  private hasCore = true;
  private t = T_END;
  private c = 0; // the coil's current at the last switch
  private running = false;
  private frame = 0;
  private last = 0;
  private visible = true;
  private still = false; // prefers reduced motion: a switch jumps to T_END
  private built = false;
  private observer: IntersectionObserver | null = null;
  private scene!: SVGGElement;
  private button!: HTMLButtonElement;
  private slider!: HTMLInputElement;
  private tOut!: HTMLOutputElement;
  private cells: HTMLTableCellElement[] = [];

  connectedCallback(): void {
    if (this.built) return;
    this.built = true;
    this.still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.replaceChildren(); // drop the no-JS fallback text
    this.classList.add('sim', 'lmp');
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
    return this.hasCore ? LAMPS.Lcore : LAMPS.Lair;
  }

  private build(): void {
    const id = ++instances;
    const top = document.createElement('div');
    top.className = 'lmp-top';
    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.className = 'btn small lmp-key';
    this.button.addEventListener('click', () => this.toggle());

    const set = document.createElement('fieldset');
    set.className = 'pfx-chips lmp-chips';
    const lg = document.createElement('legend');
    lg.textContent = 'Сердечник';
    set.append(lg);
    for (const [value, text] of [['in', 'есть'], ['out', 'нет']] as const) {
      const label = document.createElement('label');
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = `lmp-core-${id}`;
      radio.value = value;
      radio.checked = value === 'in';
      radio.addEventListener('change', () => {
        if (!radio.checked) return;
        // the coil changes from now on: its current at this moment starts a new run
        this.c = moment(this.isClosed, this.t, this.c, this.L).I2;
        this.hasCore = value === 'in';
        this.restart();
      });
      const span = document.createElement('span');
      span.textContent = text;
      label.append(radio, span);
      set.append(label);
    }
    top.append(this.button, set);

    const svg = el('svg', {
      viewBox: `0 0 ${S.w} ${S.h}`,
      class: 'sim-svg',
      role: 'img',
      'aria-label':
        'Схема: батарея и ключ, две параллельные ветви — лампа 1 с резистором и лампа 2 с катушкой. ' +
        'Лампы светятся тем ярче, чем больше ток; стрелки показывают токи. Под схемой — график ' +
        'токов через лампы после переключения ключа',
    });
    this.scene = el('g');
    svg.append(this.scene);

    const controls = document.createElement('div');
    controls.className = 'sim-controls';
    const label = document.createElement('label');
    label.className = 'sim-slider';
    const name = document.createElement('span');
    name.textContent = 'Время после переключения';
    this.tOut = document.createElement('output');
    this.slider = document.createElement('input');
    this.slider.type = 'range';
    this.slider.min = '0';
    this.slider.max = String(Math.round(T_END / T_STEP));
    this.slider.step = '1';
    this.slider.addEventListener('input', () => {
      this.running = false;
      cancelAnimationFrame(this.frame);
      this.t = Number(this.slider.value) * T_STEP;
      this.update();
    });
    label.append(name, this.tOut, this.slider);
    controls.append(label);

    const table = document.createElement('table');
    table.className = 'lmp-table';
    table.setAttribute('aria-live', 'polite');
    const body = document.createElement('tbody');
    const rows = ['ЭДС источника', 'Индуктивность L', 'Сопротивление ветви', 'Ток через лампу 1', 'Ток через лампу 2', 'ЭДС самоиндукции'];
    rows.forEach((title, i) => {
      const tr = document.createElement('tr');
      if (i < 3) tr.className = 'lmp-fixed';
      const th = document.createElement('th');
      th.scope = 'row';
      th.textContent = title;
      const td = document.createElement('td');
      tr.append(th, td);
      body.append(tr);
      this.cells.push(td);
    });
    table.append(body);
    this.append(top, svg, controls, table);
  }

  private toggle(): void {
    this.c = moment(this.isClosed, this.t, this.c, this.L).I2;
    this.isClosed = !this.isClosed;
    this.restart();
  }

  /** A new run from the present state: t from 0 (or straight to the end with reduced motion). */
  private restart(): void {
    cancelAnimationFrame(this.frame);
    if (this.still) {
      this.t = T_END;
      this.running = false;
    } else {
      this.t = 0;
      this.running = true;
      if (this.visible) this.start();
    }
    this.update();
  }

  private start(): void {
    cancelAnimationFrame(this.frame);
    this.last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min((now - this.last) / 1000, 0.1); // a hidden tab must not jump
      this.last = now;
      this.t = Math.min(T_END, this.t + dt);
      if (this.t >= T_END) this.running = false;
      this.update();
      if (this.running && this.visible) this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  private update(): void {
    const m = moment(this.isClosed, this.t, this.c, this.L);
    this.button.textContent = this.isClosed ? 'Разомкнуть ключ' : 'Замкнуть ключ';
    this.slider.value = String(Math.round(this.t / T_STEP));
    this.tOut.textContent = timeText(this.t);
    const values = [
      valueText(LAMPS.E, 'В', 1),
      valueText(this.L, 'Гн', 1),
      valueText(LAMPS.R, 'Ом', 1),
      currentText(m.I1),
      currentText(m.I2),
      emfText(m.emf),
    ];
    values.forEach((t, i) => (this.cells[i].textContent = t));
    this.draw(m);
  }

  /** An arrow from (x1, y1) to (x2, y2); cls for the shaft, head for the tip. */
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
    const t = el('text', { x: f1(x), y: f1(y), 'text-anchor': anchor, class: `lmp-label ${cls}` });
    t.append(el('tspan', { 'font-style': 'italic' }, main));
    if (sub) t.append(el('tspan', { 'baseline-shift': 'sub', 'font-size': '11' }, sub));
    return t;
  }

  private lamp(x: number, y: number, I: number, n: string): SVGElement[] {
    const glow = Math.min(1, (I / I0) ** 2);
    const d = 7.8;
    return [
      el('circle', { cx: x, cy: y, r: 21, class: 'lmp-glow', 'fill-opacity': glow.toFixed(3) }),
      el('circle', { cx: x, cy: y, r: 11, class: 'lmp-bulb' }),
      el('path', { d: `M${x - d} ${y - d}L${x + d} ${y + d}M${x - d} ${y + d}L${x + d} ${y - d}`, class: 'lmp-wire' }),
      el('text', { x, y: y - 24, 'text-anchor': 'middle', class: 'lmp-label' }, n),
    ];
  }

  private draw(m: Moment): void {
    const { xl, xr, top, y1, y2, xa, xb } = S;
    const parts: SVGElement[] = [];
    // wires with gaps for the elements (each 40 px wide)
    const wires = [
      `M${xl} ${top}H${xa - 20}M${xa + 20} ${top}H${xb - 20}M${xb + 20} ${top}H${xr}`,
      `M${xl} ${top}V${y2}M${xr} ${top}V${y2}`,
      `M${xl} ${y1}H${xa - 20}M${xa + 20} ${y1}H${xb - 20}M${xb + 20} ${y1}H${xr}`,
      `M${xl} ${y2}H${xa - 20}M${xa + 20} ${y2}H${xb - 20}M${xb + 20} ${y2}H${xr}`,
    ];
    parts.push(el('path', { d: wires.join(''), class: 'lmp-wire' }));
    parts.push(el('circle', { cx: xl, cy: y1, r: 3, class: 'lmp-node' }), el('circle', { cx: xr, cy: y1, r: 3, class: 'lmp-node' }));
    // the battery (long plate +, on the left) and the key
    parts.push(el('path', { d: `M${xa - 20} ${top}H${xa - 4}M${xa + 4} ${top}H${xa + 20}`, class: 'lmp-wire' }));
    parts.push(el('path', { d: `M${xa - 4} ${top - 13}V${top + 13}`, class: 'lmp-wire' }));
    parts.push(el('path', { d: `M${xa + 4} ${top - 7}V${top + 7}`, class: 'lmp-plate' }));
    const blade = this.isClosed ? `M${xb - 10} ${top}L${xb + 10} ${top - 1.5}` : `M${xb - 10} ${top}L${xb + 9} ${top - 11}`;
    parts.push(el('path', { d: `M${xb - 20} ${top}H${xb - 10}M${xb + 10} ${top}H${xb + 20}${blade}`, class: 'lmp-wire' }));
    parts.push(el('circle', { cx: xb - 10, cy: top, r: 2, class: 'lmp-node' }), el('circle', { cx: xb + 10, cy: top, r: 2, class: 'lmp-node' }));
    // lamps, the resistor and the coil
    parts.push(...this.lamp(xa, y1, m.I1, '1'), ...this.lamp(xa, y2, m.I2, '2'));
    parts.push(el('rect', { x: xb - 14, y: y1 - 6, width: 28, height: 12, class: 'lmp-resistor' }));
    parts.push(this.label(xb, y1 - 14, 'R', '', ''));
    const bumps = 'a5 5 0 0 1 10 0'.repeat(4);
    parts.push(el('path', { d: `M${xb - 20} ${y2}${bumps}`, class: 'lmp-wire' }));
    if (this.hasCore) parts.push(el('path', { d: `M${xb - 20} ${y2 - 9}H${xb + 20}`, class: 'lmp-core' }));
    parts.push(this.label(xb, y2 - 16, 'L', '', ''));
    // the currents: accent arrows between the lamp and the resistor or coil, longer for more
    const mid = (xa + xb) / 2;
    for (const [I, y, n] of [[m.I1, y1, '1'], [m.I2, y2, '2']] as const) {
      if (Math.abs(I) < 0.01) continue;
      const half = 6 + 22 * Math.min(1, Math.abs(I) / I0);
      const s = Math.sign(I);
      parts.push(...this.arrow(mid - s * half, y + 12, mid + s * half, y + 12, 'lmp-i', 'lmp-i-head'));
      parts.push(this.label(mid, y + 31, 'I', n, 'lmp-il'));
    }
    parts.push(...this.graph());
    this.scene.replaceChildren(...parts);
  }

  /** The currents from the last switch to the present moment. */
  private graph(): SVGElement[] {
    const { gx, gy, gw, gk } = S;
    const out: SVGElement[] = [];
    const X = (t: number) => gx + (t / T_END) * gw;
    const Y = (I: number) => gy - (I / I0) * gk;
    out.push(...this.arrow(gx, gy, gx + gw + 18, gy, 'lmp-axis', 'lmp-axis-head'));
    out.push(...this.arrow(gx, gy + gk + 8, gx, gy - gk - 16, 'lmp-axis', 'lmp-axis-head'));
    const tl = this.label(gx + gw + 7, gy + 18, 't', '', '', 'start');
    tl.append(el('tspan', {}, ', с'));
    const il = this.label(gx + 10, gy - gk - 6, 'I', '', '', 'start');
    il.append(el('tspan', {}, ', А'));
    out.push(tl, il);
    for (const I of [I0, -I0]) {
      out.push(el('path', { d: `M${gx - 4} ${f1(Y(I))}H${gx + gw}`, class: 'lmp-grid' }));
    }
    out.push(el('text', { x: gx - 7, y: f1(Y(I0) + 4), 'text-anchor': 'end', class: 'lmp-tick' }, `${num(I0, 1)}`));
    out.push(el('text', { x: gx - 7, y: f1(Y(-I0) + 4), 'text-anchor': 'end', class: 'lmp-tick' }, `−${num(I0, 1)}`));
    out.push(el('text', { x: gx - 7, y: gy + 4, 'text-anchor': 'end', class: 'lmp-tick' }, '0'));
    for (const s of [1, 2]) {
      out.push(el('path', { d: `M${f1(X(s))} ${gy}v4`, class: 'lmp-axis' }));
      out.push(el('text', { x: f1(X(s)), y: gy + 16, 'text-anchor': 'middle', class: 'lmp-tick' }, String(s)));
    }
    const n = Math.max(1, Math.round(this.t / 0.01));
    const p1: string[] = [];
    const p2: string[] = [];
    for (let k = 0; k <= n; k++) {
      const t = (this.t * k) / n;
      const m = moment(this.isClosed, t, this.c, this.L);
      p1.push(`${f1(X(t))} ${f1(Y(m.I1))}`);
      p2.push(`${f1(X(t))} ${f1(Y(m.I2))}`);
    }
    out.push(el('path', { d: `M${p1.join('L')}`, class: 'lmp-c1' }));
    out.push(el('path', { d: `M${p2.join('L')}`, class: 'lmp-c2' }));
    const m = moment(this.isClosed, this.t, this.c, this.L);
    const xt = X(this.t);
    out.push(el('circle', { cx: f1(xt), cy: f1(Y(m.I1)), r: 3.5, class: 'lmp-d1' }));
    out.push(el('circle', { cx: f1(xt), cy: f1(Y(m.I2)), r: 3.5, class: 'lmp-d2' }));
    // labels at the curves' ends, kept apart
    let l1 = Y(m.I1);
    let l2 = Y(m.I2);
    if (Math.abs(l1 - l2) < 16) {
      const c = (l1 + l2) / 2;
      const up = m.I1 >= m.I2 ? -1 : 1;
      l1 = c + up * 8;
      l2 = c - up * 8;
    }
    // right of the marker, or left of it near the end of the axis (clear of «t, с»)
    const late = xt > gx + gw - 40;
    const lx = late ? xt - 8 : xt + 8;
    const anchor = late ? 'end' : 'start';
    out.push(this.label(lx, l1 + 5, 'I', '1', 'lmp-l1', anchor));
    out.push(this.label(lx, l2 + 5, 'I', '2', 'lmp-il', anchor));
    return out;
  }
}

if (!customElements.get('pp-lamps')) customElements.define('pp-lamps', LampsSim);
