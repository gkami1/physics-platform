// <pp-nucleus> — build a nucleus from protons and neutrons. Sliders pick the element (Z) and the
// number of neutrons N; the model draws the nucleus as packed nucleons (a proton is a hollow circle
// marked +, a neutron a solid dot, as in the theory-nuc-* figures), writes its label ᴬ_Z X and, if the
// nucleus is in the table, computes the mass defect and the binding energy:
//   Δm = Z·m_p + N·m_n − M_я,  M_я = M_ат − Z·m_e,  E_св = 931,5 МэВ · Δm,  E_св/A.
// m_p = 1,00728 and m_n = 1,00866 а.е.м. as in the tasks; m_e = 0,000549 а.е.м.; Δm is rounded to five
// decimals before it is multiplied, so a student can repeat the sum from the table.
//
// The table: every stable nucleus of hydrogen…neon and of iron, plus the long-lived radioactive
// tritium, carbon-14 and uranium-235/238 (marked with their half-lives). Atomic masses from AME2020
// (W. J. Huang et al., Chin. Phys. C 45, 030002 (2021); M. Wang et al., ibid. 030003), checked against
// the AME2020 binding energies per nucleon. For each element the neutron slider reaches two past the
// table's isotopes on either side; those nuclei are not stable («радиоактивно или не существует»).
// Below, the binding energy per nucleon against A for the table and other stable nuclei, with the
// chosen nucleus marked.
//
// Nothing moves, so there is no animation. Defaults by attributes `z` and `a` (oxygen-16 without
// them); the lessons set oxygen-16 (4.1), lithium-7 (4.5) and iron-56 (4.6), clear of the tasks.

const SVG_NS = 'http://www.w3.org/2000/svg';
const NBSP = '\u00a0';
const MINUS = '\u2212';

export const MP = 1.00728;
export const MN = 1.00866;
export const ME = 0.000549;
export const MEV_PER_U = 931.5;

export type Nuclide = { sym: string; z: number; a: number; mass: number; half: string | null };

/** Element names by Z, nominative («углерод») and for «углерод-12». */
export const ELEMENTS: Record<number, [string, string]> = {
  1: ['H', 'водород'],
  2: ['He', 'гелий'],
  3: ['Li', 'литий'],
  4: ['Be', 'бериллий'],
  5: ['B', 'бор'],
  6: ['C', 'углерод'],
  7: ['N', 'азот'],
  8: ['O', 'кислород'],
  9: ['F', 'фтор'],
  10: ['Ne', 'неон'],
  26: ['Fe', 'железо'],
  92: ['U', 'уран'],
};
export const ZS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 26, 92];

const n = (sym: string, z: number, a: number, mass: number, half: string | null = null): Nuclide => ({
  sym,
  z,
  a,
  mass,
  half,
});

/** The model's table: atomic masses, а.е.м. (AME2020). */
export const TABLE: Nuclide[] = [
  n('H', 1, 1, 1.00782503),
  n('H', 1, 2, 2.01410178),
  n('H', 1, 3, 3.01604928, '12,3 года'),
  n('He', 2, 3, 3.01602932),
  n('He', 2, 4, 4.00260325),
  n('Li', 3, 6, 6.01512289),
  n('Li', 3, 7, 7.01600344),
  n('Be', 4, 9, 9.01218307),
  n('B', 5, 10, 10.01293695),
  n('B', 5, 11, 11.00930536),
  n('C', 6, 12, 12),
  n('C', 6, 13, 13.00335484),
  n('C', 6, 14, 14.00324199, '5730 лет'),
  n('N', 7, 14, 14.003074),
  n('N', 7, 15, 15.0001089),
  n('O', 8, 16, 15.99491462),
  n('O', 8, 17, 16.99913176),
  n('O', 8, 18, 17.99915961),
  n('F', 9, 19, 18.99840316),
  n('Ne', 10, 20, 19.99244018),
  n('Ne', 10, 21, 20.99384669),
  n('Ne', 10, 22, 21.99138511),
  n('Fe', 26, 54, 53.93960899),
  n('Fe', 26, 56, 55.93493633),
  n('Fe', 26, 57, 56.93539284),
  n('Fe', 26, 58, 57.93327443),
  n('U', 92, 235, 235.0439301, '700 млн лет'),
  n('U', 92, 238, 238.0507884, '4,5 млрд лет'),
];

/** Other stable nuclei, for the curve only (AME2020). */
export const CURVE: Nuclide[] = [
  n('Na', 11, 23, 22.98976928),
  n('Mg', 12, 24, 23.9850417),
  n('Al', 13, 27, 26.98153841),
  n('Si', 14, 28, 27.97692653),
  n('S', 16, 32, 31.97207117),
  n('Ar', 18, 40, 39.96238312),
  n('Ti', 22, 48, 47.94794198),
  n('Cr', 24, 52, 51.94050623),
  n('Co', 27, 59, 58.93319429),
  n('Ni', 28, 62, 61.92834537),
  n('Zn', 30, 64, 63.92914201),
  n('Kr', 36, 84, 83.91149773),
  n('Sr', 38, 88, 87.90561226),
  n('Zr', 40, 90, 89.90469876),
  n('Mo', 42, 98, 97.90540482),
  n('Ag', 47, 107, 106.9050915),
  n('Sn', 50, 120, 119.90220163),
  n('Xe', 54, 132, 131.90415509),
  n('Ba', 56, 138, 137.905247),
  n('Nd', 60, 142, 141.90772899),
  n('Gd', 64, 158, 157.92410394),
  n('W', 74, 184, 183.95093092),
  n('Pt', 78, 195, 194.96479171),
  n('Au', 79, 197, 196.96656879),
  n('Pb', 82, 208, 207.9766525),
  n('Bi', 83, 209, 208.9803991),
  n('Th', 90, 232, 232.0380558),
];

/** The usual (most abundant) isotope of each element: its N. */
export const USUAL_N: Record<number, number> = { 1: 0, 2: 2, 3: 4, 4: 5, 5: 6, 6: 6, 7: 7, 8: 8, 9: 10, 10: 10, 26: 30, 92: 146 };

export function find(z: number, a: number): Nuclide | undefined {
  return TABLE.find((t) => t.z === z && t.a === a);
}

/** The neutron numbers on the slider for element z: the table's isotopes and two more on each side. */
export function neutronRange(z: number): number[] {
  const ns = TABLE.filter((t) => t.z === z).map((t) => t.a - t.z);
  const lo = Math.max(0, Math.min(...ns) - 2);
  const hi = Math.max(...ns) + 2;
  return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
}

export type Binding = { parts: number; nuclear: number; dm: number; e: number; perA: number };

/** Mass defect (rounded to 1e-5 а.е.м.) and binding energy of a nucleus with atomic mass `mass`. */
export function binding(z: number, a: number, mass: number): Binding {
  const parts = z * MP + (a - z) * MN;
  const nuclear = mass - z * ME;
  const dm = Math.round((parts - nuclear) * 1e5) / 1e5;
  const e = dm * MEV_PER_U;
  return { parts, nuclear, dm, e, perA: e / a };
}

/** A number with a decimal comma and a true minus, `digits` decimals kept, with «≈» when rounded. */
export function num(x: number, digits = 2): string {
  const r = Number(x.toFixed(digits));
  const text = Math.abs(r).toFixed(digits).replace('.', ',');
  const sign = r < 0 ? MINUS : '';
  return Math.abs(r - x) > 1e-9 * Math.max(1, Math.abs(x)) ? `≈${NBSP}${sign}${text}` : sign + text;
}

const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const SUB = '₀₁₂₃₄₅₆₇₈₉';
const digits = (v: number, set: string): string => [...String(v)].map((d) => set[Number(d)]).join('');

/** «¹²₆C». */
export function label(z: number, a: number): string {
  return `${digits(a, SUP)}${digits(z, SUB)}${ELEMENTS[z]?.[0] ?? '?'}`;
}

/** «углерод-12». */
export function nameOf(z: number, a: number): string {
  return `${ELEMENTS[z]?.[1] ?? '?'}-${a}`;
}

function u(x: number): string {
  return `${num(x, 5)}${NBSP}а.е.м.`;
}

/** Table rows [name, value, main?]. */
export function readout(z: number, nn: number): [string, string, boolean][] {
  const a = z + nn;
  const rows: [string, string, boolean][] = [
    ['Ядро', `${nameOf(z, a)}, ${label(z, a)}`, false],
    ['Протонов Z', String(z), false],
    ['Нейтронов N = A − Z', String(nn), false],
    ['Нуклонов A', String(a), false],
  ];
  const t = find(z, a);
  if (!t) {
    rows.push(['В природе', 'нет среди стабильных: такое ядро радиоактивно или вовсе не существует', true]);
    return rows;
  }
  if (a === 1) {
    rows.push(['Энергия связи', `один протон, связывать нечего: E${NBSP}=${NBSP}0`, true]);
    return rows;
  }
  const b = binding(z, a, t.mass);
  rows.push(
    ['Протоны по отдельности Z·mₚ', `${z}·1,00728 = ${u(z * MP)}`, false],
    ['Нейтроны по отдельности N·mₙ', `${nn}·1,00866 = ${u(nn * MN)}`, false],
    ['Все нуклоны по отдельности', u(b.parts), false],
    ['Масса атома (таблица)', u(t.mass), false],
    ['Масса ядра: масса атома − Z·mₑ', u(b.nuclear), false],
    ['Дефект массы Δm', u(b.dm), false],
    ['Энергия связи E = Δm·931,5 МэВ', `${num(b.e, 1)}${NBSP}МэВ`, false],
    ['На один нуклон E/A', `${num(b.perA, 2)}${NBSP}МэВ`, true],
    ['Стабильность', t.half ? `радиоактивно, период полураспада ${t.half}` : 'стабильно', false],
  );
  return rows;
}

/** The curve's points [A, E/A], one nucleus per A (the table's stable ones first), sorted by A. */
export function curvePoints(): [number, number][] {
  const byA = new Map<number, number>();
  for (const t of [...TABLE, ...CURVE]) {
    if (t.a === 1 || (t.half && t.sym !== 'U') || (t.sym === 'U' && t.a === 235) || byA.has(t.a)) continue;
    byA.set(t.a, binding(t.z, t.a, t.mass).perA);
  }
  return [...byA.entries()].sort((p, q) => p[0] - q[0]);
}

/** Nucleon centres packed on a hexagonal lattice, nearest the centre first, centred on 0. */
export function packing(count: number, d: number): [number, number][] {
  const pts: [number, number][] = [];
  const k = Math.ceil(Math.sqrt(count)) + 2;
  for (let i = -k; i <= k; i++) {
    for (let j = -k; j <= k; j++) pts.push([(i + j / 2) * d, ((j * Math.sqrt(3)) / 2) * d]);
  }
  const dist = (p: [number, number]): number => Math.hypot(p[0] - 0.13 * d, p[1] - 0.07 * d);
  pts.sort((p, q) => dist(p) - dist(q) || p[0] - q[0] || p[1] - q[1]);
  const take = pts.slice(0, count);
  const mx = take.reduce((s, p) => s + p[0], 0) / count;
  const my = take.reduce((s, p) => s + p[1], 0) / count;
  return take.map(([x, y]) => [x - mx, y - my]);
}

/** Which of the a nucleons (in packing order) are protons: z of them, spread evenly. */
export function protonMask(z: number, a: number): boolean[] {
  return Array.from({ length: a }, (_, i) => Math.floor(((i + 1) * z) / a) > Math.floor((i * z) / a));
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

/** Layout: the nucleus centred at (cx, cy) within radius R; the graph's origin (gx, gy). */
const G = { w: 400, h: 340, cx: 110, cy: 108, R: 92, gx: 44, gy: 318, kx: 1.38, ky: 10 };

class NucleusSim extends HTMLElement {
  private protons = 8;
  private neutrons = 8;
  private built = false;
  private scene!: SVGGElement;
  private table!: HTMLTableSectionElement;
  private sliders: { name: HTMLSpanElement; out: HTMLOutputElement; input: HTMLInputElement }[] = [];

  connectedCallback(): void {
    if (this.built) return;
    this.built = true;
    const z = Number(this.getAttribute('z'));
    const a = Number(this.getAttribute('a'));
    if (ZS.includes(z)) {
      this.protons = z;
      this.neutrons = neutronRange(z).includes(a - z) ? a - z : (USUAL_N[z] ?? 0);
    }
    this.replaceChildren(); // drop the no-JS fallback text
    this.classList.add('sim', 'nuc');
    this.build();
    this.update();
  }

  disconnectedCallback(): void {
    this.built = false;
  }

  private sliderSpec(i: number): [string, number[], number, (v: number) => void, (v: number) => string] {
    if (i === 0) {
      return [
        'Элемент',
        ZS,
        this.protons,
        (v) => {
          this.protons = v;
          this.neutrons = USUAL_N[v] ?? 0;
        },
        (v) => `${ELEMENTS[v]?.[1] ?? ''}, Z = ${v}`,
      ];
    }
    return ['Нейтронов N', neutronRange(this.protons), this.neutrons, (v) => (this.neutrons = v), String];
  }

  private build(): void {
    const svg = el('svg', {
      viewBox: `0 0 ${G.w} ${G.h}`,
      class: 'sim-svg',
      role: 'img',
      'aria-label':
        'Ядро из протонов и нейтронов: протоны — светлые кружки с плюсом, нейтроны — тёмные. Рядом ' +
        'обозначение ядра и его название. Внизу график удельной энергии связи от массового числа, ' +
        'выбранное ядро отмечено',
    });
    this.scene = el('g');
    svg.append(this.scene);

    const controls = document.createElement('div');
    controls.className = 'sim-controls';
    for (let i = 0; i < 2; i++) {
      const box = document.createElement('label');
      box.className = 'sim-slider';
      const name = document.createElement('span');
      const out = document.createElement('output');
      const input = document.createElement('input');
      input.type = 'range';
      input.min = '0';
      input.step = '1';
      input.addEventListener('input', () => {
        const [, values, current, setv] = this.sliderSpec(i);
        setv(values[Number(input.value)] ?? current);
        this.update();
      });
      box.append(name, out, input);
      controls.append(box);
      this.sliders.push({ name, out, input });
    }

    const table = document.createElement('table');
    table.className = 'nuc-table';
    this.table = document.createElement('tbody');
    table.append(this.table);
    this.append(svg, controls, table);
  }

  private update(): void {
    this.sliders.forEach(({ name, out, input }, i) => {
      const [title, values, current, , show] = this.sliderSpec(i);
      name.textContent = title;
      input.max = String(values.length - 1);
      input.value = String(Math.max(0, values.indexOf(current)));
      out.textContent = show(current);
    });
    this.table.replaceChildren(
      ...readout(this.protons, this.neutrons).map(([name, value, main]) => {
        const tr = document.createElement('tr');
        if (main) tr.className = 'nuc-main';
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

  private text(x: number, y: number, s: string, anchor = 'start', cls = ''): SVGTextElement {
    return el('text', { x: f1(x), y: f1(y), 'text-anchor': anchor, class: `nuc-label ${cls}` }, s);
  }

  private draw(): void {
    const z = this.protons;
    const a = z + this.neutrons;
    const parts: SVGElement[] = [];
    // the nucleus
    const r = Math.min(13, (G.R * 0.93) / Math.sqrt(a));
    const pts = packing(a, 2 * r * 0.98);
    const mask = protonMask(z, a);
    pts.forEach(([x, y], i) => {
      const cx = G.cx + x;
      const cy = G.cy + y;
      if (mask[i]) {
        parts.push(el('circle', { cx: f1(cx), cy: f1(cy), r: f1(r), class: 'nuc-p' }));
        if (r >= 7) parts.push(this.text(cx, cy + r * 0.42, '+', 'middle', 'nuc-plus'));
      } else {
        parts.push(el('circle', { cx: f1(cx), cy: f1(cy), r: f1(r), class: 'nuc-n' }));
      }
    });
    // the label ᴬ_Z X
    const sym = ELEMENTS[z]?.[0] ?? '?';
    const lx = 288;
    parts.push(this.text(lx, 92, sym, 'start', 'nuc-big'));
    parts.push(this.text(lx - 2, 66, String(a), 'end', 'nuc-mid'));
    parts.push(this.text(lx - 2, 102, String(z), 'end', 'nuc-mid'));
    parts.push(this.text(300, 130, nameOf(z, a), 'middle'));
    const t = find(z, a);
    const status = !t ? 'нестабильно или' : t.half ? 'радиоактивно' : 'стабильно';
    parts.push(this.text(300, 150, status, 'middle', 'nuc-small nuc-muted'));
    if (!t) parts.push(this.text(300, 166, 'не существует', 'middle', 'nuc-small nuc-muted'));
    parts.push(this.text(300, 192, `Z = ${z}, N = ${this.neutrons}`, 'middle', 'nuc-small'));

    // the graph E/A against A
    const { gx, gy, kx, ky } = G;
    const X = (v: number): number => gx + v * kx;
    const Yg = (v: number): number => gy - v * ky;
    parts.push(el('path', { d: `M${gx} ${gy}H${gx + 340}`, class: 'nuc-axis' }));
    parts.push(el('path', { d: `M${gx + 346} ${gy}l-9 -4v8z`, class: 'nuc-axis-tip' }));
    parts.push(el('path', { d: `M${gx} ${gy}V${gy - 102}`, class: 'nuc-axis' }));
    parts.push(el('path', { d: `M${gx} ${gy - 108}l-4 9h8z`, class: 'nuc-axis-tip' }));
    parts.push(this.text(gx + 8, gy - 98, 'E/A, МэВ', 'start', 'nuc-small'));
    parts.push(this.text(gx + 346, gy - 6, 'A', 'end', 'nuc-small'));
    for (const v of [4, 8]) {
      parts.push(el('path', { d: `M${gx - 4} ${f1(Yg(v))}H${gx + 330}`, class: 'nuc-grid' }));
      parts.push(this.text(gx - 7, Yg(v) + 4, String(v), 'end', 'nuc-small'));
    }
    for (const v of [100, 200]) {
      parts.push(el('path', { d: `M${f1(X(v))} ${gy}v4`, class: 'nuc-axis' }));
      parts.push(this.text(X(v), gy + 16, String(v), 'middle', 'nuc-small'));
    }
    const curve = curvePoints();
    parts.push(
      el('path', {
        d: curve.map(([ca, cv], i) => `${i ? 'L' : 'M'}${f1(X(ca))} ${f1(Yg(cv))}`).join(''),
        class: 'nuc-curve',
      }),
    );
    if (t && a > 1) {
      const pa = binding(z, a, t.mass).perA;
      parts.push(el('circle', { cx: f1(X(a)), cy: f1(Yg(pa)), r: 5, class: 'nuc-dot' }));
      const right = a < 170;
      parts.push(
        this.text(X(a) + (right ? 9 : -9), Yg(pa) + 18, `${num(pa, 2)} МэВ`, right ? 'start' : 'end', 'nuc-small nuc-accent'),
      );
    }
    this.scene.replaceChildren(...parts);
  }
}

if (!customElements.get('pp-nucleus')) customElements.define('pp-nucleus', NucleusSim);
