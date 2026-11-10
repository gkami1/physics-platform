// <pp-photoeffect> — the photoeffect in a vacuum photocell. Sliders set the wavelength of the light
// (200…700 нм, steps of 10 нм), its brightness (1…10, the number of photons per second in relative
// units) and the voltage between the anode and the cathode (−5…5 В, steps of 0,1 В; plus on the anode
// accelerates the electrons, minus brakes them). Chips choose the cathode metal: caesium, potassium,
// sodium or zinc, each with its work function.
//
// Physics, with the constants of the tasks (h = 6,6·10⁻³⁴ Дж·с, c = 3·10⁸ м/с, 1 эВ = 1,6·10⁻¹⁹ Дж):
// hν = hc/λ; E_к max = hν − A (Einstein); no electrons at all when hν ≤ A, however bright the light
// (the red limit ν₀ = A/h, λ₀ = hc/A); eU_з = E_к max. The cathode emits b·10¹² electrons per second
// (b — the brightness), whatever the frequency above the red limit, so the saturation current
// Iн = b·10¹²·e grows with the brightness and does not depend on ν. The current at voltage U is
// Iн times the share of the electrons that reach the anode (currentFraction, the same model as the
// figures theory-pe-iu and theory-pe-laws): with a braking voltage only the electrons heading for
// the anode (half of them) with energy above e|U| arrive, F0(1 − |U|/U_з)², and with an accelerating
// one the field also pulls in those flying aside, 1 − (1 − F0)·exp(−U/U1), no kink at U = 0.
//
// The tube shows photons (accent dots) flying onto the cathode and electrons (text-colour dots) leaving
// it: towards the anode, turning back in a braking field, or aside to the glass. Each electron has a
// fixed seeded energy E_к max·(1 − √r), so the share that arrives is exactly the share in the formula.
// Below the tube the I(U) curve with the operating point. Without reduced motion the particles move and
// a button pauses them; with reduced motion they stand at one moment, which already shows them all.
// The defaults (caesium, 420 нм, brightness 6, 1 В) avoid the answers and intermediates of the tasks.
//
// Written into theory Markdown as plain HTML; the theory page imports this module only when such an
// element is present. Light DOM, site CSS variables: follows the light/dark theme.

const SVG_NS = 'http://www.w3.org/2000/svg';
const NBSP = '\u00a0';
const MINUS = '\u2212';

export const H = 6.6e-34;
export const C = 3e8;
export const EV = 1.6e-19;
/** Share of the emitted electrons that reach the anode at U = 0. */
export const F0 = 0.5;

/** Cathode metals: name and work function, эВ. */
export const METALS: [string, number][] = [
  ['цезий', 1.9],
  ['калий', 2.2],
  ['натрий', 2.3],
  ['цинк', 4.2],
];
/** Wavelengths, нм. */
export const LAMBDAS: number[] = Array.from({ length: 51 }, (_, i) => 200 + 10 * i);
/** Brightness, relative units. */
export const BRIGHTS: number[] = Array.from({ length: 10 }, (_, i) => i + 1);
/** Voltages in tenths of a volt, −50…50 (−5…5 В). */
export const VOLTS10: number[] = Array.from({ length: 101 }, (_, i) => i - 50);
export const START_LAMBDA = 420;
export const START_METAL = 0;
export const START_BRIGHT = 6;
export const START_VOLT10 = 10;
/** Electrons emitted per second per unit of brightness. */
export const PER_BRIGHT = 1e12;

export function photonEv(nm: number): number {
  return (H * C) / (nm * 1e-9) / EV;
}

export function frequency(nm: number): number {
  return C / (nm * 1e-9);
}

/** Largest kinetic energy of the photoelectrons, эВ; zero or negative means no photoeffect. */
export function eMax(nm: number, a: number): number {
  return photonEv(nm) - a;
}

export function emits(nm: number, a: number): boolean {
  return eMax(nm, a) > 1e-12;
}

/** Stopping voltage, В (zero without photoeffect). */
export function stopping(nm: number, a: number): number {
  return emits(nm, a) ? eMax(nm, a) : 0;
}

/** Red limit: the least frequency, Гц, and the longest wavelength, нм. */
export function nu0(a: number): number {
  return (a * EV) / H;
}

export function lambda0(a: number): number {
  return ((H * C) / (a * EV)) * 1e9;
}

/** Electrons leaving the cathode per second. */
export function emitted(nm: number, a: number, b: number): number {
  return emits(nm, a) ? b * PER_BRIGHT : 0;
}

/** Share of the emitted electrons that reach the anode at voltage u, В, stopping voltage uz, В. */
export function currentFraction(u: number, uz: number): number {
  if (uz <= 0 || u <= -uz) return 0;
  if (u <= 0) return F0 * (1 + u / uz) ** 2;
  const u1 = ((1 - F0) * uz) / (2 * F0);
  return 1 - (1 - F0) * Math.exp(-u / u1);
}

/** Saturation current, А. */
export function saturation(nm: number, a: number, b: number): number {
  return emitted(nm, a, b) * EV;
}

/** Current through the cell, А. */
export function current(nm: number, a: number, b: number, u: number): number {
  return saturation(nm, a, b) * currentFraction(u, stopping(nm, a));
}

/** A number with a decimal comma, rounded to `digits` decimals, with «≈» when rounding changed it. */
export function num(x: number, digits = 2): string {
  const r = Number(x.toFixed(digits));
  const text = String(Math.abs(r)).replace('.', ',');
  const sign = r < 0 ? MINUS : '';
  return Math.abs(r - x) > 1e-9 * Math.max(1, Math.abs(x)) ? `≈${NBSP}${sign}${text}` : `${sign}${text}`;
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

/** Scientific notation with a decimal comma: «≈ 4,61·10¹⁴», two decimals at most. */
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

export function volts(u10: number): string {
  return `${num(u10 / 10, 1)}${NBSP}В`;
}

/** Table rows [name, value, main?]. */
export function readout(nm: number, metal: number, b: number, u10: number): [string, string, boolean][] {
  const [, a] = METALS[metal];
  const on = emits(nm, a);
  const microA = (x: number): string => `${num(x * 1e6)}${NBSP}мкА`;
  return [
    ['Энергия фотона hν', `${num(photonEv(nm))}${NBSP}эВ`, false],
    ['Работа выхода A', `${num(a)}${NBSP}эВ`, false],
    ['Eк max = hν − A', on ? `${num(eMax(nm, a))}${NBSP}эВ` : 'фотоэффекта нет', true],
    ['Задерживающее напряжение Uз', on ? `${num(stopping(nm, a))}${NBSP}В` : '—', false],
    ['Частота света ν', `${sci(frequency(nm))}${NBSP}Гц`, false],
    ['Красная граница ν₀ = A/h', `${sci(nu0(a))}${NBSP}Гц`, false],
    ['Красная граница λ₀ = hc/A', `${num(lambda0(a), 0)}${NBSP}нм`, false],
    ['Электронов из катода в секунду', on ? sci(emitted(nm, a, b)) : '0', false],
    ['Ток насыщения Iн', microA(saturation(nm, a, b)), false],
    [`Ток при U = ${volts(u10)}`, microA(current(nm, a, b, u10 / 10)), true],
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

/** Layout: the tube on top, the I(U) graph below. */
const S = {
  w: 400,
  h: 402,
  anodeX: 92,
  cathX: 268,
  plateY0: 50,
  plateY1: 118,
  wallY0: 30,
  wallY1: 138,
  lightX: 394,
  // graph
  gx0: 30,
  gx1: 390,
  gOx: 210,
  gOy: 362,
  gTop: 206,
  kU: 34, // px per В
  kI: 90, // px per мкА
  cycle: 3, // s
  flight: 0.5, // s for a photon
  speed: 1.6, // gap per second per √эВ
};

const UX = (u: number): number => S.gOx + u * S.kU;
const IY = (microA: number): number => S.gOy - microA * S.kI;

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Particles per unit of brightness drawn in the tube. */
const PER_B = 4;
const SLOTS = PER_B * 10;
const rand = mulberry32(20261111);
/** Per slot: phase, lane (0…1), energy draw, forward?, catch draw, side sign, wall draw. */
const SLOT: { phase: number; lane: number; r: number; forward: boolean; catchR: number; side: number; wall: number }[] =
  Array.from({ length: SLOTS }, (_, i) => ({
    phase: rand(),
    lane: rand(),
    r: rand(),
    forward: i % 2 === 0, // exactly the share F0 = 0,5 heads for the anode
    catchR: rand(),
    side: rand() < 0.5 ? -1 : 1,
    wall: rand(),
  }));

/** Where an electron is at time s after leaving the cathode, as [gap share 0…1 towards the anode,
 * lateral offset px] or null once it has arrived, returned or hit the glass. */
export function electronAt(
  s: number,
  e: number,
  u: number,
  uz: number,
  slot: { forward: boolean; catchR: number; side: number; wall: number },
): [number, number] | null {
  const v0 = S.speed * Math.sqrt(Math.max(e, 0));
  const acc = (S.speed * S.speed * u) / 2;
  const g = v0 * s + (acc * s * s) / 2;
  if (slot.forward) {
    if (g < 0 || g > 1) return null;
    return [g, 0];
  }
  const u1 = ((1 - F0) * uz) / (2 * F0);
  const caught = u > 0 && slot.catchR < 1 - Math.exp(-u / u1);
  if (caught) {
    if (g < 0 || g > 1) return null;
    return [g, slot.side * 26 * g];
  }
  // lost: a straight flight aside to the glass in 0,5 s
  const t = s / 0.5;
  if (t > 1) return null;
  return [t * (0.25 + 0.5 * slot.wall), slot.side * 60 * t];
}

class PhotoeffectSim extends HTMLElement {
  private lam = START_LAMBDA;
  private metal = START_METAL;
  private bright = START_BRIGHT;
  private volt10 = START_VOLT10;
  private clock = 1.3; // s; the still picture is this moment
  private running = false;
  private frame = 0;
  private last = 0;
  private visible = true;
  private still = false;
  private built = false;
  private observer: IntersectionObserver | null = null;
  private photons: SVGCircleElement[] = [];
  private electrons: SVGCircleElement[] = [];
  private signs!: SVGGElement;
  private noEffect!: SVGTextElement;
  private curve!: SVGPathElement;
  private satLine!: SVGGElement;
  private point!: SVGGElement;
  private button: HTMLButtonElement | null = null;
  private outs: HTMLOutputElement[] = [];
  private table!: HTMLTableSectionElement;

  connectedCallback(): void {
    if (this.built) return;
    this.built = true;
    const l = Number(this.getAttribute('lambda'));
    this.lam = this.hasAttribute('lambda') && LAMBDAS.includes(l) ? l : START_LAMBDA;
    this.still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.running = !this.still;
    this.replaceChildren(); // drop the no-JS fallback text
    this.classList.add('sim', 'phe');
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

  private slider(name: string, values: number[], value: number, set: (v: number) => void): HTMLElement {
    const label = document.createElement('label');
    label.className = 'sim-slider';
    const span = document.createElement('span');
    span.textContent = name;
    const out = document.createElement('output');
    this.outs.push(out);
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
    return label;
  }

  private build(): void {
    const parts: HTMLElement[] = [];
    if (!this.still) {
      const top = document.createElement('div');
      top.className = 'phe-top';
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
      note.className = 'phe-note';
      note.textContent = 'движение очень сильно замедлено';
      top.append(this.button, note);
      parts.push(top);
    }

    const set = document.createElement('fieldset');
    set.className = 'pfx-chips phe-chips';
    const legend = document.createElement('legend');
    legend.textContent = 'Катод';
    set.append(legend);
    const group = `phe-${Math.random().toString(36).slice(2)}`;
    METALS.forEach(([name], i) => {
      const label = document.createElement('label');
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = group;
      radio.value = String(i);
      radio.checked = i === this.metal;
      radio.addEventListener('change', () => {
        if (!radio.checked) return;
        this.metal = i;
        this.update();
      });
      const span = document.createElement('span');
      span.textContent = name;
      label.append(radio, span);
      set.append(label);
    });

    const svg = el('svg', {
      viewBox: `0 0 ${S.w} ${S.h}`,
      class: 'sim-svg',
      role: 'img',
      'aria-label':
        'Вакуумный фотоэлемент: свет падает справа на катод, выбитые электроны летят к аноду слева, ' +
        'возвращаются в тормозящем поле или уходят в сторону. Ниже график силы тока от напряжения ' +
        'с рабочей точкой, током насыщения и задерживающим напряжением',
    });
    svg.append(...this.staticParts());
    this.signs = el('g');
    this.noEffect = this.label(180, 88, '', 'middle', 'phe-small phe-muted');
    this.curve = el('path', { class: 'phe-curve' });
    this.satLine = el('g');
    this.point = el('g');
    const particles = el('g');
    for (let i = 0; i < SLOTS; i++) {
      const p = el('circle', { class: 'phe-photon', r: 3.5 });
      const e = el('circle', { class: 'phe-electron', r: 3.5 });
      this.photons.push(p);
      this.electrons.push(e);
      particles.append(p, e);
    }
    svg.append(this.signs, particles, this.noEffect, this.satLine, this.curve, this.point);

    const controls = document.createElement('div');
    controls.className = 'sim-controls';
    controls.append(
      this.slider('Длина волны λ', LAMBDAS, this.lam, (v) => (this.lam = v)),
      this.slider('Яркость', BRIGHTS, this.bright, (v) => (this.bright = v)),
      this.slider('Напряжение U', VOLTS10, this.volt10, (v) => (this.volt10 = v)),
    );

    const table = document.createElement('table');
    table.className = 'phe-table';
    this.table = document.createElement('tbody');
    table.append(this.table);
    this.append(...parts, set, svg, controls, table);
  }

  private label(x: number, y: number, text: string, anchor = 'middle', cls = ''): SVGTextElement {
    return el('text', { x: f1(x), y: f1(y), 'text-anchor': anchor, class: `phe-label ${cls}` }, text);
  }

  /** The tube, the electrodes, the wires and the graph's axes: they never change. */
  private staticParts(): SVGElement[] {
    const out: SVGElement[] = [];
    const { anodeX: ax, cathX: kx, plateY0: y0, plateY1: y1 } = S;
    out.push(el('rect', { x: 40, y: S.wallY0 - 8, width: 280, height: S.wallY1 - S.wallY0 + 16, rx: 40, class: 'phe-tube' }));
    out.push(el('rect', { x: ax - 4, y: y0, width: 8, height: y1 - y0, class: 'phe-plate' }));
    out.push(el('rect', { x: kx - 4, y: y0, width: 8, height: y1 - y0, class: 'phe-plate' }));
    out.push(this.label(ax, 160, 'анод', 'middle', 'phe-small'));
    out.push(this.label(kx, 160, 'катод', 'middle', 'phe-small'));
    out.push(this.label(392, 24, 'свет', 'end', 'phe-small phe-accent'));
    // wires to the source and the ammeter under the tube
    const yw = 176;
    out.push(el('path', { d: `M${ax} ${y1}V${yw}H${kx}V${y1}`, class: 'phe-wire' }));
    out.push(el('circle', { cx: 180, cy: yw, r: 10, class: 'phe-meter' }));
    out.push(this.label(180, yw + 5, 'A', 'middle', 'phe-small'));
    // graph axes
    const { gx0, gx1, gOx, gOy, gTop } = S;
    out.push(el('path', { d: `M${gx0} ${gOy}H${gx1}M${gx1 - 8} ${gOy - 4}L${gx1} ${gOy}L${gx1 - 8} ${gOy + 4}`, class: 'phe-axis' }));
    out.push(el('path', { d: `M${gOx} ${gOy + 4}V${gTop - 8}M${gOx - 4} ${gTop}L${gOx} ${gTop - 8}L${gOx + 4} ${gTop}`, class: 'phe-axis' }));
    out.push(this.label(gx1, gOy + 34, 'U, В', 'end', 'phe-small phe-italic'));
    out.push(this.label(gOx + 10, gTop + 2, 'I, мкА', 'start', 'phe-small phe-italic'));
    for (const u of [-4, -2, 2, 4]) {
      out.push(el('path', { d: `M${f1(UX(u))} ${gOy}v5`, class: 'phe-axis' }));
      out.push(this.label(UX(u), gOy + 19, u < 0 ? `${MINUS}${-u}` : String(u), 'middle', 'phe-small'));
    }
    for (const i of [0.4, 0.8, 1.2, 1.6]) {
      out.push(el('path', { d: `M${gOx - 4} ${f1(IY(i))}h4`, class: 'phe-axis' }));
      out.push(this.label(gOx - 7, IY(i) + 4, String(i).replace('.', ','), 'end', 'phe-tiny'));
    }
    out.push(this.label(gOx - 6, gOy + 19, '0', 'end', 'phe-small'));
    return out;
  }

  private start(): void {
    cancelAnimationFrame(this.frame);
    this.last = performance.now();
    const tick = (now: number) => {
      // a hidden tab must not jump; the first frame may be stamped before start()
      const dt = Math.max(0, Math.min((now - this.last) / 1000, 0.1));
      this.last = now;
      this.clock = (this.clock + dt) % 100000;
      this.drawParticles();
      if (this.running && this.visible) this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  private update(): void {
    const [, a] = METALS[this.metal];
    const u = this.volt10 / 10;
    if (this.button) this.button.textContent = this.running ? 'Пауза' : 'Пуск';
    this.outs[0].textContent = `${this.lam}${NBSP}нм`;
    this.outs[1].textContent = String(this.bright);
    this.outs[2].textContent = volts(this.volt10);
    this.table.replaceChildren(
      ...readout(this.lam, this.metal, this.bright, this.volt10).map(([name, value, main]) => {
        const tr = document.createElement('tr');
        if (main) tr.className = 'phe-main';
        const th = document.createElement('th');
        th.scope = 'row';
        th.textContent = name;
        const td = document.createElement('td');
        td.textContent = value;
        tr.append(th, td);
        return tr;
      }),
    );
    // polarity of the electrodes
    const plus = u >= 0;
    this.signs.replaceChildren(
      this.label(S.anodeX - 16, S.plateY0 + 12, u === 0 ? '' : plus ? '+' : MINUS, 'middle', 'phe-sign'),
      this.label(S.cathX + 16, S.plateY0 + 12, u === 0 ? '' : plus ? MINUS : '+', 'middle', 'phe-sign'),
    );
    const on = emits(this.lam, a);
    this.noEffect.textContent = on ? '' : 'hν < A — фотоэффекта нет';
    // the I(U) curve, the saturation current and the operating point
    const uz = stopping(this.lam, a);
    const isat = saturation(this.lam, a, this.bright) * 1e6;
    const pts: string[] = [];
    for (let k = 0; k <= 400; k++) {
      const uu = -5 + k / 40;
      const i = current(this.lam, a, this.bright, uu) * 1e6;
      pts.push(`${pts.length ? 'L' : 'M'}${f1(UX(uu))} ${f1(IY(i))}`);
    }
    this.curve.setAttribute('d', pts.join(''));
    const marks: SVGElement[] = [];
    if (on) {
      marks.push(el('path', { d: `M${S.gOx} ${f1(IY(isat))}H${S.gx1 - 6}`, class: 'phe-guide phe-dash' }));
      marks.push(this.label(S.gx1 - 6, IY(isat) - 6, 'Iн', 'end', 'phe-small phe-italic'));
      if (uz <= 5) {
        const x = UX(-uz);
        marks.push(el('path', { d: `M${f1(x)} ${S.gOy - 6}v12`, class: 'phe-zmark' }));
        marks.push(this.label(x, S.gOy - 12, `${MINUS}Uз`, 'middle', 'phe-small phe-italic phe-accent'));
      }
    }
    this.satLine.replaceChildren(...marks);
    const iNow = current(this.lam, a, this.bright, u) * 1e6;
    const px = UX(u);
    const py = IY(iNow);
    this.point.replaceChildren(
      el('path', { d: `M${f1(px)} ${S.gOy}V${f1(py)}`, class: 'phe-guide' }),
      el('circle', { cx: f1(px), cy: f1(py), r: 5, class: 'phe-point' }),
    );
    this.drawParticles();
  }

  /** Photons and electrons at the current clock. */
  private drawParticles(): void {
    const [, a] = METALS[this.metal];
    const u = this.volt10 / 10;
    const on = emits(this.lam, a);
    const e = Math.max(0, eMax(this.lam, a));
    const uz = stopping(this.lam, a);
    const n = PER_B * this.bright;
    const gap = S.cathX - 4 - (S.anodeX + 4);
    for (let i = 0; i < SLOTS; i++) {
      const p = this.photons[i];
      const q = this.electrons[i];
      const slot = SLOT[i];
      if (i >= n) {
        p.style.display = 'none';
        q.style.display = 'none';
        continue;
      }
      const y = S.plateY0 + 6 + slot.lane * (S.plateY1 - S.plateY0 - 12);
      const tau = ((this.clock / S.cycle + slot.phase) % 1) * S.cycle;
      if (tau < S.flight) {
        const t = tau / S.flight;
        p.style.display = '';
        p.setAttribute('cx', f1(S.lightX + (S.cathX + 6 - S.lightX) * t));
        p.setAttribute('cy', f1(y - 26 * (1 - t)));
        q.style.display = 'none';
        continue;
      }
      p.style.display = 'none';
      const at = on ? electronAt(tau - S.flight, e * (1 - Math.sqrt(slot.r)), u, uz, slot) : null;
      if (!at) {
        q.style.display = 'none';
        continue;
      }
      const ey = Math.min(S.wallY1, Math.max(S.wallY0, y + at[1]));
      q.style.display = '';
      q.setAttribute('cx', f1(S.cathX - 4 - at[0] * gap));
      q.setAttribute('cy', f1(ey));
    }
  }
}

if (!customElements.get('pp-photoeffect')) customElements.define('pp-photoeffect', PhotoeffectSim);
