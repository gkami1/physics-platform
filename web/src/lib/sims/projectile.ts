// <pp-projectile v0="20" angle="30" h0="0"> — a ball thrown at an angle, g = 10 м/с².
//
// Written into theory Markdown as plain HTML; the theory page imports this module only when
// such an element is present. Light DOM (no shadow root) so the site's CSS variables and
// .sim styles in global.css apply and the picture follows the light/dark theme.

const G = 10;
const SVG_NS = 'http://www.w3.org/2000/svg';

// Fixed world window, so throws can be compared by eye. Fits the slider ranges below
// (worst case: v0 = 25, h0 = 10 → range ≈ 71 м, height ≈ 40 м).
const WORLD = { w: 80, h: 45 };
const VIEW = { w: 400, h: 250, left: 34, right: 10, top: 12, bottom: 26 };
const SCALE = Math.min(
  (VIEW.w - VIEW.left - VIEW.right) / WORLD.w,
  (VIEW.h - VIEW.top - VIEW.bottom) / WORLD.h,
);
const ARROW_SCALE = 1.6; // px per м/с for velocity arrows

interface Params {
  v0: number;
  angle: number; // degrees
  h0: number;
}

interface Flight {
  vx: number;
  vy0: number;
  tFlight: number;
  range: number;
  hMax: number;
}

export function flight({ v0, angle, h0 }: Params): Flight {
  const a = (angle * Math.PI) / 180;
  const vx = v0 * Math.cos(a);
  const vy0 = v0 * Math.sin(a);
  const tFlight = (vy0 + Math.sqrt(vy0 * vy0 + 2 * G * h0)) / G;
  return { vx, vy0, tFlight, range: vx * tFlight, hMax: h0 + (vy0 * vy0) / (2 * G) };
}

const sx = (x: number) => VIEW.left + x * SCALE;
const sy = (y: number) => VIEW.h - VIEW.bottom - y * SCALE;
const ru = (n: number, digits = 1) => n.toFixed(digits).replace('.', ',');

function el<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

function trajectoryPath(p: Params, upTo: number): string {
  const f = flight(p);
  const end = Math.min(upTo, f.tFlight);
  const steps = Math.max(2, Math.ceil(end * 30));
  let d = '';
  for (let i = 0; i <= steps; i++) {
    const t = (end * i) / steps;
    const x = f.vx * t;
    const y = p.h0 + f.vy0 * t - (G * t * t) / 2;
    d += `${i === 0 ? 'M' : 'L'}${sx(x).toFixed(1)} ${sy(Math.max(0, y)).toFixed(1)}`;
  }
  return d;
}

class ProjectileSim extends HTMLElement {
  private params: Params = { v0: 20, angle: 30, h0: 0 };
  private frame = 0;
  private t = 0; // flight time shown on screen
  private svg!: SVGSVGElement;
  private tower!: SVGRectElement;
  private previous!: SVGPathElement;
  private trail!: SVGPathElement;
  private ball!: SVGCircleElement;
  private arrows!: SVGGElement;
  private readout!: HTMLElement;
  private showVectors!: HTMLInputElement;

  connectedCallback(): void {
    if (this.svg) return; // re-attached, already built
    const num = (name: string, fallback: number) => Number(this.getAttribute(name) ?? fallback);
    this.params = {
      v0: clamp(num('v0', 20), 5, 25),
      angle: clamp(num('angle', 30), 10, 80),
      h0: clamp(num('h0', 0), 0, 10),
    };
    this.replaceChildren(); // drop the no-JS fallback text
    this.classList.add('sim');
    this.buildScene();
    this.buildControls();
    this.reset();
  }

  disconnectedCallback(): void {
    cancelAnimationFrame(this.frame);
  }

  private buildScene(): void {
    this.svg = el('svg', {
      viewBox: `0 0 ${VIEW.w} ${VIEW.h}`,
      class: 'sim-svg',
      role: 'img',
      'aria-label': 'Модель полёта тела, брошенного под углом к горизонту',
    });
    const grid = el('g', { class: 'sim-grid' });
    for (let x = 10; x <= WORLD.w; x += 10) {
      grid.append(el('line', { x1: sx(x), x2: sx(x), y1: sy(0), y2: sy(WORLD.h) }));
      const label = el('text', { x: sx(x), y: sy(0) + 16, 'text-anchor': 'middle' });
      label.textContent = String(x);
      grid.append(label);
    }
    for (let y = 10; y <= WORLD.h; y += 10) {
      grid.append(el('line', { x1: sx(0), x2: sx(WORLD.w), y1: sy(y), y2: sy(y) }));
      const label = el('text', { x: sx(0) - 6, y: sy(y) + 4, 'text-anchor': 'end' });
      label.textContent = String(y);
      grid.append(label);
    }
    const unitX = el('text', { x: sx(WORLD.w), y: sy(0) - 6, 'text-anchor': 'end' });
    unitX.textContent = 'x, м';
    const unitY = el('text', { x: sx(0) + 6, y: sy(WORLD.h) + 10 });
    unitY.textContent = 'y, м';
    grid.append(unitX, unitY);

    const ground = el('line', {
      class: 'sim-ground',
      x1: sx(0),
      x2: sx(WORLD.w),
      y1: sy(0),
      y2: sy(0),
    });
    this.tower = el('rect', { class: 'sim-tower', x: sx(0) - 8, width: 8 });
    this.previous = el('path', { class: 'sim-previous' });
    this.trail = el('path', { class: 'sim-trail' });
    this.arrows = el('g', { class: 'sim-arrows' });
    this.ball = el('circle', { class: 'sim-ball', r: 5 });
    this.svg.append(grid, ground, this.tower, this.previous, this.trail, this.arrows, this.ball);
    this.append(this.svg);
  }

  private buildControls(): void {
    const controls = document.createElement('div');
    controls.className = 'sim-controls';
    controls.append(
      this.slider('v0', 'Начальная скорость', 5, 25, 1, (v) => `${v} м/с`),
      this.slider('angle', 'Угол к горизонту', 10, 80, 5, (v) => `${v}°`),
      this.slider('h0', 'Высота броска', 0, 10, 1, (v) => `${v} м`),
    );

    const row = document.createElement('div');
    row.className = 'sim-row';
    const launch = document.createElement('button');
    launch.type = 'button';
    launch.className = 'btn small';
    launch.textContent = 'Бросить';
    launch.addEventListener('click', () => this.launch());

    const vectors = document.createElement('label');
    vectors.className = 'sim-check';
    this.showVectors = document.createElement('input');
    this.showVectors.type = 'checkbox';
    this.showVectors.checked = true;
    this.showVectors.addEventListener('change', () => this.drawBall(this.t));
    vectors.append(this.showVectors, ' показывать скорость и её проекции');
    row.append(launch, vectors);

    this.readout = document.createElement('p');
    this.readout.className = 'sim-readout';
    this.readout.setAttribute('aria-live', 'polite');
    this.append(controls, row, this.readout);
  }

  private slider(
    key: keyof Params,
    title: string,
    min: number,
    max: number,
    step: number,
    fmt: (v: number) => string,
  ): HTMLLabelElement {
    const label = document.createElement('label');
    label.className = 'sim-slider';
    const name = document.createElement('span');
    name.textContent = title;
    const out = document.createElement('output');
    out.textContent = fmt(this.params[key]);
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(this.params[key]);
    input.addEventListener('input', () => {
      this.params = { ...this.params, [key]: Number(input.value) };
      out.textContent = fmt(this.params[key]);
      this.reset();
    });
    label.append(name, out, input);
    return label;
  }

  /** New parameters: put the ball back, keep the last flight as a faded comparison. */
  private reset(): void {
    cancelAnimationFrame(this.frame);
    const { h0, v0, angle } = this.params;
    this.tower.setAttribute('y', String(sy(h0)));
    this.tower.setAttribute('height', String(Math.max(0, sy(0) - sy(h0))));
    this.trail.setAttribute('d', '');
    this.drawBall(0);
    this.readout.textContent = `Нажми «Бросить»: v₀ = ${v0} м/с, α = ${angle}°, h₀ = ${h0} м.`;
  }

  private launch(): void {
    cancelAnimationFrame(this.frame);
    const p = this.params;
    const f = flight(p);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      this.finish(p, f);
      return;
    }
    const start = performance.now();
    const tick = (now: number) => {
      const t = (now - start) / 1000;
      if (t >= f.tFlight) {
        this.finish(p, f);
        return;
      }
      this.trail.setAttribute('d', trajectoryPath(p, t));
      this.drawBall(t);
      this.readout.textContent = `t = ${ru(t)} с`;
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  private finish(p: Params, f: Flight): void {
    const path = trajectoryPath(p, f.tFlight);
    this.trail.setAttribute('d', path);
    this.previous.setAttribute('d', path);
    this.drawBall(f.tFlight);
    this.readout.textContent =
      `Время полёта ${ru(f.tFlight)} с · дальность ${ru(f.range)} м · ` +
      `наибольшая высота ${ru(f.hMax)} м`;
  }

  private drawBall(t: number): void {
    this.t = t;
    const p = this.params;
    const f = flight(p);
    const x = f.vx * t;
    const y = Math.max(0, p.h0 + f.vy0 * t - (G * t * t) / 2);
    const vy = f.vy0 - G * t;
    this.ball.setAttribute('cx', sx(x).toFixed(1));
    this.ball.setAttribute('cy', sy(y).toFixed(1));

    this.arrows.replaceChildren();
    if (!this.showVectors.checked) return;
    const bx = sx(x);
    const by = sy(y);
    this.arrows.append(
      arrow(bx, by, bx + f.vx * ARROW_SCALE, by, 'sim-vx'),
      arrow(bx, by, bx, by - vy * ARROW_SCALE, 'sim-vy'),
      arrow(bx, by, bx + f.vx * ARROW_SCALE, by - vy * ARROW_SCALE, 'sim-v'),
    );
  }
}

function arrow(x1: number, y1: number, x2: number, y2: number, cls: string): SVGGElement {
  const g = el('g', { class: cls });
  const len = Math.hypot(x2 - x1, y2 - y1);
  if (len < 2) return g;
  const ux = (x2 - x1) / len;
  const uy = (y2 - y1) / len;
  const head = 7;
  g.append(
    el('line', { x1, y1, x2: x2 - ux * head * 0.6, y2: y2 - uy * head * 0.6 }),
    el('path', {
      d:
        `M${x2} ${y2}L${x2 - ux * head - uy * head * 0.45} ${y2 - uy * head + ux * head * 0.45}` +
        `L${x2 - ux * head + uy * head * 0.45} ${y2 - uy * head - ux * head * 0.45}Z`,
    }),
  );
  return g;
}

function clamp(v: number, lo: number, hi: number): number {
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo;
}

if (!customElements.get('pp-projectile')) customElements.define('pp-projectile', ProjectileSim);
