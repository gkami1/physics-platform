// <pp-prefix value="2,5" from="к" to="м" unit="м" prefixes="к,,с,м"> — converting between
// units with SI prefixes: pick «из» and «в», see the multiplier on a powers-of-ten ladder,
// the chain of equalities and the decimal comma hopping one place per power of ten.
//
// Written into theory Markdown as plain HTML; the theory page imports this module only when
// such an element is present. Light DOM, site CSS variables: follows the light/dark theme.
// Arithmetic is on digit strings, never floats, so 2,5 Гм → нм stays exact.

const SVG_NS = 'http://www.w3.org/2000/svg';

interface Prefix {
  sym: string; // '' = the unit itself
  exp: number;
  name: string;
}

const ALL: Prefix[] = [
  { sym: 'Г', exp: 9, name: 'гига' },
  { sym: 'М', exp: 6, name: 'мега' },
  { sym: 'к', exp: 3, name: 'кило' },
  { sym: '', exp: 0, name: 'без приставки' },
  { sym: 'д', exp: -1, name: 'деци' },
  { sym: 'с', exp: -2, name: 'санти' },
  { sym: 'м', exp: -3, name: 'милли' },
  { sym: 'мк', exp: -6, name: 'микро' },
  { sym: 'н', exp: -9, name: 'нано' },
];

/** value = digits × 10^exp, digits without leading or trailing zeros ('0' for zero). */
export interface Decimal {
  digits: string;
  exp: number;
}

export function parseDecimal(raw: string): Decimal | null {
  const s = raw.trim().replace(/\s/g, '').replace('.', ',');
  const m = /^(\d{1,9})(?:,(\d{1,9}))?$/.exec(s);
  if (!m) return null;
  const int = m[1] ?? '';
  const frac = m[2] ?? '';
  return normalize({ digits: int + frac, exp: -frac.length });
}

function normalize(d: Decimal): Decimal {
  let digits = d.digits.replace(/^0+/, '');
  let exp = d.exp;
  if (!digits) return { digits: '0', exp: 0 };
  while (digits.endsWith('0')) {
    digits = digits.slice(0, -1);
    exp += 1;
  }
  return { digits, exp };
}

/** A digit of the written number; `pad` marks zeros that the shift added. */
export interface Cell {
  ch: string;
  pad: boolean;
}

/** The number written out in full: integer cells, fraction cells. */
export function writeOut(d: Decimal): { int: Cell[]; frac: Cell[] } {
  const own = [...d.digits].map((ch) => ({ ch, pad: false }));
  if (d.digits === '0') return { int: [{ ch: '0', pad: false }], frac: [] };
  if (d.exp >= 0) {
    return { int: [...own, ...Array.from({ length: d.exp }, () => ({ ch: '0', pad: true }))], frac: [] };
  }
  const split = own.length + d.exp; // digits before the comma
  if (split > 0) return { int: own.slice(0, split), frac: own.slice(split) };
  const lead = Array.from({ length: -split }, () => ({ ch: '0', pad: true }));
  return { int: [{ ch: '0', pad: true }], frac: [...lead, ...own] };
}

/** «2 500 000» / «0,000 25»: groups of three, decimal comma, narrow no-break spaces. */
export function formatRu(d: Decimal): string {
  const { int, frac } = writeOut(d);
  const i = int.map((c) => c.ch).join('');
  const f = frac.map((c) => c.ch).join('');
  const groupedInt = i.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const groupedFrac = f.replace(/(\d{3})(?=\d)/g, '$1 ');
  return f ? `${groupedInt},${groupedFrac}` : groupedInt;
}

const SUP: Record<string, string> = {
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
  '-': '⁻',
};
export const pow10 = (n: number) => `10${[...String(n)].map((c) => SUP[c] ?? c).join('')}`;

/** Russian plural: 1 знак, 2 знака, 5 знаков, 11 знаков, 21 знак. */
export function plural(n: number, one: string, few: string, many: string): string {
  const d = n % 10;
  const teen = n % 100 >= 11 && n % 100 <= 14;
  return d === 1 && !teen ? one : d >= 2 && d <= 4 && !teen ? few : many;
}

function el<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

function html<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls = '',
  text = '',
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text) node.textContent = text;
  return node;
}

// The ladder: exponents 9 (left) … −9 (right).
const LAD = { w: 360, h: 92, left: 18, right: 18, axis: 52 };
const lx = (exp: number) => LAD.left + ((9 - exp) / 18) * (LAD.w - LAD.left - LAD.right);

let instances = 0;

class PrefixSim extends HTMLElement {
  private prefixes: Prefix[] = ALL;
  private unit = 'м';
  private value: Decimal = { digits: '25', exp: -1 };
  private from: Prefix = ALL[2]!;
  private to: Prefix = ALL[6]!;
  private shown = 0; // how many powers of ten the comma has moved so far
  private timer = 0;
  private built = false;
  private input!: HTMLInputElement;
  private ladder!: SVGSVGElement;
  private arc!: SVGGElement;
  private digits!: HTMLElement;
  private chain!: HTMLElement;
  private rule!: HTMLElement;

  connectedCallback(): void {
    if (this.built) return;
    this.built = true;
    this.unit = this.getAttribute('unit') ?? 'м';
    const wanted = this.getAttribute('prefixes')?.split(',');
    if (wanted) {
      const picked = ALL.filter((p) => wanted.includes(p.sym));
      if (picked.length >= 2) this.prefixes = picked;
    }
    const find = (sym: string | null, fallback: Prefix) =>
      this.prefixes.find((p) => p.sym === sym) ?? fallback;
    this.from = find(this.getAttribute('from'), this.prefixes[0]!);
    this.to = find(this.getAttribute('to'), this.prefixes.at(-1)!);
    this.value = parseDecimal(this.getAttribute('value') ?? '2,5') ?? this.value;
    this.replaceChildren(); // drop the no-JS fallback text
    this.classList.add('sim', 'pfx');
    this.build();
    this.update(false);
  }

  disconnectedCallback(): void {
    clearTimeout(this.timer);
  }

  private build(): void {
    const id = ++instances;
    const top = html('div', 'pfx-top');
    const field = html('label', 'pfx-value');
    field.append(html('span', '', 'Число'));
    this.input = html('input');
    this.input.inputMode = 'decimal';
    this.input.value = formatRu(this.value).replace(/ /g, '');
    this.input.setAttribute('aria-describedby', `pfx-hint-${id}`);
    this.input.addEventListener('input', () => {
      const v = parseDecimal(this.input.value);
      this.input.toggleAttribute('aria-invalid', v === null);
      if (v) {
        this.value = v;
        this.update(false);
      }
    });
    field.append(this.input);
    const hint = html('span', 'pfx-hint', 'до 9 цифр, дробь через запятую');
    hint.id = `pfx-hint-${id}`;
    top.append(field, hint);

    this.append(
      top,
      this.chips(`pfx-from-${id}`, 'Из', () => this.from, (p) => (this.from = p)),
      this.chips(`pfx-to-${id}`, 'В', () => this.to, (p) => (this.to = p)),
    );

    this.ladder = el('svg', {
      viewBox: `0 0 ${LAD.w} ${LAD.h}`,
      class: 'sim-svg pfx-ladder',
      'aria-hidden': 'true',
    });
    const axis = el('g', { class: 'pfx-axis' });
    axis.append(el('line', { x1: lx(9), x2: lx(-9), y1: LAD.axis, y2: LAD.axis }));
    for (let e = 9; e >= -9; e--) {
      const major = ALL.some((p) => p.exp === e);
      axis.append(
        el('line', {
          x1: lx(e),
          x2: lx(e),
          y1: LAD.axis - (major ? 5 : 2.5),
          y2: LAD.axis + (major ? 5 : 2.5),
        }),
      );
    }
    for (const p of ALL) {
      const label = el('text', { x: lx(p.exp), y: LAD.axis + 20, 'text-anchor': 'middle' });
      label.textContent = p.sym || this.unit;
      label.dataset.exp = String(p.exp);
      const power = el('text', {
        x: lx(p.exp),
        y: LAD.axis + 33,
        'text-anchor': 'middle',
        class: 'pfx-power',
      });
      power.textContent = p.exp === 0 ? '1' : pow10(p.exp);
      axis.append(label, power);
    }
    this.arc = el('g', { class: 'pfx-arc' });
    this.ladder.append(axis, this.arc);
    this.append(this.ladder);

    this.digits = html('p', 'pfx-digits');
    this.digits.setAttribute('aria-hidden', 'true');
    this.chain = html('p', 'pfx-chain');
    this.chain.setAttribute('aria-live', 'polite');
    this.rule = html('p', 'pfx-rule');
    this.append(this.digits, this.chain, this.rule);
  }

  private chips(
    name: string,
    title: string,
    get: () => Prefix,
    set: (p: Prefix) => void,
  ): HTMLFieldSetElement {
    const box = html('fieldset', 'pfx-chips');
    box.append(html('legend', '', title));
    for (const p of this.prefixes) {
      const label = html('label');
      label.title = `${p.name}: ${p.exp === 0 ? '1' : pow10(p.exp)}`;
      const radio = html('input');
      radio.type = 'radio';
      radio.name = name;
      radio.checked = p === get();
      radio.addEventListener('change', () => {
        set(p);
        this.update(true);
      });
      label.append(radio, html('span', '', `${p.sym}${this.unit}`));
      box.append(label);
    }
    return box;
  }

  /** Redraw for the current choice; `animate`: hop the comma from the start. */
  private update(animate: boolean): void {
    clearTimeout(this.timer);
    const k = this.from.exp - this.to.exp; // ×10^k
    this.drawArc(k);
    this.writeChain(k);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!animate || reduced || k === 0) {
      this.shown = k;
      this.drawDigits();
      return;
    }
    this.shown = 0;
    this.drawDigits();
    const hop = () => {
      this.shown += Math.sign(k);
      this.drawDigits();
      if (this.shown !== k) this.timer = window.setTimeout(hop, 220);
    };
    this.timer = window.setTimeout(hop, 350);
  }

  private drawDigits(): void {
    const { int, frac } = writeOut({ digits: this.value.digits, exp: this.value.exp + this.shown });
    const cell = (c: Cell) => html('span', c.pad ? 'pfx-d pfx-pad' : 'pfx-d', c.ch);
    const comma = html('span', frac.length ? 'pfx-comma' : 'pfx-comma pfx-ghost', ',');
    const unit = html(
      'span',
      'pfx-unit',
      `${this.shown === this.from.exp - this.to.exp ? this.to.sym : this.shown === 0 ? this.from.sym : '…'}${this.unit}`,
    );
    this.digits.replaceChildren(...int.map(cell), comma, ...frac.map(cell), unit);
  }

  private drawArc(k: number): void {
    this.arc.replaceChildren();
    for (const t of this.ladder.querySelectorAll<SVGTextElement>('text[data-exp]')) {
      const e = Number(t.dataset.exp);
      t.classList.toggle('pfx-from', e === this.from.exp);
      t.classList.toggle('pfx-to', e === this.to.exp);
    }
    const x1 = lx(this.from.exp);
    const x2 = lx(this.to.exp);
    this.arc.append(
      el('circle', { cx: x1, cy: LAD.axis, r: 5, class: 'pfx-dot-from' }),
      el('circle', { cx: x2, cy: LAD.axis, r: 5, class: 'pfx-dot-to' }),
    );
    if (k === 0) return;
    const lift = Math.min(36, 10 + Math.abs(x2 - x1) / 6);
    const mid = (x1 + x2) / 2;
    const d = `M${x1} ${LAD.axis - 8}Q${mid} ${LAD.axis - 8 - lift * 2} ${x2} ${LAD.axis - 8}`;
    const dir = Math.sign(x2 - x1);
    const path = el('path', { d, class: 'pfx-curve', pathLength: 1 });
    const head = el('path', {
      d: `M${x2} ${LAD.axis - 7}l${-dir * 7} -6l${dir * 1.5} 7z`,
      class: 'pfx-head',
    });
    const label = el('text', {
      x: mid,
      y: LAD.axis - 12 - lift,
      'text-anchor': 'middle',
      class: 'pfx-factor',
    });
    label.textContent = `${k > 0 ? '×' : ':'} ${pow10(Math.abs(k))}`;
    this.arc.append(path, head, label);
  }

  private writeChain(k: number): void {
    const u = this.unit;
    const n = formatRu(this.value);
    const from = `${this.from.sym}${u}`;
    const to = `${this.to.sym}${u}`;
    const result = formatRu({ digits: this.value.digits, exp: this.value.exp + k });
    const one = (p: Prefix) => `1 ${p.sym}${u} = ${p.exp === 0 ? '1' : pow10(p.exp)} ${u}`;
    if (k === 0) {
      this.chain.textContent = `${n} ${from} = ${n} ${to}`;
      this.rule.textContent = 'Единица та же — число не меняется.';
      return;
    }
    // 2,5 км = 2,5 · 10³ м = 2,5 · 10³ · 10³ мм = 2,5 · 10⁶ мм = 2 500 000 мм
    const steps = [`${n} ${from}`];
    if (this.from.exp !== 0) steps.push(`${n} · ${pow10(this.from.exp)} ${u}`);
    if (this.to.exp !== 0) {
      const inTo = `${pow10(-this.to.exp)}`;
      steps.push(
        this.from.exp !== 0
          ? `${n} · ${pow10(this.from.exp)} · ${inTo} ${to}`
          : `${n} · ${inTo} ${to}`,
      );
    }
    if (this.from.exp !== 0 && this.to.exp !== 0) steps.push(`${n} · ${pow10(k)} ${to}`);
    steps.push(`${result} ${to}`);
    this.chain.replaceChildren(
      html('span', 'pfx-facts', [this.from, this.to].filter((p) => p.exp !== 0).map(one).join(';  ')),
      html('span', 'pfx-eq', steps.join(' = ')),
    );
    const places = Math.abs(k);
    const word = plural(places, 'знак', 'знака', 'знаков');
    this.rule.textContent =
      k > 0
        ? `Единица «${to}» мельче в ${pow10(k)} раз, поэтому число в ${pow10(k)} раз больше: запятая уходит на ${places} ${word} вправо.`
        : `Единица «${to}» крупнее в ${pow10(-k)} раз, поэтому число в ${pow10(-k)} раз меньше: запятая уходит на ${places} ${word} влево.`;
  }
}

if (!customElements.get('pp-prefix')) customElements.define('pp-prefix', PrefixSim);
