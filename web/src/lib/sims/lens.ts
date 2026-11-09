// <pp-lens> — the image in a thin lens. Chips pick a converging or a diverging lens; sliders set the
// distance to the object d (2…60 см) and the focal length |F| (5…25 см); the object can also be
// dragged along the axis. Three standard rays from the object's tip (parallel to the axis, through
// the optical centre, through or towards the front focus) are computed from the lens equation
// 1/F = 1/d + 1/f (F < 0 for a diverging lens, f < 0 for a virtual image), so they meet exactly at
// the image's tip — the rays themselves for a real image, their continuations for a virtual one.
// The table gives d, f, F, D = 1/F, Γ = |f|/d and the kind of image; with d = F the rays leave
// parallel and there is no image.
//
// The picture follows the optics convention of the figures (lessons 14.x–15.x): rays accent with an
// arrowhead in the middle, continuations and a virtual image muted dashed, the principal axis a muted
// dash-dot line, the lens a text-colour line with open arrowheads outward (converging) or inward
// (diverging), the foci text-colour dots, the object and a real image text-colour arrows.
//
// Nothing moves on its own, so reduced motion changes nothing: the default state (converging,
// F = 16 см, d = 40 см) already shows all three rays and a real image. Its readout (f ≈ 26,7 см,
// D = 6,25 дптр, Γ ≈ 0,67) avoids the answers and intermediates of the topic's step tasks.
//
// Written into theory Markdown as plain HTML; the theory page imports this module only when such an
// element is present. Light DOM, site CSS variables: follows the light/dark theme.

const SVG_NS = 'http://www.w3.org/2000/svg';
const NBSP = '\u00a0';

export const START = { conv: true, d: 40, focal: 16 };
export const D_MIN = 2;
export const D_MAX = 60;
export const F_MIN = 5;
export const F_MAX = 25;

/** Signed image distance f (см) for an object at d with signed focal length F, or null when d = F. */
export function imageDistance(d: number, F: number): number | null {
  if (Math.abs(d - F) < 1e-12) return null;
  return (d * F) / (d - F);
}

/** A number with a decimal comma, rounded to `digits` decimals, with «≈» when rounding changed it. */
export function num(x: number, digits = 2): string {
  const r = Number(x.toFixed(digits));
  const text = String(Math.abs(r) < 1e-12 ? 0 : r).replace('.', ',').replace('-', '−');
  return Math.abs(r - x) > 1e-9 ? `≈${NBSP}${text}` : text;
}

/** The kind of image, in words. */
export function kind(d: number, F: number): string {
  const f = imageDistance(d, F);
  if (f === null) return 'нет: лучи после линзы идут параллельно';
  const g = Math.abs(f) / d;
  const size = Math.abs(g - 1) < 1e-9 ? 'равное' : g > 1 ? 'увеличенное' : 'уменьшенное';
  return f > 0 ? `действительное, перевёрнутое, ${size}` : `мнимое, прямое, ${size}`;
}

/** The readout rows: d, f, F, D, Γ and the kind of image. */
export function readout(d: number, F: number): string[] {
  const f = imageDistance(d, F);
  const cm = (x: number, digits = 1): string => `${num(x, digits)}${NBSP}см`;
  return [
    cm(d, 0),
    f === null ? 'нет: бесконечность' : cm(f),
    cm(F, 0),
    `${num(100 / F)}${NBSP}дптр`,
    f === null ? '—' : num(Math.abs(f) / d),
    kind(d, F),
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

/** The scene: the lens at x = lx, the axis at y = ay, k px per centimetre, the object h px tall. */
const S = { w: 480, h: 280, lx: 240, ay: 140, k: 3.6, obj: 44, half: 112 };

type Pt = [number, number];

let instances = 0;

class LensSim extends HTMLElement {
  private conv = START.conv;
  private dist = START.d;
  private focal = START.focal;
  private built = false;
  private scene!: SVGGElement;
  private svgEl!: SVGSVGElement;
  private dOut!: HTMLOutputElement;
  private fOut!: HTMLOutputElement;
  private dInput!: HTMLInputElement;
  private cells: HTMLTableCellElement[] = [];
  private dragging = false;

  connectedCallback(): void {
    if (this.built) return;
    this.built = true;
    this.replaceChildren(); // drop the no-JS fallback text
    this.classList.add('sim', 'lns');
    this.build();
    this.update();
  }

  disconnectedCallback(): void {
    this.built = false;
  }

  private slider(name: string, min: number, max: number, value: number, set: (v: number) => void): [HTMLLabelElement, HTMLOutputElement, HTMLInputElement] {
    const label = document.createElement('label');
    label.className = 'sim-slider';
    const span = document.createElement('span');
    span.textContent = name;
    const out = document.createElement('output');
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = '1';
    input.value = String(value);
    input.addEventListener('input', () => {
      set(Number(input.value));
      this.update();
    });
    label.append(span, out, input);
    return [label, out, input];
  }

  private build(): void {
    const id = ++instances;
    const chips = document.createElement('fieldset');
    chips.className = 'pfx-chips lns-chips';
    const lg = document.createElement('legend');
    lg.textContent = 'Линза';
    chips.append(lg);
    for (const [conv, name] of [[true, 'собирающая'], [false, 'рассеивающая']] as const) {
      const label = document.createElement('label');
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = `lns-kind-${id}`;
      radio.value = conv ? 'conv' : 'div';
      radio.checked = conv === this.conv;
      radio.addEventListener('change', () => {
        if (!radio.checked) return;
        this.conv = conv;
        this.update();
      });
      const span = document.createElement('span');
      span.textContent = name;
      label.append(radio, span);
      chips.append(label);
    }

    this.svgEl = el('svg', {
      viewBox: `0 0 ${S.w} ${S.h}`,
      class: 'sim-svg lns-svg',
      role: 'img',
      'aria-label':
        'Линза на главной оптической оси, слева предмет-стрелка. Три луча от верхушки предмета: параллельный ' +
        'оси, через оптический центр и через фокус. Там, где сходятся лучи или их продолжения, — изображение. ' +
        'Предмет можно перетаскивать вдоль оси',
    });
    this.scene = el('g');
    this.svgEl.append(this.scene);
    this.svgEl.addEventListener('pointerdown', (ev) => {
      this.dragging = true;
      this.svgEl.setPointerCapture(ev.pointerId);
      this.dragTo(ev);
    });
    this.svgEl.addEventListener('pointermove', (ev) => {
      if (this.dragging) this.dragTo(ev);
    });
    const stop = (): void => {
      this.dragging = false;
    };
    this.svgEl.addEventListener('pointerup', stop);
    this.svgEl.addEventListener('pointercancel', stop);

    const controls = document.createElement('div');
    controls.className = 'sim-controls';
    const [dLabel, dOut, dInput] = this.slider('Расстояние до предмета d', D_MIN, D_MAX, this.dist, (v) => (this.dist = v));
    const [fLabel, fOut] = this.slider('Фокусное расстояние |F|', F_MIN, F_MAX, this.focal, (v) => (this.focal = v));
    this.dOut = dOut;
    this.fOut = fOut;
    this.dInput = dInput;
    controls.append(dLabel, fLabel);

    const table = document.createElement('table');
    table.className = 'lns-table';
    const body = document.createElement('tbody');
    ['Расстояние до предмета d', 'Расстояние до изображения f', 'Фокусное расстояние F', 'Оптическая сила D', 'Увеличение Γ', 'Изображение'].forEach((name, i) => {
      const tr = document.createElement('tr');
      if (i === 5) tr.className = 'lns-main';
      const th = document.createElement('th');
      th.scope = 'row';
      th.textContent = name;
      const td = document.createElement('td');
      tr.append(th, td);
      body.append(tr);
      this.cells.push(td);
    });
    table.append(body);
    this.append(chips, this.svgEl, controls, table);
  }

  /** Move the object to the pointer's x (only to the left of the lens). */
  private dragTo(ev: PointerEvent): void {
    const box = this.svgEl.getBoundingClientRect();
    if (box.width === 0) return;
    const x = ((ev.clientX - box.left) / box.width) * S.w;
    const d = Math.round((S.lx - x) / S.k);
    const next = Math.min(D_MAX, Math.max(D_MIN, d));
    if (next === this.dist) return;
    this.dist = next;
    this.dInput.value = String(next);
    this.update();
  }

  private update(): void {
    const F = this.conv ? this.focal : -this.focal;
    this.dOut.textContent = `${this.dist}${NBSP}см`;
    this.fOut.textContent = `${this.focal}${NBSP}см`;
    readout(this.dist, F).forEach((v, i) => (this.cells[i].textContent = v));
    this.draw(F);
  }

  /** World (px from the lens centre, y up) → screen. */
  private s([x, y]: Pt): Pt {
    return [S.lx + x, S.ay - y];
  }

  /** A ray a→b (world) with an arrowhead at the fraction `at` of its length. */
  private ray(a: Pt, b: Pt, at = 0.5): SVGElement[] {
    const [x1, y1] = this.s(a);
    const [x2, y2] = this.s(b);
    const n = Math.hypot(x2 - x1, y2 - y1) || 1;
    const ux = (x2 - x1) / n;
    const uy = (y2 - y1) / n;
    const mx = x1 + (x2 - x1) * at;
    const my = y1 + (y2 - y1) * at;
    const tip = [mx + ux * 6, my + uy * 6];
    const bx = mx - ux * 4;
    const by = my - uy * 4;
    const out: SVGElement[] = [el('path', { d: `M${f1(x1)} ${f1(y1)}L${f1(x2)} ${f1(y2)}`, class: 'lns-ray' })];
    if (n > 30) {
      out.push(
        el('path', {
          d: `M${f1(tip[0])} ${f1(tip[1])}L${f1(bx - uy * 4.5)} ${f1(by + ux * 4.5)}L${f1(bx + uy * 4.5)} ${f1(by - ux * 4.5)}Z`,
          class: 'lns-head',
        }),
      );
    }
    return out;
  }

  private dashed(a: Pt, b: Pt): SVGElement {
    const [x1, y1] = this.s(a);
    const [x2, y2] = this.s(b);
    return el('path', { d: `M${f1(x1)} ${f1(y1)}L${f1(x2)} ${f1(y2)}`, class: 'lns-cont' });
  }

  /** Walk from p along direction v until the scene's edge (world coordinates). */
  private toEdge(p: Pt, v: Pt): Pt {
    const xmax = S.w - S.lx + 2;
    const ymax = S.ay + 2;
    const ymin = -(S.h - S.ay) - 2;
    const ts: number[] = [];
    if (v[0] > 0) ts.push((xmax - p[0]) / v[0]);
    if (v[1] > 0) ts.push((ymax - p[1]) / v[1]);
    if (v[1] < 0) ts.push((ymin - p[1]) / v[1]);
    const t = Math.min(...ts.filter((x) => x > 0));
    return [p[0] + v[0] * t, p[1] + v[1] * t];
  }

  private label(x: number, y: number, text: string, cls = 'lns-label', anchor = 'middle'): SVGElement {
    const t = el('text', { x: f1(x), y: f1(y), 'text-anchor': anchor, class: cls });
    const m = /^(2?)([A-Za-z])$/.exec(text);
    if (m) {
      if (m[1]) t.append(el('tspan', {}, m[1]));
      t.append(el('tspan', { 'font-style': 'italic' }, m[2]));
    } else {
      t.textContent = text;
    }
    return t;
  }

  private draw(F: number): void {
    const { w, lx, ay, k, obj, half } = S;
    const d = this.dist * k;
    const Fp = F * k;
    const h = obj;
    const parts: SVGElement[] = [];
    // the principal axis
    parts.push(el('path', { d: `M6 ${ay}H${w - 6}`, class: 'lns-axis' }));
    // the lens
    const kk = this.conv ? 1 : -1;
    const top = ay - half;
    const bot = ay + half;
    parts.push(el('path', { d: `M${lx} ${top}V${bot}`, class: 'lns-lens' }));
    parts.push(el('path', { d: `M${lx - 7} ${top + 9 * kk}L${lx} ${top}L${lx + 7} ${top + 9 * kk}`, class: 'lns-lens' }));
    parts.push(el('path', { d: `M${lx - 7} ${bot - 9 * kk}L${lx} ${bot}L${lx + 7} ${bot - 9 * kk}`, class: 'lns-lens' }));
    // foci and double foci
    const a = Math.abs(Fp);
    for (const m of [-2, -1, 1, 2]) {
      const x = lx + m * a;
      if (x < 4 || x > w - 4) continue;
      parts.push(el('circle', { cx: f1(x), cy: ay, r: 3, class: 'lns-dot' }));
      parts.push(this.label(x, ay + 20, Math.abs(m) === 1 ? 'F' : '2F'));
    }
    parts.push(this.label(lx - 10, ay + 20, 'O'));

    const P: Pt = [-d, h];
    const fImg = imageDistance(d, Fp);
    const img: Pt | null = fImg === null ? null : [fImg, (-h * fImg) / d];
    const hits: Pt[] = [[0, h], [0, 0]];
    const y3 = (-h * Fp) / (d - Fp);
    if (fImg !== null && Math.abs(y3) <= half - 4) hits.push([0, y3]);
    for (const L of hits) {
      parts.push(...this.ray(P, L, 0.5));
      let v: Pt;
      if (img === null) v = [d, -h]; // d = F: every ray leaves parallel to the one through O
      else if (img[0] > 0) v = [img[0] - L[0], img[1] - L[1]];
      else v = [L[0] - img[0], L[1] - img[1]];
      const end = this.toEdge(L, v);
      parts.push(...this.ray(L, end, img !== null && img[0] > 0 ? 0.3 : 0.5));
      if (img !== null && img[0] < 0) parts.push(this.dashed(L, img));
    }
    // the object
    const [ox, oyTop] = this.s(P);
    parts.push(el('path', { d: `M${f1(ox)} ${ay}V${f1(oyTop + 2)}`, class: 'lns-obj' }));
    parts.push(el('path', { d: `M${f1(ox - 6)} ${f1(oyTop + 10)}L${f1(ox)} ${f1(oyTop)}L${f1(ox + 6)} ${f1(oyTop + 10)}Z`, class: 'lns-objhead' }));
    parts.push(el('rect', { x: f1(ox - 14), y: f1(oyTop - 8), width: 28, height: h + 12, class: 'lns-grab' }));
    // the image
    let note = '';
    if (img === null) {
      note = 'лучи идут параллельно: изображения нет';
    } else {
      const [ix, iy] = this.s(img);
      const inside = ix > 4 && ix < w - 4 && iy > 4 && iy < S.h - 4;
      const real = img[0] > 0;
      const dir = iy < ay ? 1 : -1; // tip above the axis: the head points up
      parts.push(el('path', { d: `M${f1(ix)} ${ay}V${f1(iy + 2 * dir)}`, class: real ? 'lns-obj' : 'lns-virt' }));
      if (inside) {
        parts.push(
          el('path', {
            d: `M${f1(ix - 6)} ${f1(iy + 10 * dir)}L${f1(ix)} ${f1(iy)}L${f1(ix + 6)} ${f1(iy + 10 * dir)}${real ? 'Z' : ''}`,
            class: real ? 'lns-objhead' : 'lns-virt',
          }),
        );
      } else {
        note = 'изображение за краем рисунка';
      }
    }
    if (note) parts.push(this.label(12, 22, note, 'lns-label lns-small', 'start'));
    this.scene.replaceChildren(...parts);
  }
}

if (!customElements.get('pp-lens')) customElements.define('pp-lens', LensSim);
