// <pp-archimedes body="al" rho="1000" s="0"> — a block on a spring balance lowered into a beaker
// of liquid that stands on scales. The block is 10 см tall, 500 см³ (cross-section 50 см²);
// bodies: wood 600, ice 900, aluminium 2700 кг/м³. Sliders: how far the balance is lowered
// (0…15 см, counted from where the block's bottom touches the liquid) and the liquid's density
// (700…1300 кг/м³). While the block goes under, the balance reads mg − F_A and the scales
// P₀ + F_A (the block pushes the liquid down with F_A, third law); once it is fully under both
// stay put. A body lighter than the liquid stops sinking where ${FA} = <i>mg</i>: the thread goes slack
// and the balance reads zero. The beaker is wide, so the level rise is neglected.
//
// Written into theory Markdown as plain HTML; the theory page imports this module only when
// such an element is present. Light DOM, site CSS variables: follows the light/dark theme.
// Colours as in the hydrostatics figures: forces red, liquid accent.

const SVG_NS = 'http://www.w3.org/2000/svg';

const G = 10; // м/с², EGE convention
const V = 5e-4; // м³, the block's volume
const H_CM = 10; // block height, см
const AREA = V / (H_CM / 100); // м², cross-section
const S = { min: 0, max: 15, step: 1 }; // см, how far the balance is lowered
const RHO = { min: 700, max: 1300, step: 50 }; // кг/м³, liquid
const BEAKER_KG = 0.5;
const LIQUID_M3 = 2.5e-3;

export const BODIES = {
  wood: { title: 'дерево', rho: 600 },
  ice: { title: 'лёд', rho: 900 },
  al: { title: 'алюминий', rho: 2700 },
} as const;
export type BodyId = keyof typeof BODIES;

const LIQUIDS: Record<number, string> = { 700: 'бензин', 800: 'керосин', 900: 'масло', 1000: 'вода' };

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Weight of the beaker with the liquid, Н (the scales' reading with nothing in the liquid). */
export function beakerWeight(rhoL: number): number {
  return round2((BEAKER_KG + rhoL * LIQUID_M3) * G);
}

export interface State {
  h: number; // см under the surface (submerged height of the block)
  bottom: number; // см, depth of the block's bottom
  mg: number; // Н
  fa: number; // Н, buoyant force
  t: number; // Н, the balance's reading
  scales: number; // Н
  floats: boolean; // the thread is slack: the block floats on its own
}

/** Everything about the block when the balance is lowered by s см into a liquid of rhoL. */
export function state(rhoB: number, rhoL: number, s: number): State {
  const mg = round2(rhoB * V * G);
  const hEq = (H_CM * rhoB) / rhoL; // where F_A = mg, if that is inside the block
  const floats = rhoB < rhoL && s >= hEq;
  const bottom = floats ? hEq : s;
  const h = Math.min(bottom, H_CM);
  const fa = floats ? mg : round2(rhoL * G * AREA * (h / 100));
  return {
    h: round2(h),
    bottom: round2(bottom),
    mg,
    fa,
    t: round2(Math.max(0, mg - fa)),
    scales: round2(beakerWeight(rhoL) + fa),
    floats,
  };
}

/** Russian decimal comma, trailing zeros dropped: 8,5; 30; 0,0005. */
export function ru(n: number, digits = 2): string {
  const s = (Math.round(n * 10 ** digits) / 10 ** digits).toFixed(digits);
  return (digits ? s.replace(/\.?0+$/, '') : s).replace('.', ',');
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

// Scene, px. 4 px per см of depth; arrows 4 px per Н.
const L = {
  w: 400,
  h: 272,
  post: 44,
  cx: 190,
  surf: 132,
  rim: 108,
  b0: 110,
  b1: 270,
  bottom: 232,
  cm: 4,
  blockW: 40,
  caseH: 40,
  thread: 48, // longer than the slack a floating block can leave (≤ 42 px)
};
const F_PX = 4;

/** Vertical arrow from (x, y) by dy px with a letter beside it; empty if too short. */
function vArrow(x: number, y: number, dy: number, main: string, sub: string, side: 1 | -1): SVGGElement {
  const g = el('g', { class: 'arc-f' });
  const len = Math.abs(dy);
  if (len < 3) return g;
  const s = Math.sign(dy);
  const head = Math.min(8, len * 0.6);
  const y2 = y + dy;
  const t = el('text', { x: x + side * 8, y: (y + dy / 2 + 4).toFixed(1), 'text-anchor': side > 0 ? 'start' : 'end' }, main);
  if (sub) t.append(el('tspan', { class: 'arc-sub', dy: 3 }, sub));
  g.append(
    el('line', { x1: x, y1: y.toFixed(1), x2: x, y2: (y2 - s * head * 0.6).toFixed(1) }),
    el('path', { d: `M${x} ${y2.toFixed(1)}L${x - 4} ${(y2 - s * head).toFixed(1)}L${x + 4} ${(y2 - s * head).toFixed(1)}Z` }),
    t,
  );
  return g;
}

let instances = 0;

class ArchimedesSim extends HTMLElement {
  private body: BodyId = 'al';
  private rho = 1000;
  private s = 0;
  private built = false;
  private liquid!: SVGRectElement;
  private moving!: SVGGElement;
  private arrows!: SVGGElement;
  private scalesText!: SVGTextElement;
  private readout!: HTMLElement;
  private outS!: HTMLOutputElement;
  private outRho!: HTMLOutputElement;

  connectedCallback(): void {
    if (this.built) return;
    this.built = true;
    const b = this.getAttribute('body');
    if (b && b in BODIES) this.body = b as BodyId;
    this.rho = this.attr('rho', 1000, RHO);
    this.s = this.attr('s', 0, S);
    this.replaceChildren(); // drop the no-JS fallback text
    this.classList.add('sim', 'arc');
    this.build();
    this.update();
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
    choice.className = 'pfx-chips arc-bodies';
    const legend = document.createElement('legend');
    legend.textContent = 'Брусок';
    choice.append(legend);
    for (const [key, b] of Object.entries(BODIES) as [BodyId, (typeof BODIES)[BodyId]][]) {
      const label = document.createElement('label');
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = `arc-${id}`;
      radio.value = key;
      radio.checked = key === this.body;
      radio.addEventListener('change', () => {
        this.body = key;
        this.update();
      });
      const span = document.createElement('span');
      span.textContent = `${b.title}, ${b.rho}`;
      label.append(radio, span);
      choice.append(label);
    }

    const svg = el('svg', {
      viewBox: `0 0 ${L.w} ${L.h}`,
      class: 'sim-svg',
      role: 'img',
      'aria-label':
        'Брусок на динамометре опускают в сосуд с жидкостью, сосуд стоит на весах. ' +
        'Стрелки силы тяжести, архимедовой силы и силы натяжения нити',
    });
    const fixed = el('g', { class: 'arc-frame' });
    fixed.append(
      el('line', { x1: L.post, y1: 4, x2: L.post, y2: L.h - 10 }),
      el('line', { x1: L.post - 24, y1: L.h - 10, x2: L.post + 24, y2: L.h - 10 }),
    );
    this.liquid = el('rect', {
      x: L.b0,
      y: L.surf,
      width: L.b1 - L.b0,
      height: L.bottom - L.surf,
      class: 'arc-liquid',
    });
    const surface = el('line', { x1: L.b0, y1: L.surf, x2: L.b1, y2: L.surf, class: 'arc-surface' });
    const beaker = el('path', {
      d: `M${L.b0} ${L.rim}V${L.bottom}H${L.b1}V${L.rim}`,
      class: 'arc-beaker',
    });
    const scales = el('g', { class: 'arc-frame' });
    scales.append(
      el('rect', { x: L.b0 - 14, y: L.bottom, width: L.b1 - L.b0 + 28, height: 6, class: 'arc-box' }),
      el('rect', { x: L.b0 - 4, y: L.bottom + 6, width: L.b1 - L.b0 + 8, height: 22, class: 'arc-box' }),
    );
    this.scalesText = el('text', { x: (L.b0 + L.b1) / 2, y: L.bottom + 21, 'text-anchor': 'middle', class: 'arc-display' });
    this.moving = el('g');
    this.arrows = el('g', { class: 'arc-arrows' });
    svg.append(fixed, this.moving, this.liquid, surface, beaker, scales, this.scalesText, this.arrows);

    const controls = document.createElement('div');
    controls.className = 'sim-controls';
    const [s, outS] = this.slider('Опустить динамометр', S, this.s, (n) => {
      this.s = n;
      this.update();
    });
    const [rho, outRho] = this.slider('Плотность жидкости', RHO, this.rho, (n) => {
      this.rho = n;
      this.update();
    });
    this.outS = outS;
    this.outRho = outRho;
    controls.append(s, rho);

    const legend2 = document.createElement('p');
    legend2.className = 'sim-check arc-legend';
    legend2.innerHTML = '<span class="crt-key crt-key-f"></span> силы, действующие на брусок';

    this.readout = document.createElement('p');
    this.readout.className = 'sim-readout';
    this.readout.setAttribute('aria-live', 'polite');
    this.append(choice, svg, controls, legend2, this.readout);
  }

  private update(): void {
    const rhoB = BODIES[this.body].rho;
    const st = state(rhoB, this.rho, this.s);
    this.outS.textContent = `на ${this.s} см`;
    this.outRho.textContent = `${this.rho} кг/м³${LIQUIDS[this.rho] ? ` (${LIQUIDS[this.rho]})` : ''}`;
    this.draw(st);
    this.readout.innerHTML = this.text(st, rhoB);
  }

  private draw(st: State): void {
    const blockBottom = L.surf + st.bottom * L.cm;
    const blockTop = blockBottom - H_CM * L.cm;
    const hook = L.surf + this.s * L.cm - H_CM * L.cm - L.thread; // where the hand holds it
    const caseTop = hook - L.caseH;
    const x = L.cx;
    const g = el('g', { class: 'arc-frame' });
    // clamp on the post and the balance's case
    g.append(el('line', { x1: L.post, y1: caseTop + 2, x2: x, y2: caseTop + 2 }));
    g.append(el('rect', { x: x - 10, y: caseTop, width: 20, height: L.caseH, rx: 3, class: 'arc-box' }));
    // spring inside the case: longer with a larger reading (0…15 Н over 24 px)
    const end = caseTop + 8 + Math.min(1, st.t / 15) * 24;
    const coils = 6;
    let d = `M${x} ${caseTop + 4}`;
    for (let i = 1; i <= coils * 2; i++) {
      const y = caseTop + 4 + ((end - caseTop - 4) * i) / (coils * 2);
      d += `L${x + (i % 2 ? 5 : -5)} ${y.toFixed(1)}`;
    }
    d += `L${x} ${end.toFixed(1)}`;
    g.append(el('path', { d, class: 'arc-spring' }));
    g.append(el('line', { x1: x - 8, y1: end, x2: x + 8, y2: end, class: 'arc-pointer' }));
    const reading = el('text', { x: x + 15, y: caseTop + 24, class: 'arc-display' }, `${ru(st.t)} Н`);
    g.append(reading);
    // thread: taut, or slack when the block floats
    const slack = L.thread - (blockTop - hook);
    if (st.floats && slack > 1) {
      const bulge = Math.min(22, 4 + slack / 2);
      g.append(
        el('path', {
          d: `M${x} ${hook}Q${x + bulge} ${((hook + blockTop) / 2).toFixed(1)} ${x} ${blockTop.toFixed(1)}`,
          class: 'arc-thread',
        }),
      );
    } else {
      g.append(el('line', { x1: x, y1: hook, x2: x, y2: blockTop, class: 'arc-thread' }));
    }
    g.append(
      el('rect', {
        x: x - L.blockW / 2,
        y: blockTop.toFixed(1),
        width: L.blockW,
        height: H_CM * L.cm,
        rx: 2,
        class: `arc-block arc-block-${this.body}`,
      }),
    );
    this.moving.replaceChildren(g);
    this.scalesText.textContent = `${ru(st.scales)} Н`;

    const cy = (blockTop + blockBottom) / 2;
    this.arrows.replaceChildren(
      vArrow(x - 8, cy, st.mg * F_PX, 'mg', '', -1),
      vArrow(x + 8, cy, -st.fa * F_PX, 'F', 'A', 1),
      vArrow(x, blockTop, -st.t * F_PX, 'T', '', 1),
    );
  }

  private text(st: State, rhoB: number): string {
    const FA = '<i>F</i><sub>A</sub>';
    const fa = `${FA} = <i>ρ</i><sub>ж</sub><i>gV</i><sub>погр</sub> = ${this.rho} · 10 · ${ru((AREA * st.h) / 100, 5)} = ${ru(st.fa)} Н`;
    const p0 = beakerWeight(this.rho);
    const sum = `Сумма показаний ${ru(st.t)} + ${ru(st.scales)} = ${ru(st.t + st.scales)} Н = <i>mg</i> + <i>P</i><sub>0</sub> — не меняется.`;
    if (this.s === 0)
      return `Брусок над жидкостью: динамометр показывает <i>mg</i> = ${ru(st.mg)} Н, весы — <i>P</i><sub>0</sub> = ${ru(p0)} Н. Опусти динамометр.`;
    if (st.floats)
      return (
        `Брусок плавает: <i>ρ</i><sub>т</sub> = ${rhoB} &lt; <i>ρ</i><sub>ж</sub> = ${this.rho}. Он погрузился на ${ru(st.h, 1)} см из ${H_CM}, ` +
        `где ${FA} = <i>mg</i> = ${ru(st.mg)} Н. Нить провисла, динамометр показывает 0, весы — ${ru(p0)} + ${ru(st.fa)} = ${ru(st.scales)} Н.`
      );
    const where =
      st.h < H_CM
        ? `Погружено ${ru(st.h, 1)} см из ${H_CM}: ${fa}.`
        : `Брусок целиком в жидкости: ${fa}. Глубже — не больше.`;
    const balance =
      st.t === 0
        ? `Плотности равны: ${FA} = <i>mg</i>, динамометр показывает 0 — брусок держится в жидкости сам.`
        : `Динамометр: ${ru(st.mg)} − ${ru(st.fa)} = ${ru(st.t)} Н. Весы: ${ru(p0)} + ${ru(st.fa)} = ${ru(st.scales)} Н.`;
    return `${where} ${balance} ${sum}`;
  }
}

if (!customElements.get('pp-archimedes')) customElements.define('pp-archimedes', ArchimedesSim);
