// <pp-cart f="2" m="2" v0="0"> — Newton's first and second laws on a frictionless track: a
// constant force F acts on a cart of mass m that starts with speed v0. The cart carries three
// arrows (force, velocity, acceleration) and drops a mark under the track every second. With
// F = 0 the marks stay evenly spaced (first law); otherwise a = F/m (second law). The previous
// run's marks stay, dimmed, so two masses or two forces can be compared.
//
// Written into theory Markdown as plain HTML; the theory page imports this module only when
// such an element is present. Light DOM, site CSS variables: follows the light/dark theme.
// Colours as in the dynamics figures: force red, velocity green, acceleration accent.

const SVG_NS = 'http://www.w3.org/2000/svg';

const TRACK_M = 40; // track length, м
const T_MAX = 8; // longest run, с
const LEFT_STOP_M = 8; // a cart coming back stops here: room for its arrows
const F = { min: -6, max: 6, step: 1 }; // Н, along the track (+ to the right)
const M = { min: 1, max: 4, step: 0.5 }; // кг
const V0 = { min: 0, max: 4, step: 1 }; // м/с
const L = { w: 400, h: 128, left: 30, right: 30, aY: 22, vY: 42, trackY: 84, marksY: 106 };
const F_PX = 8; // px per Н
const V_PX = 8; // px per м/с (capped)
const A_PX = 12; // px per м/с²
const ARROW_MAX = 64;
const xTrack = (x: number) => L.left + (x / TRACK_M) * (L.w - L.left - L.right);

const ru = (n: number, digits = 1) =>
  (Math.round(n * 10 ** digits) / 10 ** digits)
    .toFixed(digits)
    .replace('.', ',')
    .replace(/,0+$/, '')
    .replace('-', '−');

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

/** Horizontal arrow from (x, y) by dx px, its letter past the tip; empty if too short to see. */
function hArrow(x: number, y: number, dx: number, cls: string, letter: string): SVGGElement {
  const g = el('g', { class: cls });
  const len = Math.abs(dx);
  if (len < 3) return g;
  const s = Math.sign(dx);
  const head = Math.min(8, len * 0.6);
  const x2 = x + dx;
  g.append(
    el('line', { x1: x.toFixed(1), y1: y, x2: (x2 - s * head * 0.6).toFixed(1), y2: y }),
    el('path', {
      d: `M${x2.toFixed(1)} ${y}L${(x2 - s * head).toFixed(1)} ${y - 4}L${(x2 - s * head).toFixed(1)} ${y + 4}Z`,
    }),
    el(
      'text',
      { x: Math.min(L.w - 6, Math.max(6, x2 + s * 9)).toFixed(1), y: y + 4, 'text-anchor': 'middle' },
      letter,
    ),
  );
  return g;
}

const cap = (px: number) => Math.max(-ARROW_MAX, Math.min(ARROW_MAX, px));

/** Second law: acceleration from the net force and the mass. */
export function accel(f: number, m: number): number {
  return f / m;
}

/** Position on the track (from its left end) and velocity at time t; the cart starts at x0. */
export function state(x0: number, v0: number, a: number, t: number): { x: number; v: number } {
  return { x: x0 + v0 * t + (a * t * t) / 2, v: v0 + a * t };
}

/** Where the cart starts: at the left end, or in the middle when the force pushes it back
 * (so that it has room to slow down, turn round and come back). */
export function startX(f: number): number {
  return f < 0 ? TRACK_M / 2 : 0;
}

/** When the run ends: T_MAX, or earlier if the cart reaches the right end of the track or,
 * coming back, LEFT_STOP_M (so that arrows pointing left still fit). Zero when the cart stands
 * and no force acts: there is nothing to watch. */
export function runTime(x0: number, v0: number, a: number): number {
  if (v0 === 0 && a === 0) return 0;
  let end = T_MAX;
  // Roots of x0 + v0·t + a·t²/2 = X for X = TRACK_M and, if the cart starts right of it, LEFT_STOP_M.
  for (const target of x0 > LEFT_STOP_M ? [TRACK_M, LEFT_STOP_M] : [TRACK_M]) {
    const c = x0 - target;
    let t = Infinity;
    if (a === 0) {
      if (v0 !== 0 && -c / v0 > 0) t = -c / v0;
    } else {
      const disc = v0 * v0 - 2 * a * c;
      if (disc >= 0) {
        const roots = [(-v0 + Math.sqrt(disc)) / a, (-v0 - Math.sqrt(disc)) / a];
        for (const r of roots) if (r > 1e-9 && r < t) t = r;
      }
    }
    end = Math.min(end, t);
  }
  return end;
}

class CartSim extends HTMLElement {
  private f = 2;
  private m = 2;
  private v0 = 0;
  private frame = 0;
  private built = false;
  private cart!: SVGGElement;
  private body!: SVGRectElement;
  private massLabel!: SVGTextElement;
  private arrows!: SVGGElement;
  private marks!: SVGGElement;
  private previous!: SVGGElement;
  private readout!: HTMLElement;
  private outs: Record<'f' | 'm' | 'v0', HTMLOutputElement> = {} as never;
  private lastMarks: number[] = [];
  private labelled: number[] = [];
  private lastKey = '';

  connectedCallback(): void {
    if (this.built) return;
    this.built = true;
    this.f = this.attr('f', 2, F);
    this.m = this.attr('m', 2, M);
    this.v0 = this.attr('v0', 0, V0);
    this.replaceChildren(); // drop the no-JS fallback text
    this.classList.add('sim', 'crt');
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

  private key(): string {
    return `${this.f}|${this.m}|${this.v0}`;
  }

  private buildScene(): void {
    const svg = el('svg', {
      viewBox: `0 0 ${L.w} ${L.h}`,
      class: 'sim-svg',
      role: 'img',
      'aria-label':
        'Тележка на гладких рельсах длиной 40 метров; на неё действует постоянная сила. ' +
        'Над тележкой стрелки силы, скорости и ускорения, под рельсами отметки через каждую секунду',
    });

    const track = el('g', { class: 'crt-track' });
    track.append(el('line', { x1: xTrack(0), x2: xTrack(TRACK_M), y1: L.trackY, y2: L.trackY }));
    for (let s = 0; s <= TRACK_M; s += 5) {
      track.append(el('line', { x1: xTrack(s), x2: xTrack(s), y1: L.trackY, y2: L.trackY + 4 }));
      if (s % 10 === 0) {
        track.append(el('text', { x: xTrack(s), y: L.trackY + 16, 'text-anchor': 'middle' }, `${s}`));
      }
    }
    track.append(el('text', { x: 4, y: L.trackY + 16 }, 'x, м'));
    track.append(el('text', { x: 4, y: L.marksY + 13 }, 't, с'));

    this.previous = el('g', { class: 'crt-previous' });
    this.marks = el('g', { class: 'crt-marks' });

    this.cart = el('g', { class: 'crt-cart' });
    this.body = el('rect', { y: -24, height: 18, rx: 3, class: 'crt-body' });
    this.massLabel = el('text', { y: -11, 'text-anchor': 'middle', class: 'crt-mass' });
    this.cart.append(
      this.body,
      el('circle', { cx: -9, cy: -3.5, r: 3.5, class: 'crt-wheel' }),
      el('circle', { cx: 9, cy: -3.5, r: 3.5, class: 'crt-wheel' }),
      this.massLabel,
    );
    this.arrows = el('g', { class: 'crt-arrows' });

    svg.append(track, this.previous, this.marks, this.cart, this.arrows);
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
    const [f, outF] = this.slider('Сила', F, this.f, (n) => {
      this.f = n;
      this.reset();
    });
    const [m, outM] = this.slider('Масса тележки', M, this.m, (n) => {
      this.m = n;
      this.reset();
    });
    const [v0, outV0] = this.slider('Начальная скорость', V0, this.v0, (n) => {
      this.v0 = n;
      this.reset();
    });
    this.outs = { f: outF, m: outM, v0: outV0 };
    controls.append(f, m, v0);

    const row = document.createElement('div');
    row.className = 'sim-row';
    const go = document.createElement('button');
    go.type = 'button';
    go.className = 'btn small';
    go.textContent = 'Пуск';
    go.addEventListener('click', () => this.run());
    const legend = document.createElement('span');
    legend.className = 'sim-check';
    legend.innerHTML =
      '<span class="crt-key crt-key-f"></span> сила · ' +
      '<span class="crt-key crt-key-v"></span> скорость · ' +
      '<span class="crt-key crt-key-a"></span> ускорение';
    row.append(go, legend);

    this.readout = document.createElement('p');
    this.readout.className = 'sim-readout';
    this.readout.setAttribute('aria-live', 'polite');
    this.append(controls, row, this.readout);
  }

  private a(): number {
    return accel(this.f, this.m);
  }

  private hint(): string {
    const a = this.a();
    if (this.f === 0 && this.v0 === 0)
      return 'Сил нет, тележка стоит — и будет стоять. Задай силу или начальную скорость.';
    if (this.f === 0)
      return 'Сила ноль: по первому закону скорость не изменится. Нажми «Пуск» и посмотри на отметки.';
    return `a = F/m = ${ru(this.f)} / ${ru(this.m)} = ${ru(a, 2)} м/с². Нажми «Пуск».`;
  }

  private reset(): void {
    cancelAnimationFrame(this.frame);
    this.outs.f.textContent = `${this.f > 0 ? '+' : ''}${ru(this.f)} Н`;
    this.outs.m.textContent = `${ru(this.m)} кг`;
    this.outs.v0.textContent = `${this.v0} м/с`;
    const w = 26 + 6 * this.m;
    this.body.setAttribute('x', String(-w / 2));
    this.body.setAttribute('width', String(w));
    this.massLabel.textContent = `${ru(this.m)} кг`;
    this.marks.replaceChildren();
    this.drawPrevious();
    this.place(0);
    this.readout.textContent = this.hint();
  }

  private run(): void {
    cancelAnimationFrame(this.frame);
    this.marks.replaceChildren();
    this.labelled = [];
    const x0 = startX(this.f);
    const a = this.a();
    const end = runTime(x0, this.v0, a);
    if (end === 0) {
      this.readout.textContent = this.hint();
      return;
    }
    const done: number[] = [];
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      for (let t = 1; t <= end + 1e-9; t++) done.push(this.mark(t));
      this.finish(end, done);
      return;
    }
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(end, (now - start) / 1000);
      while (done.length + 1 <= t) done.push(this.mark(done.length + 1));
      this.place(t);
      const { v } = state(x0, this.v0, a, t);
      this.readout.textContent = `t = ${ru(t)} с · v = ${ru(v)} м/с · a = ${ru(a, 2)} м/с²`;
      if (t >= end) {
        this.finish(end, done);
        return;
      }
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  private finish(end: number, done: number[]): void {
    this.place(end);
    const a = this.a();
    const x0 = startX(this.f);
    const { v } = state(x0, this.v0, a, end);
    let text: string;
    if (this.f === 0) {
      text =
        `Сила ноль — скорость всё время ${this.v0} м/с, отметки на равных расстояниях. ` +
        'Двигаться тележка продолжает сама: сила для этого не нужна.';
    } else if (this.f > 0) {
      text =
        `За ${ru(end)} с скорость выросла с ${this.v0} до ${ru(v)} м/с: ` +
        `каждую секунду на a = ${ru(a, 2)} м/с². Ускорение направлено по силе.`;
    } else {
      text =
        `Сила против скорости: тележка тормозит на ${ru(-a, 2)} м/с² каждую секунду` +
        (this.v0 > 0 ? ', останавливается и едет назад. ' : '. ') +
        'Сила и ускорение всё время смотрят влево, а скорость сначала смотрела вправо.';
    }
    this.readout.textContent = text;
    this.lastMarks = done;
    this.lastKey = this.key();
  }

  private place(t: number): void {
    const a = this.a();
    const { x, v } = state(startX(this.f), this.v0, a, t);
    const cx = xTrack(x);
    this.cart.setAttribute('transform', `translate(${cx.toFixed(1)} ${L.trackY})`);
    const half = (26 + 6 * this.m) / 2;
    const fx = this.f >= 0 ? cx + half : cx - half; // a pull on the leading side
    this.arrows.replaceChildren(
      hArrow(fx, L.trackY - 15, cap(this.f * F_PX), 'crt-f', 'F'),
      hArrow(cx, L.vY, cap(v * V_PX), 'crt-v', 'v'),
      hArrow(cx, L.aY, cap(a * A_PX), 'crt-a', 'a'),
    );
  }

  /** Drops the mark for second t and returns its x on the track. */
  private mark(t: number): number {
    const { x } = state(startX(this.f), this.v0, this.a(), t);
    const px = xTrack(x);
    const g = el('g');
    g.append(el('line', { x1: px, x2: px, y1: L.marksY - 6, y2: L.marksY }));
    // Label a mark only where it does not crowd an earlier label (slow or turning carts).
    if (this.labelled.every((q) => Math.abs(q - px) >= 12)) {
      g.append(el('text', { x: px, y: L.marksY + 13, 'text-anchor': 'middle' }, `${t}`));
      this.labelled.push(px);
    }
    this.marks.append(g);
    return px;
  }

  private drawPrevious(): void {
    this.previous.replaceChildren();
    if (!this.lastMarks.length || this.lastKey === this.key()) return;
    for (const px of this.lastMarks) {
      this.previous.append(el('line', { x1: px, x2: px, y1: L.marksY - 6, y2: L.marksY }));
    }
  }
}

if (!customElements.get('pp-cart')) customElements.define('pp-cart', CartSim);
