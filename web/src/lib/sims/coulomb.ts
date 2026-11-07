// <pp-coulomb q1="3" q2="-2" r="6"> — two point charges on a line (q₁, q₂ in нКл with sign,
// −10…10; r in см, 2…20) in air, kerosene or water. Red force arrows on both charges, always
// equal in length and opposite (Newton's third law): apart for like charges, towards each other
// for unlike ones. The force on q₁ is drawn above the line, the force on q₂ below it, so the
// two arrows never run into each other when the charges attract at close range. Arrow length
// grows with the force but not in proportion (it spans six powers of ten): the readout gives
// the number, and a small F(r) graph below shows the 1/r² curve with the current distance.
//
// Written into theory Markdown as plain HTML; the theory page imports this module only when
// such an element is present. Light DOM, site CSS variables: follows the light/dark theme.
// Colours as in the electrostatics figures: charges are circles in the text colour with «+» or
// «−», forces red, a liquid an accent tint, guides muted.

const SVG_NS = 'http://www.w3.org/2000/svg';

export const K = 9e9; // Н·м²/Кл²
const Q_MAX = 10; // нКл
const R_MIN = 2; // см
const R_MAX = 20; // см
const NBSP = ' ';
const MINUS = '−';

export const MEDIA = {
  air: { title: 'воздух', eps: 1 },
  kerosene: { title: 'керосин', eps: 2 },
  water: { title: 'вода', eps: 81 },
} as const;
export type MediumId = keyof typeof MEDIA;

/** Coulomb force, Н, for charges in нКл and a distance in см, in a medium with permittivity eps. */
export function force(q1: number, q2: number, rCm: number, eps = 1): number {
  return (K * Math.abs(q1 * 1e-9) * Math.abs(q2 * 1e-9)) / (eps * (rCm * 1e-2) ** 2);
}

/** «+3», «−2», «0» with a real minus sign. */
export function signed(q: number): string {
  if (q === 0) return '0';
  return `${q > 0 ? '+' : MINUS}${Math.abs(q)}`;
}

const SUP: Record<string, string> = {
  '-': '⁻',
  '0': '⁰',
  '1': '¹',
  '2': '²',
  '3': '³',
  '4': '⁴',
  '5': '⁵',
  '6': '⁶',
  '7': '⁷',
  '8': '⁸',
  '9': '⁹',
};

/** Up to three significant digits, a decimal comma, no trailing zeros. */
export function sig3(x: number): string {
  if (x === 0) return '0';
  const digits = Math.max(0, 2 - Math.floor(Math.log10(Math.abs(x))));
  const s = x.toFixed(digits);
  return (s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s).replace('.', ',');
}

/** x as «m · 10ⁿ» with m in [1, 10) to three significant digits. */
export function sci(x: number): string {
  let e = Math.floor(Math.log10(x));
  let m = Number((x / 10 ** e).toPrecision(3));
  if (m >= 10) {
    m /= 10;
    e += 1;
  }
  const exp = String(e)
    .split('')
    .map((c) => SUP[c])
    .join('');
  return `${sig3(m)}${NBSP}·${NBSP}10${exp}`;
}

/** «F = 15 мкН = 1,5 · 10⁻⁵ Н», with no-break spaces so it never wraps at «=» or a unit. */
export function forceText(f: number): string {
  if (f === 0) return `F${NBSP}=${NBSP}0`;
  const [k, unit] = f >= 0.1 ? [1, 'Н'] : f >= 1e-3 ? [1e3, 'мН'] : f >= 1e-6 ? [1e6, 'мкН'] : [1e9, 'нН'];
  const main = `F${NBSP}=${NBSP}${sig3(f * k)}${NBSP}${unit}`;
  return unit === 'Н' ? main : `${main}${NBSP}=${NBSP}${sci(f)}${NBSP}Н`;
}

/** Arrow length in px: 14 px at 0,0025 мкН, 13 px more for every power of ten (91 px at most). */
export function arrowLength(f: number): number {
  if (f <= 0) return 0;
  return Math.max(14, Math.min(92, 14 + 13 * (Math.log10(f * 1e6) + 2.6)));
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

const L = { w: 400, h: 226, cx: 200, cy: 72, pxPerCm: 10, rq: 13, gx0: 40, gx1: 384, gy: 214, gh: 62 };

let instances = 0;

class CoulombSim extends HTMLElement {
  private q1 = 3;
  private q2 = -2;
  private r = 6;
  private medium: MediumId = 'air';
  private built = false;
  private scene!: SVGGElement;
  private dot!: SVGCircleElement;
  private guide!: SVGPathElement;
  private outs: HTMLOutputElement[] = [];
  private readout!: HTMLElement;

  connectedCallback(): void {
    if (this.built) return;
    this.built = true;
    const num = (name: string, lo: number, hi: number, fallback: number) => {
      const v = Number(this.getAttribute(name));
      return this.hasAttribute(name) && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : fallback;
    };
    this.q1 = num('q1', -Q_MAX, Q_MAX, this.q1);
    this.q2 = num('q2', -Q_MAX, Q_MAX, this.q2);
    this.r = num('r', R_MIN, R_MAX, this.r);
    const m = this.getAttribute('medium');
    if (m && m in MEDIA) this.medium = m as MediumId;
    this.replaceChildren(); // drop the no-JS fallback text
    this.classList.add('sim', 'cou');
    this.build();
    this.update();
  }

  private slider(
    title: string,
    min: number,
    max: number,
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
    input.min = String(min);
    input.max = String(max);
    input.step = '1';
    input.value = String(value);
    input.addEventListener('input', () => onInput(Number(input.value)));
    label.append(name, out, input);
    return [label, out];
  }

  private build(): void {
    const id = ++instances;
    const choice = document.createElement('fieldset');
    choice.className = 'pfx-chips cou-media';
    const legend = document.createElement('legend');
    legend.textContent = 'Среда';
    choice.append(legend);
    for (const [key, md] of Object.entries(MEDIA) as [MediumId, (typeof MEDIA)[MediumId]][]) {
      const label = document.createElement('label');
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = `cou-${id}`;
      radio.value = key;
      radio.checked = key === this.medium;
      radio.addEventListener('change', () => {
        if (!radio.checked) return;
        this.medium = key;
        this.update();
      });
      const span = document.createElement('span');
      span.textContent = `${md.title}, ε${NBSP}=${NBSP}${md.eps}`;
      label.append(radio, span);
      choice.append(label);
    }

    const svg = el('svg', {
      viewBox: `0 0 ${L.w} ${L.h}`,
      class: 'sim-svg',
      role: 'img',
      'aria-label':
        'Два точечных заряда на прямой. Красные стрелки — силы, с которыми заряды действуют друг на друга: ' +
        'равные по длине и противоположные. Ниже — график зависимости силы от расстояния',
    });
    this.scene = el('g');
    // F(r) graph: axes, the 1/r² curve scaled to fit (its shape does not depend on the charges).
    const g = el('g', { class: 'cou-graph' });
    const { gx0, gx1, gy, gh } = L;
    const gx = (rCm: number) => gx0 + ((gx1 - gx0 - 12) * rCm) / R_MAX;
    const gyOf = (rCm: number) => gy - gh * (R_MIN / rCm) ** 2;
    let d = '';
    for (let i = 0; i <= 180; i++) {
      const rc = R_MIN + ((R_MAX - R_MIN) * i) / 180;
      d += `${i ? 'L' : 'M'}${gx(rc).toFixed(1)} ${gyOf(rc).toFixed(1)}`;
    }
    g.append(
      el('path', { d: `M${gx0} ${gy}H${gx1}M${gx1 - 7} ${gy - 4}L${gx1} ${gy}L${gx1 - 7} ${gy + 4}`, class: 'cou-axis' }),
      el('path', { d: `M${gx0} ${gy}V${gy - gh - 14}M${gx0 - 4} ${gy - gh - 7}L${gx0} ${gy - gh - 14}L${gx0 + 4} ${gy - gh - 7}`, class: 'cou-axis' }),
      el('text', { x: gx1 - 2, y: gy - 8, 'text-anchor': 'end', class: 'cou-name' }, 'r'),
      el('text', { x: gx0 + 8, y: gy - gh - 4, class: 'cou-name' }, 'F'),
      el('path', { d, class: 'cou-curve' }),
    );
    this.guide = el('path', { class: 'cou-guide' });
    this.dot = el('circle', { r: 4.5, class: 'cou-dot' });
    g.append(this.guide, this.dot);
    this.dotAt = (rCm: number) => [gx(rCm), gyOf(rCm)];
    svg.append(this.scene, g);

    const controls = document.createElement('div');
    controls.className = 'sim-controls';
    const [s1, o1] = this.slider('Заряд q₁', -Q_MAX, Q_MAX, this.q1, (v) => {
      this.q1 = v;
      this.update();
    });
    const [s2, o2] = this.slider('Заряд q₂', -Q_MAX, Q_MAX, this.q2, (v) => {
      this.q2 = v;
      this.update();
    });
    const [s3, o3] = this.slider('Расстояние r', R_MIN, R_MAX, this.r, (v) => {
      this.r = v;
      this.update();
    });
    this.outs = [o1, o2, o3];
    controls.append(s1, s2, s3);
    this.readout = document.createElement('p');
    this.readout.className = 'sim-readout';
    this.readout.setAttribute('aria-live', 'polite');
    this.append(choice, svg, controls, this.readout);
  }

  private dotAt: (rCm: number) => [number, number] = () => [0, 0];

  private update(): void {
    const eps = MEDIA[this.medium].eps;
    const f = force(this.q1, this.q2, this.r, eps);
    this.outs[0].textContent = `${signed(this.q1)}${NBSP}нКл`;
    this.outs[1].textContent = `${signed(this.q2)}${NBSP}нКл`;
    this.outs[2].textContent = `${this.r}${NBSP}см`;
    let verdict: string;
    if (f === 0) verdict = 'Один из зарядов равен нулю — силы нет.';
    else if (this.q1 * this.q2 > 0) verdict = 'Заряды одноимённые — отталкиваются.';
    else verdict = 'Заряды разноимённые — притягиваются.';
    const medium = eps > 1 ? ` В${NBSP}среде с ε${NBSP}=${NBSP}${eps} сила в${NBSP}${eps}${NBSP}раз меньше, чем в${NBSP}воздухе.` : '';
    this.readout.textContent = `${forceText(f)}. ${verdict}${f > 0 ? medium : ''}`;
    this.draw(f, eps);
  }

  private charge(x: number, q: number, name: string): SVGGElement {
    const g = el('g', { class: q === 0 ? 'cou-q cou-q0' : 'cou-q' });
    g.append(
      el('circle', { cx: x, cy: L.cy, r: L.rq }),
      el('text', { x, y: L.cy + 6.5, 'text-anchor': 'middle', class: 'cou-sign' }, q > 0 ? '+' : q < 0 ? MINUS : '0'),
      el('text', { x, y: L.cy - L.rq - 32, 'text-anchor': 'middle', class: 'cou-label' }, name),
    );
    return g;
  }

  private arrow(x: number, y: number, dir: number, len: number, name: string): SVGGElement {
    const g = el('g', { class: 'cou-f' });
    const tip = x + dir * len;
    g.append(
      el('line', { x1: x, y1: y, x2: tip - dir * 7, y2: y }),
      el('path', { d: `M${tip} ${y}L${tip - dir * 9} ${y - 4.5}L${tip - dir * 9} ${y + 4.5}Z` }),
      el('text', { x: tip + dir * 4, y: y + 4, 'text-anchor': dir > 0 ? 'start' : 'end' }, name),
    );
    return g;
  }

  private draw(f: number, eps: number): void {
    const half = (this.r * L.pxPerCm) / 2;
    const x1 = L.cx - half;
    const x2 = L.cx + half;
    this.scene.replaceChildren();
    if (eps > 1) this.scene.append(el('rect', { x: 4, y: 10, width: L.w - 8, height: 126, rx: 6, class: 'cou-liquid' }));
    // r between the centres, under the charges.
    const ry = L.cy + 54;
    this.scene.append(
      el('path', { d: `M${x1} ${L.cy + L.rq + 4}V${ry + 6}M${x2} ${L.cy + L.rq + 4}V${ry + 6}`, class: 'cou-tick' }),
      el('path', {
        d: `M${x1 + 6} ${ry - 3}L${x1} ${ry}L${x1 + 6} ${ry + 3}M${x1} ${ry}H${x2}M${x2 - 6} ${ry - 3}L${x2} ${ry}L${x2 - 6} ${ry + 3}`,
        class: 'cou-r',
      }),
      el('text', { x: L.cx, y: ry - 5, 'text-anchor': 'middle', class: 'cou-rname' }, 'r'),
    );
    if (f > 0) {
      const len = arrowLength(f);
      const apart = this.q1 * this.q2 > 0;
      // Force on q₁ above the line, on q₂ below: same length, opposite directions.
      this.scene.append(
        this.arrow(x1, L.cy - L.rq - 10, apart ? -1 : 1, len, 'F₁'),
        this.arrow(x2, L.cy + L.rq + 10, apart ? 1 : -1, len, 'F₂'),
      );
    }
    this.scene.append(this.charge(x1, this.q1, 'q₁'), this.charge(x2, this.q2, 'q₂'));
    const [dx, dy] = this.dotAt(this.r);
    this.dot.setAttribute('cx', dx.toFixed(1));
    this.dot.setAttribute('cy', dy.toFixed(1));
    this.guide.setAttribute('d', `M${dx.toFixed(1)} ${L.gy}V${dy.toFixed(1)}`);
  }
}

if (!customElements.get('pp-coulomb')) customElements.define('pp-coulomb', CoulombSim);
