// <pp-relativity> — the energy of a fast particle. A slider sets the speed v as a fraction of c,
// 0…0,99: in steps of 0,05 up to 0,9 and of 0,01 above, where the energy changes fastest. The graph
// shows the kinetic energy in units of mc² against v/c: E_к = mc²(γ − 1) with γ = 1/√(1 − v²/c²)
// (accent), growing without bound as v → c (muted dashed line v = c), and the classical mv²/2
// = (v/c)²/2 · mc² (muted dashed), which agrees at small v and is ever further off near c. A point
// rides each curve at the chosen speed; beside the graph a stacked bar shows the total energy E = γmc²
// as the rest energy mc² (a surface block) plus E_к (accent tint), on its own scale up to 8mc².
// The table: v (fraction of c and км/с), γ, E, E_к and mv²/2 in units of mc², how many times the
// classical formula is smaller, and E, E_к for an electron in МэВ (mc² = 0,511 МэВ).
//
// The picture follows the graph convention of the figures (lesson 1.5): axes in the text colour, the
// relativistic curve accent, the classical one muted dashed, guides muted dashed.
//
// Nothing moves on its own, so there is no animation and reduced motion changes nothing. The
// default, v = 0,7c (γ ≈ 1,4), avoids the answers and intermediates of the topic's step tasks
// (0,6c → 1,25 and 0,8; 0,8c → 0,6; 0,87c → 2).
//
// Written into theory Markdown as plain HTML; the theory page imports this module only when such an
// element is present. Light DOM, site CSS variables: follows the light/dark theme.

const SVG_NS = 'http://www.w3.org/2000/svg';
const NBSP = '\u00a0';

/** Speeds the slider steps through, in hundredths of c. */
export const SPEEDS: number[] = [
  ...Array.from({ length: 19 }, (_, i) => i * 5),
  ...Array.from({ length: 9 }, (_, i) => 91 + i),
];
export const START = 70;
/** The electron's rest energy, МэВ. */
export const E_REST = 0.511;
/** The speed of light, км/с. */
export const C_KMS = 300_000;

export function gamma(b: number): number {
  return 1 / Math.sqrt(1 - b * b);
}

/** Kinetic energy in units of mc². */
export function kinetic(b: number): number {
  return gamma(b) - 1;
}

/** The classical mv²/2 in units of mc². */
export function classical(b: number): number {
  return (b * b) / 2;
}

/** A number with a decimal comma, rounded to `digits` decimals, with «≈» when rounding changed it. */
export function num(x: number, digits = 3): string {
  const r = Number(x.toFixed(digits));
  const text = String(Math.abs(r) < 1e-12 ? 0 : r).replace('.', ',');
  return Math.abs(r - x) > 1e-9 ? `≈${NBSP}${text}` : text;
}

/** Speed as a fraction of c: «0,7c». */
export function speedText(h: number): string {
  return h === 0 ? '0' : `${num(h / 100, 2)}c`;
}

/** Thousands separated by a no-break space: 210 000. */
export function grouped(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
}

/** How many times mv²/2 is smaller than E_к, or a dash at rest. */
export function ratioText(b: number): string {
  if (b === 0) return '—';
  return `в${NBSP}${num(kinetic(b) / classical(b), 2)} раза`;
}

/** Table rows [name, value, main?] for the speed h (hundredths of c). */
export function readout(h: number): [string, string, boolean][] {
  const b = h / 100;
  const g = gamma(b);
  const mc2 = `${NBSP}mc²`;
  return [
    ['Скорость v', h === 0 ? '0' : `${speedText(h)} = ${grouped(b * C_KMS)}${NBSP}км/с`, false],
    ['γ = 1/√(1 − v²/c²)', num(g), false],
    ['Полная энергия E = γmc²', num(g) + mc2, false],
    ['Кинетическая E_к = E − mc²', num(g - 1) + mc2, true],
    ['По классике mv²/2', num(classical(b)) + mc2, false],
    ['Классика меньше', ratioText(b), false],
    ['Электрон: E', `${num(E_REST * g)}${NBSP}МэВ`, false],
    ['Электрон: E_к', `${num(E_REST * (g - 1))}${NBSP}МэВ`, false],
  ];
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

const f1 = (v: number): string => v.toFixed(1);

/** The graph: origin (ox, oy), v/c 0…1 over w px, E_к/mc² 0…ymax over h px; the bar at bx, 0…8mc². */
const G = { w: 400, h: 260, ox: 44, oy: 226, gw: 260, gh: 196, ymax: 4, bx: 344, bw: 30, bmax: 8 };

let instances = 0;

class RelativitySim extends HTMLElement {
  private speed = START;
  private built = false;
  private scene!: SVGGElement;
  private out!: HTMLOutputElement;
  private table!: HTMLTableSectionElement;

  connectedCallback(): void {
    if (this.built) return;
    this.built = true;
    const v = Number(this.getAttribute('speed'));
    this.speed = SPEEDS.includes(v) && this.hasAttribute('speed') ? v : START;
    this.replaceChildren(); // drop the no-JS fallback text
    this.classList.add('sim', 'rel');
    this.build();
    this.update();
  }

  disconnectedCallback(): void {
    this.built = false;
  }

  private build(): void {
    const id = ++instances;
    const svg = el('svg', {
      viewBox: `0 0 ${G.w} ${G.h}`,
      class: 'sim-svg',
      role: 'img',
      'aria-label':
        'График кинетической энергии в долях mc² от скорости в долях скорости света: по теории ' +
        'относительности энергия неограниченно растёт при приближении к скорости света, по классической ' +
        'формуле mv²/2 растёт медленно. Точки показывают выбранную скорость; справа столбик полной энергии: ' +
        'энергия покоя и кинетическая',
    });
    this.scene = el('g');
    svg.append(this.scene);

    const controls = document.createElement('div');
    controls.className = 'sim-controls';
    const label = document.createElement('label');
    label.className = 'sim-slider';
    const span = document.createElement('span');
    span.textContent = 'Скорость v';
    this.out = document.createElement('output');
    this.out.id = `rel-v-${id}`;
    const input = document.createElement('input');
    input.type = 'range';
    input.min = '0';
    input.max = String(SPEEDS.length - 1);
    input.step = '1';
    input.value = String(SPEEDS.indexOf(this.speed));
    input.addEventListener('input', () => {
      this.speed = SPEEDS[Number(input.value)] ?? START;
      this.update();
    });
    label.append(span, this.out, input);
    controls.append(label);

    const table = document.createElement('table');
    table.className = 'rel-table';
    this.table = document.createElement('tbody');
    table.append(this.table);
    this.append(svg, controls, table);
  }

  private update(): void {
    this.out.textContent = speedText(this.speed);
    this.table.replaceChildren(
      ...readout(this.speed).map(([name, value, main]) => {
        const tr = document.createElement('tr');
        if (main) tr.className = 'rel-main';
        const th = document.createElement('th');
        th.scope = 'row';
        th.textContent = name;
        const td = document.createElement('td');
        td.textContent = value;
        tr.append(th, td);
        return tr;
      }),
    );
    this.draw();
  }

  private label(x: number, y: number, text: string, anchor = 'start', cls = 'rel-label'): SVGTextElement {
    return el('text', { x: f1(x), y: f1(y), 'text-anchor': anchor, class: cls }, text);
  }

  private draw(): void {
    const { ox, oy, gw, gh, ymax, bx, bw, bmax } = G;
    const b = this.speed / 100;
    const X = (v: number): number => ox + v * gw;
    const Y = (e: number): number => oy - (e / ymax) * gh;
    const parts: SVGElement[] = [];
    // axes, ticks and names
    parts.push(el('path', { d: `M${ox} ${oy}H${ox + gw + 22}M${ox} ${oy}V${oy - gh - 16}`, class: 'rel-axis' }));
    parts.push(el('path', { d: `M${ox + gw + 26} ${oy}l-9 -4v8z`, class: 'rel-tip' }));
    parts.push(el('path', { d: `M${ox} ${oy - gh - 20}l-4 9h8z`, class: 'rel-tip' }));
    for (const v of [0.5, 1]) {
      parts.push(el('path', { d: `M${f1(X(v))} ${oy}v4`, class: 'rel-axis' }));
      parts.push(this.label(X(v), oy + 18, v === 1 ? '1' : '0,5', 'middle', 'rel-label rel-small'));
    }
    for (const e of [1, 2, 3, 4]) {
      parts.push(el('path', { d: `M${ox - 4} ${f1(Y(e))}h4`, class: 'rel-axis' }));
      parts.push(this.label(ox - 7, Y(e) + 5, String(e), 'end', 'rel-label rel-small'));
    }
    parts.push(this.label(ox - 6, oy + 16, '0', 'end', 'rel-label rel-small'));
    parts.push(this.label(ox + gw + 14, oy + 18, 'v/c', 'start', 'rel-label rel-small rel-italic'));
    const yName = this.label(ox + 10, oy - gh - 8, '', 'start', 'rel-label rel-small');
    yName.append(
      el('tspan', { 'font-style': 'italic' }, 'E'),
      el('tspan', { 'baseline-shift': 'sub', 'font-size': '10' }, 'к'),
      el('tspan', { 'font-style': 'italic' }, '/mc'),
      '²',
    );
    parts.push(yName);
    parts.push(el('path', { d: `M${f1(X(1))} ${oy}V${oy - gh - 6}`, class: 'rel-guide' }));

    // the two curves
    const rel: string[] = [];
    const cls: string[] = [];
    for (let i = 0; i <= 400; i++) {
      const v = i / 400;
      cls.push(`${i ? 'L' : 'M'}${f1(X(v))} ${f1(Y(classical(v)))}`);
      const e = v < 1 ? kinetic(v) : Infinity;
      if (e <= ymax) rel.push(`${rel.length ? 'L' : 'M'}${f1(X(v))} ${f1(Y(e))}`);
    }
    parts.push(el('path', { d: cls.join(''), class: 'rel-classic' }));
    parts.push(el('path', { d: rel.join(''), class: 'rel-curve' }));
    parts.push(this.label(X(0.97), Y(0.5) - 4, 'mv²/2', 'end', 'rel-label rel-small rel-muted'));

    // the points at the chosen speed
    const ek = kinetic(b);
    const ec = classical(b);
    const top = oy - gh;
    const yk = Math.max(top, Y(ek));
    parts.push(el('path', { d: `M${f1(X(b))} ${oy}V${f1(yk)}`, class: 'rel-guide' }));
    parts.push(el('circle', { cx: f1(X(b)), cy: f1(Y(ec)), r: 4, class: 'rel-hollow' }));
    if (ek <= ymax) {
      parts.push(el('circle', { cx: f1(X(b)), cy: f1(yk), r: 5, class: 'rel-dot' }));
    } else {
      // off the graph: an arrowhead at the top edge with the value
      parts.push(el('path', { d: `M${f1(X(b))} ${top - 6}l-5 9h10z`, class: 'rel-dot' }));
      parts.push(this.label(X(b) - 8, top + 4, `${num(ek, 2)}`, 'end', 'rel-label rel-small rel-accent'));
    }

    // the bar: E = mc² + E_к on its own scale, 0…8 mc²
    const B = (e: number): number => oy - (e / bmax) * gh;
    const g = gamma(b);
    parts.push(el('rect', { x: bx, y: f1(B(1)), width: bw, height: f1(oy - B(1)), class: 'rel-rest' }));
    parts.push(el('rect', { x: bx, y: f1(B(g)), width: bw, height: f1(B(1) - B(g)), class: 'rel-kin' }));
    parts.push(el('path', { d: `M${bx - 6} ${oy}H${bx + bw + 6}`, class: 'rel-axis' }));
    parts.push(this.label(bx + bw / 2, oy - 6, 'mc²', 'middle', 'rel-label rel-tiny'));
    parts.push(this.label(bx + bw / 2, B(g) - 8, 'E', 'middle', 'rel-label rel-small rel-italic'));
    for (const e of [2, 4, 6, 8]) {
      parts.push(el('path', { d: `M${bx - 4} ${f1(B(e))}h4`, class: 'rel-axis' }));
    }
    parts.push(this.label(bx - 6, B(8) + 4, '8', 'end', 'rel-label rel-tiny'));
    parts.push(this.label(bx - 6, B(4) + 4, '4', 'end', 'rel-label rel-tiny'));

    this.scene.replaceChildren(...parts);
  }
}

if (!customElements.get('pp-relativity')) customElements.define('pp-relativity', RelativitySim);
