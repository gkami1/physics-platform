// <pp-refract> — a ray at the boundary of two media: reflection, refraction and total internal
// reflection. Chips pick the upper medium (where the light comes from, n₁) and the lower one (n₂)
// among air, water, glass and diamond; a slider sets the angle of incidence α from 0 to 89°.
// The picture follows the optics convention of the figures (lesson 14.x): rays accent with an
// arrowhead in the middle, the incident and refracted rays solid, a weak partial reflection a thin
// dashed ray, a total reflection solid; the normal muted dashed; angles as arcs from the normal;
// denser media surface fills. When n₁ > n₂ the critical angle α₀ is a muted dashed line on the
// incident side; past it the refracted ray disappears and the reflected one becomes solid.
// The table gives α, β = α, γ from n₁ sin α = n₂ sin γ, sin α / sin γ against n₂/n₁ and α₀.
//
// Nothing moves on its own, so reduced motion changes nothing: the default state (glass → water,
// 40°) already shows all three rays and the critical angle. (Glass → air would show α₀ ≈ 42°,
// an intermediate of step task ks-refr-15; water → air shows n₂/n₁ ≈ 0,75, ks-refr-14's answer.)
//
// Written into theory Markdown as plain HTML; the theory page imports this module only when
// such an element is present. Light DOM, site CSS variables: follows the light/dark theme.

const SVG_NS = 'http://www.w3.org/2000/svg';
const NBSP = ' ';

export const MEDIA = [
  ['air', 'воздух', 1],
  ['water', 'вода', 1.33],
  ['glass', 'стекло', 1.5],
  ['diamond', 'алмаз', 2.42],
] as const;

export type MediumId = (typeof MEDIA)[number][0];

export const START = { top: 'glass' as MediumId, bottom: 'water' as MediumId, angle: 40 };
export const MAX_ANGLE = 89;

const RAD = Math.PI / 180;

export function index(id: MediumId): number {
  const m = MEDIA.find((x) => x[0] === id);
  return m ? m[2] : 1;
}

/** The angle of refraction in degrees, or null past the critical angle (total reflection). */
export function refracted(n1: number, n2: number, alpha: number): number | null {
  const s = (n1 * Math.sin(alpha * RAD)) / n2;
  if (s > 1 + 1e-12) return null;
  return Math.asin(Math.min(1, s)) / RAD;
}

/** The critical angle in degrees, or null when the light goes into an equally or more dense medium. */
export function critical(n1: number, n2: number): number | null {
  return n1 > n2 ? Math.asin(n2 / n1) / RAD : null;
}

/** A number with a decimal comma, rounded to `digits` decimals, with «≈» when rounding changed it. */
export function num(x: number, digits = 2): string {
  const r = Number(x.toFixed(digits));
  const text = String(r).replace('.', ',').replace('-', '−');
  return Math.abs(r - x) > 1e-9 ? `≈${NBSP}${text}` : text;
}

/** An angle in whole degrees. */
export function angleText(deg: number): string {
  return `${num(deg, 0)}°`;
}

export function nText(n: number): string {
  return String(n).replace('.', ',');
}

/** The readout rows: γ, sin α / sin γ, n₂/n₁ and α₀. */
export function readout(n1: number, n2: number, alpha: number): string[] {
  const g = refracted(n1, n2, alpha);
  const a0 = critical(n1, n2);
  const gamma = g === null ? 'нет: полное отражение' : angleText(g);
  const ratio = g === null || alpha === 0 ? '—' : num(Math.sin(alpha * RAD) / Math.sin(g * RAD));
  const crit = a0 === null ? (n1 === n2 ? 'нет: среды одинаковые' : 'нет: вторая среда плотнее') : angleText(a0);
  return [angleText(alpha), angleText(alpha), gamma, ratio, num(n2 / n1), crit];
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

/** The scene: the boundary at y = oy, the point of incidence at ox, rays of length L. */
const S = { w: 400, h: 290, ox: 200, oy: 145, L: 125 };

let instances = 0;

class RefractSim extends HTMLElement {
  private top: MediumId = START.top;
  private bottom: MediumId = START.bottom;
  private angle = START.angle;
  private built = false;
  private scene!: SVGGElement;
  private out!: HTMLOutputElement;
  private cells: HTMLTableCellElement[] = [];

  connectedCallback(): void {
    if (this.built) return;
    this.built = true;
    this.replaceChildren(); // drop the no-JS fallback text
    this.classList.add('sim', 'rfr');
    this.build();
    this.update();
  }

  disconnectedCallback(): void {
    this.built = false;
  }

  private chips(id: number, name: string, legend: string, value: MediumId, pick: (v: MediumId) => void): HTMLFieldSetElement {
    const set = document.createElement('fieldset');
    set.className = 'pfx-chips rfr-chips';
    const lg = document.createElement('legend');
    lg.textContent = legend;
    set.append(lg);
    for (const [v, title] of MEDIA) {
      const label = document.createElement('label');
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = `rfr-${name}-${id}`;
      radio.value = v;
      radio.checked = v === value;
      radio.addEventListener('change', () => {
        if (!radio.checked) return;
        pick(v);
        this.update();
      });
      const span = document.createElement('span');
      span.textContent = title;
      label.append(radio, span);
      set.append(label);
    }
    return set;
  }

  private build(): void {
    const id = ++instances;
    const top = this.chips(id, 't', 'Откуда', this.top, (v) => (this.top = v));
    const bottom = this.chips(id, 'b', 'Куда', this.bottom, (v) => (this.bottom = v));

    const svg = el('svg', {
      viewBox: `0 0 ${S.w} ${S.h}`,
      class: 'sim-svg',
      role: 'img',
      'aria-label':
        'Луч света падает сверху на границу двух сред. Пунктир — перпендикуляр к границе. Показаны ' +
        'отражённый и преломлённый лучи и углы падения, отражения и преломления; если свет идёт в менее ' +
        'плотную среду, пунктиром отмечен предельный угол',
    });
    this.scene = el('g');
    svg.append(this.scene);

    const controls = document.createElement('div');
    controls.className = 'sim-controls';
    const label = document.createElement('label');
    label.className = 'sim-slider';
    const span = document.createElement('span');
    span.textContent = 'Угол падения α';
    this.out = document.createElement('output');
    const input = document.createElement('input');
    input.type = 'range';
    input.min = '0';
    input.max = String(MAX_ANGLE);
    input.step = '1';
    input.value = String(this.angle);
    input.addEventListener('input', () => {
      this.angle = Number(input.value);
      this.update();
    });
    label.append(span, this.out, input);
    controls.append(label);

    const table = document.createElement('table');
    table.className = 'rfr-table';
    const body = document.createElement('tbody');
    ['Угол падения α', 'Угол отражения β', 'Угол преломления γ', 'sin α / sin γ', 'n₂ / n₁', 'Предельный угол α₀'].forEach((name, i) => {
      const tr = document.createElement('tr');
      if (i === 2) tr.className = 'rfr-main';
      const th = document.createElement('th');
      th.scope = 'row';
      th.textContent = name;
      const td = document.createElement('td');
      tr.append(th, td);
      body.append(tr);
      this.cells.push(td);
    });
    table.append(body);
    this.append(top, bottom, svg, controls, table);
  }

  private update(): void {
    const n1 = index(this.top);
    const n2 = index(this.bottom);
    this.out.textContent = angleText(this.angle);
    readout(n1, n2, this.angle).forEach((v, i) => (this.cells[i].textContent = v));
    this.draw(n1, n2);
  }

  /** A ray from (x1, y1) to (x2, y2) with an arrowhead at its middle. */
  private ray(x1: number, y1: number, x2: number, y2: number, cls: string): SVGElement[] {
    const n = Math.hypot(x2 - x1, y2 - y1) || 1;
    const ux = (x2 - x1) / n;
    const uy = (y2 - y1) / n;
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    const k = cls === 'rfr-weak' ? 0.8 : 1;
    const tip = [mx + ux * 6 * k, my + uy * 6 * k];
    const bx = mx - ux * 4 * k;
    const by = my - uy * 4 * k;
    return [
      el('path', { d: `M${f1(x1)} ${f1(y1)}L${f1(x2)} ${f1(y2)}`, class: cls }),
      el('path', {
        d: `M${f1(tip[0])} ${f1(tip[1])}L${f1(bx - uy * 4.5 * k)} ${f1(by + ux * 4.5 * k)}L${f1(bx + uy * 4.5 * k)} ${f1(by - ux * 4.5 * k)}Z`,
        class: 'rfr-head',
      }),
    ];
  }

  /** An arc at the point of incidence between two screen angles (degrees, counter-clockwise, y up). */
  private arc(from: number, to: number, r: number, label: string, cls = 'rfr-arc'): SVGElement[] {
    const { ox, oy } = S;
    const at = (deg: number, rr: number): [number, number] => [ox + rr * Math.cos(deg * RAD), oy - rr * Math.sin(deg * RAD)];
    const [x1, y1] = at(from, r);
    const [x2, y2] = at(to, r);
    const out: SVGElement[] = [];
    if (Math.abs(to - from) >= 1) out.push(el('path', { d: `M${f1(x1)} ${f1(y1)}A${r} ${r} 0 0 0 ${f1(x2)} ${f1(y2)}`, class: cls }));
    const [lx, ly] = at((from + to) / 2, r + 14);
    const t = el('text', { x: f1(lx), y: f1(ly + 5), 'text-anchor': 'middle', class: 'rfr-label' });
    t.append(el('tspan', { 'font-style': 'italic' }, label[0]));
    if (label.length > 1) t.append(el('tspan', { 'font-size': '11', dy: '4' }, label.slice(1)));
    out.push(t);
    return out;
  }

  private draw(n1: number, n2: number): void {
    const { w, h, ox, oy, L } = S;
    const a = this.angle;
    const g = refracted(n1, n2, a);
    const a0 = critical(n1, n2);
    const parts: SVGElement[] = [];
    // media: a surface fill for anything denser than air, the denser of two a shade more
    const shade = (n: number, other: number): string => (n === 1 ? 'rfr-air' : n > other && other > 1 ? 'rfr-dense rfr-denser' : 'rfr-dense');
    parts.push(el('rect', { x: 0, y: 0, width: w, height: oy, class: shade(n1, n2) }));
    parts.push(el('rect', { x: 0, y: oy, width: w, height: h - oy, class: shade(n2, n1) }));
    parts.push(el('path', { d: `M0 ${oy}H${w}`, class: 'rfr-boundary' }));
    parts.push(el('path', { d: `M${ox} 12V${h - 12}`, class: 'rfr-normal' }));
    const name = (id: MediumId, n: number): string => `${MEDIA.find((m) => m[0] === id)?.[1] ?? ''}, n${NBSP}=${NBSP}${nText(n)}`;
    parts.push(el('text', { x: 12, y: 24, class: 'rfr-label rfr-small' }, name(this.top, n1)));
    parts.push(el('text', { x: 12, y: oy + 24, class: 'rfr-label rfr-small' }, name(this.bottom, n2)));

    const sa = Math.sin(a * RAD);
    const ca = Math.cos(a * RAD);
    // the critical angle on the incident side
    if (a0 !== null) {
      const sc = Math.sin(a0 * RAD);
      const cc = Math.cos(a0 * RAD);
      parts.push(el('path', { d: `M${ox} ${oy}L${f1(ox - L * 1.05 * sc)} ${f1(oy - L * 1.05 * cc)}`, class: 'rfr-crit' }));
      const t = el('text', { x: f1(ox - L * 1.12 * sc - 4), y: f1(oy - L * 1.12 * cc), 'text-anchor': 'end', class: 'rfr-label rfr-small rfr-muted' });
      t.append(el('tspan', { 'font-style': 'italic' }, 'α'), el('tspan', { 'font-size': '10', dy: '3' }, '0'));
      parts.push(t);
    }
    const same = n1 === n2;
    // reflected: none between equal media, weak with refraction, full past the critical angle
    if (!same) parts.push(...this.ray(ox, oy, ox + L * sa, oy - L * ca, g === null ? 'rfr-ray' : 'rfr-weak'));
    parts.push(...this.ray(ox - L * sa, oy - L * ca, ox, oy, 'rfr-ray'));
    if (g !== null) {
      parts.push(...this.ray(ox, oy, ox + L * Math.sin(g * RAD), oy + L * Math.cos(g * RAD), 'rfr-ray'));
    }
    if (a > 0) {
      parts.push(...this.arc(90, 90 + a, 40, 'α'));
      if (!same) parts.push(...this.arc(90 - a, 90, 52, 'β'));
      if (g !== null && g > 0) parts.push(...this.arc(270, 270 + g, 40, 'γ'));
    }
    if (g === null) {
      parts.push(el('text', { x: ox + 12, y: oy + 30, class: 'rfr-label rfr-small' }, 'полное отражение'));
    }
    this.scene.replaceChildren(...parts);
  }
}

if (!customElements.get('pp-refract')) customElements.define('pp-refract', RefractSim);
