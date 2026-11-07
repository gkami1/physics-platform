// <pp-field q1="5" q2="-5" x="10" y="2" potential> — the electric field of two point charges
// 10 см apart (q₁, q₂ in нКл with sign, −10…10). A grid of small arrows shows the direction of
// E everywhere (brighter where the field is stronger). At the point P (x 0…20 см, y 0…12 см,
// set by two sliders or by tapping the picture) the fields of the two charges E₁ and E₂ are
// drawn with their vector sum E, all three on one scale, so the parallelogram is exact; the
// readout gives E, the distances to the charges and, with the `potential` attribute, φ.
//
// Written into theory Markdown as plain HTML; the theory page imports this module only when
// such an element is present. Light DOM, site CSS variables: follows the light/dark theme.
// Colours as in the electrostatics figures: charges are circles in the text colour with «+» or
// «−», the field's picture (direction arrows) in the text colour, E vectors accent, guides muted.
// Nothing moves on its own, so reduced motion needs no special case.

const SVG_NS = 'http://www.w3.org/2000/svg';

export const K = 9e9; // Н·м²/Кл²
const Q_MAX = 10; // нКл
const X_MAX = 20; // см
const Y_MAX = 12; // см
const NBSP = ' ';
const MINUS = '−';

/** The two charges' positions, см, in the scene's coordinates (y down). */
export const CHARGES: readonly [number, number][] = [
  [5, 6],
  [15, 6],
];

export type Vec = [number, number];

/** Field of a point charge q (нКл) at (cx, cy) in the point (x, y), всё в см; В/м, y down. */
export function fieldOf(q: number, cx: number, cy: number, x: number, y: number): Vec {
  const dx = (x - cx) * 1e-2;
  const dy = (y - cy) * 1e-2;
  const r = Math.hypot(dx, dy);
  if (q === 0 || r === 0) return [0, 0];
  const e = (K * q * 1e-9) / r ** 2;
  return [(e * dx) / r, (e * dy) / r];
}

/** Potential of a point charge q (нКл) at (cx, cy) in (x, y), см; В, zero far away. */
export function potentialOf(q: number, cx: number, cy: number, x: number, y: number): number {
  const r = Math.hypot(x - cx, y - cy) * 1e-2;
  return r === 0 ? 0 : (K * q * 1e-9) / r;
}

/** Fields of both charges and their sum in (x, y). */
export function fields(q1: number, q2: number, x: number, y: number): [Vec, Vec, Vec] {
  const e1 = fieldOf(q1, CHARGES[0][0], CHARGES[0][1], x, y);
  const e2 = fieldOf(q2, CHARGES[1][0], CHARGES[1][1], x, y);
  return [e1, e2, [e1[0] + e2[0], e1[1] + e2[1]]];
}

export function potential(q1: number, q2: number, x: number, y: number): number {
  return potentialOf(q1, CHARGES[0][0], CHARGES[0][1], x, y) + potentialOf(q2, CHARGES[1][0], CHARGES[1][1], x, y);
}

/** Up to three significant digits, a decimal comma, no trailing zeros. */
export function sig3(x: number): string {
  if (x === 0) return '0';
  const digits = Math.max(0, 2 - Math.floor(Math.log10(Math.abs(x))));
  const s = x.toFixed(digits);
  return (s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s).replace('.', ',');
}

/** «E = 17,1 кВ/м» with no-break spaces; В/м below 1 кВ/м, МВ/м from 1 МВ/м. */
export function fieldText(e: number): string {
  const [k, unit] = e < 999.5 ? [1, 'В/м'] : e < 999.5e3 ? [1e-3, 'кВ/м'] : [1e-6, 'МВ/м'];
  const v = Math.abs(e) < 0.5 ? '0' : sig3(e * k);
  return v === '0' ? `E${NBSP}=${NBSP}0` : `E${NBSP}=${NBSP}${v}${NBSP}${unit}`;
}

/** «φ = −270 В» with a real minus, never «−0»; кВ from 1 кВ. */
export function potentialText(phi: number): string {
  const a = Math.abs(phi);
  if (a < 0.5) return `φ${NBSP}=${NBSP}0`;
  const [k, unit] = a < 999.5 ? [1, 'В'] : [1e-3, 'кВ'];
  return `φ${NBSP}=${NBSP}${phi < 0 ? MINUS : ''}${sig3(a * k)}${NBSP}${unit}`;
}

/** «6,4 см» */
export function cmText(d: number): string {
  return `${sig3(Math.round(d * 10) / 10)}${NBSP}см`;
}

/** «+3», «−2», «0» with a real minus sign. */
export function signed(q: number): string {
  if (q === 0) return '0';
  return `${q > 0 ? '+' : MINUS}${Math.abs(q)}`;
}

/**
 * Lengths in px of E₁, E₂ and E at P on one common scale: the longest of the three is 72 px.
 * A common scale keeps the parallelogram exact; the readout gives the size.
 */
export function vectorScale(e1: Vec, e2: Vec, e: Vec): number {
  const m = Math.max(Math.hypot(...e1), Math.hypot(...e2), Math.hypot(...e));
  return m > 0 ? 72 / m : 0;
}

/** Opacity of a direction arrow: 0,2 at 300 В/м and weaker, 1 at 300 кВ/м and stronger. */
export function gridOpacity(e: number): number {
  if (e <= 0) return 0;
  return Math.max(0.2, Math.min(1, 0.2 + (0.8 * (Math.log10(e) - Math.log10(300))) / 3));
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

const L = { w: 400, h: 232, x0: 40, y0: 20, px: 16, rq: 13 };
const X = (cm: number) => L.x0 + L.px * cm;
const Y = (cm: number) => L.y0 + L.px * cm;

class FieldSim extends HTMLElement {
  private q1 = 5;
  private q2 = -5;
  private x = 10;
  private y = 2;
  private showPotential = false;
  private built = false;
  private svg!: SVGSVGElement;
  private grid!: SVGGElement;
  private probe!: SVGGElement;
  private charges!: SVGGElement;
  private inputs: HTMLInputElement[] = [];
  private outs: HTMLOutputElement[] = [];
  private readout!: HTMLElement;

  connectedCallback(): void {
    if (this.built) return;
    this.built = true;
    const num = (name: string, lo: number, hi: number, fallback: number) => {
      const v = Number(this.getAttribute(name));
      return this.hasAttribute(name) && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : fallback;
    };
    this.q1 = num('q1', -Q_MAX, Q_MAX, this.q1);
    this.q2 = num('q2', -Q_MAX, Q_MAX, this.q2);
    this.x = num('x', 0, X_MAX, this.x);
    this.y = num('y', 0, Y_MAX, this.y);
    this.showPotential = this.hasAttribute('potential');
    this.replaceChildren(); // drop the no-JS fallback text
    this.classList.add('sim', 'fld');
    this.build();
    this.update();
  }

  private slider(
    title: string,
    min: number,
    max: number,
    value: number,
    onInput: (n: number) => void,
  ): [HTMLLabelElement, HTMLOutputElement, HTMLInputElement] {
    const label = document.createElement('label');
    label.className = 'sim-slider';
    const name = document.createElement('span');
    name.textContent = title;
    const out = document.createElement('output');
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = '1';
    input.value = String(value);
    input.addEventListener('input', () => onInput(Number(input.value)));
    label.append(name, out, input);
    return [label, out, input];
  }

  private build(): void {
    this.svg = el('svg', {
      viewBox: `0 0 ${L.w} ${L.h}`,
      class: 'sim-svg fld-svg',
      role: 'img',
      'aria-label':
        'Два точечных заряда и их электрическое поле: маленькие стрелки показывают направление ' +
        'напряжённости, в точке P — поля обоих зарядов и их векторная сумма',
    });
    this.grid = el('g', { class: 'fld-grid' });
    this.probe = el('g');
    this.charges = el('g');
    this.svg.append(this.grid, this.charges, this.probe);
    const place = (ev: PointerEvent) => {
      const m = this.svg.getScreenCTM();
      if (!m) return;
      const p = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(m.inverse());
      const x = Math.min(X_MAX, Math.max(0, Math.round((p.x - L.x0) / L.px)));
      const y = Math.min(Y_MAX, Math.max(0, Math.round((p.y - L.y0) / L.px)));
      if (x === this.x && y === this.y) return;
      this.x = x;
      this.y = y;
      this.inputs[2].value = String(x);
      this.inputs[3].value = String(y);
      this.update();
    };
    let dragging = false;
    this.svg.addEventListener('pointerdown', (ev) => {
      dragging = true;
      this.svg.setPointerCapture(ev.pointerId);
      place(ev);
    });
    this.svg.addEventListener('pointermove', (ev) => {
      if (dragging) place(ev);
    });
    const stop = () => {
      dragging = false;
    };
    this.svg.addEventListener('pointerup', stop);
    this.svg.addEventListener('pointercancel', stop);

    const controls = document.createElement('div');
    controls.className = 'sim-controls';
    const set = (k: 'q1' | 'q2' | 'x' | 'y') => (v: number) => {
      this[k] = v;
      this.update();
    };
    const parts = [
      this.slider('Заряд q₁', -Q_MAX, Q_MAX, this.q1, set('q1')),
      this.slider('Заряд q₂', -Q_MAX, Q_MAX, this.q2, set('q2')),
      this.slider('Точка P: вправо', 0, X_MAX, this.x, set('x')),
      this.slider('Точка P: вниз', 0, Y_MAX, this.y, set('y')),
    ];
    for (const [label, out, input] of parts) {
      controls.append(label);
      this.outs.push(out);
      this.inputs.push(input);
    }
    this.readout = document.createElement('p');
    this.readout.className = 'sim-readout';
    this.readout.setAttribute('aria-live', 'polite');
    this.append(this.svg, controls, this.readout);
  }

  private update(): void {
    this.outs[0].textContent = `${signed(this.q1)}${NBSP}нКл`;
    this.outs[1].textContent = `${signed(this.q2)}${NBSP}нКл`;
    this.outs[2].textContent = `${this.x}${NBSP}см`;
    this.outs[3].textContent = `${this.y}${NBSP}см`;
    const r1 = Math.hypot(this.x - CHARGES[0][0], this.y - CHARGES[0][1]);
    const r2 = Math.hypot(this.x - CHARGES[1][0], this.y - CHARGES[1][1]);
    let text: string;
    if ((r1 === 0 && this.q1 !== 0) || (r2 === 0 && this.q2 !== 0)) {
      text = 'Точка P — на самом заряде: там формула точечного заряда не работает. Сдвинь точку.';
    } else {
      const [, , e] = fields(this.q1, this.q2, this.x, this.y);
      text = `В точке P: ${fieldText(Math.hypot(...e))}`;
      if (this.showPotential) text += `, ${potentialText(potential(this.q1, this.q2, this.x, this.y))}`;
      text += `. До q₁ ${cmText(r1)}, до q₂ ${cmText(r2)}.`;
    }
    this.readout.textContent = text;
    this.draw(r1, r2);
  }

  private arrow(x: number, y: number, ux: number, uy: number, len: number, cls: string, head = 8): SVGGElement {
    const g = el('g', { class: cls });
    const tx = x + ux * len;
    const ty = y + uy * len;
    const bx = tx - ux * head;
    const by = ty - uy * head;
    const w = head * 0.45;
    g.append(
      el('line', { x1: x.toFixed(1), y1: y.toFixed(1), x2: (tx - ux * head * 0.7).toFixed(1), y2: (ty - uy * head * 0.7).toFixed(1) }),
      el('path', {
        d: `M${tx.toFixed(1)} ${ty.toFixed(1)}L${(bx - uy * w).toFixed(1)} ${(by + ux * w).toFixed(1)}L${(bx + uy * w).toFixed(1)} ${(by - ux * w).toFixed(1)}Z`,
      }),
    );
    return g;
  }

  private draw(r1: number, r2: number): void {
    // Direction arrows on a 2 см grid, centred on their points, none right next to a charge.
    this.grid.replaceChildren();
    for (let gx = 1; gx < X_MAX; gx += 2) {
      for (let gy = 1; gy < Y_MAX; gy += 2) {
        if (CHARGES.some(([cx, cy]) => Math.hypot(gx - cx, gy - cy) < 1.6)) continue;
        const [, , e] = fields(this.q1, this.q2, gx, gy);
        const m = Math.hypot(...e);
        if (m < 1e-9) continue;
        const ux = e[0] / m;
        const uy = e[1] / m;
        const a = this.arrow(X(gx) - ux * 8, Y(gy) - uy * 8, ux, uy, 16, 'fld-dir', 6);
        a.setAttribute('opacity', gridOpacity(m).toFixed(2));
        this.grid.append(a);
      }
    }
    // Charges.
    this.charges.replaceChildren();
    for (const [i, [cx, cy]] of CHARGES.entries()) {
      const qv = i === 0 ? this.q1 : this.q2;
      const g = el('g', { class: qv === 0 ? 'cou-q cou-q0' : 'cou-q' });
      g.append(
        el('circle', { cx: X(cx), cy: Y(cy), r: L.rq }),
        el('text', { x: X(cx), y: Y(cy) + 6.5, 'text-anchor': 'middle', class: 'cou-sign' }, qv > 0 ? '+' : qv < 0 ? MINUS : '0'),
        el('text', { x: X(cx), y: Y(cy) + L.rq + 20, 'text-anchor': 'middle', class: 'cou-label' }, i === 0 ? 'q₁' : 'q₂'),
      );
      this.charges.append(g);
    }
    // The point P with E₁, E₂ and their sum on one scale.
    this.probe.replaceChildren();
    const px = X(this.x);
    const py = Y(this.y);
    const onCharge = (r1 === 0 && this.q1 !== 0) || (r2 === 0 && this.q2 !== 0);
    if (!onCharge) {
      const [e1, e2, e] = fields(this.q1, this.q2, this.x, this.y);
      const s = vectorScale(e1, e2, e);
      const both = Math.hypot(...e1) > 0 && Math.hypot(...e2) > 0;
      const vecs: [Vec, string, string][] = both
        ? [
            [e1, 'fld-e1', 'E₁'],
            [e2, 'fld-e1', 'E₂'],
            [e, 'fld-e', 'E'],
          ]
        : [[e, 'fld-e', 'E']];
      if (both && s > 0) {
        const a = [px + e1[0] * s, py + e1[1] * s];
        const b = [px + e2[0] * s, py + e2[1] * s];
        const c = [px + e[0] * s, py + e[1] * s];
        this.probe.append(
          el('path', {
            d: `M${a[0].toFixed(1)} ${a[1].toFixed(1)}L${c[0].toFixed(1)} ${c[1].toFixed(1)}L${b[0].toFixed(1)} ${b[1].toFixed(1)}`,
            class: 'fld-guide',
          }),
        );
      }
      for (const [v, cls, name] of vecs) {
        const len = Math.hypot(...v) * s;
        if (len < 6) continue;
        const ux = v[0] / Math.hypot(...v);
        const uy = v[1] / Math.hypot(...v);
        this.probe.append(this.arrow(px, py, ux, uy, len, cls, cls === 'fld-e' ? 10 : 8));
        const lx = Math.min(L.w - 10, Math.max(10, px + ux * (len + 12)));
        const ly = Math.min(L.h - 4, Math.max(16, py + uy * (len + 12) + 5));
        this.probe.append(el('text', { x: lx.toFixed(1), y: ly.toFixed(1), 'text-anchor': 'middle', class: 'fld-name' }, name));
      }
    }
    this.probe.append(
      el('circle', { cx: px, cy: py, r: 4, class: 'fld-p' }),
      el('text', { x: px - 9, y: py - 8, 'text-anchor': 'end', class: 'fld-name' }, 'P'),
    );
  }
}

if (!customElements.get('pp-field')) customElements.define('pp-field', FieldSim);
