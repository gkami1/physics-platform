// <pp-uniform v="10"> — uniform motion: a car on a 100 m road drops a mark every second,
// and its path-time graph is drawn live underneath. The previous run stays as a dashed
// line, so two speeds can be compared: the faster, the steeper.
//
// Written into theory Markdown as plain HTML; the theory page imports this module only when
// such an element is present. Light DOM, site CSS variables: follows the light/dark theme.

const SVG_NS = 'http://www.w3.org/2000/svg';

const ROAD_M = 100; // road length, м
const T_MAX = 10; // graph window, с
const V = { min: 2, max: 20 };
// Layout (viewBox units): road on top, graph below, shared left edge.
const L = { w: 400, h: 318, left: 44, right: 16, roadY: 46, graphTop: 92, graphBottom: 290 };
const xRoad = (s: number) => L.left + (s / ROAD_M) * (L.w - L.left - L.right);
const xT = (t: number) => L.left + (t / T_MAX) * (L.w - L.left - L.right);
const yS = (s: number) => L.graphBottom - (s / ROAD_M) * (L.graphBottom - L.graphTop);

const ru = (n: number, digits = 1) =>
  (Math.round(n * 10 ** digits) / 10 ** digits).toFixed(digits).replace('.', ',').replace(/,0$/, '');

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

/** When the run ends: at the end of the road or of the graph window. */
export function runTime(v: number): number {
  return Math.min(T_MAX, ROAD_M / v);
}

class UniformSim extends HTMLElement {
  private v = 10;
  private frame = 0;
  private built = false;
  private svg!: SVGSVGElement;
  private car!: SVGGElement;
  private marks!: SVGGElement;
  private line!: SVGPolylineElement;
  private dot!: SVGCircleElement;
  private previous!: SVGGElement;
  private readout!: HTMLElement;
  private out!: HTMLOutputElement;
  private go!: HTMLButtonElement;
  private last: { v: number; t: number } | null = null;

  connectedCallback(): void {
    if (this.built) return;
    this.built = true;
    const v = Number(this.getAttribute('v') ?? 10);
    this.v = Number.isFinite(v) ? Math.min(V.max, Math.max(V.min, Math.round(v))) : 10;
    this.replaceChildren(); // drop the no-JS fallback text
    this.classList.add('sim', 'unf');
    this.buildScene();
    this.buildControls();
    this.reset();
  }

  disconnectedCallback(): void {
    cancelAnimationFrame(this.frame);
  }

  private buildScene(): void {
    this.svg = el('svg', {
      viewBox: `0 0 ${L.w} ${L.h}`,
      class: 'sim-svg',
      role: 'img',
      'aria-label': 'Машина едет по дороге длиной 100 метров, под ней строится график пути от времени',
    });

    // Road with a scale every 10 м.
    const road = el('g', { class: 'unf-road' });
    road.append(el('line', { x1: xRoad(0), x2: xRoad(ROAD_M), y1: L.roadY, y2: L.roadY }));
    for (let s = 0; s <= ROAD_M; s += 10) {
      road.append(el('line', { x1: xRoad(s), x2: xRoad(s), y1: L.roadY, y2: L.roadY + 4 }));
      if (s % 20 === 0) {
        road.append(el('text', { x: xRoad(s), y: L.roadY + 16, 'text-anchor': 'middle' }, `${s}`));
      }
    }
    road.append(el('text', { x: xRoad(ROAD_M), y: L.roadY + 28, 'text-anchor': 'end' }, 's, м'));
    this.marks = el('g', { class: 'unf-marks' });

    // The car: drawn with its front at x = 0, moved by translate.
    this.car = el('g', { class: 'unf-car' });
    this.car.append(
      el('rect', { x: -26, y: -15, width: 26, height: 9, rx: 3 }),
      el('path', { d: 'M-20 -15L-16 -21H-8L-4 -15Z' }),
      el('circle', { cx: -20, cy: -4, r: 3.2, class: 'unf-wheel' }),
      el('circle', { cx: -6, cy: -4, r: 3.2, class: 'unf-wheel' }),
    );

    // Graph s(t).
    const grid = el('g', { class: 'sim-grid' });
    for (let t = 1; t <= T_MAX; t++) {
      grid.append(el('line', { x1: xT(t), x2: xT(t), y1: yS(0), y2: yS(ROAD_M) }));
      if (t % 2 === 0) {
        grid.append(el('text', { x: xT(t), y: yS(0) + 15, 'text-anchor': 'middle' }, `${t}`));
      }
    }
    for (let s = 10; s <= ROAD_M; s += 10) {
      grid.append(el('line', { x1: xT(0), x2: xT(T_MAX), y1: yS(s), y2: yS(s) }));
      if (s % 20 === 0) {
        grid.append(el('text', { x: xT(0) - 6, y: yS(s) + 4, 'text-anchor': 'end' }, `${s}`));
      }
    }
    const axes = el('g', { class: 'unf-axes' });
    axes.append(
      el('line', { x1: xT(0), x2: xT(T_MAX), y1: yS(0), y2: yS(0) }),
      el('line', { x1: xT(0), x2: xT(0), y1: yS(0), y2: yS(ROAD_M) - 4 }),
      el('text', { x: xT(T_MAX), y: yS(0) + 28, 'text-anchor': 'end' }, 't, с'),
      el('text', { x: xT(0) + 6, y: yS(ROAD_M) - 8 }, 's, м'),
      el('text', { x: xT(0) - 6, y: yS(0) + 15, 'text-anchor': 'end' }, '0'),
    );
    this.previous = el('g', { class: 'unf-previous' });
    this.line = el('polyline', { class: 'unf-line', points: '' });
    this.dot = el('circle', { class: 'unf-dot', r: 4 });

    this.svg.append(road, this.marks, this.car, grid, axes, this.previous, this.line, this.dot);
    this.append(this.svg);
  }

  private buildControls(): void {
    const controls = document.createElement('div');
    controls.className = 'sim-controls';
    const label = document.createElement('label');
    label.className = 'sim-slider';
    const name = document.createElement('span');
    name.textContent = 'Скорость';
    this.out = document.createElement('output');
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(V.min);
    input.max = String(V.max);
    input.step = '1';
    input.value = String(this.v);
    input.addEventListener('input', () => {
      this.v = Number(input.value);
      this.reset();
    });
    label.append(name, this.out, input);
    controls.append(label);

    const row = document.createElement('div');
    row.className = 'sim-row';
    this.go = document.createElement('button');
    this.go.type = 'button';
    this.go.className = 'btn small';
    this.go.textContent = 'Поехали';
    this.go.addEventListener('click', () => this.run());
    row.append(this.go);

    this.readout = document.createElement('p');
    this.readout.className = 'sim-readout';
    this.readout.setAttribute('aria-live', 'polite');
    this.append(controls, row, this.readout);
  }

  /** New speed: car back to the start, the last finished run stays dashed. */
  private reset(): void {
    cancelAnimationFrame(this.frame);
    this.out.textContent = `${this.v} м/с ≈ ${ru(this.v * 3.6, 0)} км/ч`;
    this.marks.replaceChildren();
    this.drawPrevious();
    this.place(0);
    this.readout.textContent = `Нажми «Поехали»: машина каждую секунду проезжает ${this.v} м.`;
  }

  private run(): void {
    cancelAnimationFrame(this.frame);
    this.marks.replaceChildren();
    const end = runTime(this.v);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      for (let t = 1; t <= end + 1e-9; t++) this.mark(t);
      this.finish(end);
      return;
    }
    const start = performance.now();
    let marked = 0;
    const tick = (now: number) => {
      const t = Math.min(end, (now - start) / 1000);
      while (marked + 1 <= t) this.mark(++marked);
      this.place(t);
      this.readout.textContent = `t = ${ru(t)} с · s = ${ru(this.v * t)} м`;
      if (t >= end) {
        this.finish(end);
        return;
      }
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  private finish(end: number): void {
    this.place(end);
    const s = this.v * end;
    this.readout.textContent =
      `За ${ru(end)} с машина проехала ${ru(s)} м: каждую секунду по ${this.v} м, ` +
      `отметки на дороге через равные промежутки. График — прямая из начала координат.`;
    this.last = { v: this.v, t: end };
  }

  /** Car and graph at time t. */
  private place(t: number): void {
    const s = this.v * t;
    this.car.setAttribute('transform', `translate(${xRoad(s).toFixed(1)} ${L.roadY})`);
    this.line.setAttribute(
      'points',
      `${xT(0)},${yS(0)} ${xT(t).toFixed(1)},${yS(s).toFixed(1)}`,
    );
    this.dot.setAttribute('cx', xT(t).toFixed(1));
    this.dot.setAttribute('cy', yS(s).toFixed(1));
  }

  /** A mark on the road where the car is at the end of second t. */
  private mark(t: number): void {
    const x = xRoad(this.v * t);
    const g = el('g');
    g.append(el('line', { x1: x, x2: x, y1: L.roadY - 30, y2: L.roadY - 24 }));
    // Labels collide at low speeds: then only every other second.
    const gap = xRoad(this.v) - xRoad(0);
    if (gap >= 16 || t % 2 === 0) {
      g.append(el('text', { x, y: L.roadY - 32, 'text-anchor': 'middle' }, `${t} с`));
    }
    this.marks.append(g);
  }

  private drawPrevious(): void {
    this.previous.replaceChildren();
    const p = this.last;
    if (!p || p.v === this.v) return;
    const x = xT(p.t);
    const y = yS(p.v * p.t);
    this.previous.append(
      el('line', { x1: xT(0), y1: yS(0), x2: x, y2: y }),
      el('text', { x: x - 4, y: y - 6, 'text-anchor': 'end' }, `${p.v} м/с`),
    );
  }
}

if (!customElements.get('pp-uniform')) customElements.define('pp-uniform', UniformSim);
