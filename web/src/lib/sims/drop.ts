// <pp-drop h="20" v0="10"> — two balls leave a cliff at the same moment: one is just let go,
// the other is thrown horizontally. Marks every 0.5 s with a dashed line between each pair
// show they are always at the same height and land together: the horizontal speed does not
// change the fall. g = 10 м/с². The last throw stays as a dashed line for comparison.
//
// Written into theory Markdown as plain HTML; the theory page imports this module only when
// such an element is present. Light DOM, site CSS variables: follows the light/dark theme.

const G = 10;
const SVG_NS = 'http://www.w3.org/2000/svg';

const H = { min: 5, max: 45, step: 5 };
const V0 = { min: 0, max: 20, step: 1 };
const MARK_S = 0.5; // strobe interval, с

// Fixed world window so throws can be compared by eye: the farthest throw (v0 = 20 м/с from
// 45 м) lands 60 м away. The cliff takes CLIFF_M to the left of x = 0.
const WORLD = { w: 60, h: 45 };
const CLIFF_M = 4;
const VIEW = { w: 400, h: 260, left: 30, right: 12, top: 14, bottom: 26 };
const SCALE = Math.min(
  (VIEW.w - VIEW.left - VIEW.right) / (WORLD.w + CLIFF_M),
  (VIEW.h - VIEW.top - VIEW.bottom) / WORLD.h,
);
const sx = (x: number) => VIEW.left + (x + CLIFF_M) * SCALE;
const sy = (y: number) => VIEW.h - VIEW.bottom - y * SCALE;

const ru = (n: number, digits = 1) =>
  (Math.round(n * 10 ** digits) / 10 ** digits)
    .toFixed(digits)
    .replace('.', ',')
    .replace(/,?0+$/, '');

/** Time to fall from height h with no vertical starting speed: √(2h/g). */
export function fallTime(h: number): number {
  return Math.sqrt((2 * h) / G);
}

/** Both balls at time t (clamped to the landing): the common height and the thrown ball's x. */
export function at(h: number, v0: number, t: number): { t: number; y: number; x: number } {
  const tt = Math.min(Math.max(t, 0), fallTime(h));
  return { t: tt, y: Math.max(0, h - (G * tt * tt) / 2), x: v0 * tt };
}

/** Strobe moments 0, 0.5, 1 … up to (and including, if it lands on one) the landing. */
export function strobeTimes(h: number): number[] {
  const end = fallTime(h);
  const out: number[] = [];
  for (let i = 0; i * MARK_S <= end + 1e-9; i++) out.push(i * MARK_S);
  return out;
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

function snap(n: number, r: { min: number; max: number; step: number }, fallback: number) {
  if (!Number.isFinite(n)) return fallback;
  return Math.min(r.max, Math.max(r.min, Math.round(n / r.step) * r.step));
}

function trajectory(h: number, v0: number, upTo: number): string {
  const end = Math.min(upTo, fallTime(h));
  const steps = Math.max(2, Math.ceil(end * 30));
  let d = '';
  for (let i = 0; i <= steps; i++) {
    const p = at(h, v0, (end * i) / steps);
    d += `${i === 0 ? 'M' : 'L'}${sx(p.x).toFixed(1)} ${sy(p.y).toFixed(1)}`;
  }
  return d;
}

class DropSim extends HTMLElement {
  private h = 20;
  private v0 = 10;
  private frame = 0;
  private built = false;
  private cliff!: SVGRectElement;
  private previous!: SVGPathElement;
  private trail!: SVGPathElement;
  private marks!: SVGGElement;
  private level!: SVGLineElement;
  private dropped!: SVGCircleElement;
  private thrown!: SVGCircleElement;
  private readout!: HTMLElement;

  connectedCallback(): void {
    if (this.built) return;
    this.built = true;
    this.h = snap(Number(this.getAttribute('h') ?? 20), H, 20);
    this.v0 = snap(Number(this.getAttribute('v0') ?? 10), V0, 10);
    this.replaceChildren(); // drop the no-JS fallback text
    this.classList.add('sim', 'drp');
    this.buildScene();
    this.buildControls();
    this.reset();
  }

  disconnectedCallback(): void {
    cancelAnimationFrame(this.frame);
  }

  private buildScene(): void {
    const svg = el('svg', {
      viewBox: `0 0 ${VIEW.w} ${VIEW.h}`,
      class: 'sim-svg',
      role: 'img',
      'aria-label':
        'Два мяча одновременно покидают край обрыва: один просто отпускают, другой бросают горизонтально',
    });
    const grid = el('g', { class: 'sim-grid' });
    for (let x = 10; x <= WORLD.w; x += 10) {
      grid.append(el('line', { x1: sx(x), x2: sx(x), y1: sy(0), y2: sy(WORLD.h) }));
      grid.append(el('text', { x: sx(x), y: sy(0) + 16, 'text-anchor': 'middle' }, `${x}`));
    }
    for (let y = 10; y <= WORLD.h; y += 10) {
      grid.append(el('line', { x1: sx(0), x2: sx(WORLD.w), y1: sy(y), y2: sy(y) }));
      grid.append(el('text', { x: VIEW.left - 4, y: sy(y) + 4, 'text-anchor': 'end' }, `${y}`));
    }
    grid.append(
      el('text', { x: sx(WORLD.w), y: sy(0) - 6, 'text-anchor': 'end' }, 'x, м'),
      el('text', { x: VIEW.left - 4, y: sy(WORLD.h) - 2, 'text-anchor': 'end' }, 'y, м'),
    );
    const ground = el('line', {
      class: 'sim-ground',
      x1: sx(-CLIFF_M),
      x2: sx(WORLD.w),
      y1: sy(0),
      y2: sy(0),
    });
    this.cliff = el('rect', { class: 'sim-tower', x: sx(-CLIFF_M), width: CLIFF_M * SCALE });
    this.previous = el('path', { class: 'sim-previous' });
    this.trail = el('path', { class: 'sim-trail' });
    this.marks = el('g', { class: 'drp-marks' });
    this.level = el('line', { class: 'drp-level' });
    this.dropped = el('circle', { class: 'drp-dropped', r: 5 });
    this.thrown = el('circle', { class: 'drp-thrown', r: 5 });
    svg.append(
      grid,
      ground,
      this.cliff,
      this.previous,
      this.trail,
      this.marks,
      this.level,
      this.dropped,
      this.thrown,
    );
    this.append(svg);
  }

  private buildControls(): void {
    const controls = document.createElement('div');
    controls.className = 'sim-controls';
    controls.append(
      this.slider('Высота обрыва', H, () => this.h, (v) => (this.h = v), (v) => `${v} м`),
      this.slider(
        'Скорость броска',
        V0,
        () => this.v0,
        (v) => (this.v0 = v),
        (v) => `${v} м/с`,
      ),
    );
    const row = document.createElement('div');
    row.className = 'sim-row';
    const go = document.createElement('button');
    go.type = 'button';
    go.className = 'btn small';
    go.textContent = 'Пустить оба мяча';
    go.addEventListener('click', () => this.launch());
    const legend = document.createElement('span');
    legend.className = 'sim-check';
    legend.innerHTML =
      '<span class="drp-key drp-key-dropped"></span> отпустили · ' +
      '<span class="drp-key drp-key-thrown"></span> бросили горизонтально';
    row.append(go, legend);
    this.readout = document.createElement('p');
    this.readout.className = 'sim-readout';
    this.readout.setAttribute('aria-live', 'polite');
    this.append(controls, row, this.readout);
  }

  private slider(
    title: string,
    r: { min: number; max: number; step: number },
    get: () => number,
    set: (v: number) => void,
    fmt: (v: number) => string,
  ): HTMLLabelElement {
    const label = document.createElement('label');
    label.className = 'sim-slider';
    const name = document.createElement('span');
    name.textContent = title;
    const out = document.createElement('output');
    out.textContent = fmt(get());
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(r.min);
    input.max = String(r.max);
    input.step = String(r.step);
    input.value = String(get());
    input.addEventListener('input', () => {
      set(Number(input.value));
      out.textContent = fmt(get());
      this.reset();
    });
    label.append(name, out, input);
    return label;
  }

  /** New parameters: both balls back on the edge, last throw kept as a dashed line. */
  private reset(): void {
    cancelAnimationFrame(this.frame);
    this.cliff.setAttribute('y', sy(this.h).toFixed(1));
    this.cliff.setAttribute('height', (this.h * SCALE).toFixed(1));
    this.trail.setAttribute('d', '');
    this.marks.replaceChildren();
    this.draw(0);
    this.readout.textContent = `Нажми «Пустить»: высота ${this.h} м, скорость броска ${this.v0} м/с.`;
  }

  private launch(): void {
    cancelAnimationFrame(this.frame);
    this.marks.replaceChildren();
    const end = fallTime(this.h);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.finish();
      return;
    }
    const times = strobeTimes(this.h);
    let next = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min((now - start) / 1000, end);
      while (next < times.length && times[next] <= t) this.mark(times[next++]);
      this.trail.setAttribute('d', trajectory(this.h, this.v0, t));
      this.draw(t);
      if (t >= end) {
        this.finish();
        return;
      }
      const p = at(this.h, this.v0, t);
      this.readout.textContent = `t = ${ru(t)} с · оба мяча на высоте ${ru(p.y)} м`;
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  private finish(): void {
    const end = fallTime(this.h);
    this.marks.replaceChildren();
    for (const t of strobeTimes(this.h)) this.mark(t);
    const path = trajectory(this.h, this.v0, end);
    this.trail.setAttribute('d', path);
    this.previous.setAttribute('d', path);
    this.draw(end);
    const range = at(this.h, this.v0, end).x;
    this.readout.textContent =
      `Оба мяча упали одновременно, через ${ru(end, 2)} с. ` +
      (this.v0 > 0
        ? `Брошенный улетел на ${ru(range)} м.`
        : 'Без начальной скорости мячи летят вместе.');
  }

  /** Strobe mark: both balls' positions at time t and a dashed line between them. */
  private mark(t: number): void {
    const p = at(this.h, this.v0, t);
    const y = sy(p.y);
    if (p.x > 0) {
      this.marks.append(el('line', { class: 'drp-pair', x1: sx(0), x2: sx(p.x), y1: y, y2: y }));
    }
    this.marks.append(
      el('circle', { class: 'drp-mark-dropped', cx: sx(0), cy: y, r: 3 }),
      el('circle', { class: 'drp-mark-thrown', cx: sx(p.x), cy: y, r: 3 }),
    );
  }

  private draw(t: number): void {
    const p = at(this.h, this.v0, t);
    const y = sy(p.y).toFixed(1);
    this.dropped.setAttribute('cx', sx(0).toFixed(1));
    this.dropped.setAttribute('cy', y);
    this.thrown.setAttribute('cx', sx(p.x).toFixed(1));
    this.thrown.setAttribute('cy', y);
    this.level.setAttribute('x1', sx(0).toFixed(1));
    this.level.setAttribute('x2', sx(p.x).toFixed(1));
    this.level.setAttribute('y1', y);
    this.level.setAttribute('y2', y);
  }
}

if (!customElements.get('pp-drop')) customElements.define('pp-drop', DropSim);
