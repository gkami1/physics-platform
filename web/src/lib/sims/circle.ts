// <pp-circle t="2" r="1"> — a disk turns with period T. Two points sit on one spoke: A at
// distance r from the axis (slider) and B on the rim. Each carries its velocity arrow (along
// the tangent) and its acceleration arrow (to the centre), drawn to fixed scales so periods
// and points can be compared by eye. Both points keep to their spoke: one angular speed,
// different linear speeds. «Отпустить точку A» lets A go: it flies off along the tangent in a
// straight line with the speed it had, and the acceleration arrow is gone.
//
// Written into theory Markdown as plain HTML; the theory page imports this module only when
// such an element is present. Light DOM, site CSS variables: follows the light/dark theme.

const SVG_NS = 'http://www.w3.org/2000/svg';

const T_RANGE = { min: 1, max: 4, step: 0.5 }; // period, с
const R_RANGE = { min: 0.25, max: 1.75, step: 0.25 }; // distance of A from the axis, м
const RIM = 2; // disk radius, м (point B)

const VIEW = { w: 400, h: 320 };
const C = { x: 200, y: 160 }; // axis on screen
const PX = 50; // px per м
const V_SCALE = 6; // px per м/с
const A_SCALE = 1.2; // px per м/с²: the largest arrow (T = 1 с, rim) still fits inside the disk
const START = Math.PI / 6; // the spoke's angle when the page opens

const ru = (n: number, digits = 2) =>
  (Math.round(n * 10 ** digits) / 10 ** digits)
    .toFixed(digits)
    .replace('.', ',')
    .replace(/,?0+$/, '');

type Vec = { x: number; y: number };

/** Angular speed, рад/с: one turn (2π) per period. */
export function omega(period: number): number {
  return (2 * Math.PI) / period;
}

/** Linear speed of a point at distance r: v = ωr. */
export function speed(period: number, r: number): number {
  return omega(period) * r;
}

/** Centripetal acceleration of a point at distance r: a = ω²r = v²/r. */
export function accel(period: number, r: number): number {
  return omega(period) ** 2 * r;
}

/** Position (м, y up, axis at the origin) of a point at distance r when the spoke is at phi. */
export function position(r: number, phi: number): Vec {
  return { x: r * Math.cos(phi), y: r * Math.sin(phi) };
}

/** Velocity (м/с) of that point, turning counter-clockwise: along the tangent, ωr long. */
export function velocity(period: number, r: number, phi: number): Vec {
  const v = speed(period, r);
  return { x: -v * Math.sin(phi), y: v * Math.cos(phi) };
}

/** Acceleration (м/с²) of that point: towards the axis, ω²r long. */
export function acceleration(period: number, r: number, phi: number): Vec {
  const a = accel(period, r);
  return { x: -a * Math.cos(phi), y: -a * Math.sin(phi) };
}

/** A point let go at angle phi flies straight on with its velocity: position t seconds later. */
export function released(period: number, r: number, phi: number, t: number): Vec {
  const p = position(r, phi);
  const v = velocity(period, r, phi);
  return { x: p.x + v.x * t, y: p.y + v.y * t };
}

const sx = (p: Vec) => C.x + p.x * PX;
const sy = (p: Vec) => C.y - p.y * PX;

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

/** Arrow from screen point (x1, y1) by (dx, dy) world units times scale (y up). */
function arrow(x1: number, y1: number, d: Vec, scale: number, cls: string): SVGGElement {
  const g = el('g', { class: cls });
  const x2 = x1 + d.x * scale;
  const y2 = y1 - d.y * scale;
  const len = Math.hypot(x2 - x1, y2 - y1);
  if (len < 2) return g;
  const ux = (x2 - x1) / len;
  const uy = (y2 - y1) / len;
  const head = Math.min(7, len * 0.6);
  const f = (n: number) => n.toFixed(1);
  g.append(
    el('line', { x1: f(x1), y1: f(y1), x2: f(x2 - ux * head * 0.6), y2: f(y2 - uy * head * 0.6) }),
    el('path', {
      d:
        `M${f(x2)} ${f(y2)}` +
        `L${f(x2 - ux * head - uy * head * 0.45)} ${f(y2 - uy * head + ux * head * 0.45)}` +
        `L${f(x2 - ux * head + uy * head * 0.45)} ${f(y2 - uy * head - ux * head * 0.45)}Z`,
    }),
  );
  return g;
}

function snap(n: number, r: { min: number; max: number; step: number }, fallback: number) {
  if (!Number.isFinite(n)) return fallback;
  return Math.min(r.max, Math.max(r.min, Math.round(n / r.step) * r.step));
}

class CircleSim extends HTMLElement {
  private period = 2;
  private r = 1;
  private phi = START;
  private flight: { phi: number; r: number; period: number; t: number } | null = null;
  private frame = 0;
  private last = 0;
  private visible = true;
  private still = false; // prefers reduced motion: no turning, single frames
  private built = false;
  private observer: IntersectionObserver | null = null;
  private disk!: SVGGElement;
  private trackA!: SVGCircleElement;
  private spoke!: SVGLineElement;
  private arrows!: SVGGElement;
  private tail!: SVGLineElement;
  private pointA!: SVGCircleElement;
  private pointB!: SVGCircleElement;
  private labelA!: SVGTextElement;
  private labelB!: SVGTextElement;
  private release!: HTMLButtonElement;
  private readout!: HTMLElement;

  connectedCallback(): void {
    if (this.built) return;
    this.built = true;
    this.period = snap(Number(this.getAttribute('t') ?? 2), T_RANGE, 2);
    this.r = snap(Number(this.getAttribute('r') ?? 1), R_RANGE, 1);
    this.still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.replaceChildren(); // drop the no-JS fallback text
    this.classList.add('sim', 'crc');
    this.buildScene();
    this.buildControls();
    this.draw();
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

  private buildScene(): void {
    const svg = el('svg', {
      viewBox: `0 0 ${VIEW.w} ${VIEW.h}`,
      class: 'sim-svg',
      role: 'img',
      'aria-label':
        'Вращающийся диск: точка A на спице и точка B на краю, у каждой стрелки скорости и ускорения',
    });
    this.disk = el('g');
    this.disk.append(el('circle', { class: 'crc-disk', cx: C.x, cy: C.y, r: RIM * PX }));
    for (let k = 0; k < 4; k++) {
      const p = position(RIM, (k * Math.PI) / 2 + Math.PI / 4);
      this.disk.append(el('line', { class: 'crc-spokes', x1: C.x, y1: C.y, x2: sx(p), y2: sy(p) }));
    }
    this.trackA = el('circle', { class: 'crc-track', cx: C.x, cy: C.y });
    this.spoke = el('line', { class: 'crc-spoke', x1: C.x, y1: C.y });
    this.tail = el('line', { class: 'crc-tail' });
    this.arrows = el('g', { class: 'crc-arrows' });
    this.pointA = el('circle', { class: 'crc-point', r: 5 });
    this.pointB = el('circle', { class: 'crc-point', r: 5 });
    this.labelA = el('text', { class: 'crc-label', 'text-anchor': 'middle' }, 'A');
    this.labelB = el('text', { class: 'crc-label', 'text-anchor': 'middle' }, 'B');
    svg.append(
      this.disk,
      this.trackA,
      this.spoke,
      el('circle', { class: 'crc-axis', cx: C.x, cy: C.y, r: 3 }),
      this.tail,
      this.arrows,
      this.pointA,
      this.pointB,
      this.labelA,
      this.labelB,
    );
    this.append(svg);
  }

  private buildControls(): void {
    const controls = document.createElement('div');
    controls.className = 'sim-controls';
    controls.append(
      this.slider(
        'Период',
        T_RANGE,
        () => this.period,
        (v) => (this.period = v),
        (v) => `${ru(v, 1)} с`,
      ),
      this.slider(
        'Точка A от оси',
        R_RANGE,
        () => this.r,
        (v) => (this.r = v),
        (v) => `${ru(v)} м`,
      ),
    );
    const row = document.createElement('div');
    row.className = 'sim-row';
    this.release = document.createElement('button');
    this.release.type = 'button';
    this.release.className = 'btn small';
    this.release.addEventListener('click', () => this.toggleRelease());
    const legend = document.createElement('span');
    legend.className = 'sim-check';
    legend.innerHTML =
      '<span class="crc-key crc-key-v"></span> скорость · ' +
      '<span class="crc-key crc-key-a"></span> ускорение';
    row.append(this.release, legend);
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
      this.flight = null; // new parameters: A back on its spoke
      this.draw();
    });
    label.append(name, out, input);
    return label;
  }

  private start(): void {
    cancelAnimationFrame(this.frame);
    this.last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min((now - this.last) / 1000, 0.1); // a hidden tab must not jump
      this.last = now;
      this.phi = (this.phi + omega(this.period) * dt) % (2 * Math.PI);
      if (this.flight) this.flight.t += dt;
      this.draw();
      if (this.visible) this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  private toggleRelease(): void {
    if (this.flight) {
      this.flight = null;
    } else {
      // Reduced motion: no flight to watch, so show where A is a second later.
      this.flight = { phi: this.phi, r: this.r, period: this.period, t: this.still ? 1 : 0 };
    }
    this.draw();
  }

  private draw(): void {
    const deg = (-this.phi * 180) / Math.PI; // SVG turns clockwise; the disk turns the other way
    this.disk.setAttribute('transform', `rotate(${deg.toFixed(2)} ${C.x} ${C.y})`);
    this.trackA.setAttribute('r', String(this.r * PX));
    const b = position(RIM, this.phi);
    this.spoke.setAttribute('x2', sx(b).toFixed(1));
    this.spoke.setAttribute('y2', sy(b).toFixed(1));
    this.arrows.replaceChildren();
    this.place(this.pointB, this.labelB, b, this.phi);
    this.arrows.append(
      arrow(sx(b), sy(b), acceleration(this.period, RIM, this.phi), A_SCALE, 'crc-a'),
      arrow(sx(b), sy(b), velocity(this.period, RIM, this.phi), V_SCALE, 'crc-v'),
    );
    const f = this.flight;
    const head =
      `T = ${ru(this.period, 1)} с · ν = ${ru(1 / this.period)} Гц · ` +
      `ω = ${ru(omega(this.period))} рад/с`;
    const lineB =
      `B (край, ${RIM} м): v = ${ru(speed(this.period, RIM))} м/с, ` +
      `a = ${ru(accel(this.period, RIM), 1)} м/с²`;
    if (f) {
      const from = position(f.r, f.phi);
      const p = released(f.period, f.r, f.phi, f.t);
      const away = Math.abs(sx(p) - C.x) > VIEW.w || Math.abs(sy(p) - C.y) > VIEW.h;
      // Past the edge of the picture: stop drawing it further, keep the line to the edge.
      const shown = away ? released(f.period, f.r, f.phi, this.exitTime(f)) : p;
      this.tail.setAttribute('x1', sx(from).toFixed(1));
      this.tail.setAttribute('y1', sy(from).toFixed(1));
      this.tail.setAttribute('x2', sx(shown).toFixed(1));
      this.tail.setAttribute('y2', sy(shown).toFixed(1));
      this.tail.style.display = '';
      this.place(this.pointA, this.labelA, shown, Math.atan2(shown.y, shown.x));
      if (!away) {
        this.arrows.append(
          arrow(sx(p), sy(p), velocity(f.period, f.r, f.phi), V_SCALE, 'crc-v'),
        );
      }
      this.release.textContent = 'Вернуть точку A';
      this.readout.innerHTML =
        `${head}<br>A отпустили: летит по прямой, по касательной, со скоростью ` +
        `${ru(speed(f.period, f.r))} м/с. Ускорения больше нет.<br>${lineB}`;
    } else {
      const a = position(this.r, this.phi);
      this.tail.style.display = 'none';
      this.place(this.pointA, this.labelA, a, this.phi);
      this.arrows.append(
        arrow(sx(a), sy(a), acceleration(this.period, this.r, this.phi), A_SCALE, 'crc-a'),
        arrow(sx(a), sy(a), velocity(this.period, this.r, this.phi), V_SCALE, 'crc-v'),
      );
      this.release.textContent = 'Отпустить точку A';
      this.readout.innerHTML =
        `${head}<br>A (${ru(this.r)} м от оси): v = ${ru(speed(this.period, this.r))} м/с, ` +
        `a = ${ru(accel(this.period, this.r), 1)} м/с²<br>${lineB}`;
    }
  }

  /** When the released point leaves the picture (it moves in a straight line, so solve once). */
  private exitTime(f: { phi: number; r: number; period: number }): number {
    const p = position(f.r, f.phi);
    const v = velocity(f.period, f.r, f.phi);
    const limits: number[] = [];
    const bx = VIEW.w / 2 / PX;
    const by = VIEW.h / 2 / PX;
    if (v.x > 0) limits.push((bx - p.x) / v.x);
    if (v.x < 0) limits.push((-bx - p.x) / v.x);
    if (v.y > 0) limits.push((by - p.y) / v.y);
    if (v.y < 0) limits.push((-by - p.y) / v.y);
    return Math.max(0, Math.min(...limits));
  }

  /** A point and its letter, the letter just outside the point along the radius. */
  private place(dot: SVGCircleElement, label: SVGTextElement, p: Vec, dir: number): void {
    dot.setAttribute('cx', sx(p).toFixed(1));
    dot.setAttribute('cy', sy(p).toFixed(1));
    // Put the letter on the trailing side of the point, away from both arrows.
    const back = dir - Math.PI / 2;
    label.setAttribute('x', (sx(p) + 14 * Math.cos(back) + 6 * Math.cos(dir)).toFixed(1));
    label.setAttribute('y', (sy(p) - 14 * Math.sin(back) - 6 * Math.sin(dir) + 4).toFixed(1));
  }
}

if (!customElements.get('pp-circle')) customElements.define('pp-circle', CircleSim);
