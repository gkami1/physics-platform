// <pp-work f="30" angle="30" s="6" mu="0.2"> — the work of each force on a box pulled along a
// floor by a rope at angle α. The box has a fixed mass of 5 кг (mg = 50 Н); the pull is at most
// 50 Н, so it never lifts the box off the floor. N = mg − F sin α and sliding friction μN
// (lesson 6.5). The box moves only if F cos α beats friction. Bars show the signed work of the
// pull, friction, gravity and the normal force, and their sum: gravity and N are perpendicular
// to the displacement and stay at zero. «Пуск» drags the box by s and the bars grow with it.
//
// Written into theory Markdown as plain HTML; the theory page imports this module only when
// such an element is present. Light DOM, site CSS variables: follows the light/dark theme.
// Colours as in the work-power figures: forces red, displacement in the text colour, work
// accent (like the areas under F(x)).

const SVG_NS = 'http://www.w3.org/2000/svg';

const G = 10; // м/с², EGE convention
export const MASS = 5; // кг
const F = { min: 0, max: 50, step: 5 }; // Н
const ANGLE = { min: 0, max: 90, step: 10 }; // градусы
const S = { min: 1, max: 8, step: 1 }; // м
const MU = { min: 0, max: 0.5, step: 0.05 };

const L = { w: 400, h: 322, floorY: 112, boxW: 44, boxH: 30, start: 60, pxM: 28, sY: 186 };
const F_PX = 1.4; // px per Н
const B = { zero: 230, half: 110, top: 226, row: 17 };

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Russian number: decimal comma, real minus, up to `digits` decimals, trailing zeros dropped. */
export function ru(n: number, digits = 1): string {
  const r = Math.round(n * 10 ** digits) / 10 ** digits;
  const s = (Object.is(r, -0) ? 0 : r).toFixed(digits);
  return (digits ? s.replace(/\.?0+$/, '') : s).replace('.', ',').replace('-', '−');
}

export interface Works {
  moves: boolean;
  n: number; // normal force, Н
  fr: number; // friction while sliding (μN), or the static friction F cos α if the box stands
  aF: number; // Дж
  aFr: number;
  aMg: number;
  aN: number;
  total: number;
}

/** Works of all four forces when the box is dragged by s metres (zero if it cannot move). */
export function works(f: number, angleDeg: number, s: number, mu: number): Works {
  const a = (angleDeg * Math.PI) / 180;
  const along = round3(f * Math.cos(a));
  const n = round3(Math.max(0, MASS * G - f * Math.sin(a)));
  const slide = round3(mu * n);
  const moves = along > slide && along > 0;
  if (!moves) return { moves, n, fr: along, aF: 0, aFr: 0, aMg: 0, aN: 0, total: 0 };
  const aF = round3(along * s);
  const aFr = round3(-slide * s);
  return { moves, n, fr: slide, aF, aFr, aMg: 0, aN: 0, total: round3(aF + aFr) };
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

/** A letter with an optional upright subscript. */
function letter(x: number, y: number, main: string, sub = '', anchor = 'middle'): SVGTextElement {
  const t = el('text', { x: x.toFixed(1), y: y.toFixed(1), 'text-anchor': anchor }, main);
  if (sub) t.append(el('tspan', { class: 'wrk-sub', dy: 3 }, sub));
  return t;
}

/** Arrow from (x1, y1) to (x2, y2); empty if too short to see. */
function arrow(x1: number, y1: number, x2: number, y2: number, dashed = false): SVGGElement {
  const g = el('g');
  const len = Math.hypot(x2 - x1, y2 - y1);
  if (len < 3) return g;
  const ux = (x2 - x1) / len;
  const uy = (y2 - y1) / len;
  const head = Math.min(8, len * 0.6);
  const bx = x2 - ux * head;
  const by = y2 - uy * head;
  g.append(
    el('line', {
      x1: x1.toFixed(1),
      y1: y1.toFixed(1),
      x2: (x2 - ux * head * 0.6).toFixed(1),
      y2: (y2 - uy * head * 0.6).toFixed(1),
      ...(dashed ? { class: 'wrk-dash' } : {}),
    }),
    el('path', {
      d: `M${x2.toFixed(1)} ${y2.toFixed(1)}L${(bx - uy * 4).toFixed(1)} ${(by + ux * 4).toFixed(1)}L${(bx + uy * 4).toFixed(1)} ${(by - ux * 4).toFixed(1)}Z`,
    }),
  );
  return g;
}

class WorkSim extends HTMLElement {
  private f = 30;
  private angle = 30;
  private s = 6;
  private mu = 0.2;
  private frame = 0;
  private built = false;
  private box!: SVGGElement;
  private ghost!: SVGRectElement;
  private forces!: SVGGElement;
  private disp!: SVGGElement;
  private bars!: SVGGElement;
  private readout!: HTMLElement;
  private outs: Record<'f' | 'angle' | 's' | 'mu', HTMLOutputElement> = {} as never;

  connectedCallback(): void {
    if (this.built) return;
    this.built = true;
    this.f = this.attr('f', 30, F);
    this.angle = this.attr('angle', 30, ANGLE);
    this.s = this.attr('s', 6, S);
    this.mu = this.attr('mu', 0.2, MU);
    this.replaceChildren(); // drop the no-JS fallback text
    this.classList.add('sim', 'wrk');
    this.build();
    this.reset();
  }

  disconnectedCallback(): void {
    cancelAnimationFrame(this.frame);
  }

  private attr(name: string, fallback: number, r: { min: number; max: number; step: number }) {
    const n = Number(this.getAttribute(name) ?? fallback);
    if (!Number.isFinite(n)) return fallback;
    return round3(Math.min(r.max, Math.max(r.min, Math.round(n / r.step) * r.step)));
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
    input.addEventListener('input', () => onInput(round3(Number(input.value))));
    label.append(name, out, input);
    return [label, out];
  }

  private build(): void {
    const svg = el('svg', {
      viewBox: `0 0 ${L.w} ${L.h}`,
      class: 'sim-svg',
      role: 'img',
      'aria-label':
        'Ящик на полу тянут за верёвку под углом альфа. Стрелки силы тяги, трения, силы тяжести ' +
        'и реакции опоры, под полом перемещение. Ниже — работа каждой силы и их сумма',
    });
    const floor = el('g', { class: 'wrk-floor' });
    floor.append(el('line', { x1: 10, x2: L.w - 10, y1: L.floorY, y2: L.floorY }));
    for (let x = 14; x < L.w - 10; x += 9) {
      floor.append(el('line', { x1: x, y1: L.floorY, x2: x - 5, y2: L.floorY + 7, class: 'wrk-hatch' }));
    }
    this.ghost = el('rect', { y: L.floorY - L.boxH, width: L.boxW, height: L.boxH, rx: 2, class: 'wrk-ghost' });
    this.box = el('g');
    this.box.append(
      el('rect', { x: -L.boxW / 2, y: -L.boxH, width: L.boxW, height: L.boxH, rx: 2, class: 'wrk-body' }),
      el('text', { x: -9, y: -11, 'text-anchor': 'middle', class: 'wrk-mass' }, `${MASS} кг`),
    );
    this.forces = el('g', { class: 'wrk-f' });
    this.disp = el('g', { class: 'wrk-s' });
    this.bars = el('g', { class: 'wrk-bars' });
    svg.append(floor, this.ghost, this.disp, this.box, this.forces, this.bars);

    const controls = document.createElement('div');
    controls.className = 'sim-controls';
    const add = (key: 'f' | 'angle' | 's' | 'mu', title: string, r: typeof F) => {
      const [label, out] = this.slider(title, r, this[key], (n) => {
        this[key] = n;
        this.reset();
      });
      this.outs[key] = out;
      controls.append(label);
    };
    add('f', 'Сила тяги F', F);
    add('angle', 'Угол α к горизонту', ANGLE);
    add('s', 'Тянем на расстояние', S);
    add('mu', 'Коэффициент трения μ', MU);

    const row = document.createElement('div');
    row.className = 'sim-row';
    const go = document.createElement('button');
    go.type = 'button';
    go.className = 'btn small';
    go.textContent = 'Пуск';
    go.addEventListener('click', () => this.run());
    const key = document.createElement('span');
    key.className = 'sim-check';
    key.innerHTML =
      '<span class="crt-key crt-key-f"></span> силы · ' +
      '<span class="crt-key wrk-key-s"></span> перемещение · ' +
      '<span class="crt-key crt-key-a"></span> работа';
    row.append(go, key);

    this.readout = document.createElement('p');
    this.readout.className = 'sim-readout';
    this.readout.setAttribute('aria-live', 'polite');
    this.append(svg, controls, row, this.readout);
  }

  private reset(): void {
    cancelAnimationFrame(this.frame);
    this.outs.f.textContent = `${ru(this.f)} Н`;
    this.outs.angle.textContent = `${ru(this.angle)}°`;
    this.outs.s.textContent = `${ru(this.s)} м`;
    this.outs.mu.textContent = ru(this.mu, 2);
    const w = works(this.f, this.angle, this.s, this.mu);
    this.ghost.style.display = w.moves ? '' : 'none';
    this.ghost.setAttribute('x', (this.xAt(this.s) - L.boxW / 2).toFixed(1));
    this.place(0);
    this.drawBars(1);
    this.readout.innerHTML = this.hint(w);
  }

  private xAt(dist: number): number {
    return L.start + dist * L.pxM;
  }

  private hint(w: Works): string {
    const fs = `${ru(this.f)} · sin ${ru(this.angle)}°`;
    const nText = `<i>N</i> = <i>mg</i> − <i>F</i> sin α = 50 − ${fs} = ${ru(w.n)} Н`;
    if (!w.moves) {
      const along =
        this.f === 0
          ? 'Ящик никто не тянет.'
          : w.fr === 0
            ? 'Верёвка тянет прямо вверх: вдоль пола сила не тянет совсем, cos 90° = 0 — ящик стоит.'
            : `<i>F</i> cos α = ${ru(w.fr)} Н не больше трения покоя μ<i>N</i> = ${ru(this.mu * w.n)} Н — ящик стоит.`;
      return `${along} Перемещения нет, поэтому ни одна сила не совершает работы: все столбики — ноль.`;
    }
    return (
      `<i>A<sub>F</sub></i> = <i>Fs</i> cos α = ${ru(this.f)} · ${ru(this.s)} · cos ${ru(this.angle)}° = ${ru(w.aF)} Дж. ` +
      `${nText}, <i>F</i><sub>тр</sub> = μ<i>N</i> = ${ru(w.fr, 2)} Н, <i>A</i><sub>тр</sub> = ${ru(w.aFr)} Дж. ` +
      `Сила тяжести и реакция опоры перпендикулярны перемещению: их работа 0. ` +
      `Сумма ${ru(w.total)} Дж. Нажми «Пуск».`
    );
  }

  private run(): void {
    cancelAnimationFrame(this.frame);
    const w = works(this.f, this.angle, this.s, this.mu);
    if (!w.moves) {
      this.reset();
      return;
    }
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      this.finish(w);
      return;
    }
    const T = 1.2 + 0.15 * this.s;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(T, (now - start) / 1000);
      const q = (t / T) ** 2; // a constant net force: distance grows as t²
      this.place(q);
      this.drawBars(q);
      this.readout.textContent = `Пройдено ${ru(q * this.s)} м из ${ru(this.s)} м · сумма работ ${ru(q * w.total)} Дж`;
      if (t >= T) {
        this.finish(w);
        return;
      }
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  private finish(w: Works): void {
    this.place(1);
    this.drawBars(1);
    this.readout.innerHTML =
      `Ящик проехал ${ru(this.s)} м. Тяга совершила ${ru(w.aF)} Дж, трение ${ru(w.aFr)} Дж, ` +
      `сила тяжести и реакция опоры — по 0. Сумма ${ru(w.total)} Дж — это работа равнодействующей.`;
  }

  /** Box at fraction q of the full distance (0 at the start), with forces and displacement. */
  private place(q: number): void {
    const w = works(this.f, this.angle, this.s, this.mu);
    const dist = w.moves ? q * this.s : 0;
    const cx = this.xAt(dist);
    const cy = L.floorY - L.boxH / 2;
    this.box.setAttribute('transform', `translate(${cx.toFixed(1)} ${L.floorY})`);

    const a = (this.angle * Math.PI) / 180;
    const ox = cx + L.boxW / 2;
    const fx = this.f * F_PX * Math.cos(a);
    const fy = this.f * F_PX * Math.sin(a);
    const g = this.forces;
    g.replaceChildren();
    if (this.f > 0) {
      if (this.angle > 0 && this.angle < 90) {
        g.append(
          arrow(ox, cy, ox + fx, cy, true),
          arrow(ox + fx, cy, ox + fx, cy - fy, true),
          el('path', {
            class: 'wrk-arc',
            d: `M${ox + 18} ${cy}A18 18 0 0 0 ${(ox + 18 * Math.cos(a)).toFixed(1)} ${(cy - 18 * Math.sin(a)).toFixed(1)}`,
          }),
          letter(ox + 26 * Math.cos(a / 2) + 4, cy - 26 * Math.sin(a / 2) + 4, 'α'),
        );
      }
      g.append(arrow(ox, cy, ox + fx, cy - fy), letter(ox + fx + 10 * Math.cos(a) + 2, cy - fy - 10 * Math.sin(a) + 4, 'F'));
    }
    const mg = MASS * G * F_PX;
    g.append(arrow(cx + 8, cy, cx + 8, cy + mg), letter(cx + 12, cy + mg + 2, 'mg', '', 'start'));
    if (w.n > 0) g.append(arrow(cx + 8, cy, cx + 8, cy - w.n * F_PX), letter(cx + 4, cy - w.n * F_PX + 6, 'N', '', 'end'));
    const fr = w.fr * F_PX;
    if (fr >= 3) {
      const fy0 = L.floorY - 4;
      g.append(arrow(cx - L.boxW / 2, fy0, cx - L.boxW / 2 - fr, fy0), letter(cx - L.boxW / 2 - fr - 4, fy0 - 7, 'F', 'тр', 'end'));
    }

    this.disp.replaceChildren();
    if (dist > 0) {
      const x0 = this.xAt(0);
      this.disp.append(
        el('line', { x1: x0, x2: x0, y1: L.sY - 6, y2: L.sY + 6, class: 'wrk-tick' }),
        arrow(x0, L.sY, cx, L.sY),
      );
      if (cx - x0 > 20) this.disp.append(letter((x0 + cx) / 2, L.sY + 16, 's'));
    }
  }

  /** Work bars at fraction q of the full distance. */
  private drawBars(q: number): void {
    const w = works(this.f, this.angle, this.s, this.mu);
    const rows: [string, number][] = [
      ['F', w.aF],
      ['тр', w.aFr],
      ['mg', w.aMg],
      ['N', w.aN],
      ['', w.total],
    ];
    const scale = B.half / Math.max(50, Math.abs(w.aF), Math.abs(w.aFr));
    const g = this.bars;
    g.replaceChildren();
    g.append(el('text', { x: L.w - 4, y: B.top - 4, 'text-anchor': 'end', class: 'wrk-group' }, 'работа, Дж'));
    rows.forEach(([sub, full], i) => {
      const y = B.top + i * B.row + (i === 4 ? 4 : 0);
      const cy = y + B.row / 2;
      const name = sub ? letter(16, cy + 4, 'A', sub, 'start') : el('text', { x: 16, y: cy + 4 }, 'сумма');
      name.setAttribute('class', i === 4 ? 'wrk-name wrk-total' : 'wrk-name');
      const v = round3(full * q);
      const bw = v * scale;
      g.append(
        name,
        el('rect', {
          x: (bw >= 0 ? B.zero : B.zero + bw).toFixed(1),
          y: y + 3,
          width: Math.max(Math.abs(bw), 0.01).toFixed(1),
          height: B.row - 6,
          class: i === 4 ? 'wrk-bar wrk-total' : 'wrk-bar',
        }),
        el(
          'text',
          {
            x: (bw >= 0 ? B.zero + bw + 4 : B.zero + bw - 4).toFixed(1),
            y: cy + 4,
            'text-anchor': bw >= 0 ? 'start' : 'end',
            class: 'wrk-value',
          },
          ru(v),
        ),
      );
    });
    g.append(el('line', { x1: B.zero, x2: B.zero, y1: B.top, y2: B.top + 5 * B.row + 4, class: 'wrk-zero' }));
  }
}

if (!customElements.get('pp-work')) customElements.define('pp-work', WorkSim);
