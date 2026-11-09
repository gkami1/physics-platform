// <pp-rails> — a rod sliding on two rails in a uniform magnetic field across the picture, seen
// from above. The rails are joined on the left by a resistor R; the rod and the rails have no
// resistance. Chips set the field (towards us: accent dots; away: crosses) and the way the rod
// moves (right: the circuit grows; left: it shrinks); a slider sets the speed 1…5 м/с.
//
// The rod is the source: the Lorentz force on its charges gives the EMF ℰ = Bvl, the current
// I = ℰ/R goes round the circuit (accent arrows on the rod and the rails), and the Ampère force
// on the rod (red) always points against its velocity (green) — Lenz's rule. The area that the
// flux goes through is a muted tint. A table gives B, l and R (accent: they do not change), how
// the flux changes, ℰ, I, the force and the sense of the current.
//
// Without reduced motion the rod slides at a speed proportional to v and starts again from the
// other end; with reduced motion it stands in the middle with all its arrows. The loop runs only
// while the model is on screen.
//
// Written into theory Markdown as plain HTML; the theory page imports this module only when
// such an element is present. Light DOM, site CSS variables: follows the light/dark theme.

const SVG_NS = 'http://www.w3.org/2000/svg';
const NBSP = ' ';

/** The field, the distance between the rails and the resistor. */
export const RAILS = { B: 0.5, l: 0.4, R: 0.5 } as const;
export const SPEEDS = [1, 2, 3, 4, 5]; // м/с
export const SPEED_DEFAULT = 3; // index of 4 м/с
export const PX_PER_MPS = 16; // on-screen speed of the rod, px/s per м/с

export interface State {
  emf: number; // В
  I: number; // А
  F: number; // Н, the Ampère force's magnitude
  rodCurrent: 1 | -1; // the current in the rod on screen: +1 down, −1 up
  forceX: 1 | -1; // the Ampère force on the rod on screen: +1 right, −1 left
  clockwise: boolean; // the current round the circuit as seen by us
  growing: boolean; // the flux through the circuit grows
}

/**
 * The rod moves along x with velocity dir·v (dir +1 to the right, away from the resistor); the
 * field is bz = +1 towards us, −1 away. The force on a positive charge, q v × B, is on screen
 * q·Bz·(−v_y, v_x) = (0, bz·dir): it drives the current along the rod. The Ampère force
 * I l × B on that current is Bz·(−I_y, I_x) = (−bz·I_y, 0).
 */
export function rails(v: number, dir: 1 | -1, bz: 1 | -1, B = RAILS.B, l = RAILS.l, R = RAILS.R): State {
  const emf = B * v * l;
  const I = emf / R;
  const rodCurrent = (bz * dir) as 1 | -1;
  const forceX = (-bz * rodCurrent) as 1 | -1;
  // the rod is the right side of the circuit: a current down it goes round clockwise
  return { emf, I, F: I * B * l, rodCurrent, forceX, clockwise: rodCurrent > 0, growing: dir > 0 };
}

/** `digits` decimals with a decimal comma and «≈» when rounded. */
export function num(x: number, digits: number): string {
  const k = 10 ** digits;
  const r = Math.round(x * k) / k;
  const s = String(r).replace('.', ',');
  return Math.abs(r - x) > 1e-9 * Math.max(1, Math.abs(x)) ? `≈${s}` : s;
}

export function valueText(x: number, unit: string, digits = 2): string {
  return `${num(x, digits)}${NBSP}${unit}`;
}

export function fluxText(growing: boolean): string {
  return growing ? 'растёт' : 'убывает';
}

export function senseText(clockwise: boolean): string {
  return clockwise ? 'по часовой стрелке' : 'против часовой стрелки';
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

/** The scene: rails at top and bottom, the resistor at xr, the rod between xMin and xMax. */
const S = { w: 400, h: 250, top: 62, bottom: 192, xr: 44, xMin: 170, xMax: 362 };

let instances = 0;

class RailsSim extends HTMLElement {
  private vi: number = SPEED_DEFAULT;
  private way: 1 | -1 = 1; // +1 to the right
  private bz: 1 | -1 = -1;
  private x: number = (S.xMin + S.xMax) / 2;
  private frame = 0;
  private last = 0;
  private visible = true;
  private still = false; // prefers reduced motion: the rod stands in the middle
  private built = false;
  private observer: IntersectionObserver | null = null;
  private field!: SVGGElement;
  private scene!: SVGGElement;
  private vOut!: HTMLOutputElement;
  private cells: HTMLTableCellElement[] = [];

  connectedCallback(): void {
    if (this.built) return;
    this.built = true;
    this.still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.replaceChildren(); // drop the no-JS fallback text
    this.classList.add('sim', 'rail');
    this.build();
    this.drawField();
    this.update();
    if (!this.still) {
      this.observer = new IntersectionObserver((entries) => {
        this.visible = entries.some((e) => e.isIntersecting);
        if (this.visible) this.start();
        else cancelAnimationFrame(this.frame);
      });
      this.observer.observe(this);
      this.start();
    }
  }

  disconnectedCallback(): void {
    cancelAnimationFrame(this.frame);
    this.observer?.disconnect();
    this.observer = null;
    this.built = false;
  }

  private chips(id: number, name: string, legend: string, items: [string, string, boolean][], pick: (v: string) => void): HTMLFieldSetElement {
    const set = document.createElement('fieldset');
    set.className = 'pfx-chips rail-chips';
    const lg = document.createElement('legend');
    lg.textContent = legend;
    set.append(lg);
    for (const [value, title, checked] of items) {
      const label = document.createElement('label');
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = `rail-${name}-${id}`;
      radio.value = value;
      radio.checked = checked;
      radio.addEventListener('change', () => {
        if (!radio.checked) return;
        pick(value);
        this.drawField();
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
    const field = this.chips(id, 'b', 'Поле', [['in', 'от нас', true], ['out', 'к нам', false]], (v) => {
      this.bz = v === 'out' ? 1 : -1;
    });
    const way = this.chips(id, 'd', 'Стержень', [['right', 'вправо', true], ['left', 'влево', false]], (v) => {
      this.way = v === 'right' ? 1 : -1;
    });

    const svg = el('svg', {
      viewBox: `0 0 ${S.w} ${S.h}`,
      class: 'sim-svg',
      role: 'img',
      'aria-label':
        'Вид сверху: два рельса, слева соединённые резистором, по ним скользит стержень. Магнитное поле ' +
        'перпендикулярно рисунку: точки — к нам, крестики — от нас. Стрелки показывают скорость стержня, ' +
        'индукционный ток в контуре и силу Ампера на стержень',
    });
    this.field = el('g');
    this.scene = el('g');
    svg.append(this.field, this.scene);

    const controls = document.createElement('div');
    controls.className = 'sim-controls';
    const label = document.createElement('label');
    label.className = 'sim-slider';
    const name = document.createElement('span');
    name.textContent = 'Скорость';
    this.vOut = document.createElement('output');
    const input = document.createElement('input');
    input.type = 'range';
    input.min = '0';
    input.max = String(SPEEDS.length - 1);
    input.step = '1';
    input.value = String(this.vi);
    input.addEventListener('input', () => {
      this.vi = Number(input.value);
      this.update();
    });
    label.append(name, this.vOut, input);
    controls.append(label);

    const table = document.createElement('table');
    table.className = 'rail-table';
    table.setAttribute('aria-live', 'polite');
    const body = document.createElement('tbody');
    const rows = ['Поле B', 'Длина стержня l', 'Сопротивление R', 'Поток через контур', 'ЭДС ℰ = Bvl', 'Ток I = ℰ/R', 'Сила Ампера', 'Ток в контуре идёт'];
    rows.forEach((title, i) => {
      const tr = document.createElement('tr');
      if (i < 3) tr.className = 'rail-fixed';
      const th = document.createElement('th');
      th.scope = 'row';
      th.textContent = title;
      const td = document.createElement('td');
      tr.append(th, td);
      body.append(tr);
      this.cells.push(td);
    });
    table.append(body);
    this.append(field, way, svg, controls, table);
  }

  private start(): void {
    cancelAnimationFrame(this.frame);
    this.last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min((now - this.last) / 1000, 0.1); // a hidden tab must not jump
      this.last = now;
      this.x += this.way * SPEEDS[this.vi] * PX_PER_MPS * dt;
      if (this.x > S.xMax) this.x = S.xMin;
      if (this.x < S.xMin) this.x = S.xMax;
      this.draw();
      if (this.visible) this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  /** The sparse grid of the field: accent dots (towards us) or crosses (away). */
  private drawField(): void {
    const parts: SVGElement[] = [];
    for (let x = 85; x < S.w; x += 50) {
      for (let y = 30; y < S.h; y += 50) {
        if (this.bz > 0) parts.push(el('circle', { cx: x, cy: y, r: 2.2, class: 'rail-dot' }));
        else parts.push(el('path', { d: `M${x - 4.5} ${y - 4.5}l9 9m0 -9l-9 9`, class: 'rail-cross' }));
      }
    }
    this.field.replaceChildren(...parts);
  }

  private update(): void {
    const v = SPEEDS[this.vi];
    const s = rails(v, this.way, this.bz);
    this.vOut.textContent = `${v}${NBSP}м/с`;
    const values = [
      valueText(RAILS.B, 'Тл', 1),
      valueText(RAILS.l, 'м', 1),
      valueText(RAILS.R, 'Ом', 1),
      fluxText(s.growing),
      valueText(s.emf, 'В', 2),
      valueText(s.I, 'А', 2),
      valueText(s.F, 'Н', 2),
      senseText(s.clockwise),
    ];
    values.forEach((t, i) => (this.cells[i].textContent = t));
    this.draw();
  }

  /** An arrow from (x1, y1) to (x2, y2); cls for the shaft, head for the tip. */
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

  private label(x: number, y: number, main: string, sub: string, cls: string): SVGTextElement {
    const t = el('text', { x: f1(x), y: f1(y), 'text-anchor': 'middle', class: `rail-label ${cls}` });
    t.append(el('tspan', { 'font-style': 'italic' }, main));
    if (sub) t.append(el('tspan', { 'baseline-shift': 'sub', 'font-size': '11' }, sub));
    return t;
  }

  private draw(): void {
    const v = SPEEDS[this.vi];
    const s = rails(v, this.way, this.bz);
    const x = this.still ? (S.xMin + S.xMax) / 2 : this.x;
    const { top, bottom, xr } = S;
    const mid = (top + bottom) / 2;
    const parts: SVGElement[] = [];
    // the area the flux goes through
    parts.push(el('rect', { x: xr, y: top, width: f1(x - xr), height: bottom - top, class: 'rail-area' }));
    // rails and the resistor
    parts.push(el('path', { d: `M${xr} ${top}H${S.w - 6}M${xr} ${bottom}H${S.w - 6}`, class: 'rail-wire' }));
    parts.push(el('path', { d: `M${xr} ${top}V${mid - 22}M${xr} ${mid + 22}V${bottom}`, class: 'rail-wire' }));
    parts.push(el('rect', { x: xr - 7, y: mid - 22, width: 14, height: 44, class: 'rail-resistor' }));
    parts.push(this.label(xr + 22, mid + 5, 'R', '', ''));
    // the rod
    parts.push(el('rect', { x: f1(x - 5), y: top - 16, width: 10, height: bottom - top + 32, class: 'rail-rod' }));
    // the current: along the rod, then the rails (towards the resistor along the rail the rod's
    // current reaches, away from it along the other)
    // in the upper part of the rod, on its trailing side, clear of the v and F arrows
    const ix = x - this.way * 14;
    const iy = top + 26;
    parts.push(...this.arrow(ix, iy - s.rodCurrent * 18, ix, iy + s.rodCurrent * 18, 'rail-i', 'rail-i-head'));
    parts.push(this.label(ix - this.way * 12, iy + 5, 'I', '', 'rail-il'));
    const railMid = (xr + x) / 2;
    const reach = s.rodCurrent < 0 ? top : bottom; // the rail at the end the current flows to
    const other = reach === top ? bottom : top;
    const off = (y: number) => (y === top ? y - 12 : y + 12);
    parts.push(...this.arrow(railMid + 16, off(reach), railMid - 16, off(reach), 'rail-i', 'rail-i-head'));
    parts.push(...this.arrow(railMid - 16, off(other), railMid + 16, off(other), 'rail-i', 'rail-i-head'));
    // velocity (green) on the side the rod moves to, the Ampère force (red) on the other side
    const vl = 18 + 8 * v;
    const vy = mid - 14;
    parts.push(...this.arrow(x + this.way * 12, vy, x + this.way * (12 + vl), vy, 'rail-v', 'rail-v-head'));
    parts.push(this.label(x + this.way * (12 + vl + 10), vy + 5, 'v', '', 'rail-vl'));
    const fl = 14 + 7 * v;
    const fy = mid + 16;
    parts.push(...this.arrow(x + s.forceX * 12, fy, x + s.forceX * (12 + fl), fy, 'rail-f', 'rail-f-head'));
    parts.push(this.label(x + s.forceX * (12 + fl + 14), fy + 5, 'F', 'А', 'rail-fl'));
    this.scene.replaceChildren(...parts);
  }
}

if (!customElements.get('pp-rails')) customElements.define('pp-rails', RailsSim);
