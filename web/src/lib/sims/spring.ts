// <pp-spring m="0.4" k="40" a="6"> — a load on a spring on a smooth table, with a point going
// round a circle of radius A above it: the load is the point's shadow, x = A cos ωt (lesson
// 4.4 seen side-on). Below, a live x(t) graph over 4 s (the previous run stays dimmed, so a
// heavier load or a softer spring shows its longer period next to the old one) and bars of
// the spring's energy kx²/2, the load's kinetic energy mv²/2 and their sum, which keeps its
// length. Arrows: velocity green, acceleration accent, both scaled to their largest values.
//
// The motion is exact: x = A cos ωt with ω = √(k/m). «Пуск» runs 4 s in real time; with
// reduced motion it steps a quarter period at a time through the first period, then to the end.
//
// Written into theory Markdown as plain HTML; the theory page imports this module only when
// such an element is present. Light DOM, site CSS variables: follows the light/dark theme.

const SVG_NS = 'http://www.w3.org/2000/svg';

const M = { min: 0.1, max: 1, step: 0.1 }; // кг
const K = { min: 10, max: 100, step: 10 }; // Н/м
const A = { min: 2, max: 10, step: 1 }; // см
const T_RUN = 4; // с, the graph's width

const L = {
  w: 400,
  h: 424,
  eq: 210, // equilibrium x, px
  pxCm: 5,
  cy: 62, // circle centre
  rail: 168, // floor y
  wall: 30,
  bw: 28,
  bh: 26,
  gx0: 44, // graph: t = 0
  gx1: 364, // t = T_RUN
  gy: 270, // x = 0
  gpx: 4.4, // px per см on the graph
  top: 362, // bars
  row: 18,
  zero: 70,
  bar: 270, // length of the total
};
const ARROW = 44; // px for the largest speed or acceleration

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Russian number: decimal comma, real minus, up to `digits` decimals, trailing zeros dropped. */
export function ru(n: number, digits = 1): string {
  const r = Math.round(n * 10 ** digits) / 10 ** digits;
  const s = (Object.is(r, -0) ? 0 : r).toFixed(digits);
  return (digits ? s.replace(/\.?0+$/, '') : s).replace('.', ',').replace('-', '−');
}

/** Cyclic frequency ω = √(k/m), рад/с. */
export function omega(m: number, k: number): number {
  return Math.sqrt(k / m);
}

/** Period T = 2π√(m/k), с. */
export function period(m: number, k: number): number {
  return 2 * Math.PI * Math.sqrt(m / k);
}

export interface Snap {
  x: number; // м
  v: number; // м/с
  a: number; // м/с²
  ep: number; // Дж, kx²/2
  ek: number; // Дж, mv²/2
}

/** State at time t of a load released from x = A (м) at rest. */
export function snap(t: number, amp: number, m: number, k: number): Snap {
  const w = omega(m, k);
  const x = amp * Math.cos(w * t);
  const v = -amp * w * Math.sin(w * t);
  return { x, v, a: -w * w * x, ep: (k * x * x) / 2, ek: (m * v * v) / 2 };
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

function letter(x: number, y: number, main: string, sub = '', anchor = 'start'): SVGTextElement {
  const t = el('text', { x: x.toFixed(1), y: y.toFixed(1), 'text-anchor': anchor }, main);
  if (sub) t.append(el('tspan', { class: 'spr-sub', dy: 3 }, sub));
  return t;
}

function arrow(x1: number, y1: number, x2: number, y2: number): SVGGElement {
  const g = el('g');
  const len = Math.hypot(x2 - x1, y2 - y1);
  if (len < 4) return g;
  const ux = (x2 - x1) / len;
  const uy = (y2 - y1) / len;
  const head = Math.min(8, len * 0.6);
  const bx = x2 - ux * head;
  const by = y2 - uy * head;
  g.append(
    el('line', { x1: x1.toFixed(1), y1: y1.toFixed(1), x2: (x2 - ux * head * 0.6).toFixed(1), y2: (y2 - uy * head * 0.6).toFixed(1) }),
    el('path', {
      d: `M${x2.toFixed(1)} ${y2.toFixed(1)}L${(bx - uy * 4).toFixed(1)} ${(by + ux * 4).toFixed(1)}L${(bx + uy * 4).toFixed(1)} ${(by - ux * 4).toFixed(1)}Z`,
    }),
  );
  return g;
}

/** Zig-zag spring from x1 to x2 at height y. */
function springPath(x1: number, x2: number, y: number, coils = 12, amp = 7): string {
  const lead = 8;
  const a = x1 + lead;
  const b = x2 - lead;
  const step = (b - a) / (coils * 2);
  let d = `M${x1} ${y}H${a.toFixed(1)}`;
  for (let i = 0; i < coils * 2; i++) {
    const px = a + step * (i + 0.5);
    d += `L${px.toFixed(1)} ${(y + (i % 2 ? amp : -amp)).toFixed(1)}`;
  }
  return `${d}L${b.toFixed(1)} ${y}H${x2.toFixed(1)}`;
}

const tx = (t: number) => L.gx0 + (t / T_RUN) * (L.gx1 - L.gx0);

class SpringSim extends HTMLElement {
  private m = 0.4;
  private k = 40;
  private a = 6;
  private t = 0;
  private quarter = 0;
  private running = false;
  private frame = 0;
  private built = false;
  private previous: string | null = null;
  private moving!: SVGGElement;
  private trace!: SVGPolylineElement;
  private prevLine!: SVGPolylineElement;
  private ticks!: SVGGElement;
  private bars!: SVGGElement;
  private go!: HTMLButtonElement;
  private readout!: HTMLElement;
  private outs: Record<'m' | 'k' | 'a', HTMLOutputElement> = {} as never;

  connectedCallback(): void {
    if (this.built) return;
    this.built = true;
    this.m = this.attr('m', 0.4, M);
    this.k = this.attr('k', 40, K);
    this.a = this.attr('a', 6, A);
    this.replaceChildren(); // drop the no-JS fallback text
    this.classList.add('sim', 'spr');
    this.build();
    this.reset(false);
  }

  disconnectedCallback(): void {
    cancelAnimationFrame(this.frame);
  }

  private attr(name: string, fallback: number, r: { min: number; max: number; step: number }) {
    const n = Number(this.getAttribute(name) ?? fallback);
    if (!Number.isFinite(n)) return fallback;
    return round3(Math.min(r.max, Math.max(r.min, Math.round(n / r.step) * r.step)));
  }

  private build(): void {
    const svg = el('svg', {
      viewBox: `0 0 ${L.w} ${L.h}`,
      class: 'sim-svg',
      role: 'img',
      'aria-label':
        'Груз на пружине на гладком столе. Над ним точка движется по окружности радиусом A, ' +
        'груз — её тень. Ниже график координаты от времени и полосы энергии пружины, ' +
        'кинетической энергии груза и их суммы',
    });
    const fixed = el('g', { class: 'spr-fixed' });
    // wall and floor
    fixed.append(
      el('line', { x1: L.wall, y1: L.rail - 46, x2: L.wall, y2: L.rail, class: 'spr-solid' }),
      el('line', { x1: L.wall, y1: L.rail, x2: L.w - 10, y2: L.rail, class: 'spr-solid' }),
    );
    // graph axes and grid
    const grid = el('g', { class: 'sim-grid' });
    for (let s = 1; s <= T_RUN; s++) {
      grid.append(el('line', { x1: tx(s), x2: tx(s), y1: L.gy - 50, y2: L.gy + 50 }));
    }
    for (const c of [-10, -5, 5, 10]) {
      const y = L.gy - c * L.gpx;
      grid.append(el('line', { x1: L.gx0, x2: L.gx1, y1: y, y2: y }));
      grid.append(el('text', { x: L.gx0 - 5, y: y + 4, 'text-anchor': 'end' }, ru(c)));
    }
    for (let s = 0; s <= T_RUN; s++) {
      grid.append(el('text', { x: tx(s), y: L.gy + 64, 'text-anchor': 'middle' }, String(s)));
    }
    fixed.append(
      grid,
      el('line', { x1: L.gx0, x2: L.gx1 + 6, y1: L.gy, y2: L.gy, class: 'spr-axis' }),
      el('line', { x1: L.gx0, x2: L.gx0, y1: L.gy + 52, y2: L.gy - 56, class: 'spr-axis' }),
    );
    const xName = el('text', { x: L.gx0 + 6, y: L.gy - 52, class: 'spr-name' });
    xName.append(el('tspan', { 'font-style': 'italic' }, 'x'), ', см');
    const tName = el('text', { x: L.w - 4, y: L.gy + 64, 'text-anchor': 'end', class: 'spr-name' });
    tName.append(el('tspan', { 'font-style': 'italic' }, 't'), ', с');
    fixed.append(xName, tName);

    this.ticks = el('g', { class: 'spr-ticks' });
    this.prevLine = el('polyline', { class: 'sim-previous', points: '' });
    this.trace = el('polyline', { class: 'spr-trace', points: '' });
    this.moving = el('g');
    this.bars = el('g');
    svg.append(fixed, this.ticks, this.prevLine, this.trace, this.moving, this.bars);

    const controls = document.createElement('div');
    controls.className = 'sim-controls';
    const add = (key: 'm' | 'k' | 'a', title: string, r: typeof M, digits: number, unit: string) => {
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
      input.value = String(this[key]);
      input.addEventListener('input', () => {
        this[key] = round3(Number(input.value));
        this.reset(true);
      });
      out.dataset.digits = String(digits);
      out.dataset.unit = unit;
      this.outs[key] = out;
      label.append(name, out, input);
      controls.append(label);
    };
    add('m', 'Масса груза m', M, 1, ' кг');
    add('k', 'Жёсткость пружины k', K, 0, ' Н/м');
    add('a', 'Амплитуда A', A, 0, ' см');

    const row = document.createElement('div');
    row.className = 'sim-row';
    this.go = document.createElement('button');
    this.go.type = 'button';
    this.go.className = 'btn small';
    this.go.addEventListener('click', () => this.run());
    const again = document.createElement('button');
    again.type = 'button';
    again.className = 'btn small ghost';
    again.textContent = 'Заново';
    again.addEventListener('click', () => this.reset(true));
    const key = document.createElement('span');
    key.className = 'sim-check';
    key.innerHTML =
      '<span class="crt-key crt-key-v"></span> скорость и <i>E</i><sub>к</sub> · ' +
      '<span class="crt-key crt-key-a"></span> ускорение и <i>E</i><sub>п</sub>';
    row.append(this.go, again, key);

    this.readout = document.createElement('p');
    this.readout.className = 'sim-readout';
    this.readout.setAttribute('aria-live', 'polite');
    this.append(svg, controls, row, this.readout);
  }

  private reset(keepPrevious: boolean): void {
    cancelAnimationFrame(this.frame);
    if (keepPrevious && this.t > 0) this.previous = this.trace.getAttribute('points');
    this.running = false;
    this.t = 0;
    this.quarter = 0;
    for (const k of ['m', 'k', 'a'] as const) {
      const out = this.outs[k];
      out.textContent = ru(this[k], Number(out.dataset.digits)) + (out.dataset.unit ?? '');
    }
    this.prevLine.setAttribute('points', this.previous ?? '');
    const amp = this.a * L.pxCm;
    this.ticks.replaceChildren();
    for (const [c, s] of [
      [-amp, '−A'],
      [0, '0'],
      [amp, 'A'],
    ] as [number, string][]) {
      this.ticks.append(
        el('line', { x1: L.eq + c, x2: L.eq + c, y1: L.rail, y2: L.rail + 6 }),
        el('text', { x: L.eq + c, y: L.rail + 18, 'text-anchor': 'middle', 'font-style': s === '0' ? 'normal' : 'italic' }, s),
      );
    }
    this.go.textContent = 'Пуск';
    this.draw();
    const T = period(this.m, this.k);
    this.readout.innerHTML =
      `<i>T</i> = 2π√(<i>m</i>/<i>k</i>) = 2π√(${ru(this.m)} / ${ru(this.k, 0)}) ≈ ${ru(T, 2)} с: ` +
      `за ${T_RUN} с — ${ru(T_RUN / T)} колебания. Груз отвели на ${ru(this.a, 0)} см и держат. Нажми «Пуск».`;
  }

  private reduced(): boolean {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  private run(): void {
    if (this.t >= T_RUN) {
      this.reset(true);
      if (this.reduced()) return;
    }
    const T = period(this.m, this.k);
    if (this.reduced()) {
      this.go.textContent = 'Дальше';
      this.quarter += 1;
      this.t = this.quarter <= 4 ? Math.min(T_RUN, (this.quarter * T) / 4) : T_RUN;
      this.draw();
      this.say();
      return;
    }
    if (this.running) return;
    this.running = true;
    let prev = performance.now();
    const tick = (now: number) => {
      this.t = Math.min(T_RUN, this.t + Math.min(0.05, (now - prev) / 1000));
      prev = now;
      this.draw();
      this.say();
      if (this.t >= T_RUN) {
        this.running = false;
        return;
      }
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  private say(): void {
    const T = period(this.m, this.k);
    const s = snap(this.t, this.a / 100, this.m, this.k);
    if (this.t >= T_RUN) {
      this.readout.innerHTML =
        `За ${T_RUN} с груз совершил ${ru(T_RUN / T)} колебания, период <i>T</i> ≈ ${ru(T, 2)} с. ` +
        'Поменяй массу или жёсткость и запусти снова: прежний график останется пунктиром.';
      return;
    }
    const where = `<i>t</i> = ${ru(this.t, 2)} с, <i>x</i> = ${ru(s.x * 100)} см, <i>v</i> = ${ru(s.v, 2)} м/с. `;
    if (this.reduced()) {
      const q = this.quarter % 4;
      const text = [
        'Груз снова в крайней точке: прошёл период <i>T</i>, путь 4<i>A</i>.',
        'Груз проходит положение равновесия: скорость наибольшая, ускорение ноль, вся энергия кинетическая.',
        'Крайняя точка с другой стороны: скорость ноль, ускорение наибольшее, вся энергия у пружины.',
        'Снова положение равновесия, теперь груз движется в другую сторону.',
      ][q];
      this.readout.innerHTML = where + text;
      return;
    }
    this.readout.innerHTML = where + `<i>E</i><sub>п</sub> + <i>E</i><sub>к</sub> = ${ru((s.ep + s.ek) * 1000)} мДж.`;
  }

  private draw(): void {
    const ampM = this.a / 100;
    const s = snap(this.t, ampM, this.m, this.k);
    const w = omega(this.m, this.k);
    const g = this.moving;
    g.replaceChildren();
    // the circle and its point
    const r = this.a * L.pxCm;
    const ph = w * this.t;
    const px = L.eq + r * Math.cos(ph);
    const py = L.cy - r * Math.sin(ph);
    const bx = L.eq + s.x * 100 * L.pxCm;
    const by = L.rail - L.bh;
    g.append(
      el('circle', { cx: L.eq, cy: L.cy, r, class: 'spr-circle' }),
      el('line', { x1: L.eq - 58, x2: L.eq + 58, y1: L.cy, y2: L.cy, class: 'spr-thin' }),
      el('line', { x1: px.toFixed(1), y1: py.toFixed(1), x2: bx.toFixed(1), y2: by, class: 'spr-shadow' }),
      el('line', { x1: L.eq, y1: L.cy, x2: px.toFixed(1), y2: py.toFixed(1), class: 'spr-radius' }),
      el('circle', { cx: px.toFixed(1), cy: py.toFixed(1), r: 4.5, class: 'spr-point' }),
      el('line', { x1: L.eq, x2: L.eq, y1: L.rail - 40, y2: L.rail, class: 'spr-thin' }),
    );
    // spring and load
    const left = bx - L.bw / 2;
    g.append(
      el('path', { d: springPath(L.wall, left, L.rail - L.bh / 2), class: 'spr-spring' }),
      el('rect', { x: left.toFixed(1), y: by, width: L.bw, height: L.bh, rx: 2, class: 'spr-load' }),
      el('text', { x: bx.toFixed(1), y: by + 17, 'text-anchor': 'middle', class: 'spr-m' }, 'm'),
    );
    // arrows, scaled to the largest values of this run
    const vMax = ampM * w;
    const aMax = ampM * w * w;
    const va = el('g', { class: 'spr-vel' });
    va.append(arrow(bx, by - 10, bx + (s.v / vMax) * ARROW, by - 10));
    const aa = el('g', { class: 'spr-acc' });
    aa.append(arrow(bx, L.rail + 28, bx + (s.a / aMax) * ARROW, L.rail + 28));
    g.append(va, aa);
    // the graph so far
    const n = Math.max(1, Math.ceil((tx(this.t) - L.gx0) / 1));
    const pts: string[] = [];
    for (let i = 0; i <= n; i++) {
      const t = (this.t * i) / n;
      const x = ampM * Math.cos(w * t) * 100;
      pts.push(`${tx(t).toFixed(1)},${(L.gy - x * L.gpx).toFixed(1)}`);
    }
    this.trace.setAttribute('points', this.t > 0 ? pts.join(' ') : '');
    g.append(el('circle', { cx: tx(this.t).toFixed(1), cy: (L.gy - s.x * 100 * L.gpx).toFixed(1), r: 3.5, class: 'spr-point' }));
    this.drawBars(s);
  }

  private drawBars(s: Snap): void {
    const g = this.bars;
    g.replaceChildren();
    const total = s.ep + s.ek;
    const scale = total > 0 ? L.bar / total : 0;
    const rows: [string, string, number, string][] = [
      ['E', 'п', s.ep, 'spr-p'],
      ['E', 'к', s.ek, 'spr-k'],
    ];
    g.append(el('text', { x: L.w - 4, y: L.top - 6, 'text-anchor': 'end', class: 'spr-group' }, 'энергия, мДж'));
    rows.forEach(([main, sub, val, cls], k) => {
      const y = L.top + k * L.row;
      const name = letter(16, y + L.row / 2 + 4, main, sub);
      name.setAttribute('class', 'spr-name spr-it');
      const wpx = val * scale;
      g.append(
        name,
        el('rect', { x: L.zero, y: y + 3, width: Math.max(wpx, 0.01).toFixed(1), height: L.row - 6, class: `spr-bar ${cls}` }),
        el('text', { x: (L.zero + wpx + 4).toFixed(1), y: y + L.row / 2 + 4, class: 'spr-value' }, ru(val * 1000)),
      );
    });
    const y = L.top + 2 * L.row + 6;
    g.append(el('text', { x: 16, y: y + L.row / 2 + 4, class: 'spr-name spr-total' }, 'сумма'));
    const wp = s.ep * scale;
    if (wp > 0.2) g.append(el('rect', { x: L.zero, y: y + 3, width: wp.toFixed(1), height: L.row - 6, class: 'spr-bar spr-p' }));
    const wk = s.ek * scale;
    if (wk > 0.2) g.append(el('rect', { x: (L.zero + wp).toFixed(1), y: y + 3, width: wk.toFixed(1), height: L.row - 6, class: 'spr-bar spr-k' }));
    g.append(
      el('rect', { x: L.zero, y: y + 2, width: L.bar, height: L.row - 4, class: 'spr-frame' }),
      el('text', { x: L.zero + L.bar + 4, y: y + L.row / 2 + 4, class: 'spr-value' }, ru(total * 1000)),
    );
  }
}

if (!customElements.get('pp-spring')) customElements.define('pp-spring', SpringSim);
