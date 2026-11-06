// <pp-wave nu="1" v="1.5" mode="transverse" mark="lambda"> — a rope of beads, 6 m long. The
// source at the left end starts to oscillate at t = 0 and the wave runs along the rope at v:
// a bead starts moving only when the front reaches it, then repeats the source's motion late
// by x/v. Two beads are marked (accent) λ or λ/2 apart, with the range each one moves in, so
// it shows that a bead only goes up and down (or back and forth in the longitudinal mode) and
// that beads λ apart move alike, λ/2 apart oppositely. Wave speed green, as in the figures.
//
// The motion is exact: y = A sin 2πν(t − x/v) behind the front, 0 ahead of it. «Пуск» runs
// until the front reaches the end plus two periods; with reduced motion the first press shows
// the wave at the end of the rope, the next four step a quarter period each.
//
// Written into theory Markdown as plain HTML; the theory page imports this module only when
// such an element is present. Light DOM, site CSS variables: follows the light/dark theme.

const SVG_NS = 'http://www.w3.org/2000/svg';

const NU = { min: 0.5, max: 2, step: 0.25 }; // Гц
const V = { min: 1, max: 3, step: 0.25 }; // м/с
const ROPE = 6; // м
const MARK_X = 0.75; // м, the first marked bead
const BEAD = 0.15; // м between beads
const TAIL_PERIODS = 2; // run on after the front reaches the end

const L = {
  w: 400,
  h: 214,
  x0: 46, // x = 0
  px: 56, // px per м
  y0: 96, // the rope at rest
  ampT: 30, // transverse amplitude, px
  ampL: 10, // longitudinal amplitude, px (smaller for short waves)
  layer: 24, // half height of a layer line, longitudinal
  vArrow: 26,
  bracket: 150,
  scale: 178,
};

export type Mode = 'transverse' | 'longitudinal';
export type Mark = 'lambda' | 'half';

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Russian number: decimal comma, real minus, up to `digits` decimals, trailing zeros dropped. */
export function ru(n: number, digits = 2): string {
  const r = Math.round(n * 10 ** digits) / 10 ** digits;
  const s = (Object.is(r, -0) ? 0 : r).toFixed(digits);
  return (digits ? s.replace(/\.?0+$/, '') : s).replace('.', ',').replace('-', '−');
}

/** Wavelength λ = v/ν, м. */
export function wavelength(v: number, nu: number): number {
  return v / nu;
}

/** Displacement of the point at x (м) at time t (с), in amplitudes: 0 until the front arrives. */
export function displacement(x: number, t: number, v: number, nu: number): number {
  const late = t - x / v;
  return late < 0 ? 0 : Math.sin(2 * Math.PI * nu * late);
}

/** Phase lag of a point Δx further from the source, рад: Δφ = 2πΔx/λ. */
export function phaseLag(dx: number, lambda: number): number {
  return (2 * Math.PI * dx) / lambda;
}

/** Time at which the run stops: the front at the far end, then two more periods. */
export function runTime(v: number, nu: number): number {
  return ROPE / v + TAIL_PERIODS / nu;
}

/** Reduced-motion stops: the front just past the end (whole quarter periods), then four quarters. */
export function steps(v: number, nu: number): number[] {
  const q = 1 / nu / 4;
  const first = Math.ceil(ROPE / v / q - 1e-9) * q;
  return [0, 1, 2, 3, 4].map((k) => round3(first + k * q));
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

function arrow(x1: number, y1: number, x2: number, y2: number, head = 8): SVGGElement {
  const g = el('g');
  const len = Math.hypot(x2 - x1, y2 - y1);
  if (len < 4) return g;
  const ux = (x2 - x1) / len;
  const uy = (y2 - y1) / len;
  const h = Math.min(head, len * 0.6);
  const bx = x2 - ux * h;
  const by = y2 - uy * h;
  g.append(
    el('line', { x1: x1.toFixed(1), y1: y1.toFixed(1), x2: (x2 - ux * h * 0.6).toFixed(1), y2: (y2 - uy * h * 0.6).toFixed(1) }),
    el('path', {
      d: `M${x2.toFixed(1)} ${y2.toFixed(1)}L${(bx - uy * h * 0.45).toFixed(1)} ${(by + ux * h * 0.45).toFixed(1)}L${(bx + uy * h * 0.45).toFixed(1)} ${(by - ux * h * 0.45).toFixed(1)}Z`,
    }),
  );
  return g;
}

const sx = (x: number) => L.x0 + x * L.px;

let instances = 0;

class WaveSim extends HTMLElement {
  private nu = 1;
  private v = 1.5;
  private mode: Mode = 'transverse';
  private mark: Mark = 'lambda';
  private t = 0;
  private step = -1;
  private running = false;
  private frame = 0;
  private built = false;
  private moving!: SVGGElement;
  private go!: HTMLButtonElement;
  private readout!: HTMLElement;
  private outs: Record<'nu' | 'v', HTMLOutputElement> = {} as never;

  connectedCallback(): void {
    if (this.built) return;
    this.built = true;
    this.nu = this.attr('nu', 1, NU);
    this.v = this.attr('v', 1.5, V);
    this.mode = this.getAttribute('mode') === 'longitudinal' ? 'longitudinal' : 'transverse';
    this.mark = this.getAttribute('mark') === 'half' ? 'half' : 'lambda';
    this.replaceChildren(); // drop the no-JS fallback text
    this.classList.add('sim', 'wav');
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

  private chips<T extends string>(title: string, cls: string, options: [T, string][], get: () => T, set: (v: T) => void) {
    const id = ++instances;
    const box = document.createElement('fieldset');
    box.className = `pfx-chips wav-chips ${cls}`;
    const legend = document.createElement('legend');
    legend.textContent = title;
    box.append(legend);
    for (const [key, text] of options) {
      const label = document.createElement('label');
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = `wav-${cls}-${id}`;
      radio.value = key;
      radio.checked = key === get();
      radio.addEventListener('change', () => {
        set(key);
        this.reset();
      });
      const span = document.createElement('span');
      span.innerHTML = text;
      label.append(radio, span);
      box.append(label);
    }
    return box;
  }

  private build(): void {
    const modes = this.chips<Mode>(
      'Волна',
      'wav-modes',
      [
        ['transverse', 'поперечная'],
        ['longitudinal', 'продольная'],
      ],
      () => this.mode,
      (m) => (this.mode = m),
    );
    const svg = el('svg', {
      viewBox: `0 0 ${L.w} ${L.h}`,
      class: 'sim-svg',
      role: 'img',
      'aria-label':
        'Верёвка из бусинок длиной 6 м. Левый конец колеблется, и по верёвке бежит волна. ' +
        'Две бусинки отмечены: видно, что каждая только колеблется на своём месте',
    });
    const fixed = el('g', { class: 'wav-fixed' });
    for (let m = 0; m <= ROPE; m++) {
      fixed.append(
        el('line', { x1: sx(m), x2: sx(m), y1: L.scale - 4, y2: L.scale + 4 }),
        el('text', { x: sx(m), y: L.scale + 18, 'text-anchor': 'middle' }, String(m)),
      );
    }
    fixed.append(
      el('line', { x1: sx(0), x2: sx(ROPE), y1: L.scale, y2: L.scale }),
      el('text', { x: sx(ROPE) + 10, y: L.scale + 4 }, 'м'),
    );
    this.moving = el('g');
    svg.append(fixed, this.moving);

    const controls = document.createElement('div');
    controls.className = 'sim-controls';
    const add = (key: 'nu' | 'v', title: string, r: typeof NU, unit: string) => {
      const label = document.createElement('label');
      label.className = 'sim-slider';
      const name = document.createElement('span');
      name.innerHTML = title;
      const out = document.createElement('output');
      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(r.min);
      input.max = String(r.max);
      input.step = String(r.step);
      input.value = String(this[key]);
      input.addEventListener('input', () => {
        this[key] = round3(Number(input.value));
        this.reset();
      });
      out.dataset.unit = unit;
      this.outs[key] = out;
      label.append(name, out, input);
      controls.append(label);
    };
    add('nu', 'Частота источника <i>ν</i>', NU, ' Гц');
    add('v', 'Скорость волны <i>v</i>', V, ' м/с');

    const marks = this.chips<Mark>(
      'Отметить точки на расстоянии',
      'wav-marks',
      [
        ['lambda', '<i>λ</i>'],
        ['half', '<i>λ</i>/2'],
      ],
      () => this.mark,
      (m) => (this.mark = m),
    );

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
    again.addEventListener('click', () => this.reset());
    const key = document.createElement('span');
    key.className = 'sim-check';
    key.innerHTML =
      '<span class="crt-key crt-key-v"></span> волна бежит · ' +
      '<span class="crt-key crt-key-a"></span> отмеченные бусинки';
    row.append(this.go, again, key);

    this.readout = document.createElement('p');
    this.readout.className = 'sim-readout';
    this.readout.setAttribute('aria-live', 'polite');
    this.append(modes, svg, controls, marks, row, this.readout);
  }

  private lambda(): number {
    return wavelength(this.v, this.nu);
  }

  private second(): number {
    return MARK_X + (this.mark === 'half' ? this.lambda() / 2 : this.lambda());
  }

  private reset(): void {
    cancelAnimationFrame(this.frame);
    this.running = false;
    this.t = 0;
    this.step = -1;
    this.outs.nu.textContent = ru(this.nu) + (this.outs.nu.dataset.unit ?? '');
    this.outs.v.textContent = ru(this.v) + (this.outs.v.dataset.unit ?? '');
    this.go.textContent = 'Пуск';
    this.draw();
    const lam = this.lambda();
    const fits = this.second() <= ROPE;
    this.readout.innerHTML =
      `<i>λ</i> = <i>v</i>/<i>ν</i> = ${ru(this.v)} / ${ru(this.nu)} = ${ru(lam)} м, ` +
      `<i>T</i> = 1/<i>ν</i> = ${ru(1 / this.nu)} с. ` +
      (fits ? '' : 'Вторая отмеченная бусинка не помещается на верёвке — уменьши скорость или увеличь частоту. ') +
      'Нажми «Пуск»: левый конец начнёт колебаться.';
  }

  private reduced(): boolean {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  private run(): void {
    const end = runTime(this.v, this.nu);
    if (this.reduced()) {
      const stops = steps(this.v, this.nu);
      if (this.step >= stops.length - 1) {
        this.reset();
        return;
      }
      this.step += 1;
      this.t = stops[this.step];
      this.go.textContent = this.step === stops.length - 1 ? 'Сначала' : 'Дальше';
      this.draw();
      this.say();
      return;
    }
    if (this.running) {
      cancelAnimationFrame(this.frame);
      this.running = false;
      this.go.textContent = 'Дальше';
      return;
    }
    if (this.t >= end) this.t = 0;
    this.running = true;
    this.go.textContent = 'Пауза';
    let prev = performance.now();
    const tick = (now: number) => {
      this.t = Math.min(end, this.t + Math.min(0.05, (now - prev) / 1000));
      prev = now;
      this.draw();
      this.say();
      if (this.t >= end) {
        this.running = false;
        this.go.textContent = 'Пуск';
        return;
      }
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  private say(): void {
    const front = Math.min(ROPE, this.v * this.t);
    const second = this.second();
    const both = this.t * this.v >= second && second <= ROPE;
    const pair =
      this.mark === 'half'
        ? 'Отмеченные бусинки на расстоянии <i>λ</i>/2 всегда движутся в противоположные стороны — в противофазе.'
        : 'Отмеченные бусинки на расстоянии <i>λ</i> движутся одинаково — в фазе.';
    let text = `<i>t</i> = ${ru(this.t)} с. `;
    if (this.v * this.t < ROPE) text += `Волна прошла <i>vt</i> = ${ru(front)} м. `;
    else text += 'Волна дошла до конца верёвки. ';
    if (this.reduced() && this.step > 0) {
      const part = ['', 'Прошла ещё четверть периода', 'Прошла ещё половина периода', 'Прошли ещё три четверти периода', 'Прошёл ещё целый период'][this.step];
      const shift = ['', '<i>λ</i>/4', '<i>λ</i>/2', '3<i>λ</i>/4', '<i>λ</i>'][this.step];
      const what = this.mode === 'longitudinal' ? 'сгущения' : 'гребни';
      text += `${part}: ${what} сдвинулись на ${shift}, а каждая бусинка осталась на своём месте. `;
    }
    if (both) text += pair;
    else if (this.v * this.t < MARK_X) text += 'Бусинки впереди фронта пока стоят.';
    this.readout.innerHTML = text;
  }

  private draw(): void {
    const g = this.moving;
    g.replaceChildren();
    const lam = this.lambda();
    const longit = this.mode === 'longitudinal';
    const ampL = Math.min(L.ampL, (0.7 * lam * L.px) / (2 * Math.PI));
    const at = (x: number) => displacement(x, this.t, this.v, this.nu);
    const front = Math.min(ROPE, this.v * this.t);
    const second = this.second();
    const marked = [MARK_X, ...(second <= ROPE ? [second] : [])];

    // the source
    const s0 = at(0);
    if (longit) {
      g.append(el('rect', { x: (sx(0) - 16 + s0 * ampL).toFixed(1), y: L.y0 - L.layer - 4, width: 10, height: 2 * L.layer + 8, rx: 2, class: 'wav-source' }));
    } else {
      g.append(el('rect', { x: sx(0) - 18, y: (L.y0 - s0 * L.ampT - 9).toFixed(1), width: 14, height: 18, rx: 3, class: 'wav-source' }));
    }

    // range guides of the marked beads: where each one can be
    for (const x of marked) {
      if (longit) {
        g.append(el('line', { x1: (sx(x) - ampL).toFixed(1), x2: (sx(x) + ampL).toFixed(1), y1: L.y0 - L.layer - 9, y2: L.y0 - L.layer - 9, class: 'wav-range' }));
      } else {
        g.append(el('line', { x1: sx(x), x2: sx(x), y1: L.y0 - L.ampT - 5, y2: L.y0 + L.ampT + 5, class: 'wav-range' }));
      }
    }

    if (longit) {
      const layers = el('g', { class: 'wav-layers' });
      for (let i = 0; i <= Math.round(ROPE / BEAD); i++) {
        const x = sx(i * BEAD) + at(i * BEAD) * ampL;
        layers.append(el('line', { x1: x.toFixed(1), x2: x.toFixed(1), y1: L.y0 - L.layer, y2: L.y0 + L.layer }));
      }
      g.append(layers);
      for (const xm of marked) {
        const x = sx(xm) + at(xm) * ampL;
        g.append(el('line', { x1: x.toFixed(1), x2: x.toFixed(1), y1: L.y0 - L.layer - 4, y2: L.y0 + L.layer + 4, class: 'wav-marked-line' }));
      }
    } else {
      const pts: string[] = [];
      for (let i = 0; i <= ROPE * 40; i++) {
        const x = i / 40;
        pts.push(`${sx(x).toFixed(1)},${(L.y0 - at(x) * L.ampT).toFixed(1)}`);
      }
      g.append(el('polyline', { points: pts.join(' '), class: 'wav-rope' }));
      const beads = el('g', { class: 'wav-beads' });
      for (let i = 0; i <= Math.round(ROPE / BEAD); i++) {
        const x = i * BEAD;
        beads.append(el('circle', { cx: sx(x).toFixed(1), cy: (L.y0 - at(x) * L.ampT).toFixed(1), r: 2.6 }));
      }
      g.append(beads);
      for (const xm of marked) {
        g.append(el('circle', { cx: sx(xm).toFixed(1), cy: (L.y0 - at(xm) * L.ampT).toFixed(1), r: 5, class: 'wav-marked' }));
      }
    }

    // the bracket between the marked beads (their places at rest)
    if (marked.length === 2) {
      const a = sx(marked[0]);
      const b = sx(marked[1]);
      const mid = (a + b) / 2;
      const br = el('g', { class: 'wav-bracket' });
      br.append(
        el('line', { x1: a, x2: a, y1: L.bracket - 8, y2: L.bracket + 4 }),
        el('line', { x1: b, x2: b, y1: L.bracket - 8, y2: L.bracket + 4 }),
        arrow(mid, L.bracket, a + 1, L.bracket, 7),
        arrow(mid, L.bracket, b - 1, L.bracket, 7),
      );
      const label = el('text', { x: mid.toFixed(1), y: L.bracket - 6, 'text-anchor': 'middle' });
      label.append(el('tspan', { 'font-style': 'italic' }, 'λ'), this.mark === 'half' ? '/2' : '');
      br.append(label);
      g.append(br);
    }

    // the front and the direction the wave runs
    if (this.t > 0) {
      const fx = sx(front);
      g.append(el('line', { x1: fx.toFixed(1), x2: fx.toFixed(1), y1: L.vArrow + 8, y2: L.y0 + L.ampT + 8, class: 'wav-front' }));
      const va = el('g', { class: 'wav-v' });
      const tip = Math.min(fx + 10, L.w - 16);
      va.append(arrow(tip - 56, L.vArrow, tip, L.vArrow));
      const vt = el('text', { x: (tip + 6).toFixed(1), y: L.vArrow + 4 });
      vt.append(el('tspan', { 'font-style': 'italic' }, 'v'));
      va.append(vt);
      g.append(va);
    }
  }
}

if (!customElements.get('pp-wave')) customElements.define('pp-wave', WaveSim);
