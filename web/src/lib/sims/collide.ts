// <pp-collide m1="2" v1="2.5" m2="3" v2="0" mode="sticky"> — two carts on a frictionless track
// run into each other. Masses 1…4 кг, velocities −4…4 м/с (+ to the right). «липкий»: the carts
// couple and move on together, u = (m₁v₁ + m₂v₂)/(m₁ + m₂); «упругий»: they bounce apart with
// the standard elastic-collision velocities (equal masses swap them). Energy is not shown: it is
// the topic after next. Strobe marks every half second under the track (grey before the hit,
// text colour after) and momentum bars p₁, p₂ and the total before and after: the total stays the same.
//
// Written into theory Markdown as plain HTML; the theory page imports this module only when
// such an element is present. Light DOM, site CSS variables: follows the light/dark theme.
// Colours as in the momentum figures: velocity green, momentum accent.

const SVG_NS = 'http://www.w3.org/2000/svg';

const TRACK_M = 12; // track length, м
const X1 = 3.5; // where the carts start (centres), м
const X2 = 8.5;
const T_MAX = 8; // longest run, с
const STROBE = 0.5; // с between marks
const M = { min: 1, max: 4, step: 0.5 }; // кг
const V = { min: -4, max: 4, step: 0.5 }; // м/с
export type Mode = 'sticky' | 'elastic';

const L = { w: 400, h: 262, left: 24, right: 24, vY: 34, trackY: 76, mark1: 92, mark2: 106 };
const PX_M = (L.w - L.left - L.right) / TRACK_M;
const V_PX = 10; // px per м/с
const xTrack = (x: number) => L.left + x * PX_M;
/** Half the cart's length in metres: heavier carts are drawn longer. */
export const half = (m: number) => (24 + 5 * m) / 2 / PX_M;

/** Russian number: decimal comma, real minus, up to `digits` decimals, trailing zeros dropped. */
export function ru(n: number, digits = 2): string {
  const r = Math.round(n * 10 ** digits) / 10 ** digits;
  const s = (Object.is(r, -0) ? 0 : r).toFixed(digits);
  return (digits ? s.replace(/\.?0+$/, '') : s).replace('.', ',').replace('-', '−');
}

const signed = (n: number, digits = 2) => (Math.round(n * 10 ** digits) > 0 ? '+' : '') + ru(n, digits);

/** Velocities right after the hit. */
export function after(m1: number, v1: number, m2: number, v2: number, mode: Mode): [number, number] {
  if (mode === 'sticky') {
    const u = (m1 * v1 + m2 * v2) / (m1 + m2);
    return [u, u];
  }
  const s = m1 + m2;
  return [((m1 - m2) * v1 + 2 * m2 * v2) / s, ((m2 - m1) * v2 + 2 * m1 * v1) / s];
}

/** When the carts touch (cart 1 starts on the left), or Infinity if they never close in. */
export function hitTime(m1: number, v1: number, m2: number, v2: number): number {
  const gap = X2 - X1 - half(m1) - half(m2);
  return v1 > v2 ? gap / (v1 - v2) : Infinity;
}

/** When a cart starting at x with speed v reaches an end of the track (its edge, not centre). */
export function edgeTime(x: number, v: number, h: number): number {
  if (v > 0) return (TRACK_M - h - x) / v;
  if (v < 0) return (x - h) / -v;
  return Infinity;
}

export interface Plan {
  hit: number; // с, Infinity if no hit happens before the run ends
  end: number; // с
  u1: number;
  u2: number;
  x1Hit: number; // centres at the moment of the hit
  x2Hit: number;
}

/** The whole run: the hit (if it comes before a cart leaves the track) and when it all ends. */
export function plan(m1: number, v1: number, m2: number, v2: number, mode: Mode): Plan {
  const h1 = half(m1);
  const h2 = half(m2);
  const first = Math.min(edgeTime(X1, v1, h1), edgeTime(X2, v2, h2), T_MAX);
  const tHit = hitTime(m1, v1, m2, v2);
  const [u1, u2] = after(m1, v1, m2, v2, mode);
  if (!(tHit < first)) {
    const still = v1 === 0 && v2 === 0; // nothing to watch
    return { hit: Infinity, end: still ? 0 : first, u1: v1, u2: v2, x1Hit: 0, x2Hit: 0 };
  }
  const x1Hit = X1 + v1 * tHit;
  const x2Hit = X2 + v2 * tHit;
  const rest = Math.min(edgeTime(x1Hit, u1, h1), edgeTime(x2Hit, u2, h2), T_MAX - tHit, 3);
  return { hit: tHit, end: tHit + rest, u1, u2, x1Hit, x2Hit };
}

/** Centres of both carts at time t of the run. */
export function positions(v1: number, v2: number, p: Plan, t: number): [number, number] {
  if (t <= p.hit) return [X1 + v1 * t, X2 + v2 * t];
  const dt = t - p.hit;
  return [p.x1Hit + p.u1 * dt, p.x2Hit + p.u2 * dt];
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

/** Horizontal arrow from (x, y) by dx px with a letter and a subscript; empty if too short. */
function hArrow(x: number, y: number, dx: number, cls: string, letter: string, sub: string): SVGGElement {
  const g = el('g', { class: cls });
  const len = Math.abs(dx);
  if (len < 3) return g;
  const s = Math.sign(dx);
  const head = Math.min(8, len * 0.6);
  const x2 = x + dx;
  const t = el('text', { x: (x + dx / 2).toFixed(1), y: y - 6, 'text-anchor': 'middle' }, letter);
  t.append(el('tspan', { class: 'col-sub', dy: 3 }, sub));
  g.append(
    el('line', { x1: x.toFixed(1), y1: y, x2: (x2 - s * head * 0.6).toFixed(1), y2: y }),
    el('path', {
      d: `M${x2.toFixed(1)} ${y}L${(x2 - s * head).toFixed(1)} ${y - 4}L${(x2 - s * head).toFixed(1)} ${y + 4}Z`,
    }),
    t,
  );
  return g;
}

// Momentum bars: zero at the middle, one scale for before and after.
const B = { zero: 230, half: 120, top: 128, row: 15, gap: 8 };

let instances = 0;

class CollideSim extends HTMLElement {
  private m1 = 2;
  private v1 = 2.5;
  private m2 = 3;
  private v2 = 0;
  private mode: Mode = 'sticky';
  private frame = 0;
  private built = false;
  private carts!: [SVGGElement, SVGGElement];
  private bodies!: [SVGRectElement, SVGRectElement];
  private arrows!: SVGGElement;
  private marks!: SVGGElement;
  private bars!: SVGGElement;
  private readout!: HTMLElement;
  private outs: Record<'m1' | 'v1' | 'm2' | 'v2', HTMLOutputElement> = {} as never;

  connectedCallback(): void {
    if (this.built) return;
    this.built = true;
    this.m1 = this.attr('m1', 2, M);
    this.v1 = this.attr('v1', 2.5, V);
    this.m2 = this.attr('m2', 3, M);
    this.v2 = this.attr('v2', 0, V);
    this.mode = this.getAttribute('mode') === 'elastic' ? 'elastic' : 'sticky';
    this.replaceChildren(); // drop the no-JS fallback text
    this.classList.add('sim', 'col');
    this.build();
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

  private build(): void {
    const id = ++instances;
    const choice = document.createElement('fieldset');
    choice.className = 'pfx-chips col-modes';
    const legend = document.createElement('legend');
    legend.textContent = 'Удар';
    choice.append(legend);
    for (const [key, title] of [
      ['sticky', 'липкий — тележки сцепляются'],
      ['elastic', 'упругий — отскакивают'],
    ] as [Mode, string][]) {
      const label = document.createElement('label');
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = `col-${id}`;
      radio.value = key;
      radio.checked = key === this.mode;
      radio.addEventListener('change', () => {
        this.mode = key;
        this.reset();
      });
      const span = document.createElement('span');
      span.textContent = title;
      label.append(radio, span);
      choice.append(label);
    }

    const svg = el('svg', {
      viewBox: `0 0 ${L.w} ${L.h}`,
      class: 'sim-svg',
      role: 'img',
      'aria-label':
        'Две тележки на гладких рельсах сталкиваются. Над ними стрелки скоростей, под рельсами ' +
        'отметки через полсекунды, ниже — импульсы тележек и их сумма до удара и после',
    });
    const track = el('g', { class: 'col-track' });
    track.append(el('line', { x1: xTrack(0), x2: xTrack(TRACK_M), y1: L.trackY, y2: L.trackY }));
    track.append(el('text', { x: 4, y: L.mark1 + 3 }, '1'), el('text', { x: 4, y: L.mark2 + 3 }, '2'));
    this.marks = el('g', { class: 'col-marks' });
    const cart = (n: string): [SVGGElement, SVGRectElement] => {
      const g = el('g', { class: 'col-cart' });
      const body = el('rect', { y: -22, height: 16, rx: 3, class: 'col-body' });
      g.append(
        body,
        el('circle', { cx: -8, cy: -3, r: 3, class: 'col-wheel' }),
        el('circle', { cx: 8, cy: -3, r: 3, class: 'col-wheel' }),
        el('text', { y: -10, 'text-anchor': 'middle', class: 'col-mass' }, n),
      );
      return [g, body];
    };
    const [c1, b1] = cart('1');
    const [c2, b2] = cart('2');
    this.carts = [c1, c2];
    this.bodies = [b1, b2];
    this.arrows = el('g', { class: 'col-arrows' });
    this.bars = el('g', { class: 'col-bars' });
    svg.append(track, this.marks, c1, c2, this.arrows, this.bars);

    const controls = document.createElement('div');
    controls.className = 'sim-controls';
    const add = (key: 'm1' | 'v1' | 'm2' | 'v2', title: string, r: typeof M) => {
      const [label, out] = this.slider(title, r, this[key], (n) => {
        this[key] = n;
        this.reset();
      });
      this.outs[key] = out;
      controls.append(label);
    };
    add('m1', 'Масса тележки 1', M);
    add('v1', 'Скорость тележки 1', V);
    add('m2', 'Масса тележки 2', M);
    add('v2', 'Скорость тележки 2', V);

    const row = document.createElement('div');
    row.className = 'sim-row';
    const go = document.createElement('button');
    go.type = 'button';
    go.className = 'btn small';
    go.textContent = 'Пуск';
    go.addEventListener('click', () => this.run());
    const key = document.createElement('span');
    key.className = 'sim-check';
    key.innerHTML =
      '<span class="crt-key crt-key-v"></span> скорость · ' +
      '<span class="crt-key crt-key-a"></span> импульс · вправо — плюс';
    row.append(go, key);

    this.readout = document.createElement('p');
    this.readout.className = 'sim-readout';
    this.readout.setAttribute('aria-live', 'polite');
    this.append(choice, svg, controls, row, this.readout);
  }

  private plan(): Plan {
    return plan(this.m1, this.v1, this.m2, this.v2, this.mode);
  }

  private reset(): void {
    cancelAnimationFrame(this.frame);
    this.outs.m1.textContent = `${ru(this.m1)} кг`;
    this.outs.m2.textContent = `${ru(this.m2)} кг`;
    this.outs.v1.textContent = `${signed(this.v1)} м/с`;
    this.outs.v2.textContent = `${signed(this.v2)} м/с`;
    [this.m1, this.m2].forEach((m, i) => {
      const w = 2 * half(m) * PX_M;
      this.bodies[i]!.setAttribute('x', (-w / 2).toFixed(1));
      this.bodies[i]!.setAttribute('width', w.toFixed(1));
    });
    this.marks.replaceChildren();
    this.place(0, this.plan());
    this.drawBars(false);
    this.readout.innerHTML = this.hint();
  }

  private sum(): number {
    return this.m1 * this.v1 + this.m2 * this.v2;
  }

  private hint(): string {
    const p = this.plan();
    const before =
      `До удара: <i>p</i> = ${ru(this.m1)}·${ru(this.v1)} + ${ru(this.m2)}·(${ru(this.v2)}) = ` +
      `${ru(this.sum())} кг·м/с.`;
    if (p.hit === Infinity)
      return `${before} Тележки не сближаются или не успеют встретиться — удара не будет. Сделай так, чтобы первая догоняла вторую.`;
    return `${before} Нажми «Пуск».`;
  }

  private run(): void {
    cancelAnimationFrame(this.frame);
    this.marks.replaceChildren();
    this.drawBars(false);
    const p = this.plan();
    if (p.end === 0) {
      this.readout.innerHTML = this.hint();
      return;
    }
    let next = STROBE;
    const drop = (upTo: number) => {
      for (; next <= upTo + 1e-9; next += STROBE) this.mark(next, p);
    };
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      drop(p.end);
      this.finish(p);
      return;
    }
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(p.end, (now - start) / 1000);
      drop(t);
      this.place(t, p);
      if (t > p.hit) this.drawBars(true);
      if (t >= p.end) {
        this.finish(p);
        return;
      }
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  private finish(p: Plan): void {
    this.place(p.end, p);
    if (p.hit === Infinity) {
      this.readout.innerHTML = this.hint();
      return;
    }
    this.drawBars(true);
    const total = this.sum();
    const s = this.m1 + this.m2;
    let text: string;
    if (this.mode === 'sticky') {
      text =
        `Тележки сцепились: <i>u</i> = <i>p</i> / (<i>m</i><sub>1</sub> + <i>m</i><sub>2</sub>) = ` +
        `${ru(total)} / ${ru(s)} = ${ru(p.u1)} м/с. `;
    } else {
      text = `После удара: <i>u</i><sub>1</sub> = ${ru(p.u1)} м/с, <i>u</i><sub>2</sub> = ${ru(p.u2)} м/с. `;
      if (this.m1 === this.m2) text += 'Массы равны — тележки обменялись скоростями. ';
    }
    text += `Импульс системы после удара — снова ${ru(total)} кг·м/с.`;
    this.readout.innerHTML = text;
  }

  private place(t: number, p: Plan): void {
    const [x1, x2] = positions(this.v1, this.v2, p, t);
    const hit = t > p.hit;
    const [w1, w2] = hit ? [p.u1, p.u2] : [this.v1, this.v2];
    const c1 = xTrack(x1);
    const c2 = xTrack(x2);
    this.carts[0].setAttribute('transform', `translate(${c1.toFixed(1)} ${L.trackY})`);
    this.carts[1].setAttribute('transform', `translate(${c2.toFixed(1)} ${L.trackY})`);
    const sticky = hit && this.mode === 'sticky';
    this.arrows.replaceChildren(
      ...(sticky
        ? [hArrow((c1 + c2) / 2, L.vY, w1 * V_PX, 'col-v', 'u', '')]
        : [
            hArrow(c1, L.vY, w1 * V_PX, 'col-v', hit ? 'u' : 'v', '1'),
            hArrow(c2, L.vY - (Math.abs(c2 - c1) < 60 ? 14 : 0), w2 * V_PX, 'col-v', hit ? 'u' : 'v', '2'),
          ]),
    );
  }

  /** Strobe mark for both carts at time t: grey before the hit, text colour after. */
  private mark(t: number, p: Plan): void {
    const [x1, x2] = positions(this.v1, this.v2, p, t);
    const cls = t > p.hit ? 'col-after' : 'col-before';
    for (const [x, y] of [
      [x1, L.mark1],
      [x2, L.mark2],
    ] as const) {
      this.marks.append(el('line', { x1: xTrack(x), x2: xTrack(x), y1: y - 5, y2: y + 5, class: cls }));
    }
  }

  private drawBars(withAfter: boolean): void {
    const p = this.plan();
    const before = [this.m1 * this.v1, this.m2 * this.v2, this.sum()];
    const hit = p.hit !== Infinity;
    const afterP = [this.m1 * p.u1, this.m2 * p.u2, this.m1 * p.u1 + this.m2 * p.u2];
    const scale = B.half / Math.max(1, ...before.map(Math.abs), ...(hit ? afterP.map(Math.abs) : []));
    const g = this.bars;
    g.replaceChildren();
    const groups: [string, number[] | null][] = [
      ['до удара', before],
      ['после', withAfter && hit ? afterP : null],
    ];
    let y = B.top;
    for (const [title, values] of groups) {
      g.append(el('text', { x: 4, y: y + 8, class: 'col-group' }, title));
      y += 12;
      ['p₁', 'p₂', 'p₁ + p₂'].forEach((name, i) => {
        const cy = y + B.row / 2;
        const label = el('text', { x: 4, y: cy + 4, class: i === 2 ? 'col-name col-total' : 'col-name' }, name);
        g.append(label);
        if (values) {
          const v = values[i]!;
          const w = v * scale;
          g.append(
            el('rect', {
              x: (w >= 0 ? B.zero : B.zero + w).toFixed(1),
              y: y + 2,
              width: Math.max(Math.abs(w), 0.01).toFixed(1),
              height: B.row - 4,
              class: i === 2 ? 'col-bar col-total' : 'col-bar',
            }),
            el(
              'text',
              {
                x: (w >= 0 ? B.zero + w + 4 : B.zero + w - 4).toFixed(1),
                y: cy + 4,
                'text-anchor': w >= 0 ? 'start' : 'end',
                class: 'col-value',
              },
              ru(v),
            ),
          );
        } else {
          g.append(el('text', { x: B.zero + 6, y: cy + 4, class: 'col-value col-wait' }, '…'));
        }
        y += B.row;
      });
      y += B.gap;
    }
    g.append(el('line', { x1: B.zero, x2: B.zero, y1: B.top + 10, y2: y - B.gap, class: 'col-zero' }));
    g.append(el('text', { x: L.w - 4, y: B.top + 8, 'text-anchor': 'end', class: 'col-group' }, 'кг·м/с'));
  }
}

if (!customElements.get('pp-collide')) customElements.define('pp-collide', CollideSim);
