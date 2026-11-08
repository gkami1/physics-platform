// <pp-capacitor> — a parallel-plate capacitor charged from a battery, then either left connected
// or disconnected (chips). Sliders change the plate distance d and the plate area S, chips put a
// dielectric between the plates. A table under the picture says how C, q, U, E and W changed
// compared with the start (charged at d₀ and S₀ with air between the plates): in words, «в 2 раза
// больше», never as numbers in units, so it cannot show a task's answer. The quantity that stays
// fixed (q when disconnected, U when connected) is marked in accent. Switching the mode starts
// over from the start state. Nothing is animated, so reduced motion needs nothing special.
//
// Written into theory Markdown as plain HTML; the theory page imports this module only when
// such an element is present. Light DOM, site CSS variables: follows the light/dark theme.
// Colours as in the capacitor figures: plates text-colour bars with signs, field lines in the text
// colour, a dielectric an accent tint, circuit symbols and wires in the text colour.

const SVG_NS = 'http://www.w3.org/2000/svg';
const NBSP = ' ';
const MINUS = '−';

export type Mode = 'connected' | 'disconnected';

export const D_VALUES = [0.5, 1, 1.5, 2, 3] as const;
export const S_VALUES = [0.5, 1, 1.5, 2] as const;
export const DIELECTRICS = [
  { id: 'air', title: 'воздух', eps: 1 },
  { id: 'paraffin', title: 'парафин', eps: 2 },
  { id: 'glass', title: 'стекло', eps: 7 },
] as const;

export interface Ratios {
  C: number;
  q: number;
  U: number;
  E: number;
  W: number;
}

/**
 * C, q, U, E and W as multiples of their start values (d₀, S₀, air, charged to the source's U).
 * d and S are multiples of d₀ and S₀. Connected: U stays, q = CU. Disconnected: q stays, U = q/C.
 */
export function ratios(mode: Mode, d: number, S: number, eps: number): Ratios {
  const C = (eps * S) / d;
  if (mode === 'connected') return { C, q: C, U: 1, E: 1 / d, W: C };
  const U = 1 / C;
  return { C, q: 1, U, E: U / d, W: 1 / C };
}

function comma(x: number): string {
  return String(x).replace('.', ',');
}

/** «2», «1,5» or «≈4,7» for a factor k ≥ 1. */
export function factor(k: number): string {
  if (Math.abs(k - Math.round(k)) < 1e-9) return String(Math.round(k));
  const one = Math.round(k * 10) / 10;
  return Math.abs(k - one) < 1e-9 ? comma(one) : `≈${comma(one)}`;
}

/** «раз» or «раза» after a factor. */
function times(k: number): string {
  if (Math.abs(k - Math.round(k)) > 1e-9) return 'раза';
  const n = Math.round(k);
  const last = n % 10;
  const teen = n % 100 >= 12 && n % 100 <= 14;
  return last >= 2 && last <= 4 && !teen ? 'раза' : 'раз';
}

/** How a quantity changed: «как в начале», «в 2 раза больше», «в 1,5 раза меньше». */
export function ratioText(r: number): string {
  if (Math.abs(r - 1) < 1e-9) return 'как в начале';
  const k = r > 1 ? r : 1 / r;
  return `в${NBSP}${factor(k)}${NBSP}${times(k)} ${r > 1 ? 'больше' : 'меньше'}`;
}

/** A slider value as a multiple of the start: «d₀», «2d₀», «0,5d₀». */
export function multipleLabel(v: number, sym: string): string {
  return v === 1 ? sym : `${comma(v)}${sym}`;
}

/** Field lines drawn: their density follows E (five lines over the start plate at the start). */
export function lineCount(E: number, S: number): number {
  return Math.max(1, Math.round(5 * E * S));
}

export const ROWS: { key: keyof Ratios; name: string }[] = [
  { key: 'C', name: 'Ёмкость C' },
  { key: 'q', name: 'Заряд q' },
  { key: 'U', name: 'Напряжение U' },
  { key: 'E', name: 'Поле E' },
  { key: 'W', name: 'Энергия W' },
];

/** The table's second column. The fixed quantity says why it stays. */
export function rowText(mode: Mode, key: keyof Ratios, r: Ratios): string {
  if (mode === 'disconnected' && key === 'q') return 'не меняется: заряду некуда уйти';
  if (mode === 'connected' && key === 'U') return 'не меняется: его задаёт источник';
  return ratioText(r[key]);
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

const L = {
  w: 400,
  h: 252,
  cx: 200,
  cy: 112,
  plateH: 80,
  gap: 56,
  left: 34,
  right: 366,
  wireY: 226,
};

let instances = 0;

class CapacitorSim extends HTMLElement {
  private mode: Mode = 'connected';
  private di = 1; // index in D_VALUES
  private si = 1; // index in S_VALUES
  private ei = 0; // index in DIELECTRICS
  private built = false;
  private scene!: SVGGElement;
  private caption!: SVGTextElement;
  private dInput!: HTMLInputElement;
  private sInput!: HTMLInputElement;
  private dOut!: HTMLOutputElement;
  private sOut!: HTMLOutputElement;
  private dielRadios: HTMLInputElement[] = [];
  private cells: HTMLTableCellElement[] = [];
  private rows: HTMLTableRowElement[] = [];

  connectedCallback(): void {
    if (this.built) return;
    this.built = true;
    if (this.getAttribute('mode') === 'disconnected') this.mode = 'disconnected';
    this.replaceChildren(); // drop the no-JS fallback text
    this.classList.add('sim', 'cap');
    this.build();
    this.draw();
  }

  private chips(
    legendText: string,
    cls: string,
    options: { value: string; title: string; checked: boolean }[],
    onPick: (value: string) => void,
  ): [HTMLFieldSetElement, HTMLInputElement[]] {
    const id = ++instances;
    const set = document.createElement('fieldset');
    set.className = `pfx-chips cap-chips ${cls}`;
    const legend = document.createElement('legend');
    legend.textContent = legendText;
    set.append(legend);
    const radios: HTMLInputElement[] = [];
    for (const o of options) {
      const label = document.createElement('label');
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = `cap-${id}`;
      radio.value = o.value;
      radio.checked = o.checked;
      radio.addEventListener('change', () => {
        if (radio.checked) onPick(o.value);
      });
      const span = document.createElement('span');
      span.textContent = o.title;
      label.append(radio, span);
      set.append(label);
      radios.push(radio);
    }
    return [set, radios];
  }

  private slider(
    title: string,
    n: number,
    value: number,
    onInput: (i: number) => void,
  ): [HTMLLabelElement, HTMLOutputElement, HTMLInputElement] {
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
    return [label, out, input];
  }

  private build(): void {
    const [modeSet] = this.chips(
      'Конденсатор',
      'cap-mode',
      [
        {
          value: 'connected',
          title: 'подключён к источнику',
          checked: this.mode === 'connected',
        },
        {
          value: 'disconnected',
          title: 'отключён от источника',
          checked: this.mode === 'disconnected',
        },
      ],
      (v) => {
        this.mode = v as Mode;
        this.reset();
      },
    );
    const svg = el('svg', {
      viewBox: `0 0 ${L.w} ${L.h}`,
      class: 'sim-svg',
      role: 'img',
      'aria-label':
        'Плоский конденсатор, соединённый с батарейкой через ключ. Между пластинами линии поля; ' +
        'их густота показывает напряжённость',
    });
    this.scene = el('g');
    this.caption = el('text', {
      x: L.cx,
      y: 16,
      'text-anchor': 'middle',
      class: 'cap-caption',
    });
    svg.append(this.scene, this.caption);

    const controls = document.createElement('div');
    controls.className = 'sim-controls';
    let dLabel: HTMLLabelElement;
    let sLabel: HTMLLabelElement;
    [dLabel, this.dOut, this.dInput] = this.slider(
      'Расстояние между пластинами',
      D_VALUES.length,
      this.di,
      (i) => {
        this.di = i;
        this.draw();
      },
    );
    [sLabel, this.sOut, this.sInput] = this.slider('Площадь пластин', S_VALUES.length, this.si, (i) => {
      this.si = i;
      this.draw();
    });
    controls.append(dLabel, sLabel);

    let dielSet: HTMLFieldSetElement;
    [dielSet, this.dielRadios] = this.chips(
      'Между пластинами',
      'cap-diel-chips',
      DIELECTRICS.map((m, i) => ({
        value: String(i),
        title: m.eps === 1 ? m.title : `${m.title}, ε${NBSP}=${NBSP}${m.eps}`,
        checked: i === this.ei,
      })),
      (v) => {
        this.ei = Number(v);
        this.draw();
      },
    );

    const table = document.createElement('table');
    table.className = 'cap-table';
    table.setAttribute('aria-live', 'polite');
    const body = document.createElement('tbody');
    for (const row of ROWS) {
      const tr = document.createElement('tr');
      const th = document.createElement('th');
      th.scope = 'row';
      th.textContent = row.name;
      const td = document.createElement('td');
      tr.append(th, td);
      body.append(tr);
      this.rows.push(tr);
      this.cells.push(td);
    }
    table.append(body);
    const note = document.createElement('p');
    note.className = 'cap-note';
    note.textContent =
      'По сравнению с началом: конденсатор зарядили от источника при d₀ и S₀, между пластинами воздух.';
    this.append(modeSet, svg, controls, dielSet, table, note);
  }

  /** Back to the start state: d₀, S₀, air. */
  private reset(): void {
    this.di = 1;
    this.si = 1;
    this.ei = 0;
    this.dInput.value = '1';
    this.sInput.value = '1';
    this.dielRadios.forEach((r, i) => (r.checked = i === 0));
    this.draw();
  }

  private head(x: number, y: number): SVGPathElement {
    return el('path', {
      d: `M${x + 4} ${y}L${x - 4} ${y - 3.5}L${x - 4} ${y + 3.5}Z`,
      class: 'cap-head',
    });
  }

  private draw(): void {
    const d = D_VALUES[this.di];
    const S = S_VALUES[this.si];
    const m = DIELECTRICS[this.ei];
    const r = ratios(this.mode, d, S, m.eps);
    const connected = this.mode === 'connected';
    this.dOut.textContent = multipleLabel(d, 'd₀');
    this.sOut.textContent = multipleLabel(S, 'S₀');
    this.caption.textContent = connected ? 'подключён: U не меняется' : 'отключён: q не меняется';
    ROWS.forEach((row, i) => {
      this.cells[i].textContent = rowText(this.mode, row.key, r);
      this.rows[i].classList.toggle(
        'cap-fixed',
        (connected && row.key === 'U') || (!connected && row.key === 'q'),
      );
    });

    const g = L.gap * d;
    const h = L.plateH * S;
    const x1 = L.cx - g / 2; // inner face of the left plate
    const x2 = L.cx + g / 2;
    const y1 = L.cy - h / 2;
    const parts: SVGElement[] = [];
    if (m.eps > 1) parts.push(el('rect', { x: x1, y: y1, width: g, height: h, class: 'cap-diel' }));
    // Wires: from the plates' outer sides out and down to the battery and the switch.
    const bx = 170;
    const sx = 250;
    const W = L.wireY;
    parts.push(
      el('path', {
        d: `M${x1 - 6} ${L.cy}H${L.left}V${W}H${bx - 4}M${bx + 4} ${W}H${sx - 15}M${sx + 15} ${W}H${L.right}V${L.cy}H${x2 + 6}`,
        class: 'cap-wire',
      }),
      el('path', { d: `M${bx - 4} ${W - 13}V${W + 13}`, class: 'cap-wire' }),
      el('path', {
        d: `M${bx + 4} ${W - 7}V${W + 7}`,
        class: 'cap-wire cap-thick',
      }),
      el(
        'text',
        {
          x: bx - 14,
          y: W - 12,
          'text-anchor': 'middle',
          class: 'cap-sign cap-small',
        },
        '+',
      ),
      el(
        'text',
        {
          x: bx + 14,
          y: W - 12,
          'text-anchor': 'middle',
          class: 'cap-sign cap-small',
        },
        MINUS,
      ),
      el('circle', { cx: sx - 15, cy: W, r: 2.2, class: 'cap-dot' }),
      el('circle', { cx: sx + 15, cy: W, r: 2.2, class: 'cap-dot' }),
      el('path', {
        d: connected ? `M${sx - 15} ${W}H${sx + 15}` : `M${sx - 15} ${W}L${sx + 12} ${W - 14}`,
        class: 'cap-wire',
      }),
      el('text', { x: sx, y: W + 20, 'text-anchor': 'middle', class: 'cap-small-note' }, 'ключ'),
    );
    // Field lines: density follows E.
    const n = lineCount(r.E, S);
    for (let k = 0; k < n; k++) {
      const y = y1 + (h * (k + 0.5)) / n;
      parts.push(el('path', { d: `M${x1 + 1} ${y}H${x2 - 1}`, class: 'cap-line' }), this.head(L.cx, y));
    }
    // Plates and their signs, one per 14 px.
    parts.push(
      el('rect', { x: x1 - 6, y: y1, width: 6, height: h, class: 'cap-plate' }),
      el('rect', { x: x2, y: y1, width: 6, height: h, class: 'cap-plate' }),
    );
    const signs = Math.max(2, Math.floor(h / 14));
    for (let k = 0; k < signs; k++) {
      const yc = y1 + (h * (k + 0.5)) / signs;
      if (Math.abs(yc - L.cy) < 7) continue; // the wire leaves the plate here
      const y = yc + 5;
      parts.push(
        el('text', { x: x1 - 16, y, 'text-anchor': 'middle', class: 'cap-sign' }, '+'),
        el('text', { x: x2 + 16, y, 'text-anchor': 'middle', class: 'cap-sign' }, MINUS),
      );
    }
    this.scene.replaceChildren(...parts);
  }
}

if (!customElements.get('pp-capacitor')) customElements.define('pp-capacitor', CapacitorSim);
