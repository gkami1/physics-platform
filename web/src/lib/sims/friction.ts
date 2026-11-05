// <pp-friction f="4" m="2" mu="0.3"> — static and sliding friction: a block on a table is
// pulled by a horizontal force F. While F ≤ μmg the block stands and static friction equals F;
// above that it slides, friction stays μmg and a = (F − μmg)/m. Under the table a live graph
// of friction against the pull (the «hockey stick») marks where the current pull sits on it.
// «Пуск» pulls the block for real: it stays put, or slides off with marks every second.
//
// Written into theory Markdown as plain HTML; the theory page imports this module only when
// such an element is present. Light DOM, site CSS variables: follows the light/dark theme.
// Colours as in the dynamics figures and <pp-cart>: forces red, velocity green, acceleration
// accent.

const SVG_NS = 'http://www.w3.org/2000/svg';

const G = 10; // м/с², EGE convention
const F = { min: 0, max: 20, step: 1 }; // Н
const M = { min: 1, max: 4, step: 0.5 }; // кг
const MU = { min: 0.1, max: 0.5, step: 0.05 };
const TABLE_M = 10; // table length, м
const START_M = 2.5; // where the block starts: room for the friction arrow on its left
const STOP_M = 7.5; // where a run ends: room for the pull arrow on its right
const T_MAX = 5; // longest run, с
const L = {
  w: 400,
  h: 236,
  left: 20,
  right: 20,
  aY: 12,
  vY: 28,
  tableY: 70,
  marksY: 86,
  gLeft: 44,
  gRight: 380,
  gTop: 120,
  gBottom: 210,
};
const F_PX = 3; // px per Н
const V_PX = 8; // px per м/с (capped)
const A_PX = 8; // px per м/с² (capped)
const ARROW_MAX = 60;
const xTable = (x: number) => L.left + (x / TABLE_M) * (L.w - L.left - L.right);
const xG = (f: number) => L.gLeft + (f / F.max) * (L.gRight - L.gLeft);
const yG = (f: number) => L.gBottom - (f / F.max) * (L.gBottom - L.gTop);

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

/** A letter with an optional upright subscript: «F», «Fтр». */
function letter(x: number, y: number, main: string, sub = ''): SVGTextElement {
  const t = el('text', { x: x.toFixed(1), y, 'text-anchor': 'middle' }, main);
  if (sub) t.append(el('tspan', { class: 'frc-sub', dy: 3 }, sub));
  return t;
}

/** Horizontal arrow from (x, y) by dx px, its letter past the tip (or, with `above`, over the
 * tip); empty if too short to see. */
function hArrow(
  x: number,
  y: number,
  dx: number,
  cls: string,
  main: string,
  sub = '',
  above = false,
): SVGGElement {
  const g = el('g', { class: cls });
  const len = Math.abs(dx);
  if (len < 3) return g;
  const s = Math.sign(dx);
  const head = Math.min(8, len * 0.6);
  const x2 = x + dx;
  const lx = above
    ? Math.min(L.w - 10, Math.max(10, x2 - s * 6))
    : Math.min(L.w - 8, Math.max(8, x2 + s * (sub ? 13 : 9)));
  g.append(
    el('line', { x1: x.toFixed(1), y1: y, x2: (x2 - s * head * 0.6).toFixed(1), y2: y }),
    el('path', {
      d: `M${x2.toFixed(1)} ${y}L${(x2 - s * head).toFixed(1)} ${y - 4}L${(x2 - s * head).toFixed(1)} ${y + 4}Z`,
    }),
    letter(lx, above ? y - 7 : y + 4, main, sub),
  );
  return g;
}

const cap = (px: number) => Math.max(-ARROW_MAX, Math.min(ARROW_MAX, px));
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Maximum static friction (= sliding friction) on a horizontal table: μN with N = mg. */
export function maxFriction(m: number, mu: number): number {
  return round3(mu * m * G);
}

/** Friction on a block pulled with a horizontal force f: equal to f while the block stands
 * (f ≤ μmg), μmg once it slides. */
export function friction(f: number, m: number, mu: number): { fr: number; slides: boolean } {
  const max = maxFriction(m, mu);
  return f > max ? { fr: max, slides: true } : { fr: f, slides: false };
}

/** Acceleration of the block: zero while it stands, (F − μmg)/m when it slides. */
export function accel(f: number, m: number, mu: number): number {
  const { fr, slides } = friction(f, m, mu);
  return slides ? round3((f - fr) / m) : 0;
}

/** How long a run lasts: until the block has covered the table (STOP_M − START_M) or T_MAX. */
export function runTime(a: number): number {
  if (a <= 0) return 0;
  return Math.min(T_MAX, Math.sqrt((2 * (STOP_M - START_M)) / a));
}

class FrictionSim extends HTMLElement {
  private f = 4;
  private m = 2;
  private mu = 0.3;
  private frame = 0;
  private built = false;
  private block!: SVGGElement;
  private body!: SVGRectElement;
  private massLabel!: SVGTextElement;
  private arrows!: SVGGElement;
  private marks!: SVGGElement;
  private curve!: SVGPolylineElement;
  private guide!: SVGPathElement;
  private guideLabel!: SVGTextElement;
  private dot!: SVGCircleElement;
  private readout!: HTMLElement;
  private outs: Record<'f' | 'm' | 'mu', HTMLOutputElement> = {} as never;
  private labelled: number[] = [];

  connectedCallback(): void {
    if (this.built) return;
    this.built = true;
    this.f = this.attr('f', 4, F);
    this.m = this.attr('m', 2, M);
    this.mu = this.attr('mu', 0.3, MU);
    this.replaceChildren(); // drop the no-JS fallback text
    this.classList.add('sim', 'frc');
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
    return round3(Math.min(r.max, Math.max(r.min, Math.round(n / r.step) * r.step)));
  }

  private buildScene(): void {
    const svg = el('svg', {
      viewBox: `0 0 ${L.w} ${L.h}`,
      class: 'sim-svg',
      role: 'img',
      'aria-label':
        'Брусок на столе, его тянут горизонтальной силой. Стрелки силы тяги, силы трения, ' +
        'скорости и ускорения. Ниже график: сила трения в зависимости от силы тяги',
    });

    const table = el('g', { class: 'frc-table' });
    table.append(el('line', { x1: xTable(0), x2: xTable(TABLE_M), y1: L.tableY, y2: L.tableY }));
    for (let x = xTable(0) + 4; x < xTable(TABLE_M); x += 9) {
      table.append(el('line', { x1: x, y1: L.tableY, x2: x - 5, y2: L.tableY + 7, class: 'frc-hatch' }));
    }

    this.marks = el('g', { class: 'frc-marks' });
    this.block = el('g', { class: 'frc-block' });
    this.body = el('rect', { y: -26, height: 26, rx: 2, class: 'frc-body' });
    this.massLabel = el('text', { y: -9, 'text-anchor': 'middle', class: 'frc-mass' });
    this.block.append(this.body, this.massLabel);
    this.arrows = el('g', { class: 'frc-arrows' });

    // The graph: friction against the pull, 0…20 Н on both axes.
    const graph = el('g', { class: 'sim-grid' });
    for (let f = 0; f <= F.max; f += 5) {
      graph.append(
        el('line', { x1: xG(f), x2: xG(f), y1: L.gTop, y2: L.gBottom }),
        el('line', { x1: L.gLeft, x2: L.gRight, y1: yG(f), y2: yG(f) }),
        el('text', { x: xG(f), y: L.gBottom + 13, 'text-anchor': 'middle' }, `${f}`),
      );
      if (f > 0) graph.append(el('text', { x: L.gLeft - 5, y: yG(f) + 4, 'text-anchor': 'end' }, `${f}`));
    }
    const yName = el('text', { x: L.gLeft + 6, y: L.gTop - 6 }, 'F');
    yName.append(el('tspan', { class: 'frc-sub', dy: 3 }, 'тр'), el('tspan', { dy: -3 }, ', Н'));
    graph.append(yName, el('text', { x: L.gRight, y: L.gBottom + 24, 'text-anchor': 'end' }, 'F тяги, Н'));
    this.guide = el('path', { class: 'frc-guide' });
    this.guideLabel = el('text', { class: 'frc-guide-label' });
    this.curve = el('polyline', { class: 'frc-curve', points: '' });
    this.dot = el('circle', { r: 5, class: 'frc-dot' });

    svg.append(table, this.marks, this.block, this.arrows, graph, this.guide, this.guideLabel, this.curve, this.dot);
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
    input.addEventListener('input', () => onInput(round3(Number(input.value))));
    label.append(name, out, input);
    return [label, out];
  }

  private buildControls(): void {
    const controls = document.createElement('div');
    controls.className = 'sim-controls';
    const [f, outF] = this.slider('Сила тяги', F, this.f, (n) => {
      this.f = n;
      this.reset();
    });
    const [m, outM] = this.slider('Масса бруска', M, this.m, (n) => {
      this.m = n;
      this.reset();
    });
    const [mu, outMu] = this.slider('Коэффициент трения μ', MU, this.mu, (n) => {
      this.mu = n;
      this.reset();
    });
    this.outs = { f: outF, m: outM, mu: outMu };
    controls.append(f, m, mu);

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
      '<span class="crt-key crt-key-f"></span> силы · ' +
      '<span class="crt-key crt-key-v"></span> скорость · ' +
      '<span class="crt-key crt-key-a"></span> ускорение';
    row.append(go, legend);

    this.readout = document.createElement('p');
    this.readout.className = 'sim-readout';
    this.readout.setAttribute('aria-live', 'polite');
    this.append(controls, row, this.readout);
  }

  private hint(): string {
    const max = maxFriction(this.m, this.mu);
    const { fr, slides } = friction(this.f, this.m, this.mu);
    const maxText = `μmg = ${ru(this.mu, 2)} · ${ru(this.m)} · 10 = ${ru(max, 2)} Н`;
    if (this.f === 0) return `Брусок никто не тянет — трения нет. Наибольшее трение покоя ${maxText}.`;
    if (!slides)
      return (
        `${ru(this.f)} Н ≤ ${maxText}: брусок стоит. Трение покоя равно силе тяги: ` +
        `${ru(fr, 2)} Н, а не ${ru(max, 2)} Н.`
      );
    return (
      `${ru(this.f)} Н > ${maxText}: брусок скользит, трение ${ru(fr, 2)} Н. ` +
      `a = (${ru(this.f)} − ${ru(fr, 2)}) / ${ru(this.m)} = ${ru(accel(this.f, this.m, this.mu), 2)} м/с². Нажми «Пуск».`
    );
  }

  private reset(): void {
    cancelAnimationFrame(this.frame);
    this.outs.f.textContent = `${ru(this.f)} Н`;
    this.outs.m.textContent = `${ru(this.m)} кг`;
    this.outs.mu.textContent = ru(this.mu, 2);
    const w = 30 + 6 * this.m;
    this.body.setAttribute('x', String(-w / 2));
    this.body.setAttribute('width', String(w));
    this.massLabel.textContent = `${ru(this.m)} кг`;
    this.marks.replaceChildren();
    this.drawGraph();
    this.place(0);
    this.readout.textContent = this.hint();
  }

  private drawGraph(): void {
    const max = maxFriction(this.m, this.mu);
    const pts: [number, number][] = [
      [0, 0],
      [max, max],
      [F.max, max],
    ];
    this.curve.setAttribute('points', pts.map(([f, fr]) => `${xG(f).toFixed(1)},${yG(fr).toFixed(1)}`).join(' '));
    this.guide.setAttribute(
      'd',
      `M${xG(max).toFixed(1)} ${L.gBottom}V${yG(max).toFixed(1)}H${L.gLeft}`,
    );
    // The μmg label sits above the flat part, on whichever side has room.
    const right = xG(max) < (L.gLeft + L.gRight) / 2;
    this.guideLabel.setAttribute('x', (right ? xG(max) + 8 : xG(max) - 8).toFixed(1));
    this.guideLabel.setAttribute('y', (yG(max) - 6).toFixed(1));
    this.guideLabel.setAttribute('text-anchor', right ? 'start' : 'end');
    this.guideLabel.textContent = `μmg = ${ru(max, 2)} Н`;
    const { fr } = friction(this.f, this.m, this.mu);
    this.dot.setAttribute('cx', xG(this.f).toFixed(1));
    this.dot.setAttribute('cy', yG(fr).toFixed(1));
  }

  private run(): void {
    cancelAnimationFrame(this.frame);
    this.marks.replaceChildren();
    this.labelled = [];
    this.place(0);
    const a = accel(this.f, this.m, this.mu);
    const end = runTime(a);
    if (end === 0) {
      this.readout.textContent =
        this.f === 0
          ? 'Сила тяги ноль — брусок стоит, трения нет.'
          : `Брусок не сдвинулся: трение покоя подстроилось и стало ${ru(this.f)} Н — ровно столько, сколько тянут.`;
      return;
    }
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      for (let t = 1; t <= end + 1e-9; t++) this.mark(t);
      this.finish(end);
      return;
    }
    let marked = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(end, (now - start) / 1000);
      while (marked + 1 <= t) this.mark(++marked);
      this.place(t);
      this.readout.textContent = `t = ${ru(t)} с · v = ${ru(a * t)} м/с · a = ${ru(a, 2)} м/с²`;
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
    const a = accel(this.f, this.m, this.mu);
    const { fr } = friction(this.f, this.m, this.mu);
    this.readout.textContent =
      `Брусок разгонялся: за ${ru(end)} с скорость выросла до ${ru(a * end)} м/с. ` +
      `Трение всё время было ${ru(fr, 2)} Н — от скорости оно не зависит.`;
  }

  private place(t: number): void {
    const a = accel(this.f, this.m, this.mu);
    const { fr } = friction(this.f, this.m, this.mu);
    const x = START_M + (a * t * t) / 2;
    const v = a * t;
    const cx = xTable(x);
    this.block.setAttribute('transform', `translate(${cx.toFixed(1)} ${L.tableY})`);
    const half = (30 + 6 * this.m) / 2;
    this.arrows.replaceChildren(
      hArrow(cx + half, L.tableY - 13, cap(this.f * F_PX), 'frc-f', 'F'),
      hArrow(cx - half, L.tableY - 4, -cap(fr * F_PX), 'frc-f', 'F', 'тр', true),
      hArrow(cx, L.vY, cap(v * V_PX), 'frc-v', 'v'),
      hArrow(cx, L.aY, cap(a * A_PX), 'frc-a', 'a'),
    );
  }

  private mark(t: number): void {
    const a = accel(this.f, this.m, this.mu);
    const px = xTable(START_M + (a * t * t) / 2);
    const g = el('g');
    g.append(el('line', { x1: px, x2: px, y1: L.marksY - 5, y2: L.marksY + 1 }));
    // Label a mark only where it does not crowd an earlier label (a slow start).
    if (this.labelled.every((q) => Math.abs(q - px) >= 22)) {
      g.append(el('text', { x: px, y: L.marksY + 13, 'text-anchor': 'middle' }, `${t} с`));
      this.labelled.push(px);
    }
    this.marks.append(g);
  }
}

if (!customElements.get('pp-friction')) customElements.define('pp-friction', FrictionSim);
