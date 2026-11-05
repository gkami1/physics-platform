// <pp-orbit v="6"> — Newton's cannon: a cannon on a mountain 400 km high (above the air) fires
// horizontally. Slow shots fall back, each one farther round the globe; at the circular speed
// (≈ 7,8 км/с at that height) the ball goes round the Earth; faster, the orbit stretches; above
// the escape speed (≈ 11 км/с) the ball leaves for good. Gravity is GM/r², with g = 10 м/с² and
// R = 6400 км (EGE convention), so v₁ = √(gR) = 8 км/с at the surface.
//
// Written into theory Markdown as plain HTML; the theory page imports this module only when
// such an element is present. Light DOM, site CSS variables: follows the light/dark theme.
// Colours as in the dynamics figures: force red, velocity green, the path accent.

const SVG_NS = 'http://www.w3.org/2000/svg';

// Units: lengths in Earth radii, speeds in units of 8 км/с, so GM = 1 and one time unit is
// R / 8 км/с = 800 с.
const R_KM = 6400;
const V_UNIT = 8; // км/с
const T_UNIT = 800; // с
export const H_KM = 400; // mountain height
const R0 = 1 + H_KM / R_KM; // launch radius
const V = { min: 1, max: 12, step: 0.1 }; // км/с
const DT = 0.002;
const T_MAX = 2000; // time units (≈ 19 сут): enough for the longest closed orbit (v < 10,95 км/с)
const R_OUT = 4; // radii: an unbound ball this far out has left the picture for good
const CIRCLE_TOL = 0.05; // км/с: this close to the circular speed counts as a circle
const KEEP = 5; // previous shots shown
const STORE_EVERY = 0.015; // radii between stored points (under a pixel on screen)

const VIEW = { w: 400, h: 270, cx: 200, cy: 112, r: 58 };
const F_PX = 34; // force arrow at the surface, px (falls as 1/r²)
const V_PX = 6; // px per км/с

export type Outcome = 'falls' | 'orbit' | 'escapes';

export interface Shot {
  /** Points along the flight: x, y in Earth radii (Earth's centre at 0, cannon at (0, R0)),
   * t in seconds. */
  points: { x: number; y: number; t: number }[];
  outcome: Outcome;
  /** Flight time, с: until the ball lands, comes back round, or leaves the picture. */
  time: number;
  /** For a fall: distance along the ground from the mountain, км. */
  range: number;
}

/** Speed of a circular orbit at the cannon's height, км/с: √(GM/r) = v₁·√(R/r). */
export function circularSpeed(): number {
  return V_UNIT / Math.sqrt(R0);
}

/** Escape speed at the cannon's height, км/с: √2 times the circular speed. */
export function escapeSpeed(): number {
  return Math.SQRT2 * circularSpeed();
}

/** Fire horizontally at v км/с and follow the ball (velocity Verlet, GM = 1). */
export function shoot(vKms: number): Shot {
  let x = 0;
  let y = R0;
  let vx = vKms / V_UNIT;
  let vy = 0;
  let t = 0;
  let turned = 0; // angle swept round the centre, rad (clockwise, the way the ball flies)
  let prev = Math.atan2(x, y);
  const points = [{ x, y, t: 0 }];
  const accel = (px: number, py: number) => {
    const r3 = Math.hypot(px, py) ** 3;
    return [-px / r3, -py / r3];
  };
  let [ax, ay] = accel(x, y);
  while (t < T_MAX) {
    vx += (ax * DT) / 2;
    vy += (ay * DT) / 2;
    x += vx * DT;
    y += vy * DT;
    [ax, ay] = accel(x, y);
    vx += (ax * DT) / 2;
    vy += (ay * DT) / 2;
    t += DT;
    const a = Math.atan2(x, y);
    let d = a - prev;
    if (d < -Math.PI) d += 2 * Math.PI;
    if (d > Math.PI) d -= 2 * Math.PI;
    turned += d;
    prev = a;
    const r = Math.hypot(x, y);
    if (r <= 1) {
      points.push({ x: x / r, y: y / r, t: t * T_UNIT });
      return { points, outcome: 'falls', time: t * T_UNIT, range: turned * R_KM };
    }
    const last = points[points.length - 1];
    if (Math.hypot(x - last.x, y - last.y) >= STORE_EVERY) points.push({ x, y, t: t * T_UNIT });
    if (turned >= 2 * Math.PI) {
      points.push({ x: 0, y: R0, t: t * T_UNIT });
      return { points, outcome: 'orbit', time: t * T_UNIT, range: 0 };
    }
    // Unbound (energy v²/2 − GM/r ≥ 0) and out of the picture: it never comes back.
    if (r > R_OUT && (vx * vx + vy * vy) / 2 - 1 / r >= 0) break;
  }
  points.push({ x, y, t: t * T_UNIT });
  return { points, outcome: 'escapes', time: t * T_UNIT, range: 0 };
}

/** Where along the flight the ball is at time t, с (linear between stored points). */
export function at(shot: Shot, t: number): { x: number; y: number; vx: number; vy: number } {
  const p = shot.points;
  let i = 1;
  while (i < p.length - 1 && p[i].t < t) i++;
  const a = p[i - 1];
  const b = p[i];
  const span = b.t - a.t || 1;
  const k = Math.min(1, Math.max(0, (t - a.t) / span));
  // Velocity from the chord, in км/с (radii per second → км/с).
  return {
    x: a.x + (b.x - a.x) * k,
    y: a.y + (b.y - a.y) * k,
    vx: ((b.x - a.x) / span) * R_KM,
    vy: ((b.y - a.y) / span) * R_KM,
  };
}

const sx = (x: number) => VIEW.cx + x * VIEW.r;
const sy = (y: number) => VIEW.cy - y * VIEW.r;
const ru = (n: number, digits = 1) =>
  (Math.round(n * 10 ** digits) / 10 ** digits).toFixed(digits).replace('.', ',');
const minutes = (s: number) => {
  const m = Math.round(s / 60);
  return m < 120 ? `${m} мин` : `${ru(s / 3600)} ч`;
};
const km = (n: number) => `${Math.round(n / 100) * 100}`.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

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

function pathOf(shot: Shot, upTo = Infinity): string {
  let d = '';
  for (const p of shot.points) {
    if (p.t > upTo) break;
    d += `${d ? 'L' : 'M'}${sx(p.x).toFixed(1)} ${sy(p.y).toFixed(1)}`;
  }
  return d;
}

function arrow(x1: number, y1: number, dx: number, dy: number, cls: string, name: string): SVGGElement {
  const g = el('g', { class: cls });
  const len = Math.hypot(dx, dy);
  if (len < 4) return g;
  const ux = dx / len;
  const uy = dy / len;
  const head = Math.min(8, len * 0.6);
  const x2 = x1 + dx;
  const y2 = y1 + dy;
  g.append(
    el('line', { x1, y1, x2: x2 - ux * head * 0.6, y2: y2 - uy * head * 0.6 }),
    el('path', {
      d:
        `M${x2} ${y2}L${x2 - ux * head - uy * head * 0.45} ${y2 - uy * head + ux * head * 0.45}` +
        `L${x2 - ux * head + uy * head * 0.45} ${y2 - uy * head - ux * head * 0.45}Z`,
    }),
    el('text', { x: x2 + ux * 9, y: y2 + uy * 9 + 4, 'text-anchor': 'middle' }, name),
  );
  return g;
}

class OrbitSim extends HTMLElement {
  private v = 6;
  private frame = 0;
  private built = false;
  private previous!: SVGGElement;
  private trail!: SVGPathElement;
  private ball!: SVGCircleElement;
  private arrows!: SVGGElement;
  private out!: HTMLOutputElement;
  private readout!: HTMLElement;
  private shots: SVGPathElement[] = [];

  connectedCallback(): void {
    if (this.built) return;
    this.built = true;
    const n = Number(this.getAttribute('v') ?? 6);
    this.v = Number.isFinite(n) ? Math.min(V.max, Math.max(V.min, Math.round(n * 10) / 10)) : 6;
    this.replaceChildren(); // drop the no-JS fallback text
    this.classList.add('sim', 'orb');
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
        'Земля и пушка на высокой горе. Пушка стреляет горизонтально; видны путь ядра, ' +
        'его скорость и сила тяготения, направленная к центру Земли',
    });
    const earth = el('circle', { cx: VIEW.cx, cy: VIEW.cy, r: VIEW.r, class: 'orb-earth' });
    const label = el('text', { x: VIEW.cx, y: VIEW.cy + 4, 'text-anchor': 'middle', class: 'orb-label' }, 'Земля');
    // The mountain, drawn to scale (400 км on a 6400 км Earth), plus the cannon on top.
    const top = sy(R0);
    const foot = 9;
    const footY = VIEW.cy - Math.sqrt(VIEW.r ** 2 - foot ** 2);
    const mountain = el('path', {
      d: `M${VIEW.cx - foot} ${footY.toFixed(1)}L${VIEW.cx} ${top.toFixed(1)}L${VIEW.cx + foot} ${footY.toFixed(1)}Z`,
      class: 'orb-mountain',
    });
    const cannon = el('rect', { x: VIEW.cx - 3, y: top - 4, width: 9, height: 4, rx: 1, class: 'orb-cannon' });
    this.previous = el('g');
    this.trail = el('path', { class: 'sim-trail' });
    this.arrows = el('g', { class: 'orb-arrows' });
    this.ball = el('circle', { r: 4, class: 'sim-ball' });
    svg.append(earth, label, this.previous, mountain, cannon, this.trail, this.arrows, this.ball);
    this.append(svg);
  }

  private buildControls(): void {
    const controls = document.createElement('div');
    controls.className = 'sim-controls';
    const slider = document.createElement('label');
    slider.className = 'sim-slider';
    const name = document.createElement('span');
    name.textContent = 'Скорость ядра';
    this.out = document.createElement('output');
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(V.min);
    input.max = String(V.max);
    input.step = String(V.step);
    input.value = String(this.v);
    input.addEventListener('input', () => {
      this.v = Math.round(Number(input.value) * 10) / 10;
      this.reset();
    });
    slider.append(name, this.out, input);
    controls.append(slider);

    const row = document.createElement('div');
    row.className = 'sim-row';
    const fire = document.createElement('button');
    fire.type = 'button';
    fire.className = 'btn small';
    fire.textContent = 'Выстрелить';
    fire.addEventListener('click', () => this.fire());
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'btn small ghost';
    clear.textContent = 'Стереть следы';
    clear.addEventListener('click', () => {
      this.shots = [];
      this.previous.replaceChildren();
      this.reset();
    });
    const legend = document.createElement('span');
    legend.className = 'sim-check';
    legend.innerHTML =
      '<span class="crt-key crt-key-f"></span> сила тяготения · ' +
      '<span class="crt-key crt-key-v"></span> скорость';
    row.append(fire, clear, legend);

    this.readout = document.createElement('p');
    this.readout.className = 'sim-readout';
    this.readout.setAttribute('aria-live', 'polite');
    this.append(controls, row, this.readout);
  }

  private reset(): void {
    cancelAnimationFrame(this.frame);
    this.out.textContent = `${ru(this.v)} км/с`;
    this.trail.setAttribute('d', '');
    this.place(0, R0, this.v, 0);
    this.readout.textContent =
      `Пушка на горе высотой ${H_KM} км — выше воздуха, он не тормозит ядро. ` +
      `Скорость ${ru(this.v)} км/с, нажми «Выстрелить».`;
  }

  private fire(): void {
    cancelAnimationFrame(this.frame);
    const shot = shoot(this.v);
    // A circle takes about 5 s on screen; long flights are sped up to fit in 9 s.
    const circle = 2 * Math.PI * R0 ** 1.5 * T_UNIT;
    const scale = Math.max(shot.time / 9, circle / 5); // simulated seconds per real second
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      this.finish(shot);
      return;
    }
    const start = performance.now();
    const tick = (now: number) => {
      const t = ((now - start) / 1000) * scale;
      if (t >= shot.time) {
        this.finish(shot);
        return;
      }
      this.trail.setAttribute('d', pathOf(shot, t));
      const p = at(shot, t);
      this.place(p.x, p.y, p.vx, p.vy);
      this.readout.textContent = `t = ${minutes(t)} · высота ${km((Math.hypot(p.x, p.y) - 1) * R_KM)} км`;
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  private finish(shot: Shot): void {
    const d = pathOf(shot);
    this.trail.setAttribute('d', '');
    const kept = el('path', { d, class: 'sim-previous orb-shot' });
    this.shots.push(kept);
    if (this.shots.length > KEEP) this.shots.shift()?.remove();
    this.previous.append(kept);
    this.trail.setAttribute('d', d);
    const last = shot.points[shot.points.length - 1];
    if (shot.outcome === 'escapes') {
      this.ball.setAttribute('visibility', 'hidden');
      this.arrows.replaceChildren();
    } else if (shot.outcome === 'orbit') {
      this.place(0, R0, this.v, 0);
    } else {
      this.place(last.x, last.y, 0, 0, false);
    }
    this.readout.textContent = this.verdict(shot);
  }

  private verdict(shot: Shot): string {
    const vc = circularSpeed();
    if (shot.outcome === 'falls')
      return (
        `Ядро упало через ${minutes(shot.time)}, в ${km(shot.range)} км от горы (по поверхности). ` +
        'Стреляй быстрее — упадёт дальше: Земля круглая и «уходит» из-под ядра.'
      );
    if (shot.outcome === 'escapes')
      return (
        `Ядро улетело от Земли навсегда: ${ru(this.v)} км/с больше второй космической скорости ` +
        `(на этой высоте ${ru(escapeSpeed())} км/с).`
      );
    if (Math.abs(this.v - vc) < CIRCLE_TOL)
      return (
        `Круговая орбита! Ядро облетело Землю за ${minutes(shot.time)} и вернулось к горе. ` +
        'Оно всё время падает к центру, но так и не долетает до земли.'
      );
    return (
      `Ядро облетело Землю за ${minutes(shot.time)} по вытянутой орбите — эллипсу: ` +
      (this.v > vc ? 'улетает дальше от Земли и возвращается к горе.' : 'проходит ниже горы и возвращается к ней.')
    );
  }

  /** Ball at (x, y) in radii with velocity (vx, vy) in км/с; the force points to the centre. */
  private place(x: number, y: number, vx: number, vy: number, withForce = true): void {
    const bx = sx(x);
    const by = sy(y);
    this.ball.setAttribute('visibility', 'visible');
    this.ball.setAttribute('cx', bx.toFixed(1));
    this.ball.setAttribute('cy', by.toFixed(1));
    const r = Math.hypot(x, y);
    const f = F_PX / (r * r);
    this.arrows.replaceChildren(
      withForce ? arrow(bx, by, (-x / r) * f, (y / r) * f, 'orb-f', 'F') : el('g'),
      arrow(bx, by, vx * V_PX, -vy * V_PX, 'orb-v', 'v'),
    );
  }
}

if (!customElements.get('pp-orbit')) customElements.define('pp-orbit', OrbitSim);
