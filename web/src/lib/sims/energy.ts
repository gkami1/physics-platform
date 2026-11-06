// <pp-energy h="3" m="1" mu="0"> — a puck slides down a trough: a 45° slope, a 2 m flat
// bottom and a gentler 30° slope, both slopes 4 m high. It starts from rest at height h. Bars
// show its potential energy mgh, kinetic energy mv²/2, the heat Q released by friction and
// all three stacked: the stack never changes length. Without friction the puck climbs the other
// slope to the same height, however steep; with friction (μ on every part, the slopes too
// steep to hold it) each swing is lower, until it stops on the flat and all of mgh is heat.
//
// The motion is exact: on each straight part the acceleration is constant, so the puck is
// stepped to the next corner or turning point in closed form (corners keep the speed).
// «Пуск» releases the puck; with reduced motion it jumps from event to event instead.
//
// Written into theory Markdown as plain HTML; the theory page imports this module only when
// such an element is present. Light DOM, site CSS variables: follows the light/dark theme.
// Colours as in the energy figures: potential energy accent, kinetic green (like the
// velocity), heat muted.

const SVG_NS = 'http://www.w3.org/2000/svg';

const G = 10; // м/с², EGE convention
const TOP = 4; // height of both slopes, м
const H = { min: 1, max: 4, step: 0.5 }; // м
const M = { min: 1, max: 3, step: 0.5 }; // кг
const MU = { min: 0, max: 0.3, step: 0.05 };
const T_MAX = 60; // a frictionless run stops itself after this long, с

interface Part {
  len: number; // м along the track
  sin: number; // + when moving along +s goes down
  cos: number;
  x0: number; // start, м
  y0: number;
  dx: number; // unit direction of +s
  dy: number;
}

const rad = (d: number) => (d * Math.PI) / 180;
function part(x0: number, y0: number, len: number, deg: number): Part {
  // deg: slope of +s below the horizontal (positive: downhill)
  const a = rad(deg);
  return { len, sin: Math.sin(a), cos: Math.cos(a), x0, y0, dx: Math.cos(a), dy: -Math.sin(a) };
}
const L1 = TOP / Math.sin(rad(45));
const FLAT = 2;
const L3 = TOP / Math.sin(rad(30));
const X1 = TOP; // end of the first slope, м
export const PARTS: Part[] = [
  part(0, TOP, L1, 45),
  part(X1, 0, FLAT, 0),
  part(X1 + FLAT, 0, L3, -30),
];
const S_END = L1 + FLAT + L3;

const L = { w: 400, h: 266, x0: 14, base: 146, pxM: 28.5, top: 182, row: 18, zero: 100, pxJ: 2 };
const V_PX = 5; // px per м/с
const sx = (x: number) => L.x0 + x * L.pxM;
const sy = (y: number) => L.base - y * L.pxM;

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const EPS = 1e-9;

/** Russian number: decimal comma, real minus, up to `digits` decimals, trailing zeros dropped. */
export function ru(n: number, digits = 1): string {
  const r = Math.round(n * 10 ** digits) / 10 ** digits;
  const s = (Object.is(r, -0) ? 0 : r).toFixed(digits);
  return (digits ? s.replace(/\.?0+$/, '') : s).replace('.', ',').replace('-', '−');
}

/** Index of the part the puck is on at s, moving in direction dir (−1, 0, +1). */
function partAt(s: number, dir: number): number {
  let start = 0;
  for (let i = 0; i < PARTS.length; i++) {
    const end = start + PARTS[i].len;
    if (s < end - EPS || i === PARTS.length - 1) {
      // at the very start of a part and moving back: the previous part
      if (i > 0 && dir < 0 && Math.abs(s - start) < EPS) return i - 1;
      return i;
    }
    if (Math.abs(s - end) < EPS) return dir > 0 || (dir === 0 && i < PARTS.length - 1 && PARTS[i + 1].sin > 0) ? i + 1 : i;
    start = end;
  }
  return PARTS.length - 1;
}

function partStart(i: number): number {
  let s = 0;
  for (let k = 0; k < i; k++) s += PARTS[k].len;
  return s;
}

/** Point on the track (м) at s; at a corner, the part the puck is moving onto (dir = sign v). */
export function point(s: number, dir = 0): { x: number; y: number; i: number } {
  const i = partAt(Math.min(S_END, Math.max(0, s)), dir);
  const p = PARTS[i];
  const d = s - partStart(i);
  return { x: p.x0 + p.dx * d, y: p.y0 + p.dy * d, i };
}

export interface State {
  s: number;
  v: number;
  stopped: boolean;
}

/**
 * Advance by at most dt seconds; stops early at a corner or a turning point if `toEvent`.
 * Returns the time actually used and whether an event (corner, turn, stop) was reached.
 */
export function advance(st: State, dt: number, mu: number, toEvent: boolean): { used: number; event: string } {
  let used = 0;
  while (used < dt - EPS && !st.stopped) {
    const dir = Math.sign(st.v);
    const i = partAt(st.s, dir);
    const p = PARTS[i];
    const ag = G * p.sin;
    const fr = mu * G * p.cos;
    if (dir === 0) {
      if (Math.abs(ag) <= fr + EPS) {
        st.stopped = true;
        return { used, event: 'stop' };
      }
    }
    const moveDir = dir !== 0 ? dir : Math.sign(ag);
    const a = ag - moveDir * fr;
    const left = dt - used;
    // time to the end of this part in the direction of motion
    const start = partStart(i);
    const dist = moveDir > 0 ? start + p.len - st.s : st.s - start;
    let tEdge = Infinity;
    // solve |v| t + (a·moveDir) t²/2 = dist for the first positive root
    const v0 = Math.abs(st.v);
    const aa = a * moveDir;
    if (dist <= EPS) tEdge = 0;
    else if (Math.abs(aa) < EPS) tEdge = v0 > EPS ? dist / v0 : Infinity;
    else {
      const disc = v0 * v0 + 2 * aa * dist;
      if (disc >= 0) {
        const t = (-v0 + Math.sqrt(disc)) / aa;
        if (t > 0) tEdge = t;
      }
    }
    const tTurn = aa < -EPS ? v0 / -aa : Infinity;
    const t = Math.min(left, tEdge, tTurn);
    if (tEdge === 0) {
      // sitting on a corner: step onto the next part without using time
      st.s += moveDir * 1e-7;
      if (st.v === 0) st.v = moveDir * 1e-7;
      continue;
    }
    st.s += moveDir * (v0 * t + (aa * t * t) / 2);
    st.v = moveDir * (v0 + aa * t);
    used += t;
    st.s = Math.min(S_END, Math.max(0, st.s));
    if (t === tTurn) {
      st.v = 0;
      if (toEvent) return { used, event: 'turn' };
      continue;
    }
    if (t === tEdge) {
      st.s = moveDir > 0 ? start + p.len : start;
      if (toEvent) return { used, event: 'corner' };
    }
  }
  return { used, event: st.stopped ? 'stop' : '' };
}

export interface Energies {
  ep: number;
  ek: number;
  q: number;
}

export function energies(st: State, m: number, h: number): Energies {
  const { y } = point(st.s);
  const ep = round3(m * G * y);
  const ek = round3((m * st.v * st.v) / 2);
  const q = round3(Math.max(0, m * G * h - ep - ek));
  return { ep, ek, q };
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

/** A letter with an optional upright subscript. */
function letter(x: number, y: number, main: string, sub = '', anchor = 'middle'): SVGTextElement {
  const t = el('text', { x: x.toFixed(1), y: y.toFixed(1), 'text-anchor': anchor }, main);
  if (sub) t.append(el('tspan', { class: 'eng-sub', dy: 3 }, sub));
  return t;
}

/** Arrow from (x1, y1) to (x2, y2); empty if too short to see. */
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
    el('line', {
      x1: x1.toFixed(1),
      y1: y1.toFixed(1),
      x2: (x2 - ux * head * 0.6).toFixed(1),
      y2: (y2 - uy * head * 0.6).toFixed(1),
    }),
    el('path', {
      d: `M${x2.toFixed(1)} ${y2.toFixed(1)}L${(bx - uy * 4).toFixed(1)} ${(by + ux * 4).toFixed(1)}L${(bx + uy * 4).toFixed(1)} ${(by - ux * 4).toFixed(1)}Z`,
    }),
  );
  return g;
}

class EnergySim extends HTMLElement {
  private h = 3;
  private m = 1;
  private mu = 0;
  private st: State = { s: 0, v: 0, stopped: false };
  private running = false;
  private time = 0;
  private frame = 0;
  private built = false;
  private puck!: SVGCircleElement;
  private vel!: SVGGElement;
  private level!: SVGGElement;
  private turns!: SVGGElement;
  private bars!: SVGGElement;
  private go!: HTMLButtonElement;
  private readout!: HTMLElement;
  private outs: Record<'h' | 'm' | 'mu', HTMLOutputElement> = {} as never;

  connectedCallback(): void {
    if (this.built) return;
    this.built = true;
    this.h = this.attr('h', 3, H);
    this.m = this.attr('m', 1, M);
    this.mu = this.attr('mu', 0, MU);
    this.replaceChildren(); // drop the no-JS fallback text
    this.classList.add('sim', 'eng');
    this.build();
    this.reset();
  }

  disconnectedCallback(): void {
    cancelAnimationFrame(this.frame);
  }

  private attr(name: string, fallback: number, r: { min: number; max: number; step: number }) {
    const n = Number(this.getAttribute(name) ?? fallback);
    if (!Number.isFinite(n)) return fallback;
    return round3(Math.min(r.max, Math.max(r.min, Math.round(n / r.step) * r.step)));
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
    input.addEventListener('input', () => onInput(round3(Number(input.value))));
    label.append(name, out, input);
    return [label, out];
  }

  private build(): void {
    const svg = el('svg', {
      viewBox: `0 0 ${L.w} ${L.h}`,
      class: 'sim-svg',
      role: 'img',
      'aria-label':
        'Жёлоб: крутой склон слева, ровное дно и пологий склон справа. Шайба скользит по нему, ' +
        'пунктир — высота старта. Ниже — потенциальная и кинетическая энергия шайбы, тепло и их сумма',
    });
    const track = el('g', { class: 'eng-track' });
    const pts = [
      [sx(0), sy(TOP)],
      [sx(X1), sy(0)],
      [sx(X1 + FLAT), sy(0)],
      [sx(X1 + FLAT + TOP / Math.tan(rad(30))), sy(TOP)],
    ];
    const line = pts.map(([x, y], k) => `${k ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('');
    track.append(
      el('path', { d: `${line}V${L.base + 10}H${pts[0][0]}Z`, class: 'eng-ground' }),
      el('path', { d: line, class: 'eng-line' }),
    );
    this.level = el('g', { class: 'eng-level' });
    this.turns = el('g', { class: 'eng-turns' });
    this.puck = el('circle', { r: 7, class: 'eng-puck' });
    this.vel = el('g', { class: 'eng-vel' });
    this.bars = el('g', { class: 'eng-bars' });
    svg.append(track, this.level, this.turns, this.puck, this.vel, this.bars);

    const controls = document.createElement('div');
    controls.className = 'sim-controls';
    const add = (key: 'h' | 'm' | 'mu', title: string, r: typeof H, digits: number, unit: string) => {
      const [label, out] = this.slider(title, r, this[key], (n) => {
        this[key] = n;
        this.reset();
      });
      out.dataset.digits = String(digits);
      out.dataset.unit = unit;
      this.outs[key] = out;
      controls.append(label);
    };
    add('h', 'Высота старта h', H, 1, ' м');
    add('m', 'Масса шайбы m', M, 1, ' кг');
    add('mu', 'Коэффициент трения μ', MU, 2, '');

    const row = document.createElement('div');
    row.className = 'sim-row';
    this.go = document.createElement('button');
    this.go.type = 'button';
    this.go.className = 'btn small';
    this.go.addEventListener('click', () => this.run());
    const stop = document.createElement('button');
    stop.type = 'button';
    stop.className = 'btn small ghost';
    stop.textContent = 'Заново';
    stop.addEventListener('click', () => this.reset());
    const key = document.createElement('span');
    key.className = 'sim-check';
    key.innerHTML =
      '<span class="crt-key crt-key-a"></span> <i>E</i><sub>п</sub> · ' +
      '<span class="crt-key crt-key-v"></span> <i>E</i><sub>к</sub> и скорость · ' +
      '<span class="crt-key eng-key-q"></span> тепло <i>Q</i>';
    row.append(this.go, stop, key);

    this.readout = document.createElement('p');
    this.readout.className = 'sim-readout';
    this.readout.setAttribute('aria-live', 'polite');
    this.append(svg, controls, row, this.readout);
  }

  private reset(): void {
    cancelAnimationFrame(this.frame);
    this.running = false;
    this.time = 0;
    for (const k of ['h', 'm', 'mu'] as const) {
      const out = this.outs[k];
      out.textContent = ru(this[k], Number(out.dataset.digits)) + (out.dataset.unit ?? '');
    }
    this.st = { s: (TOP - this.h) / Math.sin(rad(45)), v: 0, stopped: false };
    this.turns.replaceChildren();
    this.level.replaceChildren(
      el('line', { x1: sx(0), x2: L.w - 4, y1: sy(this.h), y2: sy(this.h) }),
      el('text', { x: sx(X1 + FLAT / 2), y: sy(this.h) - 5, 'text-anchor': 'middle' }, 'высота старта'),
    );
    this.go.textContent = 'Пуск';
    this.draw();
    const e = energies(this.st, this.m, this.h);
    this.readout.innerHTML =
      `Шайба стоит на высоте ${ru(this.h)} м: <i>E</i><sub>п</sub> = <i>mgh</i> = ` +
      `${ru(this.m)} · 10 · ${ru(this.h)} = ${ru(e.ep)} Дж, <i>E</i><sub>к</sub> = 0. ` +
      (this.mu === 0 ? 'Трения нет. ' : `Трение μ = ${ru(this.mu, 2)}. `) +
      'Нажми «Пуск».';
  }

  private reduced(): boolean {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  private run(): void {
    if (this.st.stopped) {
      this.reset();
      if (this.reduced()) return; // show the start again; the next press steps on
    }
    if (this.reduced()) {
      this.go.textContent = 'Дальше';
      const r = advance(this.st, 1e6, this.mu, true);
      this.time += r.used;
      if (r.event === 'turn') this.markTurn();
      this.draw();
      this.say(r.event);
      return;
    }
    if (this.running) return;
    this.running = true;
    let prev = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - prev) / 1000);
      prev = now;
      let left = dt;
      while (left > 1e-6 && !this.st.stopped) {
        const r = advance(this.st, left, this.mu, true);
        left -= r.used;
        this.time += r.used;
        if (r.event === 'turn') this.markTurn();
        if (r.used === 0 && !r.event) break;
      }
      this.draw();
      if (this.st.stopped || this.time > T_MAX) {
        this.running = false;
        this.st.stopped = true;
        this.say('stop');
        return;
      }
      this.say('');
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  private markTurn(): void {
    const { x, y } = point(this.st.s);
    this.turns.append(el('circle', { cx: sx(x).toFixed(1), cy: (sy(y) - 3).toFixed(1), r: 2.5 }));
  }

  private say(event: string): void {
    const e = energies(this.st, this.m, this.h);
    const { y } = point(this.st.s);
    const sum = `<i>E</i><sub>п</sub> + <i>E</i><sub>к</sub> = ${ru(e.ep)} + ${ru(e.ek)} = ${ru(e.ep + e.ek)} Дж`;
    const heat = this.mu > 0 ? `, тепло <i>Q</i> = ${ru(e.q)} Дж` : '';
    const where = `Высота ${ru(y, 2)} м, скорость ${ru(Math.abs(this.st.v))} м/с. `;
    if (event === 'stop' && this.mu === 0) {
      this.readout.innerHTML = `${where}${sum}: столько же, сколько в начале. Трения нет — шайба качалась бы вечно.`;
    } else if (event === 'stop') {
      this.readout.innerHTML =
        `Шайба остановилась на дне. Вся энергия <i>mgh</i> = ${ru(this.m * G * this.h)} Дж ` +
        `перешла в тепло: <i>Q</i> = ${ru(e.q)} Дж.`;
    } else if (event === 'turn') {
      this.readout.innerHTML =
        `${where}Шайба на миг остановилась: <i>E</i><sub>к</sub> = 0, ` +
        (this.mu === 0
          ? `и она поднялась на ту же высоту ${ru(this.h)} м, хотя склон другой.`
          : `но высота меньше начальной: ${ru(e.q)} Дж уже стали теплом.`);
    } else {
      this.readout.innerHTML = `${where}${sum}${heat}.`;
    }
  }

  private draw(): void {
    const { x, y, i } = point(this.st.s, Math.sign(this.st.v));
    const p = PARTS[i];
    // the puck sits on the track: offset along the segment's upward normal (screen y grows down)
    const tx = p.dx;
    const ty = -p.dy;
    const [ox, oy] = -tx < 0 ? [ty, -tx] : [-ty, tx];
    const px = sx(x) + ox * 8;
    const py = sy(y) + oy * 8;
    this.puck.setAttribute('cx', px.toFixed(1));
    this.puck.setAttribute('cy', py.toFixed(1));

    this.vel.replaceChildren();
    const v = this.st.v;
    if (Math.abs(v) > 0.05) {
      const len = Math.abs(v) * V_PX;
      const d = Math.sign(v);
      this.vel.append(arrow(px, py, px + d * tx * (len + 8), py + d * ty * (len + 8)));
    }
    this.drawBars();
  }

  private drawBars(): void {
    const e = energies(this.st, this.m, this.h);
    const g = this.bars;
    g.replaceChildren();
    g.append(el('text', { x: L.w - 4, y: L.top - 6, 'text-anchor': 'end', class: 'eng-group' }, 'энергия, Дж'));
    const rows: [string, string, number, string][] = [
      ['E', 'п', e.ep, 'eng-p'],
      ['E', 'к', e.ek, 'eng-k'],
      ['Q', '', e.q, 'eng-q'],
    ];
    rows.forEach(([main, sub, val, cls], k) => {
      const y = L.top + k * L.row;
      const name = letter(16, y + L.row / 2 + 4, main, sub, 'start');
      name.setAttribute('class', 'eng-name');
      const w = val * L.pxJ;
      g.append(
        name,
        el('rect', { x: L.zero, y: y + 3, width: Math.max(w, 0.01).toFixed(1), height: L.row - 6, class: `eng-bar ${cls}` }),
        el('text', { x: (L.zero + w + 4).toFixed(1), y: y + L.row / 2 + 4, class: 'eng-value' }, ru(val)),
      );
    });
    // the stack: all three end to end, always as long as mgh at the start
    const y = L.top + 3 * L.row + 6;
    const name = el('text', { x: 16, y: y + L.row / 2 + 4, class: 'eng-name eng-total' }, 'сумма');
    g.append(name);
    let x0 = L.zero;
    for (const [val, cls] of [
      [e.ep, 'eng-p'],
      [e.ek, 'eng-k'],
      [e.q, 'eng-q'],
    ] as [number, string][]) {
      const w = val * L.pxJ;
      if (w > 0.2) g.append(el('rect', { x: x0.toFixed(1), y: y + 3, width: w.toFixed(1), height: L.row - 6, class: `eng-bar ${cls}` }));
      x0 += w;
    }
    const total = this.m * G * this.h;
    g.append(
      el('rect', { x: L.zero, y: y + 2, width: (total * L.pxJ).toFixed(1), height: L.row - 4, class: 'eng-frame' }),
      el('text', { x: (L.zero + total * L.pxJ + 4).toFixed(1), y: y + L.row / 2 + 4, class: 'eng-value' }, ru(e.ep + e.ek + e.q)),
      el('line', { x1: L.zero, x2: L.zero, y1: L.top, y2: y + L.row, class: 'eng-zero' }),
    );
  }
}

if (!customElements.get('pp-energy')) customElements.define('pp-energy', EnergySim);
