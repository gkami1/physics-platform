// <pp-photons> — photons of light. A slider sets the wavelength λ, 100…1000 нм: in steps of 20 нм in
// the ultraviolet and the infrared and of 10 нм across the visible band 380…760 нм. A second slider
// sets the power of the source, 1…10 мВт. On top, a spectrum strip (ultraviolet, the visible band as
// lettered surface cells — colours are named, never painted — and the infrared) with a marker at λ;
// below it the wave drawn to scale with one wavelength marked; at the bottom the beam from a laser as
// a stream of photons (accent dots). The number of dots is proportional to the number of photons per
// second N = Pλ/(hc), and the area of a dot to the energy of one photon E = hc/λ, so the ink of the
// whole stream follows the power: at a shorter wavelength fewer, bigger dots, at a higher power more
// dots of the same size. Dots sit at fixed seeded pseudo-random places, so any prefix of them is
// spread uniformly at any count.
//
// The table: λ, ν = c/λ, E = hν in Дж and эВ, p = h/λ, the band (and colour), P and N. Constants as
// in the tasks: h = 6,6·10⁻³⁴ Дж·с, c = 3·10⁸ м/с, 1 эВ = 1,6·10⁻¹⁹ Дж.
//
// Without reduced motion the wave and the photons run to the right, and a button pauses them; with
// reduced motion they stand, which already shows the whole picture. The defaults, 470 нм and 8 мВт
// (E ≈ 2,63 эВ, N ≈ 1,9·10¹⁶ в секунду), avoid the answers and intermediates of the step tasks.
//
// Written into theory Markdown as plain HTML; the theory page imports this module only when such an
// element is present. Light DOM, site CSS variables: follows the light/dark theme.

const SVG_NS = 'http://www.w3.org/2000/svg';
const NBSP = '\u00a0';

export const H = 6.6e-34;
export const C = 3e8;
export const EV = 1.6e-19;

/** Wavelengths the slider steps through, нм. */
export const LAMBDAS: number[] = [
  ...Array.from({ length: 14 }, (_, i) => 100 + 20 * i), // 100…360
  ...Array.from({ length: 39 }, (_, i) => 380 + 10 * i), // 380…760
  ...Array.from({ length: 12 }, (_, i) => 780 + 20 * i), // 780…1000
];
/** Powers, мВт. */
export const POWERS: number[] = Array.from({ length: 10 }, (_, i) => i + 1);
export const START_LAMBDA = 470;
export const START_POWER = 8;

/** The visible colours, [from, to) нм, name, letter on the strip. */
export const COLOURS: [number, number, string, string][] = [
  [380, 440, 'фиолетовый', 'ф'],
  [440, 485, 'синий', 'с'],
  [485, 500, 'голубой', 'г'],
  [500, 565, 'зелёный', 'з'],
  [565, 590, 'жёлтый', 'ж'],
  [590, 625, 'оранжевый', 'о'],
  [625, 761, 'красный', 'к'],
];

export function frequency(nm: number): number {
  return C / (nm * 1e-9);
}

/** Energy of one photon, Дж. */
export function energy(nm: number): number {
  return (H * C) / (nm * 1e-9);
}

export function energyEv(nm: number): number {
  return energy(nm) / EV;
}

/** Momentum of one photon, кг·м/с. */
export function momentum(nm: number): number {
  return H / (nm * 1e-9);
}

/** Photons per second from a source of power mW (мВт) at wavelength nm. */
export function perSecond(nm: number, mW: number): number {
  return (mW * 1e-3) / energy(nm);
}

export function band(nm: number): string {
  if (nm < 380) return 'ультрафиолет';
  if (nm > 760) return 'инфракрасное';
  const c = COLOURS.find(([a, b]) => nm >= a && nm < b);
  return `видимый свет, ${c ? c[2] : ''}`;
}

/** A number with a decimal comma, rounded to `digits` decimals, with «≈» when rounding changed it. */
export function num(x: number, digits = 2): string {
  const r = Number(x.toFixed(digits));
  const text = String(r).replace('.', ',');
  return Math.abs(r - x) > 1e-9 * Math.max(1, Math.abs(x)) ? `≈${NBSP}${text}` : text;
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

/** Scientific notation with a decimal comma: «≈ 4,21·10⁻¹⁹», two decimals at most. */
export function sci(x: number): string {
  let e = Math.floor(Math.log10(Math.abs(x)));
  let m = Number((x / 10 ** e).toFixed(2));
  if (m >= 10) {
    m = Number((m / 10).toFixed(2));
    e += 1;
  }
  const exact = Math.abs(m * 10 ** e - x) <= 1e-9 * Math.abs(x);
  const pow = `10${[...String(e)].map((ch) => SUP[ch]).join('')}`;
  const text = m === 1 ? pow : `${String(m).replace('.', ',')}·${pow}`;
  return exact ? text : `≈${NBSP}${text}`;
}

/** Table rows [name, value, main?]. */
export function readout(nm: number, mW: number): [string, string, boolean][] {
  return [
    ['Длина волны λ', `${nm}${NBSP}нм`, false],
    ['Частота ν = c/λ', `${sci(frequency(nm))}${NBSP}Гц`, false],
    ['Энергия фотона E = hν', `${sci(energy(nm))}${NBSP}Дж`, true],
    ['То же в электронвольтах', `${num(energyEv(nm))}${NBSP}эВ`, false],
    ['Импульс фотона p = h/λ', `${sci(momentum(nm))}${NBSP}кг·м/с`, false],
    ['Диапазон', band(nm), false],
    ['Мощность P', `${mW}${NBSP}мВт`, false],
    ['Фотонов в секунду N = P/E', sci(perSecond(nm, mW)), true],
  ];
}

/** The most dots drawn (at 1000 нм and 10 мВт); the count is proportional to N. */
export const MAX_DOTS = 600;

export function dotCount(nm: number, mW: number): number {
  return Math.max(1, Math.round((MAX_DOTS * perSecond(nm, mW)) / perSecond(1000, 10)));
}

/** Dot radius, px: the area is proportional to the photon's energy (2,2 px at 1000 нм). */
export function dotRadius(nm: number): number {
  return 2.2 * Math.sqrt(1000 / nm);
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

/** Layout: the strip, the wave and the beam. */
const S = {
  w: 400,
  h: 252,
  x0: 24,
  x1: 376,
  stripY: 30,
  stripH: 18,
  waveY: 112,
  waveA: 12,
  pxPerNm: 0.12,
  beamX0: 58,
  beamX1: 388,
  beamY0: 160,
  beamY1: 212,
  speed: 46, // px/s, for the eye only
};

const X = (nm: number): number => S.x0 + ((nm - 100) / 900) * (S.x1 - S.x0);

/** Seeded pseudo-random points in the unit square (mulberry32): the same picture on every load,
 * and no lattice — a low-discrepancy sequence stretched over the wide beam showed diagonal stripes. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261110);
const POINTS: [number, number][] = Array.from({ length: MAX_DOTS }, () => [rand(), rand()]);

class PhotonsSim extends HTMLElement {
  private lam = START_LAMBDA;
  private power = START_POWER;
  private shift = 0; // px the stream has moved
  private running = false;
  private frame = 0;
  private last = 0;
  private visible = true;
  private still = false;
  private built = false;
  private observer: IntersectionObserver | null = null;
  private strip!: SVGGElement;
  private wave!: SVGPathElement;
  private bracket!: SVGGElement;
  private stream!: SVGGElement;
  private dots: SVGCircleElement[] = [];
  private button: HTMLButtonElement | null = null;
  private lOut!: HTMLOutputElement;
  private pOut!: HTMLOutputElement;
  private table!: HTMLTableSectionElement;

  connectedCallback(): void {
    if (this.built) return;
    this.built = true;
    const l = Number(this.getAttribute('lambda'));
    this.lam = this.hasAttribute('lambda') && LAMBDAS.includes(l) ? l : START_LAMBDA;
    const p = Number(this.getAttribute('power'));
    this.power = this.hasAttribute('power') && POWERS.includes(p) ? p : START_POWER;
    this.still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.running = !this.still;
    this.replaceChildren(); // drop the no-JS fallback text
    this.classList.add('sim', 'pht');
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

  private slider(name: string, values: number[], value: number, set: (v: number) => void): [HTMLElement, HTMLOutputElement] {
    const label = document.createElement('label');
    label.className = 'sim-slider';
    const span = document.createElement('span');
    span.textContent = name;
    const out = document.createElement('output');
    const input = document.createElement('input');
    input.type = 'range';
    input.min = '0';
    input.max = String(values.length - 1);
    input.step = '1';
    input.value = String(values.indexOf(value));
    input.addEventListener('input', () => {
      set(values[Number(input.value)] ?? value);
      this.update();
    });
    label.append(span, out, input);
    return [label, out];
  }

  private build(): void {
    const parts: HTMLElement[] = [];
    if (!this.still) {
      const top = document.createElement('div');
      top.className = 'pht-top';
      this.button = document.createElement('button');
      this.button.type = 'button';
      this.button.className = 'btn small';
      this.button.addEventListener('click', () => {
        this.running = !this.running;
        if (this.running && this.visible) this.start();
        else cancelAnimationFrame(this.frame);
        this.update();
      });
      const note = document.createElement('span');
      note.className = 'pht-note';
      note.textContent = 'движение очень сильно замедлено';
      top.append(this.button, note);
      parts.push(top);
    }

    const svg = el('svg', {
      viewBox: `0 0 ${S.w} ${S.h}`,
      class: 'sim-svg',
      role: 'img',
      'aria-label':
        'Сверху шкала длин волн от 100 до 1000 нанометров: ультрафиолет, видимый свет по цветам, ' +
        'инфракрасное; метка показывает выбранную длину волны. Ниже волна в масштабе. Внизу луч лазера ' +
        'как поток фотонов-точек: число точек пропорционально числу фотонов в секунду, площадь точки — ' +
        'энергии одного фотона',
    });
    svg.append(...this.staticParts());
    this.strip = el('g');
    this.wave = el('path', { class: 'pht-wave' });
    this.bracket = el('g');
    this.stream = el('g');
    for (let i = 0; i < MAX_DOTS; i++) {
      const c = el('circle', { class: 'pht-dot', r: 2 });
      this.dots.push(c);
      this.stream.append(c);
    }
    svg.append(this.strip, this.wave, this.bracket, this.stream);

    const controls = document.createElement('div');
    controls.className = 'sim-controls';
    const [lLabel, lOut] = this.slider('Длина волны λ', LAMBDAS, this.lam, (v) => (this.lam = v));
    const [pLabel, pOut] = this.slider('Мощность P', POWERS, this.power, (v) => (this.power = v));
    this.lOut = lOut;
    this.pOut = pOut;
    controls.append(lLabel, pLabel);

    const table = document.createElement('table');
    table.className = 'pht-table';
    this.table = document.createElement('tbody');
    table.append(this.table);
    this.append(...parts, svg, controls, table);
  }

  private label(x: number, y: number, text: string, anchor = 'middle', cls = ''): SVGTextElement {
    return el('text', { x: f1(x), y: f1(y), 'text-anchor': anchor, class: `pht-label ${cls}` }, text);
  }

  /** The strip's cells and ticks, the laser and the beam's edges: they never change. */
  private staticParts(): SVGElement[] {
    const { stripY: y, stripH: h, beamX0, beamX1, beamY0, beamY1 } = S;
    const out: SVGElement[] = [];
    out.push(el('rect', { x: X(100), y, width: f1(X(380) - X(100)), height: h, class: 'pht-zone' }));
    out.push(el('rect', { x: f1(X(760)), y, width: f1(X(1000) - X(760)), height: h, class: 'pht-zone' }));
    out.push(this.label((X(100) + X(380)) / 2, y + 13, 'ультрафиолет', 'middle', 'pht-small pht-muted'));
    out.push(this.label((X(760) + X(1000)) / 2, y + 13, 'ИК', 'middle', 'pht-small pht-muted'));
    for (const [a, b, , letter] of COLOURS) {
      const x = X(a);
      const w = X(Math.min(b, 760)) - x;
      out.push(el('rect', { x: f1(x), y, width: f1(w), height: h, class: 'pht-cell' }));
      if (w >= 9) out.push(this.label(x + w / 2, y + 13, letter, 'middle', 'pht-tiny'));
    }
    for (const t of [200, 400, 600, 800, 1000]) {
      out.push(el('path', { d: `M${f1(X(t))} ${y + h}v5`, class: 'pht-axis' }));
      const text = t === 1000 ? `1000${NBSP}нм` : String(t);
      out.push(this.label(X(t), y + h + 18, text, t === 1000 ? 'end' : 'middle', 'pht-small'));
    }
    // the laser and the beam
    out.push(el('rect', { x: 10, y: beamY0 + 6, width: 40, height: beamY1 - beamY0 - 12, rx: 4, class: 'pht-body' }));
    out.push(this.label(30, beamY1 + 24, 'лазер', 'middle', 'pht-small'));
    out.push(el('path', { d: `M${beamX0} ${beamY0}H${beamX1}M${beamX0} ${beamY1}H${beamX1}`, class: 'pht-edge' }));
    out.push(
      this.label((beamX0 + beamX1) / 2, beamY1 + 24, 'точка — фотон; площадь точки — его энергия', 'middle', 'pht-small pht-muted'),
    );
    return out;
  }

  private start(): void {
    cancelAnimationFrame(this.frame);
    this.last = performance.now();
    const tick = (now: number) => {
      // a hidden tab must not jump; the first frame may be stamped before start()
      const dt = Math.max(0, Math.min((now - this.last) / 1000, 0.1));
      this.last = now;
      this.shift = (this.shift + S.speed * dt) % 100000;
      this.drawMoving();
      if (this.running && this.visible) this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  private update(): void {
    if (this.button) this.button.textContent = this.running ? 'Пауза' : 'Пуск';
    this.lOut.textContent = `${this.lam}${NBSP}нм`;
    this.pOut.textContent = `${this.power}${NBSP}мВт`;
    this.table.replaceChildren(
      ...readout(this.lam, this.power).map(([name, value, main]) => {
        const tr = document.createElement('tr');
        if (main) tr.className = 'pht-main';
        const th = document.createElement('th');
        th.scope = 'row';
        th.textContent = name;
        const td = document.createElement('td');
        td.textContent = value;
        tr.append(th, td);
        return tr;
      }),
    );
    // the marker on the strip
    const x = X(this.lam);
    const { stripY: y, stripH: h } = S;
    this.strip.replaceChildren(
      el('path', { d: `M${f1(x)} ${y - 2}V${y + h + 2}`, class: 'pht-mark' }),
      el('path', { d: `M${f1(x)} ${y - 3}l-6 -10h12z`, class: 'pht-tip' }),
    );
    // one wavelength marked over the wave
    const per = this.lam * S.pxPerNm;
    const by = S.waveY - S.waveA - 10;
    const bx = S.x0;
    this.bracket.replaceChildren(
      el('path', { d: `M${bx} ${by + 4}v-6M${f1(bx + per)} ${by + 4}v-6M${bx} ${by + 1}H${f1(bx + per)}`, class: 'pht-guide' }),
      this.label(bx + per / 2, by - 5, 'λ', 'middle', 'pht-small pht-italic'),
    );
    // dot sizes and how many are shown
    const n = dotCount(this.lam, this.power);
    const r = f1(dotRadius(this.lam));
    this.dots.forEach((d, i) => {
      d.setAttribute('r', r);
      d.style.display = i < n ? '' : 'none';
    });
    this.drawMoving();
  }

  /** The wave and the dots at the current shift. */
  private drawMoving(): void {
    const per = this.lam * S.pxPerNm;
    const seg: string[] = [];
    for (let x = S.x0; x <= S.x1; x += 1) {
      const y = S.waveY - S.waveA * Math.sin((2 * Math.PI * (x - S.x0 - this.shift)) / per + Math.PI / 2);
      seg.push(`${seg.length ? 'L' : 'M'}${x} ${f1(y)}`);
    }
    this.wave.setAttribute('d', seg.join(''));
    const n = dotCount(this.lam, this.power);
    const r = dotRadius(this.lam);
    const x0 = S.beamX0 + r;
    const len = S.beamX1 - S.beamX0 - 2 * r;
    const y0 = S.beamY0 + r + 2;
    const hgt = S.beamY1 - S.beamY0 - 2 * r - 4;
    for (let i = 0; i < n; i++) {
      const [u, v] = POINTS[i];
      const d = this.dots[i];
      d.setAttribute('cx', f1(x0 + ((u * len + this.shift) % len)));
      d.setAttribute('cy', f1(y0 + v * hgt));
    }
  }
}

if (!customElements.get('pp-photons')) customElements.define('pp-photons', PhotonsSim);
