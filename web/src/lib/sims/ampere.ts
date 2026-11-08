// <pp-ampere> — a straight conductor in a uniform magnetic field, seen from above. The field
// goes from the pole N (left) to S (right); a slider turns the conductor (0…180°), chips send the
// current from end 1 to end 2 or back. The Ampère force is perpendicular to the picture: a red
// circle with a dot (towards us) or a cross (away from us) at the conductor's middle. Muted
// dashed legs show the part of the conductor across the field, l sin α. A table gives I, B and l
// (in accent: they do not change), the angle α between the current and B, sin α, the force
// F = IBl sin α and its direction. Nothing is animated, so reduced motion needs nothing special.
//
// Written into theory Markdown as plain HTML; the theory page imports this module only when
// such an element is present. Light DOM, site CSS variables: follows the light/dark theme.
// Colours as in the magnetism figures: field lines in the text colour with arrowheads, the N
// pole an accent tint and S a muted tint, the current an accent arrow beside the conductor, the
// force red, guides muted.

const SVG_NS = 'http://www.w3.org/2000/svg';
const NBSP = ' ';

/** The fixed current, field and length: F_max = IBl = 0,9 Н. */
export const AMP = { I: 2.5, B: 0.6, l: 0.6 } as const;
export const ANGLES = Array.from({ length: 37 }, (_, k) => k * 5); // the conductor's turn, degrees
export const ANGLE_DEFAULT = 12; // index of 60°

export type Direction = 'out' | 'in' | 'none';

export interface Force {
  alpha: number; // the angle between the current and B, whole degrees
  sin: number; // sin α
  F: number; // |F|, Н
  dir: Direction; // 'out': towards us, 'in': away from us
}

/**
 * The Ampère force F = I l × B for a conductor turned by phi degrees from B (counter-clockwise,
 * seen from above), the current from end 1 to end 2 (or back, with reverse). B points along +x.
 */
export function ampere(phi: number, reverse: boolean, I = AMP.I, B = AMP.B, l = AMP.l): Force {
  const a = (phi * Math.PI) / 180;
  const s = reverse ? -1 : 1;
  const ux = s * Math.cos(a);
  const uy = s * Math.sin(a); // y up
  // (ux, uy, 0) × (1, 0, 0) = (0, 0, −uy)
  const fz = -I * B * l * uy;
  const eps = 1e-9;
  const alpha = Math.round((Math.acos(Math.max(-1, Math.min(1, ux))) * 180) / Math.PI);
  const sin = Math.abs(uy) < eps ? 0 : Math.abs(uy);
  return { alpha, sin, F: Math.abs(fz) < eps ? 0 : Math.abs(fz), dir: fz > eps ? 'out' : fz < -eps ? 'in' : 'none' };
}

/** Two decimals with a decimal comma, «≈» when rounded; whole numbers without decimals. */
export function num(x: number): string {
  const r = Math.round(x * 100) / 100;
  const s = String(r).replace('.', ',');
  return Math.abs(r - x) > 1e-9 ? `≈${s}` : s;
}

export function unitText(x: number, unit: string): string {
  return `${num(x)}${NBSP}${unit}`;
}

export function directionText(d: Direction): string {
  return d === 'out' ? 'к нам' : d === 'in' ? 'от нас' : 'силы нет';
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

const S = { w: 400, h: 280, cx: 200, cy: 140, half: 90, lines: [30, 70, 110, 170, 210, 250] };

let instances = 0;

class AmpereSim extends HTMLElement {
  private ai: number = ANGLE_DEFAULT;
  private reverse = false;
  private built = false;
  private scene!: SVGGElement;
  private aOut!: HTMLOutputElement;
  private cells: HTMLTableCellElement[] = [];

  connectedCallback(): void {
    if (this.built) return;
    this.built = true;
    this.replaceChildren(); // drop the no-JS fallback text
    this.classList.add('sim', 'amp');
    this.build();
    this.draw();
  }

  private build(): void {
    const id = ++instances;
    const set = document.createElement('fieldset');
    set.className = 'pfx-chips amp-chips';
    const legend = document.createElement('legend');
    legend.textContent = 'Ток';
    set.append(legend);
    for (const [value, title] of [
      [false, 'от 1 к 2'],
      [true, 'от 2 к 1'],
    ] as const) {
      const label = document.createElement('label');
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = `amp-${id}`;
      radio.value = value ? 'back' : 'forth';
      radio.checked = this.reverse === value;
      radio.addEventListener('change', () => {
        if (!radio.checked) return;
        this.reverse = value;
        this.draw();
      });
      const span = document.createElement('span');
      span.textContent = title;
      label.append(radio, span);
      set.append(label);
    }

    const svg = el('svg', {
      viewBox: `0 0 ${S.w} ${S.h}`,
      class: 'sim-svg',
      role: 'img',
      'aria-label':
        'Вид сверху: однородное магнитное поле от полюса N к полюсу S и прямой проводник с током, ' +
        'повёрнутый к линиям поля. Сила Ампера перпендикулярна рисунку: кружок с точкой — к нам, ' +
        'с крестиком — от нас',
    });
    this.scene = el('g');
    svg.append(this.scene);

    const controls = document.createElement('div');
    controls.className = 'sim-controls';
    const label = document.createElement('label');
    label.className = 'sim-slider';
    const name = document.createElement('span');
    name.textContent = 'Поворот проводника';
    this.aOut = document.createElement('output');
    const input = document.createElement('input');
    input.type = 'range';
    input.min = '0';
    input.max = String(ANGLES.length - 1);
    input.step = '1';
    input.value = String(this.ai);
    input.addEventListener('input', () => {
      this.ai = Number(input.value);
      this.draw();
    });
    label.append(name, this.aOut, input);
    controls.append(label);

    const table = document.createElement('table');
    table.className = 'amp-table';
    table.setAttribute('aria-live', 'polite');
    const body = document.createElement('tbody');
    ['Ток I, поле B, длина l', 'Угол α между током и B', 'sin α', 'Сила Ампера IBl sin α', 'Направление силы'].forEach(
      (title, i) => {
        const tr = document.createElement('tr');
        if (i === 0) tr.className = 'amp-fixed';
        const th = document.createElement('th');
        th.scope = 'row';
        th.textContent = title;
        const td = document.createElement('td');
        tr.append(th, td);
        body.append(tr);
        this.cells.push(td);
      },
    );
    table.append(body);
    this.append(set, svg, controls, table);
  }

  private text(x: number, y: number, s: string, cls: string, anchor = 'middle'): SVGTextElement {
    return el('text', { x: f1(x), y: f1(y), 'text-anchor': anchor, class: cls }, s);
  }

  /** An arrow from (x1, y1) to (x2, y2) in screen coordinates; cls for the shaft, head for the tip. */
  private arrow(x1: number, y1: number, x2: number, y2: number, cls: string, head: string): SVGElement[] {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const n = Math.hypot(dx, dy) || 1;
    const ux = dx / n;
    const uy = dy / n;
    const h = 9;
    const bx = x2 - ux * h;
    const by = y2 - uy * h;
    return [
      el('path', { d: `M${f1(x1)} ${f1(y1)}L${f1(x2 - ux * 6)} ${f1(y2 - uy * 6)}`, class: cls }),
      el('path', {
        d: `M${f1(x2)} ${f1(y2)}L${f1(bx - uy * 4)} ${f1(by + ux * 4)}L${f1(bx + uy * 4)} ${f1(by - ux * 4)}Z`,
        class: head,
      }),
    ];
  }

  private draw(): void {
    const phi = ANGLES[this.ai];
    const f = ampere(phi, this.reverse);
    this.aOut.textContent = `${phi}°`;
    const values = [
      `${unitText(AMP.I, 'А')}, ${unitText(AMP.B, 'Тл')}, ${unitText(AMP.l, 'м')} — не меняются`,
      `${f.alpha}°`,
      num(f.sin),
      unitText(f.F, 'Н'),
      directionText(f.dir),
    ];
    values.forEach((t, i) => (this.cells[i].textContent = t));

    const { cx, cy, half } = S;
    const a = (phi * Math.PI) / 180;
    // the rod from end 1 to end 2, screen coordinates (y down)
    const x1 = cx - half * Math.cos(a);
    const y1 = cy + half * Math.sin(a);
    const x2 = cx + half * Math.cos(a);
    const y2 = cy - half * Math.sin(a);
    // the current's direction (screen) and its angle in degrees (math, y up)
    const s = this.reverse ? -1 : 1;
    const ux = s * Math.cos(a);
    const uy = -s * Math.sin(a);
    const theta = Math.atan2(-uy, ux); // radians, (−π, π]

    const parts: SVGElement[] = [];
    // poles and field lines
    parts.push(
      el('rect', { x: 6, y: 14, width: 30, height: 252, class: 'amp-pole-n' }),
      el('rect', { x: 364, y: 14, width: 30, height: 252, class: 'amp-pole-s' }),
      this.text(21, cy + 6, 'N', 'amp-pole'),
      this.text(379, cy + 6, 'S', 'amp-pole'),
    );
    for (const y of S.lines) {
      parts.push(el('path', { d: `M36 ${y}H364`, class: 'amp-line' }));
      parts.push(el('path', { d: `M${y < cy ? 72 : 336} ${y}l-9 -4v8z`, class: 'amp-head' }));
    }
    parts.push(...this.arrow(296, 50, 344, 50, 'amp-b', 'amp-b-head'), this.text(288, 55, 'B', 'amp-label amp-it amp-bl', 'end'));

    // the part across the field: muted dashed legs from end 1 to end 2
    const across = Math.abs(y2 - y1) > 0.5;
    if (Math.abs(x2 - x1) > 0.5 || across) {
      parts.push(el('path', { d: `M${f1(x1)} ${f1(y1)}H${f1(x2)}V${f1(y2)}`, class: 'amp-guide' }));
    }
    if (across) {
      const right = x2 >= x1 - 0.5;
      const lx = right ? x2 + 8 : x2 - 8;
      const t = el('text', { x: f1(lx), y: f1((y1 + y2) / 2 + 5), 'text-anchor': right ? 'start' : 'end', class: 'amp-label' });
      t.append(el('tspan', { 'font-style': 'italic' }, 'l'), el('tspan', {}, ' sin '), el('tspan', { 'font-style': 'italic' }, 'α'));
      parts.push(t);
    }

    // the rod and its ends
    parts.push(
      el('path', { d: `M${f1(x1)} ${f1(y1)}L${f1(x2)} ${f1(y2)}`, class: 'amp-rod' }),
      this.text(x1 - 16 * Math.cos(a), y1 + 16 * Math.sin(a) + 5, '1', 'amp-end'),
      this.text(x2 + 16 * Math.cos(a), y2 - 16 * Math.sin(a) + 5, '2', 'amp-end'),
    );

    // the angle between the current and B, at the middle
    if (f.alpha > 0) {
      const R = 40;
      const ex = cx + R * Math.cos(theta);
      const ey = cy - R * Math.sin(theta);
      const sweep = theta > 0 ? 0 : 1;
      parts.push(el('path', { d: `M${cx + R} ${cy}A${R} ${R} 0 0 ${sweep} ${f1(ex)} ${f1(ey)}`, class: 'amp-arc' }));
      const mid = theta / 2;
      parts.push(this.text(cx + 54 * Math.cos(mid), cy - 54 * Math.sin(mid) + 5, 'α', 'amp-label amp-it'));
    }

    // the current: an accent arrow beside the rod, on the side away from the angle
    const side = theta >= 0 ? 1 : -1; // rotate the direction by +90° (math) for theta ≥ 0
    const nx = side * -Math.sin(theta);
    const ny = -side * Math.cos(theta); // screen
    const off = 13;
    const p0 = { x: cx + 34 * ux + off * nx, y: cy + 34 * uy + off * ny };
    const p1 = { x: cx + 82 * ux + off * nx, y: cy + 82 * uy + off * ny };
    parts.push(...this.arrow(p0.x, p0.y, p1.x, p1.y, 'amp-current', 'amp-current-head'));
    parts.push(this.text(cx + 58 * ux + 28 * nx, cy + 58 * uy + 28 * ny + 5, 'I', 'amp-label amp-it amp-i'));

    // the force, perpendicular to the picture
    if (f.dir !== 'none') {
      parts.push(el('circle', { cx, cy, r: 12, class: 'amp-force' }));
      if (f.dir === 'out') parts.push(el('circle', { cx, cy, r: 3.2, class: 'amp-force-dot' }));
      else parts.push(el('path', { d: `M${cx - 7} ${cy - 7}L${cx + 7} ${cy + 7}M${cx - 7} ${cy + 7}L${cx + 7} ${cy - 7}`, class: 'amp-force-x' }));
      const back = theta / 2 + Math.PI;
      const fl = el('text', {
        x: f1(cx + 36 * Math.cos(back)),
        y: f1(cy - 36 * Math.sin(back) + 5),
        'text-anchor': 'middle',
        class: 'amp-label amp-f',
      });
      fl.append(el('tspan', { 'font-style': 'italic' }, 'F'), el('tspan', { 'baseline-shift': 'sub', 'font-size': '11' }, 'А'));
      parts.push(fl);
    } else {
      parts.push(this.text(cx, 275, 'ток вдоль линий поля: силы нет', 'amp-note amp-f'));
    }
    this.scene.replaceChildren(...parts);
  }
}

if (!customElements.get('pp-ampere')) customElements.define('pp-ampere', AmpereSim);
