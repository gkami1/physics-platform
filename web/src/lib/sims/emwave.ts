// <pp-emwave> — an electromagnetic wave running along x, and its place on the scale of waves.
// The vector E (accent) oscillates up and down, B (green) across, drawn obliquely towards us;
// both are largest at the same places (in phase), perpendicular to each other and to the
// direction of travel c. A slider steps the frequency through 1, 2, 5 · 10ⁿ Гц from 10⁴ to 10²⁰;
// the table gives the period T = 1/ν, the wavelength λ = c/ν, the band, where such waves are met
// and a thing of about that size. Under the wave the scale of waves on a logarithmic frequency
// axis (as in the figure of lesson 13.4) with a frame round the present frequency.
//
// The picture always shows two wavelengths across: the wavelength itself is written on the
// bracket. The motion is slowed down beyond measure (one period of the picture takes 2 s).
// Without reduced motion the wave runs, and a button pauses it; with reduced motion it stands.
// The loop runs only while the model is on screen.
//
// Written into theory Markdown as plain HTML; the theory page imports this module only when
// such an element is present. Light DOM, site CSS variables: follows the light/dark theme.

const SVG_NS = 'http://www.w3.org/2000/svg';
const NBSP = ' ';

export const C = 3e8; // м/с
const MANT = [1, 2, 5] as const;
const LG_MIN = 4;
const LG_MAX = 20;
/** Slider positions: 1, 2, 5 in every decade from 10⁴ up to 10²⁰ Гц. */
export const STEPS = (LG_MAX - LG_MIN) * 3 + 1;
export const START = 15; // 10⁹ Гц
const VIS_PERIOD = 2; // с, one period of the picture

/** The frequency at slider position i, Гц. */
export function freq(i: number): number {
  return MANT[i % 3] * 10 ** (LG_MIN + Math.floor(i / 3));
}

/** The band, by the wavelength in m (usual school boundaries; they are approximate). */
export const BANDS = ['радиоволны', 'инфракрасное излучение', 'видимый свет', 'ультрафиолет', 'рентгеновское излучение', 'гамма-излучение'] as const;
const EDGES = [1e-3, 760e-9, 380e-9, 1e-8, 1e-11]; // m, from radio down

export function band(lambda: number): number {
  const k = EDGES.findIndex((e) => lambda > e);
  return k < 0 ? 5 : k;
}

export function where(lambda: number): string {
  switch (band(lambda)) {
    case 0:
      if (lambda >= 1) return 'радиовещание, телевидение';
      return lambda >= 0.1 ? 'мобильная связь, Wi-Fi, микроволновка' : 'радары, спутниковая связь';
    case 1:
      return 'тепло от батареи и Солнца, пульт';
    case 2:
      return 'свет, который видит глаз';
    case 3:
      return 'загар, бактерицидные лампы';
    case 4:
      return 'рентгеновские снимки';
    default:
      return 'радиоактивный распад';
  }
}

const SIZES: [number, string][] = [
  [1e3, 'километры'],
  [100, 'футбольное поле'],
  [10, 'многоэтажный дом'],
  [1, 'рост человека'],
  [0.1, 'ладонь'],
  [0.01, 'монета'],
  [1e-3, 'муравей'],
  [1e-4, 'толщина листа бумаги'],
  [1e-5, 'толщина волоса'],
  [1e-6, 'бактерия'],
  [1e-7, 'вирус'],
  [1e-8, 'крупная молекула'],
  [1e-9, 'молекула'],
  [1e-10, 'атом'],
];

export function sizeLike(lambda: number): string {
  const s = SIZES.find(([v]) => lambda >= v * (1 - 1e-9));
  return s ? s[1] : 'меньше атома';
}

const SUP: Record<string, string> = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };

/** Two significant digits with a decimal comma. */
function sig(x: number): string {
  const r = Number(x.toPrecision(2));
  return String(r).replace('.', ',');
}

/** x as «m·10ⁿ» (or «10ⁿ» when m = 1) and the unit. */
export function sciText(x: number, unit: string): string {
  const e = Math.floor(Math.log10(x) + 1e-9);
  const m = sig(x / 10 ** e);
  const p = String(e)
    .split('')
    .map((ch) => SUP[ch])
    .join('');
  return `${m === '1' ? '' : `${m}·`}10${p}${NBSP}${unit}`;
}

const UNITS: [number, string][] = [
  [1e3, 'км'],
  [1, 'м'],
  [1e-2, 'см'],
  [1e-3, 'мм'],
  [1e-6, 'мкм'],
  [1e-9, 'нм'],
  [1e-12, 'пм'],
];

/** A length in the unit that gives a number from 1 up (km … pm). */
export function lengthText(l: number): string {
  const [u, name] = UNITS.find(([v]) => l >= v * (1 - 1e-9)) ?? UNITS[UNITS.length - 1];
  return `${sig(l / u)}${NBSP}${name}`;
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

/** The wave: x from x0 to x1, axis at yc, one wavelength lam px, amplitudes ae (E) and ab (B),
 * B drawn along dz; the scale: a decade dec px from sx, the bar from top, bh high. */
const S = { w: 400, h: 296, x0: 40, x1: 340, yc: 110, lam: 150, ae: 56, ab: 52, sx: 20, dec: 22.5, top: 238, bh: 26 };
const DZ = [-0.55, 0.42] as const;

const sx = (lg: number): number => S.sx + (lg - LG_MIN) * S.dec;

class EmWaveSim extends HTMLElement {
  private idx = START;
  private phase = 0; // periods of the picture
  private running = false;
  private frame = 0;
  private last = 0;
  private visible = true;
  private still = false;
  private built = false;
  private observer: IntersectionObserver | null = null;
  private wave!: SVGGElement;
  private mark!: SVGRectElement;
  private span!: SVGTextElement;
  private button: HTMLButtonElement | null = null;
  private out!: HTMLOutputElement;
  private cells: HTMLTableCellElement[] = [];

  connectedCallback(): void {
    if (this.built) return;
    this.built = true;
    this.still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.replaceChildren();
    this.classList.add('sim', 'emw');
    this.running = !this.still;
    this.build();
    this.update();
    if (!this.still) {
      this.observer = new IntersectionObserver((entries) => {
        this.visible = entries.some((e) => e.isIntersecting);
        if (this.visible && this.running) this.start();
        else cancelAnimationFrame(this.frame);
      });
      this.observer.observe(this);
    }
  }

  disconnectedCallback(): void {
    cancelAnimationFrame(this.frame);
    this.observer?.disconnect();
    this.observer = null;
    this.built = false;
  }

  private build(): void {
    const parts: HTMLElement[] = [];
    if (!this.still) {
      const top = document.createElement('div');
      top.className = 'emw-top';
      this.button = document.createElement('button');
      this.button.type = 'button';
      this.button.className = 'btn small emw-play';
      this.button.addEventListener('click', () => {
        this.running = !this.running;
        if (this.running && this.visible) this.start();
        else cancelAnimationFrame(this.frame);
        this.update();
      });
      const note = document.createElement('span');
      note.className = 'emw-note';
      note.textContent = 'движение очень сильно замедлено';
      top.append(this.button, note);
      parts.push(top);
    }

    const svg = el('svg', {
      viewBox: `0 0 ${S.w} ${S.h}`,
      class: 'sim-svg',
      role: 'img',
      'aria-label':
        'Электромагнитная волна бежит вправо: вектор E колеблется вверх и вниз, вектор B — поперёк, ' +
        'оба в фазе. Скобка — длина волны. Внизу шкала электромагнитных волн по частоте, рамка — ' +
        'выбранная частота',
    });
    this.wave = el('g');
    svg.append(this.wave, ...this.scale());

    const controls = document.createElement('div');
    controls.className = 'sim-controls';
    const label = document.createElement('label');
    label.className = 'sim-slider';
    const span = document.createElement('span');
    span.textContent = 'Частота ν';
    this.out = document.createElement('output');
    const input = document.createElement('input');
    input.type = 'range';
    input.min = '0';
    input.max = String(STEPS - 1);
    input.step = '1';
    input.value = String(this.idx);
    input.addEventListener('input', () => {
      this.idx = Number(input.value);
      this.update();
    });
    label.append(span, this.out, input);
    controls.append(label);

    const table = document.createElement('table');
    table.className = 'emw-table';
    const body = document.createElement('tbody');
    ['Период T = 1/ν', 'Длина волны λ = c/ν', 'Диапазон', 'Где встречается', 'Длина волны примерно как'].forEach((name, i) => {
      const tr = document.createElement('tr');
      if (i === 1) tr.className = 'emw-main';
      const th = document.createElement('th');
      th.scope = 'row';
      th.textContent = name;
      const td = document.createElement('td');
      tr.append(th, td);
      body.append(tr);
      this.cells.push(td);
    });
    table.append(body);
    this.append(...parts, svg, controls, table);
  }

  private start(): void {
    cancelAnimationFrame(this.frame);
    this.last = performance.now();
    const tick = (now: number) => {
      // a hidden tab must not jump; the first frame may be stamped before start()
      const dt = Math.max(0, Math.min((now - this.last) / 1000, 0.1));
      this.last = now;
      this.phase = (this.phase + dt / VIS_PERIOD) % 1;
      this.drawWave();
      if (this.running && this.visible) this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  private update(): void {
    const nu = freq(this.idx);
    const l = C / nu;
    if (this.button) this.button.textContent = this.running ? 'Пауза' : 'Пуск';
    this.out.textContent = sciText(nu, 'Гц');
    const values = [sciText(1 / nu, 'с'), lengthText(l), BANDS[band(l)], where(l), sizeLike(l)];
    values.forEach((v, i) => (this.cells[i].textContent = v));
    this.span.textContent = `λ${NBSP}=${NBSP}${lengthText(l)}`;
    const x = sx(Math.log10(nu));
    this.mark.setAttribute('x', f1(x - 4));
    this.drawWave();
  }

  private arrow(x1: number, y1: number, x2: number, y2: number): SVGElement[] {
    const n = Math.hypot(x2 - x1, y2 - y1) || 1;
    const ux = (x2 - x1) / n;
    const uy = (y2 - y1) / n;
    const bx = x2 - ux * 8;
    const by = y2 - uy * 8;
    return [
      el('path', { d: `M${f1(x1)} ${f1(y1)}L${f1(x2 - ux * 5)} ${f1(y2 - uy * 5)}`, class: 'emw-c' }),
      el('path', { d: `M${f1(x2)} ${f1(y2)}L${f1(bx - uy * 4)} ${f1(by + ux * 4)}L${f1(bx + uy * 4)} ${f1(by - ux * 4)}Z`, class: 'emw-c-head' }),
    ];
  }

  private drawWave(): void {
    const { x0, x1, yc, lam, ae, ab } = S;
    const parts: SVGElement[] = [];
    const s = (x: number) => Math.sin(2 * Math.PI * ((x - x0) / lam - this.phase));
    const xs: number[] = [];
    for (let x = x0; x <= x1 + 1e-9; x += 2.5) xs.push(x);
    const stems = (cls: string, end: (x: number, v: number) => [number, number]) => {
      const d: string[] = [];
      for (let k = 0; k < xs.length; k += 4) {
        const v = s(xs[k]);
        if (Math.abs(v) < 0.08) continue;
        const [ex, ey] = end(xs[k], v);
        d.push(`M${f1(xs[k])} ${yc}L${f1(ex)} ${f1(ey)}`);
      }
      return el('path', { d: d.join(''), class: cls });
    };
    const bEnd = (x: number, v: number): [number, number] => [x + ab * v * DZ[0], yc + ab * v * DZ[1]];
    const eEnd = (x: number, v: number): [number, number] => [x, yc - ae * v];
    parts.push(stems('emw-bs', bEnd));
    parts.push(el('path', { d: 'M' + xs.map((x) => bEnd(x, s(x)).map(f1).join(' ')).join('L'), class: 'emw-b' }));
    parts.push(el('path', { d: `M${x0 - 14} ${yc}H${x1 + 6}`, class: 'emw-axis' }));
    parts.push(...this.arrow(x1 + 8, yc, x1 + 50, yc));
    parts.push(el('text', { x: x1 + 46, y: yc - 10, 'text-anchor': 'middle', class: 'emw-label', 'font-style': 'italic' }, 'c'));
    parts.push(stems('emw-es', eEnd));
    parts.push(el('path', { d: 'M' + xs.map((x) => eEnd(x, s(x)).map(f1).join(' ')).join('L'), class: 'emw-e' }));
    parts.push(el('text', { x: x0 - 8, y: yc - ae + 4, 'text-anchor': 'end', class: 'emw-label emw-le', 'font-style': 'italic' }, 'E'));
    parts.push(el('text', { x: x0 - 22, y: yc + 34, 'text-anchor': 'end', class: 'emw-label emw-lb', 'font-style': 'italic' }, 'B'));
    // the bracket: one wavelength between two crests (they move with the wave)
    const c1 = x0 + lam * ((((0.25 + this.phase) % 1) + 1) % 1);
    const by = 30;
    parts.push(el('path', { d: `M${f1(c1)} ${by - 5}v10M${f1(c1 + lam)} ${by - 5}v10M${f1(c1)} ${by}H${f1(c1 + lam)}`, class: 'emw-guide' }));
    this.span.setAttribute('x', f1(c1 + lam / 2));
    this.wave.replaceChildren(...parts);
  }

  /** The scale of waves: bands, λ ticks above, ν ticks below, and the frame of the present ν. */
  private scale(): SVGElement[] {
    const { top, bh } = S;
    const out: SVGElement[] = [];
    const lgc = Math.log10(C);
    const edges = [LG_MIN, lgc + 3, lgc - Math.log10(760e-9), lgc - Math.log10(380e-9), lgc + 8, lgc + 11, LG_MAX];
    const names = ['радиоволны', 'ИК', '', 'УФ', 'рентген', 'γ'];
    for (let i = 0; i < 6; i++) {
      const a = sx(edges[i]);
      const b = sx(edges[i + 1]);
      out.push(el('rect', { x: f1(a), y: top, width: f1(b - a), height: bh, class: i === 2 ? 'emw-vis' : 'emw-band' }));
      if (names[i]) out.push(el('text', { x: f1((a + b) / 2), y: top + 17, 'text-anchor': 'middle', class: 'emw-name' }, names[i]));
    }
    for (const [name, l] of [['1 км', 1e3], ['1 м', 1], ['1 мм', 1e-3], ['1 мкм', 1e-6], ['1 нм', 1e-9]] as const) {
      const x = sx(lgc - Math.log10(l));
      out.push(el('path', { d: `M${f1(x)} ${top - 5}V${top}`, class: 'emw-guide' }));
      out.push(el('text', { x: f1(x), y: top - 9, 'text-anchor': 'middle', class: 'emw-tick' }, name.replace(' ', NBSP)));
    }
    out.push(el('text', { x: 4, y: top - 9, class: 'emw-label emw-small', 'font-style': 'italic' }, 'λ'));
    for (const p of [6, 10, 14, 18]) {
      const x = sx(p);
      out.push(el('path', { d: `M${f1(x)} ${top + bh}v5`, class: 'emw-guide' }));
      out.push(el('text', { x: f1(x), y: top + bh + 19, 'text-anchor': 'middle', class: 'emw-tick' }, `10${String(p).split('').map((ch) => SUP[ch]).join('')}`));
    }
    const nl = el('text', { x: 4, y: top + bh + 19, class: 'emw-label emw-small' });
    nl.append(el('tspan', { 'font-style': 'italic' }, 'ν'), el('tspan', {}, ', Гц'));
    out.push(nl);
    this.mark = el('rect', { x: 0, y: top - 4, width: 8, height: bh + 8, rx: 2, class: 'emw-mark' });
    this.span = el('text', { x: 0, y: 22, 'text-anchor': 'middle', class: 'emw-label emw-small' });
    out.push(this.mark, this.span);
    return out;
  }
}

if (!customElements.get('pp-emwave')) customElements.define('pp-emwave', EmWaveSim);
