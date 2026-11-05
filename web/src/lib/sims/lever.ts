// <pp-lever a="4,-2" b="2,1" c="3,2"> — a ruler on a pivot at its middle with holes every 10 см,
// five each side. Three loads (each «n,k»: n weights of 1 Н hung in hole k, k < 0 left of the
// axis, k > 0 right; n = 0 takes the load off). The readout adds up the moments that turn the
// ruler anticlockwise and clockwise; if they differ, the ruler tips to its stop on the heavier
// side, if they are equal it stays level. The ruler itself is weightless (hung at its middle).
//
// Written into theory Markdown as plain HTML; the theory page imports this module only when
// such an element is present. Light DOM, site CSS variables: follows the light/dark theme.
// Colours as in the dynamics figures: forces red.

const SVG_NS = 'http://www.w3.org/2000/svg';

const HOLES = 5; // each side
const HOLE_M = 0.1; // м between holes
const N_MAX = 5; // weights per load, 1 Н each
const TILT_MAX = 10; // degrees, where the ruler rests against its stop
const L = { w: 400, h: 210, cx: 200, cy: 70, hole: 32, block: 9 };

export interface Load {
  n: number; // weights of 1 Н
  k: number; // hole, −5…5 (0 is the axis)
}

/** Moment of one load about the axis, Н·м: positive turns the ruler clockwise (load right). */
export function moment({ n, k }: Load): number {
  return Math.round(n * k * HOLE_M * 1000) / 1000;
}

/** Sums of the anticlockwise and clockwise moments, Н·м. */
export function sums(loads: Load[]): { ccw: number; cw: number } {
  let ccw = 0;
  let cw = 0;
  for (const l of loads) {
    const m = moment(l);
    if (m < 0) ccw -= m;
    else cw += m;
  }
  const r = (x: number) => Math.round(x * 1000) / 1000;
  return { ccw: r(ccw), cw: r(cw) };
}

/** Where the ruler comes to rest, degrees clockwise: level when balanced, else on a stop. */
export function tilt(loads: Load[]): number {
  const { ccw, cw } = sums(loads);
  if (Math.abs(cw - ccw) < 1e-9) return 0;
  return cw > ccw ? TILT_MAX : -TILT_MAX;
}

const ru = (x: number, digits = 2) =>
  (Math.round(x * 10 ** digits) / 10 ** digits).toFixed(digits).replace('.', ',').replace(/,?0+$/, '') || '0';

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

const NAMES = ['A', 'Б', 'В'];

class LeverSim extends HTMLElement {
  private loads: Load[] = [
    { n: 4, k: -2 },
    { n: 2, k: 1 },
    { n: 0, k: 3 },
  ];
  private angle = 0;
  private frame = 0;
  private built = false;
  private beam!: SVGGElement;
  private hangers!: SVGGElement;
  private outs: HTMLOutputElement[] = [];
  private readout!: HTMLElement;

  connectedCallback(): void {
    if (this.built) return;
    this.built = true;
    ['a', 'b', 'c'].forEach((name, i) => {
      const raw = this.getAttribute(name);
      if (!raw) return;
      const [n, k] = raw.split(',').map(Number);
      if (Number.isFinite(n) && Number.isFinite(k))
        this.loads[i] = {
          n: Math.min(N_MAX, Math.max(0, Math.round(n))),
          k: Math.min(HOLES, Math.max(-HOLES, Math.round(k))),
        };
    });
    this.replaceChildren(); // drop the no-JS fallback text
    this.classList.add('sim', 'lev');
    this.buildScene();
    this.buildControls();
    this.angle = tilt(this.loads);
    this.update(false);
  }

  disconnectedCallback(): void {
    cancelAnimationFrame(this.frame);
  }

  private buildScene(): void {
    const svg = el('svg', {
      viewBox: `0 0 ${L.w} ${L.h}`,
      class: 'sim-svg',
      role: 'img',
      'aria-label': 'Линейка на оси посередине, на неё подвешены грузы. Линейка в равновесии или наклоняется в сторону большего момента',
    });
    const half = (HOLES + 0.5) * L.hole;
    // Stand: a post from the floor to the axis.
    const stand = el('g', { class: 'lev-stand' });
    stand.append(
      el('line', { x1: L.cx, y1: L.cy, x2: L.cx, y2: L.h - 12 }),
      el('line', { x1: L.cx - 40, y1: L.h - 12, x2: L.cx + 40, y2: L.h - 12 }),
    );
    this.beam = el('g');
    this.beam.append(el('rect', { x: L.cx - half, y: L.cy - 5, width: 2 * half, height: 10, rx: 2, class: 'lev-beam' }));
    for (let k = -HOLES; k <= HOLES; k++) {
      const x = L.cx + k * L.hole;
      this.beam.append(el('circle', { cx: x, cy: L.cy, r: k === 0 ? 4 : 2, class: k === 0 ? 'lev-axis' : 'lev-hole' }));
      if (k) this.beam.append(el('text', { x, y: L.cy - 10, 'text-anchor': 'middle', class: 'lev-num' }, String(Math.abs(k))));
    }
    this.hangers = el('g');
    svg.append(stand, this.beam, this.hangers);
    this.append(svg);
  }

  private slider(
    title: string,
    min: number,
    max: number,
    value: number,
    onInput: (n: number) => void,
  ): [HTMLLabelElement, HTMLOutputElement] {
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
    return [label, out];
  }

  private buildControls(): void {
    const controls = document.createElement('div');
    controls.className = 'sim-controls lev-controls';
    this.loads.forEach((load, i) => {
      const [n, outN] = this.slider(`Груз ${NAMES[i]}: сколько гирь по 1 Н`, 0, N_MAX, load.n, (v) => {
        this.loads[i] = { ...this.loads[i], n: v };
        this.update(true);
      });
      const [k, outK] = this.slider(`Груз ${NAMES[i]}: отверстие`, -HOLES, HOLES, load.k, (v) => {
        this.loads[i] = { ...this.loads[i], k: v };
        this.update(true);
      });
      this.outs.push(outN, outK);
      controls.append(n, k);
    });
    this.readout = document.createElement('p');
    this.readout.className = 'sim-readout';
    this.readout.setAttribute('aria-live', 'polite');
    this.append(controls, this.readout);
  }

  private update(animate: boolean): void {
    this.loads.forEach((l, i) => {
      this.outs[2 * i].textContent = `${l.n} Н`;
      this.outs[2 * i + 1].textContent =
        l.k === 0 ? 'на оси' : `${l.k < 0 ? 'слева' : 'справа'}, ${ru(Math.abs(l.k) * HOLE_M, 1)} м`;
    });
    this.readout.textContent = this.verdict();
    const target = tilt(this.loads);
    cancelAnimationFrame(this.frame);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!animate || reduced || target === this.angle) {
      this.angle = target;
      this.draw();
      return;
    }
    const from = this.angle;
    const start = performance.now();
    const tick = (now: number) => {
      const k = Math.min(1, (now - start) / 500);
      this.angle = from + (target - from) * (1 - (1 - k) ** 2);
      this.draw();
      if (k < 1) this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  private verdict(): string {
    const parts = (sign: number) =>
      this.loads
        .filter((l) => l.n > 0 && Math.sign(l.k) === sign)
        .map((l) => `${l.n} · ${ru(Math.abs(l.k) * HOLE_M, 1)}`);
    const { ccw, cw } = sums(this.loads);
    const left = parts(-1);
    const right = parts(1);
    const side = (p: string[], total: number) => (p.length ? `${p.join(' + ')} = ${ru(total)} Н·м` : '0');
    const text = `Против часовой: ${side(left, ccw)}. По часовой: ${side(right, cw)}.`;
    if (Math.abs(ccw - cw) < 1e-9) return `${text} Моменты равны — линейка в равновесии.`;
    return `${text} ${cw > ccw ? 'Перевешивает правая сторона' : 'Перевешивает левая сторона'}: моменты не равны.`;
  }

  /** Beam and loads at the current angle (degrees, clockwise). */
  private draw(): void {
    this.beam.setAttribute('transform', `rotate(${this.angle.toFixed(2)} ${L.cx} ${L.cy})`);
    const a = (this.angle * Math.PI) / 180;
    this.hangers.replaceChildren();
    // Loads in the same hole hang side by side.
    const seen = new Map<number, number>();
    this.loads.forEach((l, i) => {
      if (l.n === 0) return;
      const slot = seen.get(l.k) ?? 0;
      seen.set(l.k, slot + 1);
      const hx = L.cx + l.k * L.hole * Math.cos(a);
      const hy = L.cy + l.k * L.hole * Math.sin(a);
      const x = hx + slot * 12;
      const g = el('g', { class: 'lev-load' });
      const top = hy + 26;
      g.append(el('line', { x1: hx, y1: hy, x2: x, y2: top, class: 'lev-string' }));
      for (let j = 0; j < l.n; j++)
        g.append(el('rect', { x: x - 7, y: top + j * L.block, width: 14, height: L.block - 1.5, rx: 1.5, class: 'lev-weight' }));
      const bottom = top + l.n * L.block;
      // The load's weight: a force arrow, 8 px per Н.
      const len = l.n * 8;
      g.append(
        el('line', { x1: x, y1: bottom + 2, x2: x, y2: bottom + len - 4, class: 'lev-f' }),
        el('path', { d: `M${x} ${bottom + len + 2}L${x - 4} ${bottom + len - 6}L${x + 4} ${bottom + len - 6}Z`, class: 'lev-fh' }),
        el('text', { x: x + (slot ? 9 : -9), y: bottom + len, 'text-anchor': slot ? 'start' : 'end', class: 'lev-name' }, NAMES[i]),
      );
      this.hangers.append(g);
    });
  }
}

if (!customElements.get('pp-lever')) customElements.define('pp-lever', LeverSim);
