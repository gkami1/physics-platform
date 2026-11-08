// <pp-slab> — a slab of metal or of a dielectric between two charged plates. A button switches
// the field on: in a metal the free electrons (dots) drift against the field and the induced
// «−» and «+» appear on the slab's faces; every field line ends on an induced charge, so inside
// there are none (E = 0). In a dielectric the molecules (dipoles) turn along the field, bound
// charges appear on the faces and only about 1/ε of the lines pass through (E = E₀/ε).
// With the `dielectrics` attribute, chips choose the material (metal, kerosene, ebonite,
// water); `material="…"` sets the start. With reduced motion the change is instant.
//
// Written into theory Markdown as plain HTML; the theory page imports this module only when
// such an element is present. Light DOM, site CSS variables: follows the light/dark theme.
// Colours as in the conductor figures: field lines in the text colour, a metal surface-filled
// with a text outline, a dielectric an accent tint, electrons text-colour dots (moved ones
// accent), induced and bound charges small «+»/«−» in the text colour.

import { rng } from './random';

const SVG_NS = 'http://www.w3.org/2000/svg';
const NBSP = ' ';
const MINUS = '−';

export const MATERIALS = {
  metal: { title: 'металл', name: 'металла', eps: Infinity },
  kerosene: { title: 'керосин', name: 'керосина', eps: 2 },
  ebonite: { title: 'эбонит', name: 'эбонита', eps: 3 },
  water: { title: 'вода', name: 'воды', eps: 81 },
} as const;
export type MaterialId = keyof typeof MATERIALS;

export const LINES = 10;
export const DURATION = 1.6; // s

/** Field inside the slab as a fraction of the outside field E₀: 0 in a metal, 1/ε in a dielectric. */
export function innerFraction(eps: number): number {
  return Number.isFinite(eps) ? 1 / eps : 0;
}

/** How many of n field lines pass through: none in a metal, about n/ε (at least one) in a dielectric. */
export function linesInside(n: number, eps: number): number {
  if (!Number.isFinite(eps)) return 0;
  return Math.min(n, Math.max(1, Math.round(n / eps)));
}

/** Indices of the k lines (of n) that pass through, spread evenly. */
export function passingLines(n: number, k: number): number[] {
  const out: number[] = [];
  for (let j = 0; j < k; j++) out.push(Math.round(((j + 0.5) * n) / k - 0.5));
  return out;
}

/** Progress of the slab's response, 0…1, eased: fast at first, settling at the end. */
export function ease(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return 1 - (1 - x) ** 3;
}

/** A dipole's angle (degrees, 0 = «+» along the field) at progress s: it turns from a0 to a0/ε. */
export function dipoleAngle(a0: number, eps: number, s: number): number {
  const a = ((((a0 + 180) % 360) + 360) % 360) - 180;
  return a * (1 - s * (1 - 1 / eps));
}

/** The line under the model. */
export function readoutText(id: MaterialId, on: boolean, done: boolean): string {
  const m = MATERIALS[id];
  const metal = !Number.isFinite(m.eps);
  if (!on) {
    return metal
      ? 'Поля нет: свободные электроны распределены по металлу равномерно, он не заряжен.'
      : `Поля нет: молекулы ${m.name} повёрнуты как попало.`;
  }
  if (!done) return metal ? 'Электроны смещаются против поля…' : 'Молекулы поворачиваются вдоль поля…';
  if (metal) {
    return (
      `Внутри металла E${NBSP}=${NBSP}0: поле индуцированных зарядов погасило внешнее. ` +
      'Линии поля оканчиваются на индуцированных зарядах.'
    );
  }
  return (
    `Внутри ${m.name} поле в${NBSP}${m.eps}${NBSP}раз${m.eps % 10 >= 2 && m.eps % 10 <= 4 && (m.eps < 10 || m.eps > 20) ? 'а' : ''} ` +
    `слабее внешнего: E${NBSP}=${NBSP}E₀/${m.eps}. Часть линий оканчивается на связанных зарядах.`
  );
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

const L = { w: 400, h: 222, px1: 30, px2: 370, y1: 14, y2: 194, sx1: 150, sx2: 250 };
const lineY = (i: number) => L.y1 + ((L.y2 - L.y1) * (i + 0.5)) / LINES;
const rowY = (j: number) => L.y1 + ((L.y2 - L.y1) * (j + 1)) / LINES; // between the lines

let instances = 0;

interface Electron {
  x: number;
  y: number;
  node: SVGCircleElement;
}

interface Dipole {
  x: number;
  y: number;
  a0: number;
  node: SVGGElement;
}

class SlabSim extends HTMLElement {
  private material: MaterialId = 'metal';
  private on = false;
  private s = 0; // response progress, 0…1
  private frame = 0;
  private built = false;
  private plates!: SVGGElement;
  private field!: SVGGElement;
  private body!: SVGGElement;
  private marks!: SVGGElement;
  private electrons: Electron[] = [];
  private dipoles: Dipole[] = [];
  private button!: HTMLButtonElement;
  private readout!: HTMLElement;
  private caption!: SVGTextElement;

  connectedCallback(): void {
    if (this.built) return;
    this.built = true;
    const m = this.getAttribute('material');
    if (m && m in MATERIALS) this.material = m as MaterialId;
    this.replaceChildren(); // drop the no-JS fallback text
    this.classList.add('sim', 'slb');
    this.build();
    this.rebuildBody();
    this.draw();
  }

  disconnectedCallback(): void {
    cancelAnimationFrame(this.frame);
  }

  private build(): void {
    const id = ++instances;
    if (this.hasAttribute('dielectrics')) {
      const choice = document.createElement('fieldset');
      choice.className = 'pfx-chips slb-chips';
      const legend = document.createElement('legend');
      legend.textContent = 'Пластина';
      choice.append(legend);
      for (const [key, md] of Object.entries(MATERIALS) as [MaterialId, (typeof MATERIALS)[MaterialId]][]) {
        const label = document.createElement('label');
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = `slb-${id}`;
        radio.value = key;
        radio.checked = key === this.material;
        radio.addEventListener('change', () => {
          if (!radio.checked) return;
          this.material = key;
          cancelAnimationFrame(this.frame);
          this.rebuildBody();
          this.s = 0;
          if (this.on) this.run(1);
          else this.draw();
        });
        const span = document.createElement('span');
        span.textContent = Number.isFinite(md.eps) ? `${md.title}, ε${NBSP}=${NBSP}${md.eps}` : md.title;
        label.append(radio, span);
        choice.append(label);
      }
      this.append(choice);
    }
    const svg = el('svg', {
      viewBox: `0 0 ${L.w} ${L.h}`,
      class: 'sim-svg',
      role: 'img',
      'aria-label':
        'Пластина из металла или диэлектрика между двумя заряженными пластинами. ' +
        'Когда поле включено, заряды в пластине смещаются и ослабляют поле внутри неё',
    });
    this.plates = el('g', { class: 'slb-plates' });
    this.field = el('g', { class: 'slb-field' });
    this.body = el('g');
    this.marks = el('g', { class: 'slb-marks' });
    this.caption = el('text', { x: L.w / 2, y: L.h - 8, 'text-anchor': 'middle', class: 'slb-caption' });
    for (const x of [L.px1 - 6, L.px2]) {
      this.plates.append(el('rect', { x, y: L.y1, width: 6, height: L.y2 - L.y1, class: 'slb-plate' }));
    }
    svg.append(this.plates, this.field, this.body, this.marks, this.caption);

    const row = document.createElement('div');
    row.className = 'sim-row';
    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.className = 'btn small';
    this.button.addEventListener('click', () => {
      this.on = !this.on;
      this.run(this.on ? 1 : 0);
    });
    row.append(this.button);
    this.readout = document.createElement('p');
    this.readout.className = 'sim-readout';
    this.readout.setAttribute('aria-live', 'polite');
    this.append(svg, row, this.readout);
  }

  /** The slab and its particles for the current material, relaxed (s = 0). */
  private rebuildBody(): void {
    const metal = !Number.isFinite(MATERIALS[this.material].eps);
    this.body.replaceChildren();
    this.electrons = [];
    this.dipoles = [];
    this.body.append(
      el('rect', {
        x: L.sx1,
        y: L.y1,
        width: L.sx2 - L.sx1,
        height: L.y2 - L.y1,
        rx: 4,
        class: metal ? 'slb-metal' : 'slb-diel',
      }),
    );
    const r = rng(7);
    if (metal) {
      for (let j = 0; j < LINES - 1; j++) {
        for (let i = 0; i < 4; i++) {
          const x = 172 + 19 * i + (r() - 0.5) * 6;
          const y = rowY(j) + (r() - 0.5) * 5;
          const node = el('circle', { cx: x.toFixed(1), cy: y.toFixed(1), r: 2.8, class: 'slb-e' });
          this.body.append(node);
          this.electrons.push({ x, y, node });
        }
      }
    } else {
      for (let j = 0; j < LINES - 1; j++) {
        for (let i = 0; i < 3; i++) {
          const x = 170 + 30 * i;
          const y = rowY(j);
          const node = el('g', { class: 'slb-dip' });
          node.append(
            el('rect', { x: x - 11, y: y - 4.5, width: 22, height: 9, rx: 4.5 }),
            el('text', { x: x + 5.5, y: y + 3.8, 'text-anchor': 'middle' }, '+'),
            el('text', { x: x - 5.5, y: y + 3.8, 'text-anchor': 'middle' }, MINUS),
          );
          this.body.append(node);
          this.dipoles.push({ x, y, a0: r() * 360 - 180, node });
        }
      }
    }
  }

  /** Animate s towards target (0 or 1); instant with reduced motion. */
  private run(target: number): void {
    cancelAnimationFrame(this.frame);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.s = target;
      this.draw();
      return;
    }
    const from = this.s;
    const start = performance.now();
    const tick = (now: number) => {
      const t = (now - start) / 1000 / DURATION;
      this.s = from + (target - from) * ease(t);
      if (t >= 1) this.s = target;
      this.draw();
      if (t < 1) this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  private head(x: number, y: number): SVGPathElement {
    return el('path', { d: `M${x + 5} ${y}L${x - 5} ${y - 4}L${x - 5} ${y + 4}Z` });
  }

  private draw(): void {
    const md = MATERIALS[this.material];
    const metal = !Number.isFinite(md.eps);
    const s = this.s;
    this.button.textContent = this.on ? 'Выключить поле' : 'Включить поле';
    this.readout.textContent = readoutText(this.material, this.on, s === (this.on ? 1 : 0));
    this.caption.textContent = metal ? 'металл' : `${md.title}, ε${NBSP}=${NBSP}${md.eps}`;

    // Plates: signs while the field is on.
    this.plates.querySelectorAll('text').forEach((t) => t.remove());
    if (this.on) {
      for (let k = 0; k < 6; k++) {
        const y = L.y1 + ((L.y2 - L.y1) * (k + 0.5)) / 6 + 5;
        this.plates.append(
          el('text', { x: L.px1 - 16, y, 'text-anchor': 'middle', class: 'slb-sign' }, '+'),
          el('text', { x: L.px2 + 16, y, 'text-anchor': 'middle', class: 'slb-sign' }, MINUS),
        );
      }
    }

    // Field lines: outside the slab always (while on); inside, the ones that end on charges fade out.
    this.field.replaceChildren();
    this.marks.replaceChildren();
    const through = new Set(passingLines(LINES, linesInside(LINES, md.eps)));
    if (this.on) {
      for (let i = 0; i < LINES; i++) {
        const y = lineY(i);
        this.field.append(
          el('path', { d: `M${L.px1} ${y}H${L.sx1}M${L.sx2} ${y}H${L.px2}`, class: 'slb-line' }),
          this.head((L.px1 + L.sx1) / 2, y),
          this.head((L.sx2 + L.px2) / 2, y),
        );
        const fade = through.has(i) ? 1 : 1 - s;
        if (fade > 0.02) {
          this.field.append(el('path', { d: `M${L.sx1} ${y}H${L.sx2}`, class: 'slb-line', opacity: fade.toFixed(2) }));
        }
        if (!through.has(i) && s > 0.02) {
          this.marks.append(
            el('text', { x: L.sx1 + 7, y: y + 5, 'text-anchor': 'middle', opacity: s.toFixed(2) }, MINUS),
            el('text', { x: L.sx2 - 7, y: y + 5, 'text-anchor': 'middle', opacity: s.toFixed(2) }, '+'),
          );
        }
      }
    }

    // Electrons drift up to 10 px against the field; dipoles turn towards it.
    for (const e of this.electrons) {
      e.node.setAttribute('cx', (e.x - 10 * s).toFixed(1));
      e.node.classList.toggle('slb-moved', s > 0.02);
    }
    for (const d of this.dipoles) {
      d.node.setAttribute('transform', `rotate(${dipoleAngle(d.a0, md.eps, s).toFixed(1)} ${d.x} ${d.y})`);
    }
  }
}

if (!customElements.get('pp-slab')) customElements.define('pp-slab', SlabSim);
