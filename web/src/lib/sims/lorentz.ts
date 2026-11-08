// <pp-lorentz> — a charged particle in a uniform magnetic field across the picture. The particle
// has the mass of a proton and the charge +e or −e (chips), the field points towards us or away
// (chips: accent dots or crosses), a slider sets the speed (2…10 · 10⁵ м/с). The particle goes
// round a circle of radius R = mv/(|q|B): its velocity a green arrow along the circle, the
// Lorentz force a red arrow to the centre, the radius a muted dashed line. All circles start at
// one point, where the particle flies to the right, so a faster particle draws a larger circle
// from the same place. A table gives B (accent: it does not change), R, the period
// T = 2πm/(|q|B) and the sense of rotation.
//
// Without reduced motion the particle goes round once every TURN_S seconds whatever its speed:
// the period does not depend on the speed, and the picture shows exactly that. With reduced
// motion nothing moves: the particle stays at the starting point with its arrows. The loop runs
// only while the model is on screen.
//
// Written into theory Markdown as plain HTML; the theory page imports this module only when
// such an element is present. Light DOM, site CSS variables: follows the light/dark theme.

const SVG_NS = 'http://www.w3.org/2000/svg';
const NBSP = ' ';

/** A particle with the mass of a proton and the charge ±e, in a field of 0,1 Тл. */
export const LOR = { m: 1.67e-27, q: 1.6e-19, B: 0.1 } as const;
// × 10⁵ м/с; below 2 the circle would hide behind the particle
export const SPEEDS = [2, 3, 4, 5, 6, 7, 8, 9, 10];
export const SPEED_DEFAULT = 3; // index of 5 · 10⁵ м/с
export const TURN_S = 4; // seconds per turn on screen, the same for every speed

export interface Orbit {
  r: number; // radius, м
  T: number; // period, с
  F: number; // |F| = |q|vB, Н
  clockwise: boolean; // as seen by us
}

/**
 * The circle of a particle with charge sign·e and speed v (м/с) in a field B towards us
 * (bz = +1) or away (bz = −1). F = q v × B: for a positive charge in a field towards us the
 * force at the top of the circle, where v points right, points down — clockwise.
 */
export function orbit(v: number, sign: 1 | -1, bz: 1 | -1, m = LOR.m, q = LOR.q, B = LOR.B): Orbit {
  return { r: (m * v) / (q * B), T: (2 * Math.PI * m) / (q * B), F: q * v * B, clockwise: sign * bz > 0 };
}

/** The force direction on screen (y down) for velocity (vx, vy): q·Bz·(−vy, vx), unit length. */
export function forceDir(vx: number, vy: number, sign: 1 | -1, bz: 1 | -1): [number, number] {
  const fx = sign * bz * -vy;
  const fy = sign * bz * vx;
  const n = Math.hypot(fx, fy) || 1;
  return [fx / n, fy / n];
}

/** `digits` decimals with a decimal comma and «≈» when rounded. */
export function num(x: number, digits: number): string {
  const k = 10 ** digits;
  const r = Math.round(x * k) / k;
  const s = String(r).replace('.', ',');
  return Math.abs(r - x) > 1e-9 * Math.max(1, Math.abs(x)) ? `≈${s}` : s;
}

export function speedText(k: number): string {
  return `${k}${NBSP}·${NBSP}10⁵${NBSP}м/с`;
}

export function radiusText(r: number): string {
  return `${num(r * 100, 1)}${NBSP}см`;
}

export function periodText(T: number): string {
  return `${num(T * 1e6, 2)}${NBSP}мкс`;
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

/** The scene: the starting point at the top (clockwise) or bottom (counter-clockwise). */
const S = { w: 400, h: 280, x: 200, top: 24, bottom: 256, pxPerCm: 11.4 };

let instances = 0;

class LorentzSim extends HTMLElement {
  private vi: number = SPEED_DEFAULT;
  private sign: 1 | -1 = 1;
  private bz: 1 | -1 = 1;
  private phi = 0; // the angle turned from the starting point, radians
  private frame = 0;
  private last = 0;
  private visible = true;
  private still = false; // prefers reduced motion: the particle stays at the starting point
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
    this.classList.add('sim', 'lor');
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
    set.className = 'pfx-chips lor-chips';
    const lg = document.createElement('legend');
    lg.textContent = legend;
    set.append(lg);
    for (const [value, title, checked] of items) {
      const label = document.createElement('label');
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = `lor-${name}-${id}`;
      radio.value = value;
      radio.checked = checked;
      radio.addEventListener('change', () => {
        if (!radio.checked) return;
        pick(value);
        this.phi = 0; // back to the starting point
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
    const charge = this.chips(id, 'q', 'Заряд', [['plus', '+e', true], ['minus', '−e', false]], (v) => {
      this.sign = v === 'plus' ? 1 : -1;
    });
    const field = this.chips(id, 'b', 'Поле', [['out', 'к нам', true], ['in', 'от нас', false]], (v) => {
      this.bz = v === 'out' ? 1 : -1;
    });

    const svg = el('svg', {
      viewBox: `0 0 ${S.w} ${S.h}`,
      class: 'sim-svg',
      role: 'img',
      'aria-label':
        'Однородное магнитное поле, перпендикулярное рисунку: точки — к нам, крестики — от нас. ' +
        'Заряженная частица движется по окружности; стрелка скорости направлена по касательной, ' +
        'сила Лоренца — к центру',
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
    table.className = 'lor-table';
    table.setAttribute('aria-live', 'polite');
    const body = document.createElement('tbody');
    ['Поле B', 'Радиус R', 'Период T', 'Частица обходит круг'].forEach((title, i) => {
      const tr = document.createElement('tr');
      if (i === 0) tr.className = 'lor-fixed';
      const th = document.createElement('th');
      th.scope = 'row';
      th.textContent = title;
      const td = document.createElement('td');
      tr.append(th, td);
      body.append(tr);
      this.cells.push(td);
    });
    table.append(body);
    this.append(charge, field, svg, controls, table);
  }

  private start(): void {
    cancelAnimationFrame(this.frame);
    this.last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min((now - this.last) / 1000, 0.1); // a hidden tab must not jump
      this.last = now;
      this.phi = (this.phi + (2 * Math.PI * dt) / TURN_S) % (2 * Math.PI);
      this.draw();
      if (this.visible) this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  /** The sparse grid of the field: accent dots (towards us) or crosses (away). */
  private drawField(): void {
    const parts: SVGElement[] = [];
    for (let x = 25; x < S.w; x += 50) {
      for (let y = 20; y < S.h; y += 48) {
        if (this.bz > 0) parts.push(el('circle', { cx: x, cy: y, r: 2.2, class: 'lor-dot' }));
        else parts.push(el('path', { d: `M${x - 4.5} ${y - 4.5}l9 9m0 -9l-9 9`, class: 'lor-cross' }));
      }
    }
    this.field.replaceChildren(...parts);
  }

  private update(): void {
    const k = SPEEDS[this.vi];
    const o = orbit(k * 1e5, this.sign, this.bz);
    this.vOut.textContent = speedText(k);
    const values = [`${String(LOR.B).replace('.', ',')}${NBSP}Тл`, radiusText(o.r), periodText(o.T), senseText(o.clockwise)];
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
    const t = el('text', { x: f1(x), y: f1(y), 'text-anchor': 'middle', class: `lor-label ${cls}` });
    t.append(el('tspan', { 'font-style': 'italic' }, main));
    if (sub) t.append(el('tspan', { 'baseline-shift': 'sub', 'font-size': '11' }, sub));
    return t;
  }

  private draw(): void {
    const k = SPEEDS[this.vi];
    const o = orbit(k * 1e5, this.sign, this.bz);
    const R = o.r * 100 * S.pxPerCm;
    // the starting point: the particle flies to the right there; the centre is below it for a
    // clockwise turn, above it otherwise
    const cw = o.clockwise;
    const y0 = cw ? S.top : S.bottom;
    const cx = S.x;
    const cy = cw ? y0 + R : y0 - R;
    // the particle's angle round the centre (screen, y down); at the start it is straight up
    // (clockwise) or straight down; it moves clockwise on screen when cw
    const a0 = cw ? -Math.PI / 2 : Math.PI / 2;
    const a = a0 + (cw ? 1 : -1) * this.phi;
    const px = cx + R * Math.cos(a);
    const py = cy + R * Math.sin(a);
    // velocity along the tangent in the sense of motion (screen coordinates)
    const vx = cw ? -Math.sin(a) : Math.sin(a);
    const vy = cw ? Math.cos(a) : -Math.cos(a);
    const [fx, fy] = forceDir(vx, vy, this.sign, this.bz);
    const vl = 26 + 4 * k; // the velocity arrow grows with the speed, and so does the force,
    const fl = Math.max(14, Math.min(14 + 3 * k, R - 11)); // but it never pokes past the centre
    const pr = 9;

    const parts: SVGElement[] = [];
    parts.push(el('circle', { cx: f1(cx), cy: f1(cy), r: f1(R), class: 'lor-orbit' }));
    // the radius to the right of the centre, away from the arrows at the start
    parts.push(el('path', { d: `M${f1(cx)} ${f1(cy)}H${f1(cx + R)}`, class: 'lor-guide' }));
    parts.push(el('circle', { cx: f1(cx), cy: f1(cy), r: 2.4, class: 'lor-centre' }));
    // on the side of the radius away from the force label, which ends near the centre
    if (R > 22) parts.push(this.label(cx + R / 2, cw ? cy + 19 : cy - 7, 'R', '', 'lor-r'));
    else parts.push(this.label(cx + R + 14, cy + 5, 'R', '', 'lor-r'));
    parts.push(
      ...this.arrow(px + pr * vx, py + pr * vy, px + (pr + vl) * vx, py + (pr + vl) * vy, 'lor-v', 'lor-v-head'),
      ...this.arrow(px + pr * fx, py + pr * fy, px + (pr + fl) * fx, py + (pr + fl) * fy, 'lor-f', 'lor-f-head'),
    );
    // labels beyond the arrowheads, a little to the side
    parts.push(this.label(px + (pr + vl + 12) * vx - 10 * fx, py + (pr + vl + 12) * vy - 10 * fy + 5, 'v', '', 'lor-vl'));
    parts.push(this.label(px + (pr + fl + 10) * fx + 14 * vx, py + (pr + fl + 10) * fy + 14 * vy + 5, 'F', 'Л', 'lor-fl'));
    parts.push(el('circle', { cx: f1(px), cy: f1(py), r: pr, class: 'lor-particle' }));
    parts.push(el('text', { x: f1(px), y: f1(py + 5), 'text-anchor': 'middle', class: 'lor-sign' }, this.sign > 0 ? '+' : '−'));
    this.scene.replaceChildren(...parts);
  }
}

if (!customElements.get('pp-lorentz')) customElements.define('pp-lorentz', LorentzSim);
