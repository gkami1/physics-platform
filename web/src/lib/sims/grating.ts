// <pp-grating> — a diffraction grating. Chips pick one wavelength or white light; sliders set the
// wavelength λ (380…760 нм) and the number of lines per millimetre N (100…1000), so the period is
// d = 1/N мм. Light falls from the left; the directions of the maxima, d sin φ = kλ, are rays from the
// grating to a half-circle screen, and on the sin φ axis beside it the maxima stand equally spaced
// by λ/d. An order with sin φ = 1 would go along the grating: it is marked hollow and not counted, so
// k_max is the largest k with kλ < d and there are 2k_max + 1 maxima. In white light every order
// k ≥ 1 is a spectrum from violet (380 нм) to red (760 нм): an accent-tinted wedge on the fan and a
// band on the axis, cut at 90°; overlapping spectra look denser. The table lists d, d/λ, k_max, the
// number of maxima and sin φ, φ by order — or, for white light, each spectrum's angles and which
// spectra overlap (the second and the third, at any period: 3 · 380 < 2 · 760).
//
// The picture follows the optics convention of the figures (lessons 14.x–16.x): rays accent with an
// arrowhead in the middle, the grating and the axis in the text colour, guides muted dashed; colours
// are named, never painted (16.x figure specs), so a spectrum is an accent band with «ф» and «к».
//
// Nothing moves on its own, so reduced motion changes nothing. The defaults: one wavelength, 650 нм,
// N = 220 (d ≈ 4,55 мкм, k_max = 6, 13 maxima), avoiding the answers and intermediates of the
// topic's step tasks; lesson 16.7 starts it in white light with N = 500 via attributes.
//
// Written into theory Markdown as plain HTML; the theory page imports this module only when such an
// element is present. Light DOM, site CSS variables: follows the light/dark theme.

const SVG_NS = 'http://www.w3.org/2000/svg';
const NBSP = '\u00a0';

export const L_MIN = 380;
export const L_MAX = 760;
export const N_MIN = 100;
export const N_MAX = 1000;
export const START = { white: false, lambda: 650, lines: 220 };

const RAD = Math.PI / 180;
/** Nanometres in a millimetre: d = 10⁶ / N нм. */
const MM = 1_000_000;

/** sin φ of the order k for λ in нм and N lines per mm. */
export function sinPhi(k: number, lambda: number, lines: number): number {
  return (k * lambda * lines) / MM;
}

/** The highest order seen: the largest k with kλ < d (sin φ = 1 runs along the grating). Integer arithmetic. */
export function kMax(lambda: number, lines: number): number {
  return Math.floor((MM - 1) / (lambda * lines));
}

/** The order that would go exactly at 90°, or null. */
export function ninety(lambda: number, lines: number): number | null {
  return MM % (lambda * lines) === 0 ? MM / (lambda * lines) : null;
}

export function count(lambda: number, lines: number): number {
  return 2 * kMax(lambda, lines) + 1;
}

/** A number with a decimal comma, rounded to `digits` decimals, with «≈» when rounding changed it. */
export function num(x: number, digits = 2): string {
  const r = Number(x.toFixed(digits));
  const text = String(Math.abs(r) < 1e-12 ? 0 : r).replace('.', ',').replace('-', '−');
  return Math.abs(r - x) > 1e-9 ? `≈${NBSP}${text}` : text;
}

export function angleText(s: number): string {
  return `${num(Math.asin(Math.min(1, s)) / RAD, 1)}°`;
}

export function periodText(lines: number): string {
  return `${num(1000 / lines)}${NBSP}мкм`;
}

/** Summary rows for one wavelength: d, d/λ, k_max, the number of maxima. */
export function summary(lambda: number, lines: number): string[] {
  return [periodText(lines), num(MM / lines / lambda), String(kMax(lambda, lines)), String(count(lambda, lines))];
}

/** Per-order rows [k, sin φ, φ] for k = 0…min(k_max, limit). */
export function orders(lambda: number, lines: number, limit = 6): string[][] {
  const rows: string[][] = [];
  for (let k = 0; k <= Math.min(kMax(lambda, lines), limit); k++) {
    const s = sinPhi(k, lambda, lines);
    rows.push([String(k), num(s, 3), angleText(s)]);
  }
  return rows;
}

/** White light: per order k ≥ 1 whose violet end is seen, the angles from violet to red. */
export function spectra(lines: number, limit = 6): string[][] {
  const rows: string[][] = [];
  for (let k = 1; k <= limit; k++) {
    const sv = sinPhi(k, L_MIN, lines);
    if (sv >= 1) break;
    const sr = sinPhi(k, L_MAX, lines);
    const red = sr < 1 ? ` до${NBSP}${angleText(sr)}` : ', красный край за 90°';
    rows.push([String(k), `от${NBSP}${angleText(sv)}${red}`]);
  }
  return rows;
}

/** Which spectra overlap first: the second and the third, if the third is seen at all. */
export function overlap(lines: number): string {
  return sinPhi(3, L_MIN, lines) < 1 ? 'второй и третий порядки' : 'нет: третьего порядка не видно';
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

/** The scene: the grating at (gx, gy), a half-circle screen of radius R, the sin φ axis at ax. */
const S = { w: 400, h: 260, gx: 44, gy: 130, R: 108, ax: 300 };

let instances = 0;

class GratingSim extends HTMLElement {
  private white = START.white;
  private lambda = START.lambda;
  private lines = START.lines;
  private built = false;
  private scene!: SVGGElement;
  private lOut!: HTMLOutputElement;
  private nOut!: HTMLOutputElement;
  private lInput!: HTMLInputElement;
  private table!: HTMLTableSectionElement;

  connectedCallback(): void {
    if (this.built) return;
    this.built = true;
    const pick = (name: string, lo: number, hi: number, fallback: number): number => {
      const v = Number(this.getAttribute(name));
      return Number.isInteger(v) && v >= lo && v <= hi && v % 10 === 0 ? v : fallback;
    };
    this.lambda = pick('lambda', L_MIN, L_MAX, START.lambda);
    this.lines = pick('lines', N_MIN, N_MAX, START.lines);
    this.white = this.getAttribute('light') === 'white';
    this.replaceChildren(); // drop the no-JS fallback text
    this.classList.add('sim', 'grt');
    this.build();
    this.update();
  }

  disconnectedCallback(): void {
    this.built = false;
  }

  private slider(name: string, min: number, max: number, value: number, set: (v: number) => void): [HTMLLabelElement, HTMLOutputElement, HTMLInputElement] {
    const label = document.createElement('label');
    label.className = 'sim-slider';
    const span = document.createElement('span');
    span.textContent = name;
    const out = document.createElement('output');
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = '10';
    input.value = String(value);
    input.addEventListener('input', () => {
      set(Number(input.value));
      this.update();
    });
    label.append(span, out, input);
    return [label, out, input];
  }

  private build(): void {
    const id = ++instances;
    const chips = document.createElement('fieldset');
    chips.className = 'pfx-chips grt-chips';
    const lg = document.createElement('legend');
    lg.textContent = 'Свет';
    chips.append(lg);
    for (const [white, name] of [[false, 'одна длина волны'], [true, 'белый']] as const) {
      const label = document.createElement('label');
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = `grt-light-${id}`;
      radio.value = white ? 'white' : 'mono';
      radio.checked = white === this.white;
      radio.addEventListener('change', () => {
        if (!radio.checked) return;
        this.white = white;
        this.update();
      });
      const span = document.createElement('span');
      span.textContent = name;
      label.append(radio, span);
      chips.append(label);
    }

    const svg = el('svg', {
      viewBox: `0 0 ${S.w} ${S.h}`,
      class: 'sim-svg',
      role: 'img',
      'aria-label':
        'Свет падает слева на дифракционную решётку. Лучи от решётки к полукруглому экрану показывают ' +
        'направления на максимумы; справа ось синуса угла, на которой максимумы стоят через равные промежутки. ' +
        'В белом свете каждый порядок — спектр от фиолетового до красного',
    });
    this.scene = el('g');
    svg.append(this.scene);

    const controls = document.createElement('div');
    controls.className = 'sim-controls';
    const [lLabel, lOut, lInput] = this.slider('Длина волны λ', L_MIN, L_MAX, this.lambda, (v) => (this.lambda = v));
    const [nLabel, nOut] = this.slider('Штрихов на мм', N_MIN, N_MAX, this.lines, (v) => (this.lines = v));
    this.lOut = lOut;
    this.nOut = nOut;
    this.lInput = lInput;
    controls.append(lLabel, nLabel);

    const table = document.createElement('table');
    table.className = 'grt-table';
    this.table = document.createElement('tbody');
    table.append(this.table);
    this.append(chips, svg, controls, table);
  }

  private row(cells: string[], head = false, cls = ''): HTMLTableRowElement {
    const tr = document.createElement('tr');
    if (cls) tr.className = cls;
    cells.forEach((c, i) => {
      const cell = document.createElement(head || i === 0 ? 'th' : 'td');
      if (i === 0 && !head) (cell as HTMLTableCellElement).scope = 'row';
      if (cells.length === 2 && i === 1) cell.colSpan = 2;
      cell.textContent = c;
      tr.append(cell);
    });
    return tr;
  }

  private update(): void {
    const { lambda, lines } = this;
    this.lOut.textContent = this.white ? '380…760' + NBSP + 'нм' : `${lambda}${NBSP}нм`;
    this.lInput.disabled = this.white;
    this.nOut.textContent = String(lines);
    const rows: HTMLTableRowElement[] = [];
    if (this.white) {
      rows.push(this.row(['Период d', periodText(lines)]));
      rows.push(this.row(['Порядок k', 'спектр: от фиолетового до красного'], true));
      rows.push(this.row(['0', 'белая полоса, 0°']));
      for (const r of spectra(lines)) rows.push(this.row(r));
      const more = Math.floor((MM - 1) / (L_MIN * lines));
      if (more > 6) rows.push(this.row(['…', `ещё ${more - 6}`]));
      rows.push(this.row(['Перекрываются', overlap(lines)], false, 'grt-main'));
    } else {
      const [d, ratio, km, n] = summary(lambda, lines);
      rows.push(this.row(['Период d', d]));
      rows.push(this.row(['d / λ', ratio]));
      rows.push(this.row(['Наибольший порядок k_max', km]));
      rows.push(this.row(['Всего максимумов 2k_max + 1', n], false, 'grt-main'));
      rows.push(this.row(['k', 'sin φ', 'φ'], true));
      for (const r of orders(lambda, lines)) rows.push(this.row(r));
      const k = kMax(lambda, lines);
      if (k > 6) rows.push(this.row(['…', `ещё ${k - 6}`]));
      const z = ninety(lambda, lines);
      if (z !== null) rows.push(this.row([String(z), '1', '90°: вдоль решётки, не виден']));
    }
    this.table.replaceChildren(...rows);
    this.draw();
  }

  /** A ray from (x1, y1) to (x2, y2) with an arrowhead at `at` of its length. */
  private ray(x1: number, y1: number, x2: number, y2: number, at = 0.6): SVGElement[] {
    const n = Math.hypot(x2 - x1, y2 - y1) || 1;
    const ux = (x2 - x1) / n;
    const uy = (y2 - y1) / n;
    const mx = x1 + (x2 - x1) * at;
    const my = y1 + (y2 - y1) * at;
    const tip = [mx + ux * 5, my + uy * 5];
    const bx = mx - ux * 3.5;
    const by = my - uy * 3.5;
    return [
      el('path', { d: `M${f1(x1)} ${f1(y1)}L${f1(x2)} ${f1(y2)}`, class: 'grt-ray' }),
      el('path', {
        d: `M${f1(tip[0])} ${f1(tip[1])}L${f1(bx - uy * 4)} ${f1(by + ux * 4)}L${f1(bx + uy * 4)} ${f1(by - ux * 4)}Z`,
        class: 'grt-head',
      }),
    ];
  }

  private label(x: number, y: number, text: string, anchor = 'start', cls = 'grt-label'): SVGTextElement {
    return el('text', { x: f1(x), y: f1(y), 'text-anchor': anchor, class: cls }, text);
  }

  private draw(): void {
    const { gx, gy, R, ax, h } = S;
    const { lambda, lines } = this;
    const parts: SVGElement[] = [];
    const yOf = (s: number): number => gy - R * s;
    const onArc = (s: number): [number, number] => {
      const c = Math.sqrt(Math.max(0, 1 - s * s));
      return [gx + R * c, gy - R * s];
    };
    parts.push(el('path', { d: `M${gx} ${gy - R}A${R} ${R} 0 0 1 ${gx} ${gy + R}`, class: 'grt-screen' }));
    parts.push(el('path', { d: `M${ax} ${h - 8}V8`, class: 'grt-axis' }));
    parts.push(el('path', { d: `M${ax} 4l-4 9h8z`, class: 'grt-dot' }));
    for (const s of [1, -1]) parts.push(el('path', { d: `M${ax - 5} ${f1(yOf(s))}H${ax + 5}`, class: 'grt-axis' }));
    parts.push(this.label(ax - 8, yOf(1) + 5, '1', 'end', 'grt-label grt-small'));
    parts.push(this.label(ax - 8, yOf(-1) + 5, '−1', 'end', 'grt-label grt-small'));
    const sl = this.label(ax - 8, 16, '', 'end', 'grt-label grt-small');
    sl.append('sin ', el('tspan', { 'font-style': 'italic' }, 'φ'));
    parts.push(sl);
    // light in and the grating
    for (const y of [gy - 14, gy + 14]) parts.push(...this.ray(6, y, gx - 4, y, 0.5));
    parts.push(el('path', { d: `M${gx} ${gy - 30}V${gy + 30}`, class: 'grt-grating' }));

    if (this.white) {
      const k = Math.floor((MM - 1) / (L_MIN * lines));
      for (let o = 1; o <= k; o++) {
        const sv = sinPhi(o, L_MIN, lines);
        const sr = Math.min(1, sinPhi(o, L_MAX, lines));
        for (const sign of [1, -1]) {
          const pts: string[] = [`M${gx} ${gy}`];
          for (let i = 0; i <= 16; i++) {
            const [x, y] = onArc(sign * (sv + ((sr - sv) * i) / 16));
            pts.push(`L${f1(x)} ${f1(y)}`);
          }
          parts.push(el('path', { d: pts.join('') + 'Z', class: 'grt-band' }));
          const y1 = yOf(sign * sv);
          const y2 = yOf(sign * sr);
          parts.push(el('rect', { x: ax - 6, y: f1(Math.min(y1, y2)), width: 12, height: f1(Math.abs(y2 - y1)), class: 'grt-band grt-edge' }));
        }
        if (o <= 3) {
          const yv = yOf(sv);
          const yr = yOf(sr);
          parts.push(this.label(ax + 12, yv + 4, `ф${o}`, 'start', 'grt-label grt-small'));
          if (sr < 1 && yv - yr > 26) parts.push(this.label(ax + 12, yr + 10, `к${o}`, 'start', 'grt-label grt-small'));
        }
      }
      parts.push(...this.ray(gx, gy, gx + R, gy));
      parts.push(el('circle', { cx: ax, cy: gy, r: 3.5, class: 'grt-dot' }));
      parts.push(this.label(ax + 12, gy + 5, 'белый', 'start', 'grt-label grt-small'));
    } else {
      const k = kMax(lambda, lines);
      const step = R * sinPhi(1, lambda, lines);
      const every = step >= 15 ? 1 : Math.ceil(15 / step);
      for (let o = -k; o <= k; o++) {
        const s = sinPhi(o, lambda, lines);
        const [x, y] = onArc(s);
        parts.push(el('path', { d: `M${f1(x + 3)} ${f1(y)}H${ax}`, class: 'grt-guide' }));
        parts.push(...this.ray(gx, gy, x, y));
        parts.push(el('circle', { cx: ax, cy: f1(y), r: 3, class: 'grt-dot' }));
        if (o % every === 0 || Math.abs(o) === k) {
          parts.push(this.label(ax + 10, y + 4.5, `k${NBSP}=${NBSP}${o < 0 ? '−' : ''}${Math.abs(o)}`, 'start', 'grt-label grt-small'));
        }
      }
      const z = ninety(lambda, lines);
      if (z !== null) {
        for (const sign of [1, -1]) {
          parts.push(el('circle', { cx: ax, cy: f1(yOf(sign)), r: 4, class: 'grt-hollow' }));
          parts.push(el('path', { d: `M${gx} ${gy}V${f1(yOf(sign))}`, class: 'grt-guide' }));
        }
        parts.push(this.label(ax - 10, yOf(1) - 6, `k${NBSP}=${NBSP}${z}: 90°`, 'end', 'grt-label grt-small grt-muted'));
      }
    }
    this.scene.replaceChildren(...parts);
  }
}

if (!customElements.get('pp-grating')) customElements.define('pp-grating', GratingSim);
