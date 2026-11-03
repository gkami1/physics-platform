// <pp-path track="stadium"> — path vs displacement: pick a route, scrub or play along it, and
// watch the path counter only grow while the displacement arrow (start → body) can shrink,
// even to zero after a lap of the stadium.
//
// Written into theory Markdown as plain HTML; the theory page imports this module only when
// such an element is present. Light DOM, site CSS variables: follows the light/dark theme.

const SVG_NS = 'http://www.w3.org/2000/svg';
const VIEW = { w: 400, h: 230 };

type Pt = [number, number];

interface Track {
  id: string;
  title: string;
  /** Points in viewBox units, sampled densely enough to look smooth. */
  points: Pt[];
  /** Metres per viewBox unit, so readouts come out in round numbers. */
  scale: number;
}

function arc(cx: number, cy: number, r: number, from: number, to: number, n = 48): Pt[] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = from + ((to - from) * i) / n;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as Pt;
  });
}

// A 400 m stadium: straights of 74,3 м and bends of radius 40 м, drawn at 2 units per metre,
// starting at the middle of the bottom straight and going anticlockwise.
function stadium(): Pt[] {
  const r = 80;
  const half = 74.3; // half a straight on screen: 37,15 м
  const cx = VIEW.w / 2;
  const cy = 112;
  return [
    [cx, cy + r],
    [cx + half, cy + r],
    ...arc(cx + half, cy, r, Math.PI / 2, -Math.PI / 2),
    [cx - half, cy - r],
    ...arc(cx - half, cy, r, -Math.PI / 2, -Math.PI * 1.5),
    [cx, cy + r],
  ];
}

const TRACKS: Track[] = [
  { id: 'straight', title: 'Прямо', points: [[30, 120], [370, 120]], scale: 1 },
  {
    id: 'back',
    title: 'Туда и обратно',
    points: [[30, 120], [340, 120], [130, 120]],
    scale: 1,
  },
  {
    id: 'zigzag',
    title: 'Зигзагом',
    points: [[30, 190], [110, 50], [190, 190], [270, 50], [360, 160]],
    scale: 1,
  },
  { id: 'stadium', title: 'Круг стадиона', points: stadium(), scale: 0.5 },
];

const dist = (a: Pt, b: Pt) => Math.hypot(b[0] - a[0], b[1] - a[1]);

/** Position after `f` (0…1) of the route, and the distance travelled to it (viewBox units). */
export function along(points: Pt[], f: number): { at: Pt; travelled: number; index: number } {
  const lengths = points.slice(1).map((p, i) => dist(points[i]!, p));
  const total = lengths.reduce((a, b) => a + b, 0);
  let left = Math.max(0, Math.min(1, f)) * total;
  for (let i = 0; i < lengths.length; i++) {
    const seg = lengths[i]!;
    if (left <= seg || i === lengths.length - 1) {
      const k = seg === 0 ? 0 : Math.min(1, left / seg);
      const a = points[i]!;
      const b = points[i + 1]!;
      return {
        at: [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k],
        travelled: f * total,
        index: i,
      };
    }
    left -= seg;
  }
  return { at: points[0]!, travelled: 0, index: 0 };
}

function el<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

const pts = (p: Pt[]) => p.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
const m = (units: number, scale: number) => Math.round(units * scale);

let instances = 0;

class PathSim extends HTMLElement {
  private track: Track = TRACKS[3]!;
  private f = 0;
  private frame = 0;
  private built = false;
  private route!: SVGPolylineElement;
  private done!: SVGPolylineElement;
  private start!: SVGCircleElement;
  private body!: SVGCircleElement;
  private arrow!: SVGGElement;
  private slider!: HTMLInputElement;
  private readout!: HTMLElement;
  private note!: HTMLElement;

  connectedCallback(): void {
    if (this.built) return;
    this.built = true;
    this.track = TRACKS.find((t) => t.id === this.getAttribute('track')) ?? this.track;
    this.replaceChildren(); // drop the no-JS fallback text
    this.classList.add('sim', 'pth');
    this.build();
    this.draw();
  }

  disconnectedCallback(): void {
    cancelAnimationFrame(this.frame);
  }

  private build(): void {
    const id = ++instances;
    const choice = document.createElement('fieldset');
    choice.className = 'pfx-chips pth-tracks';
    const legend = document.createElement('legend');
    legend.textContent = 'Маршрут';
    legend.className = 'visually-hidden';
    choice.append(legend);
    for (const t of TRACKS) {
      const label = document.createElement('label');
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = `pth-${id}`;
      radio.checked = t === this.track;
      radio.addEventListener('change', () => {
        this.track = t;
        this.setF(0);
      });
      const span = document.createElement('span');
      span.textContent = t.title;
      label.append(radio, span);
      choice.append(label);
    }

    const svg = el('svg', {
      viewBox: `0 0 ${VIEW.w} ${VIEW.h}`,
      class: 'sim-svg',
      role: 'img',
      'aria-label': 'Маршрут тела, пройденная часть пути и вектор перемещения от старта',
    });
    this.route = el('polyline', { class: 'pth-route' });
    this.done = el('polyline', { class: 'pth-done' });
    this.start = el('circle', { class: 'pth-start', r: 5 });
    this.arrow = el('g', { class: 'pth-arrow' });
    this.body = el('circle', { class: 'pth-body', r: 6 });
    svg.append(this.route, this.done, this.arrow, this.start, this.body);

    const controls = document.createElement('div');
    controls.className = 'sim-row';
    const play = document.createElement('button');
    play.type = 'button';
    play.className = 'btn small';
    play.textContent = 'Пройти маршрут';
    play.addEventListener('click', () => this.play());
    const label = document.createElement('label');
    label.className = 'sim-slider pth-scrub';
    const name = document.createElement('span');
    name.textContent = 'Где тело';
    this.slider = document.createElement('input');
    this.slider.type = 'range';
    this.slider.min = '0';
    this.slider.max = '1000';
    this.slider.value = '0';
    this.slider.addEventListener('input', () => {
      cancelAnimationFrame(this.frame);
      this.f = Number(this.slider.value) / 1000;
      this.draw();
    });
    label.append(name, this.slider);
    controls.append(play, label);

    this.readout = document.createElement('p');
    this.readout.className = 'sim-readout pth-readout';
    this.readout.setAttribute('aria-live', 'polite');
    this.note = document.createElement('p');
    this.note.className = 'pfx-rule';
    this.append(choice, svg, controls, this.readout, this.note);
  }

  private setF(f: number): void {
    this.f = f;
    this.slider.value = String(Math.round(f * 1000));
    this.draw();
  }

  private play(): void {
    cancelAnimationFrame(this.frame);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.setF(1);
      return;
    }
    const start = performance.now();
    const tick = (now: number) => {
      const f = Math.min(1, (now - start) / 5000);
      this.setF(f);
      if (f < 1) this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  private draw(): void {
    const t = this.track;
    const first = t.points[0]!;
    const { at, travelled, index } = along(t.points, this.f);
    this.route.setAttribute('points', pts(t.points));
    this.done.setAttribute('points', pts([...t.points.slice(0, index + 1), at]));
    this.start.setAttribute('cx', String(first[0]));
    this.start.setAttribute('cy', String(first[1]));
    this.body.setAttribute('cx', at[0].toFixed(1));
    this.body.setAttribute('cy', at[1].toFixed(1));

    // Displacement: an arrow from the start to the body, unless they coincide.
    this.arrow.replaceChildren();
    const d = dist(first, at);
    if (d > 8) {
      const ux = (at[0] - first[0]) / d;
      const uy = (at[1] - first[1]) / d;
      const tip: Pt = [at[0] - ux * 7, at[1] - uy * 7]; // stop at the body's edge
      const h = 9;
      this.arrow.append(
        el('line', { x1: first[0], y1: first[1], x2: tip[0] - ux * h * 0.6, y2: tip[1] - uy * h * 0.6 }),
        el('path', {
          d:
            `M${tip[0]} ${tip[1]}L${tip[0] - ux * h - uy * h * 0.45} ${tip[1] - uy * h + ux * h * 0.45}` +
            `L${tip[0] - ux * h + uy * h * 0.45} ${tip[1] - uy * h - ux * h * 0.45}Z`,
        }),
      );
    }

    const l = m(travelled, t.scale);
    const s = m(d, t.scale);
    this.readout.replaceChildren();
    const path = document.createElement('span');
    path.className = 'pth-l';
    path.textContent = `путь l = ${l} м`;
    const disp = document.createElement('span');
    disp.className = 'pth-s';
    disp.textContent = `перемещение |s| = ${s} м`;
    this.readout.append(path, ' · ', disp);
    this.note.textContent =
      this.f === 0
        ? 'Нажми «Пройти маршрут» или двигай ползунок.'
        : s === l
          ? 'Тело идёт по прямой и не разворачивается — путь равен модулю перемещения.'
          : s === 0
            ? 'Тело вернулось на старт: путь большой, а перемещение равно нулю.'
            : 'Путь больше модуля перемещения: путь считает каждый метр, а перемещение — только где тело оказалось.';
  }
}

if (!customElements.get('pp-path')) customElements.define('pp-path', PathSim);
