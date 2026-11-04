// <pp-accel v0="0" a="2"> — uniformly accelerated motion: a car on a 100 m road drops a mark
// every second (the gaps grow or shrink), and its v(t) graph is drawn live underneath with
// the area under it shaded: that area is the path. A braking car stops and stays stopped.
// The previous run stays as a dashed line for comparison.
//
// Written into theory Markdown as plain HTML; the theory page imports this module only when
// such an element is present. Light DOM, site CSS variables: follows the light/dark theme.
// The road, car and graph reuse the <pp-uniform> styles (`unf-*`).

const SVG_NS = 'http://www.w3.org/2000/svg';

const ROAD_M = 100; // road length, м
const T_MAX = 10; // graph window, с
const V_MAX = 20; // graph height, м/с
const V0 = { min: 0, max: 20, step: 1 };
const A = { min: -4, max: 4, step: 0.5 };
const AFTER_STOP_S = 2; // keep the clock running this long after a braking car stops
const L = { w: 400, h: 318, left: 44, right: 16, roadY: 46, graphTop: 92, graphBottom: 290 };
const xRoad = (s: number) => L.left + (s / ROAD_M) * (L.w - L.left - L.right);
const xT = (t: number) => L.left + (t / T_MAX) * (L.w - L.left - L.right);
const yV = (v: number) => L.graphBottom - (v / V_MAX) * (L.graphBottom - L.graphTop);

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

/** Time a braking car needs to stop; Infinity if it never stops. */
export function stopTime(v0: number, a: number): number {
  return a < 0 ? v0 / -a : v0 === 0 && a === 0 ? 0 : Infinity;
}

/** Speed and path at time t. After a stop the car stands: it never reverses. */
export function state(v0: number, a: number, t: number): { v: number; s: number } {
  const tt = Math.min(t, stopTime(v0, a));
  return { v: v0 + a * tt, s: v0 * tt + (a * tt * tt) / 2 };
}

/** When the run ends: the end of the road, the top or right edge of the graph, or a while
 * after the car has stopped. */
export function runTime(v0: number, a: number): number {
  if (v0 === 0 && a <= 0) return 0; // standing and not speeding up: nothing to run
  let end = T_MAX;
  const stop = stopTime(v0, a);
  if (stop < Infinity) end = Math.min(end, stop + AFTER_STOP_S);
  if (a > 0) end = Math.min(end, (V_MAX - v0) / a);
  // Reaching the end of the road: v0·t + a·t²/2 = ROAD_M.
  const road =
    a === 0 ? (v0 > 0 ? ROAD_M / v0 : Infinity) : (-v0 + Math.sqrt(v0 * v0 + 2 * a * ROAD_M)) / a;
  if (Number.isFinite(road) && road > 0 && road <= stop) end = Math.min(end, road);
  return Math.max(0, end);
}

class AccelSim extends HTMLElement {
  private v0 = 0;
  private a = 2;
  private frame = 0;
  private built = false;
  private car!: SVGGElement;
  private marks!: SVGGElement;
  private area!: SVGPolygonElement;
  private line!: SVGPolylineElement;
  private dot!: SVGCircleElement;
  private previous!: SVGGElement;
  private readout!: HTMLElement;
  private outV0!: HTMLOutputElement;
  private outA!: HTMLOutputElement;
  private last: { v0: number; a: number; t: number } | null = null;

  connectedCallback(): void {
    if (this.built) return;
    this.built = true;
    this.v0 = this.attr('v0', 0, V0);
    this.a = this.attr('a', 2, A);
    this.replaceChildren(); // drop the no-JS fallback text
    this.classList.add('sim', 'acc');
    this.buildScene();
    this.buildControls();
    this.reset();
  }

  disconnectedCallback(): void {
    cancelAnimationFrame(this.frame);
  }

  private attr(name: string, fallback: number, r: { min: number; max: number; step: number }) {
    const n = Number(this.getAttribute(name) ?? fallback);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(r.max, Math.max(r.min, Math.round(n / r.step) * r.step));
  }

  private buildScene(): void {
    const svg = el('svg', {
      viewBox: `0 0 ${L.w} ${L.h}`,
      class: 'sim-svg',
      role: 'img',
      'aria-label':
        'Машина разгоняется или тормозит на дороге длиной 100 метров, под ней строится график скорости от времени',
    });

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

    this.car = el('g', { class: 'unf-car' });
    this.car.append(
      el('rect', { x: -26, y: -15, width: 26, height: 9, rx: 3 }),
      el('path', { d: 'M-20 -15L-16 -21H-8L-4 -15Z' }),
      el('circle', { cx: -20, cy: -4, r: 3.2, class: 'unf-wheel' }),
      el('circle', { cx: -6, cy: -4, r: 3.2, class: 'unf-wheel' }),
    );

    const grid = el('g', { class: 'sim-grid' });
    for (let t = 1; t <= T_MAX; t++) {
      grid.append(el('line', { x1: xT(t), x2: xT(t), y1: yV(0), y2: yV(V_MAX) }));
      if (t % 2 === 0) {
        grid.append(el('text', { x: xT(t), y: yV(0) + 15, 'text-anchor': 'middle' }, `${t}`));
      }
    }
    for (let v = 2; v <= V_MAX; v += 2) {
      grid.append(el('line', { x1: xT(0), x2: xT(T_MAX), y1: yV(v), y2: yV(v) }));
      if (v % 4 === 0) {
        grid.append(el('text', { x: xT(0) - 6, y: yV(v) + 4, 'text-anchor': 'end' }, `${v}`));
      }
    }
    const axes = el('g', { class: 'unf-axes' });
    axes.append(
      el('line', { x1: xT(0), x2: xT(T_MAX), y1: yV(0), y2: yV(0) }),
      el('line', { x1: xT(0), x2: xT(0), y1: yV(0), y2: yV(V_MAX) - 4 }),
      el('text', { x: xT(T_MAX), y: yV(0) + 28, 'text-anchor': 'end' }, 't, с'),
      el('text', { x: xT(0) + 6, y: yV(V_MAX) - 8 }, 'v, м/с'),
      el('text', { x: xT(0) - 6, y: yV(0) + 15, 'text-anchor': 'end' }, '0'),
    );
    this.area = el('polygon', { class: 'acc-area', points: '' });
    this.previous = el('g', { class: 'unf-previous' });
    this.line = el('polyline', { class: 'unf-line', points: '' });
    this.dot = el('circle', { class: 'unf-dot', r: 4 });

    svg.append(road, this.marks, this.car, this.area, grid, axes, this.previous, this.line, this.dot);
    this.append(svg);
  }

  private slider(
    title: string,
    r: { min: number; max: number; step: number },
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
    input.min = String(r.min);
    input.max = String(r.max);
    input.step = String(r.step);
    input.value = String(value);
    input.addEventListener('input', () => onInput(Number(input.value)));
    label.append(name, out, input);
    return [label, out];
  }

  private buildControls(): void {
    const controls = document.createElement('div');
    controls.className = 'sim-controls';
    const [v0, outV0] = this.slider('Начальная скорость', V0, this.v0, (n) => {
      this.v0 = n;
      this.reset();
    });
    const [a, outA] = this.slider('Ускорение', A, this.a, (n) => {
      this.a = n;
      this.reset();
    });
    this.outV0 = outV0;
    this.outA = outA;
    controls.append(v0, a);

    const row = document.createElement('div');
    row.className = 'sim-row';
    const go = document.createElement('button');
    go.type = 'button';
    go.className = 'btn small';
    go.textContent = 'Поехали';
    go.addEventListener('click', () => this.run());
    row.append(go);

    this.readout = document.createElement('p');
    this.readout.className = 'sim-readout';
    this.readout.setAttribute('aria-live', 'polite');
    this.append(controls, row, this.readout);
  }

  private hint(): string {
    if (this.a > 0 && runTime(this.v0, this.a) === 0)
      return `На графике помещается скорость до ${V_MAX} м/с: уменьши начальную скорость.`;
    if (this.v0 === 0 && this.a <= 0) return 'Машина стоит и не разгоняется: задай ускорение больше нуля.';
    if (this.a === 0) return 'Ускорение ноль: скорость не меняется, это равномерное движение.';
    if (this.a > 0) return `Нажми «Поехали»: каждую секунду скорость растёт на ${ru(this.a)} м/с.`;
    return `Нажми «Поехали»: каждую секунду скорость падает на ${ru(-this.a)} м/с.`;
  }

  private reset(): void {
    cancelAnimationFrame(this.frame);
    this.outV0.textContent = `${this.v0} м/с`;
    this.outA.textContent = `${this.a > 0 ? '+' : ''}${ru(this.a)} м/с²`.replace('-', '−');
    this.marks.replaceChildren();
    this.drawPrevious();
    this.place(0);
    this.readout.textContent = this.hint();
  }

  private run(): void {
    cancelAnimationFrame(this.frame);
    this.marks.replaceChildren();
    const end = runTime(this.v0, this.a);
    if (end === 0) {
      this.readout.textContent = this.hint();
      return;
    }
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
      const { v, s } = state(this.v0, this.a, t);
      this.readout.textContent = `t = ${ru(t)} с · v = ${ru(v)} м/с · s = ${ru(s)} м`;
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
    const { v, s } = state(this.v0, this.a, end);
    const stop = stopTime(this.v0, this.a);
    let text =
      `За ${ru(end)} с скорость стала ${ru(v)} м/с, путь ${ru(s)} м — ` +
      `это площадь закрашенной фигуры под графиком.`;
    if (stop <= end) {
      text =
        `Машина остановилась через ${ru(stop)} с и дальше стоит: назад она не поедет. ` +
        `Тормозной путь ${ru(s)} м — площадь треугольника под графиком.`;
    } else if (this.a > 0) {
      text += ' Отметки на дороге всё дальше друг от друга: машина разгоняется.';
    }
    this.readout.textContent = text;
    this.last = { v0: this.v0, a: this.a, t: end };
  }

  /** Points of the v(t) graph from 0 to t, with a corner where the car stops. */
  private graph(v0: number, a: number, t: number): [number, number][] {
    const pts: [number, number][] = [[0, v0]];
    const stop = stopTime(v0, a);
    if (stop < t) pts.push([stop, 0]);
    pts.push([t, state(v0, a, t).v]);
    return pts;
  }

  private place(t: number): void {
    const { s, v } = state(this.v0, this.a, t);
    this.car.setAttribute('transform', `translate(${xRoad(s).toFixed(1)} ${L.roadY})`);
    const pts = this.graph(this.v0, this.a, t).map(([tt, vv]) => `${xT(tt).toFixed(1)},${yV(vv).toFixed(1)}`);
    this.line.setAttribute('points', pts.join(' '));
    this.area.setAttribute(
      'points',
      [`${xT(0)},${yV(0)}`, ...pts, `${xT(t).toFixed(1)},${yV(0)}`].join(' '),
    );
    this.dot.setAttribute('cx', xT(t).toFixed(1));
    this.dot.setAttribute('cy', yV(v).toFixed(1));
  }

  private mark(t: number): void {
    if (t > stopTime(this.v0, this.a)) return; // standing still: no new marks
    const x = xRoad(state(this.v0, this.a, t).s);
    const g = el('g');
    g.append(el('line', { x1: x, x2: x, y1: L.roadY - 30, y2: L.roadY - 24 }));
    const prev = xRoad(state(this.v0, this.a, t - 1).s);
    if (x - prev >= 16 || t % 2 === 0) {
      g.append(el('text', { x, y: L.roadY - 32, 'text-anchor': 'middle' }, `${t} с`));
    }
    this.marks.append(g);
  }

  private drawPrevious(): void {
    this.previous.replaceChildren();
    const p = this.last;
    if (!p || (p.v0 === this.v0 && p.a === this.a)) return;
    const pts = this.graph(p.v0, p.a, p.t).map(([t, v]) => `${xT(t).toFixed(1)},${yV(v).toFixed(1)}`);
    this.previous.append(el('polyline', { points: pts.join(' '), fill: 'none' }));
  }
}

if (!customElements.get('pp-accel')) customElements.define('pp-accel', AccelSim);
