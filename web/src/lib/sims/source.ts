// <pp-source> — a real source: a battery with EMF ℰ and its internal resistance r (inside a muted
// dashed outline) closed on a rheostat R, with an ammeter in the circuit and a voltmeter on the
// poles. Chips choose a new or an old battery (small or large r), a slider sets R down to a near
// short circuit. A table gives ℰ (in accent: it does not change), the current I = ℰ/(R + r), the
// voltage on the poles U = IR and the drop Ir inside the source. Under the circuit the source's
// U(I) line with the working point on it. Current arrows get thicker with the current. Nothing is
// animated, so reduced motion needs nothing special.
//
// With show="power" the same circuit has one battery (ℰ = 6 В, r = 2 Ом, no chips), the slider
// goes from a short circuit (R = 0) to 6r, the table gives the current, the power in the outer
// circuit I²R, the heat power inside I²r and the efficiency R/(R + r), and the graph under the
// circuit is the outer power against R with its maximum at R = r (muted guides).
//
// Written into theory Markdown as plain HTML; the theory page imports this module only when
// such an element is present. Light DOM, site CSS variables: follows the light/dark theme.
// Colours as in the circuit figures: symbols and wires in the text colour, the source's outline
// muted and dashed, the current an accent arrow, the U(I) line accent, what stays the same accent.

const SVG_NS = 'http://www.w3.org/2000/svg';
const NBSP = ' ';

export const EMF = 6;
export const R_INT = { fresh: 0.5, old: 3 } as const;
export type Battery = keyof typeof R_INT;
export const R_VALUES = [0.1, 0.5, 1, 2, 3.5, 5.5, 8, 12, 20, 50] as const;
export const R_DEFAULT = 4; // index of 3,5 Ом

export interface State {
  I: number; // current, А
  U: number; // voltage on the poles, В
  drop: number; // Ir, В
  Ishort: number; // ℰ/r, А
}

/** Ohm's law for the whole circuit. */
export function solve(E: number, r: number, R: number): State {
  const I = E / (R + r);
  return { I, U: I * R, drop: I * r, Ishort: E / r };
}

// show="power": one battery, R from a short circuit to 6r.
export const POWER = { r: 2, values: [0, 0.5, 1, 1.5, 2, 3, 4, 6, 8, 12], start: 6 } as const;

export interface PowerState {
  I: number; // current, А
  P: number; // power in the outer circuit I²R, Вт
  heat: number; // heat power inside the source I²r, Вт
  total: number; // power of the outside forces ℰI, Вт
  eta: number; // efficiency R/(R + r), 0…1
}

/** Powers in the whole circuit: ℰI = I²R + I²r. */
export function power(E: number, r: number, R: number): PowerState {
  const I = E / (R + r);
  return { I, P: I * I * R, heat: I * I * r, total: E * I, eta: R / (R + r) };
}

/** The efficiency in whole percent, «≈» when rounded. */
export function percentText(eta: number): string {
  const x = eta * 100;
  const k = Math.round(x);
  return `${Math.abs(k - x) > 1e-9 ? '≈' : ''}${k}${NBSP}%`;
}

/** Up to three significant digits with a decimal comma; «≈» when rounded. */
export function num(x: number): string {
  const digits = x >= 100 ? 0 : x >= 10 ? 1 : 2;
  const k = 10 ** digits;
  const r = Math.round(x * k) / k;
  const s = String(r).replace('.', ',');
  return Math.abs(r - x) > 1e-9 * Math.max(1, x) ? `≈${s}` : s;
}

export function unitText(x: number, unit: string): string {
  return `${num(x)}${NBSP}${unit}`;
}

/** Arrow stroke width: grows with the current, 1.2 at zero, 4.5 at 12 А. */
export function arrowWidth(I: number): number {
  return 1.2 + 3.3 * Math.sqrt(Math.min(I, 12) / 12);
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

// Circuit: top wire, bottom wire with the source, voltmeter under it. Graph below.
const L = { w: 400, h: 400, left: 40, right: 360, top: 56, bot: 170, vy: 222 };
const G = { ox: 64, oy: 366, w: 300, h: 110, imax: 13 }; // I_кз of the new battery, 12 А, stays clear of the axis end

let instances = 0;

class SourceSim extends HTMLElement {
  private battery: Battery = 'fresh';
  private ri: number = R_DEFAULT;
  private powerMode = false;
  private built = false;
  private scene!: SVGGElement;
  private rOut!: HTMLOutputElement;
  private cells: HTMLTableCellElement[] = [];

  private get rValues(): readonly number[] {
    return this.powerMode ? POWER.values : R_VALUES;
  }

  connectedCallback(): void {
    if (this.built) return;
    this.built = true;
    if (this.getAttribute('battery') === 'old') this.battery = 'old';
    if (this.getAttribute('show') === 'power') {
      this.powerMode = true;
      this.ri = POWER.start;
    }
    this.replaceChildren(); // drop the no-JS fallback text
    this.classList.add('sim', 'emf');
    this.build();
    this.draw();
  }

  private build(): void {
    const id = ++instances;
    const set = document.createElement('fieldset');
    set.className = 'pfx-chips emf-chips';
    const legend = document.createElement('legend');
    legend.textContent = 'Батарейка';
    set.append(legend);
    for (const [value, title] of [
      ['fresh', `новая, r = ${unitText(R_INT.fresh, 'Ом')}`],
      ['old', `старая, r = ${unitText(R_INT.old, 'Ом')}`],
    ] as const) {
      const label = document.createElement('label');
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = `emf-${id}`;
      radio.value = value;
      radio.checked = this.battery === value;
      radio.addEventListener('change', () => {
        if (!radio.checked) return;
        this.battery = value;
        this.draw();
      });
      const span = document.createElement('span');
      span.textContent = title;
      label.append(radio, span);
      set.append(label);
    }

    const svg = el('svg', {
      viewBox: `0 0 ${L.w} ${L.h}`,
      class: 'sim-svg',
      role: 'img',
      'aria-label': this.powerMode
        ? 'Схема: батарейка с ЭДС и внутренним сопротивлением замкнута на реостат через амперметр, ' +
          'вольтметр подключён к полюсам батарейки. Ниже — график мощности во внешней цепи от ' +
          'сопротивления реостата с максимумом при R = r, точка на нём показывает мощность сейчас'
        : 'Схема: батарейка с ЭДС и внутренним сопротивлением замкнута на реостат через амперметр, ' +
          'вольтметр подключён к полюсам батарейки. Ниже — график напряжения на полюсах от тока, ' +
          'точка на нём показывает ток и напряжение сейчас',
    });
    this.scene = el('g');
    svg.append(this.scene);

    const controls = document.createElement('div');
    controls.className = 'sim-controls';
    const label = document.createElement('label');
    label.className = 'sim-slider';
    const name = document.createElement('span');
    name.textContent = 'Сопротивление реостата R';
    this.rOut = document.createElement('output');
    const input = document.createElement('input');
    input.type = 'range';
    input.min = '0';
    input.max = String(this.rValues.length - 1);
    input.step = '1';
    input.value = String(this.ri);
    input.addEventListener('input', () => {
      this.ri = Number(input.value);
      this.draw();
    });
    label.append(name, this.rOut, input);
    controls.append(label);

    const table = document.createElement('table');
    table.className = 'emf-table';
    table.setAttribute('aria-live', 'polite');
    const body = document.createElement('tbody');
    const rows = this.powerMode
      ? ['ЭДС ℰ и сопротивление r', 'Ток I', 'Мощность во внешней цепи I²R', 'Нагрев источника I²r', 'КПД η']
      : ['ЭДС ℰ', 'Ток I', 'Напряжение на полюсах U', 'Падение внутри Ir'];
    rows.forEach((title, i) => {
      const tr = document.createElement('tr');
      if (i === 0) tr.className = 'emf-fixed';
      const th = document.createElement('th');
      th.scope = 'row';
      th.textContent = title;
      const td = document.createElement('td');
      tr.append(th, td);
      body.append(tr);
      this.cells.push(td);
    });
    table.append(body);
    if (this.powerMode) this.append(svg, controls, table);
    else this.append(set, svg, controls, table);
  }

  private arrow(x1: number, y1: number, x2: number, y2: number, w: number): SVGElement[] {
    const dx = Math.sign(x2 - x1);
    const dy = Math.sign(y2 - y1);
    const h = 5 + w; // head length
    const s = 2.5 + w * 0.9; // head half-width
    const bx = x2 - dx * h;
    const by = y2 - dy * h;
    return [
      el('path', { d: `M${x1} ${y1}L${bx} ${by}`, class: 'emf-current', 'stroke-width': w.toFixed(2) }),
      el('path', {
        d: `M${x2} ${y2}L${bx - dy * s} ${by + dx * s}L${bx + dy * s} ${by - dx * s}Z`,
        class: 'emf-head',
      }),
    ];
  }

  private text(x: number, y: number, s: string, cls: string, anchor = 'middle'): SVGTextElement {
    return el('text', { x, y, 'text-anchor': anchor, class: cls }, s);
  }

  private sub(x: number, y: number, main: string, sub: string): SVGTextElement {
    const t = el('text', { x, y, 'text-anchor': 'middle', class: 'emf-label' });
    t.append(el('tspan', { 'font-style': 'italic' }, main));
    t.append(el('tspan', { 'baseline-shift': 'sub', 'font-size': '11' }, sub));
    return t;
  }

  private meter(x: number, y: number, letter: string): SVGElement[] {
    return [
      el('circle', { cx: x, cy: y, r: 12, class: 'emf-wire' }),
      this.text(x, y + 5, letter, 'emf-meter'),
    ];
  }

  private draw(): void {
    const r = this.powerMode ? POWER.r : R_INT[this.battery];
    const R = this.rValues[this.ri];
    const s = solve(EMF, r, R);
    const p = power(EMF, r, R);
    this.rOut.textContent = unitText(R, 'Ом');
    const values = this.powerMode
      ? [
          `${unitText(EMF, 'В')}, ${unitText(r, 'Ом')} — не меняются`,
          unitText(p.I, 'А'),
          unitText(p.P, 'Вт'),
          unitText(p.heat, 'Вт'),
          percentText(p.eta),
        ]
      : [`${unitText(EMF, 'В')} — не меняется`, unitText(s.I, 'А'), unitText(s.U, 'В'), unitText(s.drop, 'В')];
    values.forEach((t, i) => (this.cells[i].textContent = t));

    const { left, right, top, bot, vy } = L;
    const bx = 140; // battery centre: «+» (long thin plate) on the left
    const rx = 200; // internal resistance centre
    const w = arrowWidth(s.I);
    const parts: SVGElement[] = [
      // Wires: from «+» left and up, along the top through the rheostat, down the right side
      // through the ammeter, back along the bottom through r into «−».
      el('path', {
        d:
          `M${bx - 4} ${bot}H${left}V${top}H${186}M${214} ${top}H${right}V${102}` +
          `M${right} ${126}V${bot}H${rx + 14}M${rx - 14} ${bot}H${bx + 4}`,
        class: 'emf-wire',
      }),
      // The source's outline, its battery and r.
      el('rect', { x: bx - 32, y: bot - 36, width: 126, height: 66, rx: 6, class: 'emf-outline' }),
      el('path', { d: `M${bx - 4} ${bot - 13}V${bot + 13}`, class: 'emf-wire' }),
      el('path', { d: `M${bx + 4} ${bot - 7}V${bot + 7}`, class: 'emf-wire emf-thick' }),
      el('rect', { x: rx - 14, y: bot - 6, width: 28, height: 12, class: 'emf-wire' }),
      this.text(bx, bot - 19, 'ℰ', 'emf-label'),
      this.text(rx, bot - 14, 'r', 'emf-label emf-it'),
      this.text(bx - 12, bot + 26, '+', 'emf-sign'),
      this.text(bx + 12, bot + 26, '−', 'emf-sign'),
      // The rheostat: a resistor with a slanted arrow.
      el('rect', { x: 186, y: top - 6, width: 28, height: 12, class: 'emf-wire' }),
      el('path', { d: `M188 ${top + 14}L207.4 ${top - 8.7}`, class: 'emf-wire emf-thin' }),
      el('path', { d: `M212 ${top - 14}L210.1 ${top - 6.4}L204.7 ${top - 11}Z`, class: 'emf-dot' }),
      this.text(176, top - 12, 'R', 'emf-label emf-it'),
      // The ammeter on the right side.
      ...this.meter(right, 114, 'A'),
      // The voltmeter on the poles, joined outside the outline.
      el('path', {
        d: `M${bx - 22 - 20} ${bot}V${vy}H${168}M${192} ${vy}H${rx + 52}V${bot}`,
        class: 'emf-wire',
      }),
      ...this.meter(180, vy, 'V'),
      el('circle', { cx: bx - 42, cy: bot, r: 3, class: 'emf-dot' }),
      el('circle', { cx: rx + 52, cy: bot, r: 3, class: 'emf-dot' }),
      this.text(rx + 70, vy + 5, 'на полюсах', 'emf-note', 'start'),
      // The current: out of «+», round the circuit, back into «−».
      ...this.arrow(70, top - 14, 140, top - 14, w),
      this.text(105, top - 24, 'I', 'emf-label emf-i emf-it'),
      ...this.arrow(right + 16, 140, right + 16, 160, w),
      ...this.arrow(330, bot - 14, 270, bot - 14, w),
    ];

    if (this.powerMode) parts.push(...this.powerGraph(r, R, p.P));
    else parts.push(...this.lineGraph(r, s));
    this.scene.replaceChildren(...parts);
  }

  /** The outer power against R, its maximum at R = r and the working point. */
  private powerGraph(r: number, R: number, P: number): SVGElement[] {
    const { ox, oy, h } = G;
    const values = POWER.values;
    const rmax = values[values.length - 1];
    const kx = G.w / rmax;
    const pmax = (EMF * EMF) / (4 * r);
    const ky = h / pmax;
    const X = (x: number): number => ox + x * kx;
    const Y = (y: number): number => oy - y * ky;
    let d = '';
    for (let k = 0; k <= 120; k++) {
      const x = (rmax * k) / 120;
      d += `${k ? 'L' : 'M'}${X(x).toFixed(1)} ${Y(power(EMF, r, x).P).toFixed(1)}`;
    }
    return [
      el('path', { d: `M${ox} ${oy}H${ox + G.w + 16}`, class: 'emf-wire emf-thin' }),
      el('path', { d: `M${ox} ${oy}V${oy - h - 22}`, class: 'emf-wire emf-thin' }),
      el('path', { d: `M${ox + G.w + 16} ${oy}l-8 -4v8z`, class: 'emf-dot' }),
      el('path', { d: `M${ox} ${oy - h - 22}l-4 8h8z`, class: 'emf-dot' }),
      this.text(ox + G.w + 14, oy + 18, 'R', 'emf-label emf-it', 'end'),
      this.text(ox + 10, oy - h - 10, 'P', 'emf-label emf-it', 'start'),
      this.text(ox - 8, oy + 5, '0', 'emf-note', 'end'),
      el('path', { d: `M${X(r)} ${oy}V${Y(pmax)}H${ox}`, class: 'emf-guide' }),
      this.text(X(r), oy + 18, 'r', 'emf-label emf-it'),
      this.sub(ox - 18, Y(pmax) + 5, 'P', 'max'),
      this.text(X(r) + 12, Y(pmax) - 6, 'максимум при R = r', 'emf-note', 'start'),
      el('path', { d, class: 'emf-line' }),
      el('circle', { cx: X(R).toFixed(1), cy: Y(P).toFixed(1), r: 5, class: 'emf-point' }),
    ];
  }

  /** The U(I) line of the source and the working point on it. */
  private lineGraph(r: number, s: State): SVGElement[] {
    const parts: SVGElement[] = [];
    const { ox, oy, h, imax } = G;
    const kx = G.w / imax;
    const ky = h / EMF;
    const X = (i: number): number => ox + i * kx;
    const Y = (u: number): number => oy - u * ky;
    const iEnd = Math.min(s.Ishort, imax);
    const px = X(s.I);
    const py = Y(s.U);
    parts.push(
      el('path', { d: `M${ox} ${oy}H${ox + G.w + 16}`, class: 'emf-wire emf-thin' }),
      el('path', { d: `M${ox} ${oy}V${oy - h - 22}`, class: 'emf-wire emf-thin' }),
      el('path', { d: `M${ox + G.w + 16} ${oy}l-8 -4v8z`, class: 'emf-dot' }),
      el('path', { d: `M${ox} ${oy - h - 22}l-4 8h8z`, class: 'emf-dot' }),
      this.text(ox + G.w + 14, oy + 18, 'I', 'emf-label emf-it', 'end'),
      this.text(ox + 10, oy - h - 10, 'U', 'emf-label emf-it', 'start'),
      this.text(ox - 8, Y(EMF) + 5, 'ℰ', 'emf-label', 'end'),
      el('path', {
        d: `M${ox} ${Y(EMF)}L${X(iEnd).toFixed(1)} ${Y(EMF - iEnd * r).toFixed(1)}`,
        class: 'emf-line',
      }),
      el('path', {
        d: `M${px.toFixed(1)} ${oy}V${py.toFixed(1)}H${ox}`,
        class: 'emf-guide',
      }),
      el('circle', { cx: px.toFixed(1), cy: py.toFixed(1), r: 5, class: 'emf-point' }),
    );
    if (s.Ishort <= imax) {
      parts.push(
        el('circle', { cx: X(s.Ishort).toFixed(1), cy: oy, r: 3, class: 'emf-dot' }),
        this.sub(X(s.Ishort), oy + 20, 'I', 'кз'),
      );
    }
    return parts;
  }
}

if (!customElements.get('pp-source')) customElements.define('pp-source', SourceSim);
