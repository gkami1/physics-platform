// <pp-circuit> — a source and two resistors, connected in series or in parallel (chips). Sliders
// set the source's voltage U and the resistances R₁ and R₂. Under the picture a table gives the
// resistance, current and voltage of each resistor and of the whole circuit, as an ammeter and a
// voltmeter would show them; the column that is the same for both resistors (the current in
// series, the voltage in parallel) is marked in accent. Current arrows beside the wires get
// thicker with the current, so the split in parallel is visible. Nothing is animated, so reduced
// motion needs nothing special. Attribute `mode="parallel"` starts in parallel.
//
// Written into theory Markdown as plain HTML; the theory page imports this module only when
// such an element is present. Light DOM, site CSS variables: follows the light/dark theme.
// Colours as in the circuit figures: symbols and wires in the text colour, the current an accent
// arrow, what stays the same in accent.

const SVG_NS = 'http://www.w3.org/2000/svg';
const NBSP = ' ';

export type Mode = 'series' | 'parallel';

export const U_VALUES = [1.5, 4.5, 9, 18] as const;
export const R_VALUES = [10, 20, 30, 45, 60, 90, 120] as const;

export interface Solution {
  R: number;
  I: number;
  I1: number;
  I2: number;
  U1: number;
  U2: number;
}

/** Ohm's law for the two connections: series (one current) or parallel (one voltage). */
export function solve(mode: Mode, U: number, R1: number, R2: number): Solution {
  if (mode === 'series') {
    const R = R1 + R2;
    const I = U / R;
    return { R, I, I1: I, I2: I, U1: I * R1, U2: I * R2 };
  }
  const R = (R1 * R2) / (R1 + R2);
  const I1 = U / R1;
  const I2 = U / R2;
  return { R, I: I1 + I2, I1, I2, U1: U, U2: U };
}

/** Up to three significant digits with a decimal comma; «≈» when rounded. */
export function num(x: number): string {
  const digits = x >= 100 ? 0 : x >= 10 ? 1 : 2;
  const k = 10 ** digits;
  const r = Math.round(x * k) / k;
  const s = String(r).replace('.', ',');
  return Math.abs(r - x) > 1e-9 * Math.max(1, x) ? `≈${s}` : s;
}

/** A current in А, or in мА below 1 А. */
export function currentText(I: number): string {
  return I >= 1 - 1e-12 ? `${num(I)}${NBSP}А` : `${num(I * 1000)}${NBSP}мА`;
}

export function voltageText(U: number): string {
  return `${num(U)}${NBSP}В`;
}

export function resistanceText(R: number): string {
  return `${num(R)}${NBSP}Ом`;
}

/** Arrow stroke width: the main current gets 4, a branch current its share of that. */
export function arrowWidth(I: number, Imain: number): number {
  return 1.2 + 2.8 * (I / Imain);
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

const L = { w: 400, h: 248, bx: 44, right: 356, bot: 222 };

let instances = 0;

class CircuitSim extends HTMLElement {
  private mode: Mode = 'series';
  private ui = 2; // index in U_VALUES
  private r1 = 4; // index in R_VALUES
  private r2 = 5;
  private built = false;
  private scene!: SVGGElement;
  private caption!: SVGTextElement;
  private uOut!: HTMLOutputElement;
  private r1Out!: HTMLOutputElement;
  private r2Out!: HTMLOutputElement;
  private cells: HTMLTableCellElement[][] = [];
  private table!: HTMLTableElement;

  connectedCallback(): void {
    if (this.built) return;
    this.built = true;
    if (this.getAttribute('mode') === 'parallel') this.mode = 'parallel';
    this.replaceChildren(); // drop the no-JS fallback text
    this.classList.add('sim', 'crc');
    this.build();
    this.draw();
  }

  private slider(
    title: string,
    n: number,
    value: number,
    onInput: (i: number) => void,
  ): [HTMLLabelElement, HTMLOutputElement] {
    const label = document.createElement('label');
    label.className = 'sim-slider';
    const name = document.createElement('span');
    name.textContent = title;
    const out = document.createElement('output');
    const input = document.createElement('input');
    input.type = 'range';
    input.min = '0';
    input.max = String(n - 1);
    input.step = '1';
    input.value = String(value);
    input.addEventListener('input', () => onInput(Number(input.value)));
    label.append(name, out, input);
    return [label, out];
  }

  private build(): void {
    const id = ++instances;
    const set = document.createElement('fieldset');
    set.className = 'pfx-chips crc-chips';
    const legend = document.createElement('legend');
    legend.textContent = 'Соединение';
    set.append(legend);
    for (const [value, title] of [
      ['series', 'последовательно'],
      ['parallel', 'параллельно'],
    ] as const) {
      const label = document.createElement('label');
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = `crc-${id}`;
      radio.value = value;
      radio.checked = this.mode === value;
      radio.addEventListener('change', () => {
        if (!radio.checked) return;
        this.mode = value;
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
      'aria-label':
        'Схема: источник тока и два резистора, соединённые последовательно или параллельно. ' +
        'Стрелки показывают ток; чем больше ток, тем толще стрелка',
    });
    this.scene = el('g');
    this.caption = el('text', { x: 200, y: 18, 'text-anchor': 'middle', class: 'crc-caption' });
    svg.append(this.scene, this.caption);

    const controls = document.createElement('div');
    controls.className = 'sim-controls';
    let uLabel: HTMLLabelElement;
    let r1Label: HTMLLabelElement;
    let r2Label: HTMLLabelElement;
    [uLabel, this.uOut] = this.slider('Напряжение источника U', U_VALUES.length, this.ui, (i) => {
      this.ui = i;
      this.draw();
    });
    [r1Label, this.r1Out] = this.slider('Сопротивление R₁', R_VALUES.length, this.r1, (i) => {
      this.r1 = i;
      this.draw();
    });
    [r2Label, this.r2Out] = this.slider('Сопротивление R₂', R_VALUES.length, this.r2, (i) => {
      this.r2 = i;
      this.draw();
    });
    controls.append(uLabel, r1Label, r2Label);

    this.table = document.createElement('table');
    this.table.className = 'crc-table';
    this.table.setAttribute('aria-live', 'polite');
    const head = document.createElement('thead');
    const hr = document.createElement('tr');
    for (const t of ['', 'Сопротивление', 'Ток', 'Напряжение']) {
      const th = document.createElement('th');
      th.scope = 'col';
      th.textContent = t;
      hr.append(th);
    }
    head.append(hr);
    const body = document.createElement('tbody');
    for (const name of ['R₁', 'R₂', 'Вся цепь']) {
      const tr = document.createElement('tr');
      const th = document.createElement('th');
      th.scope = 'row';
      th.textContent = name;
      tr.append(th);
      const row: HTMLTableCellElement[] = [];
      for (let k = 0; k < 3; k++) {
        const td = document.createElement('td');
        tr.append(td);
        row.push(td);
      }
      body.append(tr);
      this.cells.push(row);
    }
    this.table.append(head, body);
    this.append(set, svg, controls, this.table);
  }

  private arrow(x1: number, y1: number, x2: number, y2: number, w: number): SVGElement[] {
    const dx = Math.sign(x2 - x1);
    const dy = Math.sign(y2 - y1);
    const h = 5 + w; // head length
    const s = 2.5 + w * 0.9; // head half-width
    const bx = x2 - dx * h;
    const by = y2 - dy * h;
    return [
      el('path', { d: `M${x1} ${y1}L${bx} ${by}`, class: 'crc-current', 'stroke-width': w.toFixed(2) }),
      el('path', {
        d: `M${x2} ${y2}L${bx - dy * s} ${by + dx * s}L${bx + dy * s} ${by - dx * s}Z`,
        class: 'crc-head',
      }),
    ];
  }

  private label(x: number, y: number, text: string, sub: string, cls = 'crc-label'): SVGTextElement {
    const t = el('text', { x, y, 'text-anchor': 'middle', class: cls });
    const main = el('tspan', { 'font-style': 'italic' }, text);
    t.append(main);
    if (sub) t.append(el('tspan', { 'baseline-shift': 'sub', 'font-size': '11' }, sub));
    return t;
  }

  private resistor(x: number, y: number): SVGElement {
    return el('rect', { x: x - 14, y: y - 6, width: 28, height: 12, class: 'crc-res' });
  }

  private draw(): void {
    const U = U_VALUES[this.ui];
    const R1 = R_VALUES[this.r1];
    const R2 = R_VALUES[this.r2];
    const s = solve(this.mode, U, R1, R2);
    const series = this.mode === 'series';
    this.uOut.textContent = voltageText(U);
    this.r1Out.textContent = resistanceText(R1);
    this.r2Out.textContent = resistanceText(R2);
    this.caption.textContent = series
      ? 'последовательно: ток один и тот же'
      : 'параллельно: напряжение одно и то же';
    const rows = [
      [resistanceText(R1), currentText(s.I1), voltageText(s.U1)],
      [resistanceText(R2), currentText(s.I2), voltageText(s.U2)],
      [resistanceText(s.R), currentText(s.I), voltageText(U)],
    ];
    rows.forEach((row, i) => row.forEach((t, k) => (this.cells[i][k].textContent = t)));
    this.table.classList.toggle('crc-series', series);
    this.table.classList.toggle('crc-parallel', !series);

    const { bx, right, bot } = L;
    const parts: SVGElement[] = [];
    // The source: vertical battery, «+» (long thin plate) on top.
    const by = series ? 150 : 165;
    parts.push(
      el('path', { d: `M${bx - 13} ${by - 4}H${bx + 13}`, class: 'crc-wire' }),
      el('path', { d: `M${bx - 7} ${by + 4}H${bx + 7}`, class: 'crc-wire crc-thick' }),
      el('text', { x: bx + 22, y: by - 8, 'text-anchor': 'middle', class: 'crc-sign' }, '+'),
      el('text', { x: bx + 22, y: by + 20, 'text-anchor': 'middle', class: 'crc-sign' }, '−'),
      this.label(bx - 24, by + 5, 'U', ''),
    );
    const wMain = arrowWidth(s.I, s.I);
    if (series) {
      const y = 80;
      parts.push(
        el('path', {
          d: `M${bx} ${by - 4}V${y}H${136}M${164} ${y}H${236}M${264} ${y}H${right}V${bot}H${bx}V${by + 4}`,
          class: 'crc-wire',
        }),
        this.resistor(150, y),
        this.resistor(250, y),
        this.label(150, y + 28, 'R', '1'),
        this.label(250, y + 28, 'R', '2'),
        ...this.arrow(80, y - 14, 118, y - 14, wMain),
        ...this.arrow(181, y - 14, 219, y - 14, wMain),
        ...this.arrow(282, y - 14, 320, y - 14, wMain),
        this.label(99, y - 28, 'I', '', 'crc-label crc-i'),
        this.label(200, y - 28, 'I', '', 'crc-label crc-i'),
        this.label(301, y - 28, 'I', '', 'crc-label crc-i'),
      );
    } else {
      const ym = 100;
      const y1 = 62;
      const y2 = 138;
      const xa = 130;
      const xb = 310;
      parts.push(
        el('path', {
          d:
            `M${bx} ${by - 4}V${ym}H${xa}M${xa} ${y1}V${y2}M${xb} ${y1}V${y2}` +
            `M${xa} ${y1}H${206}M${234} ${y1}H${xb}M${xa} ${y2}H${206}M${234} ${y2}H${xb}` +
            `M${xb} ${ym}H${right}V${bot}H${bx}V${by + 4}`,
          class: 'crc-wire',
        }),
        this.resistor(220, y1),
        this.resistor(220, y2),
        el('circle', { cx: xa, cy: ym, r: 3, class: 'crc-dot' }),
        el('circle', { cx: xb, cy: ym, r: 3, class: 'crc-dot' }),
        this.label(260, y1 - 10, 'R', '1'),
        this.label(260, y2 - 10, 'R', '2'),
        ...this.arrow(66, ym - 14, 110, ym - 14, wMain),
        ...this.arrow(146, y1 - 14, 184, y1 - 14, arrowWidth(s.I1, s.I)),
        ...this.arrow(146, y2 - 14, 184, y2 - 14, arrowWidth(s.I2, s.I)),
        this.label(88, ym - 28, 'I', '', 'crc-label crc-i'),
        this.label(165, y1 - 28, 'I', '1', 'crc-label crc-i'),
        this.label(165, y2 - 28, 'I', '2', 'crc-label crc-i'),
      );
    }
    // The current returns to the source's «−» along the bottom wire.
    parts.push(...this.arrow(232, bot - 14, 168, bot - 14, wMain), this.label(200, bot - 24, 'I', '', 'crc-label crc-i'));
    this.scene.replaceChildren(...parts);
  }
}

if (!customElements.get('pp-circuit')) customElements.define('pp-circuit', CircuitSim);
