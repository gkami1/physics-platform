"""Generated figures: YAML specs in `content/<exam>/figures/` → SVG files in `assets/`.

A figure spec lives next to the content it illustrates, so a graph is drawn from the same
numbers the task's answer was computed from. `content-build figures` regenerates the SVGs;
`content-build validate` fails if a committed SVG is out of date with its spec.

Two kinds:
- `graph`: axes, grid, ticks with decimal commas, polylines (optionally shaded), notes.
- `diagram`: free drawing from primitives (lines, arrows, circles, springs, hatched surfaces,
  angle arcs, sine waves, circuit elements, labels) in viewBox coordinates, y pointing down.

Colours: everything is drawn with `currentColor`. Tones (`force`, `vel`, `accent`, `muted`)
are groups with a `fig-<tone>` class that sets CSS `color`, so the site theme recolours them;
the `color` attribute is only a fallback for viewing the file on its own. Once inlined into a
page (see `inline_svg_images`) the figure follows the light/dark theme.
"""

from __future__ import annotations

import html
import math
import re
from pathlib import Path
from typing import Annotated, Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, model_validator

# --- shared -----------------------------------------------------------------------------------


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


Pt = tuple[float, float]
Tone = Literal["default", "force", "vel", "accent", "muted"]
Fill = Literal["none", "solid", "surface", "accent"]

TONE_FALLBACK = {"force": "crimson", "vel": "seagreen", "accent": "royalblue", "muted": "gray"}


def _f(v: float) -> str:
    return f"{v:.1f}".rstrip("0").rstrip(".") if abs(v) > 1e-9 else "0"


def _pt(p: Pt) -> str:
    return f"{_f(p[0])} {_f(p[1])}"


def _tone(tone: Tone, body: str) -> str:
    if tone == "default":
        return body
    return f'<g class="fig-{tone}" color="{TONE_FALLBACK[tone]}">{body}</g>'


def _fill_attrs(fill: Fill) -> str:
    return {
        "none": 'fill="none"',
        "solid": 'fill="currentColor"',
        "surface": 'class="fig-fill" fill="whitesmoke"',
        "accent": 'class="fig-area" fill="royalblue" fill-opacity="0.18"',
    }[fill]


_MARKUP = re.compile(r"\*([^*]+)\*|_\{([^}]*)\}|\^\{([^}]*)\}|_(\w+)")


def rich_text(s: str, size: float) -> str:
    """Tiny label markup: `*v*` italic, `_{0}` or `_тр` (a whole word) subscript, `^{2}` sup."""
    out: list[str] = []
    pos = 0
    shift = round(size * 0.3, 1)
    for m in _MARKUP.finditer(s):
        if m.start() > pos:
            out.append(html.escape(s[pos : m.start()]))
        italic, sub, sup, sub1 = m.groups()
        if italic is not None:
            out.append(f'<tspan font-style="italic">{html.escape(italic)}</tspan>')
        else:
            text, dy = (sup, -shift) if sup is not None else (sub or sub1 or "", shift)
            small = _f(size * 0.72)
            out.append(f'<tspan dy="{_f(dy)}" font-size="{small}">{html.escape(text)}</tspan>')
            out.append(f'<tspan dy="{_f(-dy)}">​</tspan>')  # back to the baseline
        pos = m.end()
    out.append(html.escape(s[pos:]))
    return "".join(out)


def _text(at: Pt, s: str, *, size: float = 14, anchor: str = "middle", italic: bool = False) -> str:
    style = ' font-style="italic"' if italic else ""
    return (
        f'<text x="{_f(at[0])}" y="{_f(at[1])}" text-anchor="{anchor}" font-size="{_f(size)}"'
        f'{style} fill="currentColor" stroke="none">{rich_text(s, size)}</text>'
    )


def _arrow(a: Pt, b: Pt, *, width: float = 2, head: float = 9, dashed: bool = False) -> str:
    """Shaft from a to b with a filled head ending exactly at b."""
    dx, dy = b[0] - a[0], b[1] - a[1]
    n = math.hypot(dx, dy) or 1.0
    ux, uy = dx / n, dy / n
    base = (b[0] - ux * head, b[1] - uy * head)
    left = (base[0] - uy * head * 0.42, base[1] + ux * head * 0.42)
    right = (base[0] + uy * head * 0.42, base[1] - ux * head * 0.42)
    dash = ' stroke-dasharray="5 4"' if dashed else ""
    shaft_end = (b[0] - ux * head * 0.7, b[1] - uy * head * 0.7)
    return (
        f'<path stroke-width="{_f(width)}"{dash} d="M{_pt(a)}L{_pt(shaft_end)}"/>'
        f'<path fill="currentColor" stroke="none" d="M{_pt(b)}L{_pt(left)}L{_pt(right)}Z"/>'
    )


# --- graph ------------------------------------------------------------------------------------


class Axis(_Strict):
    var: str  # italic symbol, e.g. "t"
    unit: str = ""  # upright unit, e.g. "с"; empty for qualitative graphs
    min: float
    max: float
    step: float = Field(gt=0)  # grid and tick spacing
    label_every: int = Field(default=1, ge=1)  # label every n-th tick
    numbers: bool = True  # False: qualitative axis, no grid or tick labels

    @model_validator(mode="after")
    def _range(self) -> Axis:
        if self.max <= self.min:
            raise ValueError("axis max must be greater than min")
        if (self.max - self.min) / self.step > 40:
            raise ValueError("too many grid lines; increase step")
        return self


class Series(_Strict):
    points: list[Pt] = Field(min_length=2)
    fill: bool = False  # shade the area between the line and the x axis
    dashed: bool = False
    tone: Tone = "accent"


class Note(_Strict):
    at: Pt  # data coordinates
    text: str
    anchor: Literal["start", "middle", "end"] = "start"


class GraphSpec(_Strict):
    kind: Literal["graph"]
    x: Axis
    y: Axis
    series: list[Series] = Field(min_length=1)
    # Points to mark with dashed lines to both axes (helps read values off the graph).
    guides: list[Pt] = Field(default_factory=list)
    notes: list[Note] = Field(default_factory=list)

    @model_validator(mode="after")
    def _inside(self) -> GraphSpec:
        for s in self.series:
            for px, py in s.points:
                if not (self.x.min <= px <= self.x.max and self.y.min <= py <= self.y.max):
                    raise ValueError(f"point ({px}, {py}) is outside the axes")
        return self


W, H = 400, 260
LEFT, RIGHT, TOP, BOTTOM = 52, 28, 26, 40


def _num(v: float) -> str:
    """Tick label: up to 3 decimals, trailing zeros stripped, Russian decimal comma."""
    s = f"{round(v, 3):.3f}".rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s.replace(".", ",").replace("-", "−")


def _ticks(a: Axis) -> list[float]:
    n = round((a.max - a.min) / a.step)
    return [round(a.min + i * a.step, 9) for i in range(n + 1)]


def render_graph(spec: GraphSpec) -> str:
    pw, ph = W - LEFT - RIGHT, H - TOP - BOTTOM
    x0, y0 = LEFT, TOP + ph  # screen position of the axes origin (x.min, y.min)

    def sx(x: float) -> float:
        return LEFT + (x - spec.x.min) / (spec.x.max - spec.x.min) * pw

    def sy(y: float) -> float:
        return TOP + ph - (y - spec.y.min) / (spec.y.max - spec.y.min) * ph

    out: list[str] = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" '
        f'height="{H}" class="fig-svg" font-size="13" fill="none" stroke="currentColor">'
    ]

    # The value-zero line: the axes stay at (x.min, y.min), but with negative values a line
    # at y = 0 is where vₓ(t) changes sign, and shaded areas (paths) are measured from it.
    zero = _f(sy(min(max(0.0, spec.y.min), spec.y.max)))

    # shaded areas go under everything else
    for s in spec.series:
        if s.fill:
            pts = [(sx(px), sy(py)) for px, py in s.points]
            d = f"M{_f(pts[0][0])} {zero}" + "".join(f"L{_pt(p)}" for p in pts)
            d += f"L{_f(pts[-1][0])} {zero}Z"
            out.append(_tone(s.tone, f'<path {_fill_attrs("accent")} stroke="none" d="{d}"/>'))

    # grid
    grid = [f"M{_f(sx(t))} {TOP}V{y0}" for t in _ticks(spec.x)[1:]] if spec.x.numbers else []
    grid += [f"M{x0} {_f(sy(t))}H{x0 + pw}" for t in _ticks(spec.y)[1:]] if spec.y.numbers else []
    if grid:
        out.append(f'<path class="fig-grid" stroke-width="1" opacity="0.35" d="{" ".join(grid)}"/>')

    # axes with arrowheads
    out.append(
        f'<path class="fig-axis" stroke-width="1.5" d="M{x0} {y0}H{W - 8}M{x0} {y0}V8"/>'
        f'<path class="fig-axis" fill="currentColor" stroke="none" '
        f'd="M{W - 4} {y0}l-9 -4v8zM{x0} 4l-4 9h8z"/>'
    )

    if spec.y.min < 0 < spec.y.max:
        out.append(f'<path class="fig-axis" stroke-width="1.5" d="M{x0} {zero}H{x0 + pw}"/>')

    # tick labels
    labels: list[str] = []
    if spec.x.numbers:
        for i, t in enumerate(_ticks(spec.x)):
            if i % spec.x.label_every == 0:
                labels.append(
                    f'<text x="{_f(sx(t))}" y="{y0 + 18}" text-anchor="middle">{_num(t)}</text>'
                )
    if spec.y.numbers:
        for i, t in enumerate(_ticks(spec.y)):
            # One shared "0" at the origin: the x axis already labels it.
            if i % spec.y.label_every == 0 and not (i == 0 and spec.x.min == 0 == spec.y.min):
                labels.append(
                    f'<text x="{x0 - 7}" y="{_f(sy(t) + 4.5)}" text-anchor="end">{_num(t)}</text>'
                )
    if not spec.x.numbers and not spec.y.numbers:
        labels.append(f'<text x="{x0 - 7}" y="{y0 + 16}" text-anchor="end">0</text>')
    out.append(f'<g class="fig-text" fill="currentColor" stroke="none">{"".join(labels)}')

    # axis names: italic symbol, upright unit
    def name(a: Axis) -> str:
        var = f'<tspan font-style="italic">{rich_text(a.var, 13)}</tspan>'
        return f"{var}, {html.escape(a.unit)}" if a.unit else var

    out.append(f'<text x="{W - 6}" y="{y0 - 10}" text-anchor="end">{name(spec.x)}</text>')
    out.append(f'<text x="{x0 + 10}" y="16">{name(spec.y)}</text></g>')

    # dashed guides
    if spec.guides:
        d = " ".join(f"M{_f(sx(gx))} {y0}V{_f(sy(gy))}H{x0}" for gx, gy in spec.guides)
        out.append(f'<path class="fig-guide" stroke-width="1" stroke-dasharray="4 3" d="{d}"/>')

    # data
    for s in spec.series:
        coords = " ".join(f"{_f(sx(px))},{_f(sy(py))}" for px, py in s.points)
        dash = ' stroke-dasharray="6 4"' if s.dashed else ""
        line = (
            f'<polyline class="fig-line" stroke-width="2.5" stroke-linejoin="round"{dash} '
            f'points="{coords}"/>'
        )
        out.append(line if s.tone == "accent" else _tone(s.tone, line))

    for n in spec.notes:
        out.append(_text((sx(n.at[0]), sy(n.at[1])), n.text, size=13, anchor=n.anchor))

    out.append("</svg>")
    return "".join(out) + "\n"


# --- diagram ----------------------------------------------------------------------------------


# Animation without JavaScript, one shared loop (web/src/styles/global.css, .fig-draw etc.):
# `draw` paths trace themselves in the first half, `appear` items fade in after that, and
# a path's `mover` dot rides along it while it is drawn. CSS shows the final picture to
# readers who prefer reduced motion; the mover (SMIL, which CSS cannot pause) is hidden.
CYCLE_S = 6  # must match --fig-cycle in global.css
Animate = Literal["draw", "appear"]


class _Item(_Strict):
    tone: Tone = "default"
    animate: Literal["appear"] | None = None


class Line(_Item):
    line: list[Pt] = Field(min_length=2)
    width: float = 1.5
    dashed: bool = False
    closed: bool = False
    fill: Fill = "none"


class Arrow(_Item):
    arrow: tuple[Pt, Pt]
    width: float = 2
    dashed: bool = False
    label: str | None = None
    label_at: Pt | None = None  # absolute; default: a little past the arrowhead


class Circle(_Item):
    circle: Pt
    r: float = Field(gt=0)
    fill: Fill = "none"
    width: float = 1.5
    dashed: bool = False
    label: str | None = None  # centred inside


class Rect(_Item):
    rect: tuple[float, float, float, float]  # x, y, w, h
    fill: Fill = "none"
    width: float = 1.5
    rotate: float = 0  # degrees about the centre, clockwise
    radius: float = 0
    dashed: bool = False


class Text(_Item):
    text: str
    at: Pt
    size: float = 14
    anchor: Literal["start", "middle", "end"] = "middle"


class Hatch(_Item):
    """A surface (wall, floor, ceiling) drawn as a line with short slanted strokes."""

    hatch: tuple[Pt, Pt]
    side: Literal[1, -1] = 1  # 1: strokes on the right of a→b (below a left→right floor)
    spacing: float = 9


class Spring(_Item):
    spring: tuple[Pt, Pt]
    coils: int = Field(default=7, ge=2)
    amplitude: float = 7


class Angle(_Item):
    """Arc at a vertex between two directions (degrees, counter-clockwise from +x, y up)."""

    angle: Pt
    start: float
    end: float
    r: float = 26
    label: str | None = None


class Sine(_Item):
    sine: Pt  # start on the axis
    length: float
    amplitude: float
    periods: float = 2
    phase: float = 0  # degrees
    width: float = 2


class Dots(_Item):
    dots: list[Pt] = Field(min_length=1)
    r: float = 4
    fill: Fill = "solid"


class Element(_Item):
    """Circuit element centred at `at`, leads ending 20 units either side along its axis."""

    element: Literal[
        "resistor",
        "battery",
        "capacitor",
        "lamp",
        "ammeter",
        "voltmeter",
        "galvanometer",
        "switch",
        "coil",
        "rheostat",
    ]
    at: Pt
    vertical: bool = False
    label: str | None = None
    label_side: Literal[1, -1] = -1  # -1: above (or left of) the element


class PathItem(_Item):
    path: str  # raw SVG path data, for anything the primitives don't cover
    width: float = 1.5
    fill: Fill = "none"
    dashed: bool = False
    animate: Animate | None = None  # type: ignore[assignment]  # paths can also be drawn
    mover: bool = False  # with animate: draw, a dot travels the path as it is drawn

    @model_validator(mode="after")
    def _mover_needs_draw(self) -> PathItem:
        if self.mover and self.animate != "draw":
            raise ValueError("mover needs animate: draw")
        if self.animate == "draw" and self.dashed:
            raise ValueError("a drawn path cannot be dashed (the dash pattern draws it)")
        return self


Item = Annotated[
    Line | Arrow | Circle | Rect | Text | Hatch | Spring | Angle | Sine | Dots | Element | PathItem,
    Field(union_mode="left_to_right"),
]


class DiagramSpec(_Strict):
    kind: Literal["diagram"]
    size: tuple[int, int] = (400, 260)
    items: list[Item] = Field(min_length=1)


def _dash(d: bool) -> str:
    return ' stroke-dasharray="5 4"' if d else ""


def _line(i: Line) -> str:
    d = "M" + "L".join(_pt(p) for p in i.line) + ("Z" if i.closed else "")
    return f'<path {_fill_attrs(i.fill)} stroke-width="{_f(i.width)}"{_dash(i.dashed)} d="{d}"/>'


def _arrow_item(i: Arrow) -> str:
    out = _arrow(i.arrow[0], i.arrow[1], width=i.width, dashed=i.dashed)
    if i.label:
        a, b = i.arrow
        n = math.hypot(b[0] - a[0], b[1] - a[1]) or 1.0
        at = i.label_at or (b[0] + (b[0] - a[0]) / n * 14, b[1] + (b[1] - a[1]) / n * 14 + 5)
        out += _text(at, i.label)
    return out


def _circle(i: Circle) -> str:
    out = (
        f'<circle cx="{_f(i.circle[0])}" cy="{_f(i.circle[1])}" r="{_f(i.r)}" '
        f'{_fill_attrs(i.fill)} stroke-width="{_f(i.width)}"{_dash(i.dashed)}/>'
    )
    if i.label:
        out += _text((i.circle[0], i.circle[1] + 5), i.label, size=min(14, i.r * 1.1))
    return out


def _rect(i: Rect) -> str:
    x, y, w, h = i.rect
    rot = f' transform="rotate({_f(i.rotate)} {_f(x + w / 2)} {_f(y + h / 2)})"' if i.rotate else ""
    rx = f' rx="{_f(i.radius)}"' if i.radius else ""
    return (
        f'<rect x="{_f(x)}" y="{_f(y)}" width="{_f(w)}" height="{_f(h)}"{rx} '
        f'{_fill_attrs(i.fill)} stroke-width="{_f(i.width)}"{_dash(i.dashed)}{rot}/>'
    )


def _hatch(i: Hatch) -> str:
    (ax, ay), (bx, by) = i.hatch
    n = math.hypot(bx - ax, by - ay) or 1.0
    ux, uy = (bx - ax) / n, (by - ay) / n
    # Screen coordinates (y down): (-uy, ux) points to the right of the a→b direction.
    nx, ny = -uy * i.side, ux * i.side
    strokes = []
    t = i.spacing / 2
    while t < n:
        px, py = ax + ux * t, ay + uy * t
        q = (px + nx * 8 - ux * 6, py + ny * 8 - uy * 6)
        strokes.append(f"M{_pt((px, py))}L{_pt(q)}")
        t += i.spacing
    return (
        f'<path stroke-width="2" d="M{_pt(i.hatch[0])}L{_pt(i.hatch[1])}"/>'
        f'<path stroke-width="1" d="{"".join(strokes)}"/>'
    )


def _spring(i: Spring) -> str:
    (ax, ay), (bx, by) = i.spring
    n = math.hypot(bx - ax, by - ay) or 1.0
    ux, uy = (bx - ax) / n, (by - ay) / n
    nx, ny = -uy, ux
    lead = min(12.0, n * 0.12)
    body = n - 2 * lead
    pts = [(ax, ay), (ax + ux * lead, ay + uy * lead)]
    zig = i.coils * 2
    for k in range(1, zig + 1):
        t = lead + body * (k - 0.5) / zig
        s = i.amplitude * (1 if k % 2 else -1)
        pts.append((ax + ux * t + nx * s, ay + uy * t + ny * s))
    pts += [(bx - ux * lead, by - uy * lead), (bx, by)]
    d = "M" + "L".join(_pt(p) for p in pts)
    return f'<path stroke-width="1.5" stroke-linejoin="round" d="{d}"/>'


def _angle(i: Angle) -> str:
    cx, cy = i.angle

    def at(deg: float, r: float) -> Pt:
        return (cx + r * math.cos(math.radians(deg)), cy - r * math.sin(math.radians(deg)))

    sweep = (i.end - i.start) % 360
    large = 1 if sweep > 180 else 0
    out = (
        f'<path stroke-width="1.3" d="M{_pt(at(i.start, i.r))}A{_f(i.r)} {_f(i.r)} 0 {large} 0 '
        f'{_pt(at(i.start + sweep, i.r))}"/>'
    )
    if i.label:
        lx, ly = at(i.start + sweep / 2, i.r + 13)
        out += _text((lx, ly + 5), i.label)
    return out


def _sine(i: Sine) -> str:
    x0, y0 = i.sine
    steps = max(24, int(i.periods * 32))
    pts = []
    for k in range(steps + 1):
        x = i.length * k / steps
        phase = 2 * math.pi * i.periods * k / steps + math.radians(i.phase)
        pts.append((x0 + x, y0 - i.amplitude * math.sin(phase)))
    return (
        f'<path stroke-width="{_f(i.width)}" stroke-linejoin="round" '
        f'd="M{"L".join(_pt(p) for p in pts)}"/>'
    )


def _dots(i: Dots) -> str:
    return "".join(
        f'<circle cx="{_f(x)}" cy="{_f(y)}" r="{_f(i.r)}" {_fill_attrs(i.fill)} stroke-width="1"/>'
        for x, y in i.dots
    )


def _element(i: Element) -> str:
    """Draw horizontally around (0, 0), then move and rotate into place."""
    k = i.element
    parts: list[str] = []
    if k in ("resistor", "rheostat"):
        parts.append('<path d="M-20 0H-14M14 0H20"/><rect x="-14" y="-6" width="28" height="12"/>')
        if k == "rheostat":
            parts.append(_arrow((-12, 14), (12, -14), width=1.3, head=6))
    elif k == "battery":  # long thin plate = +, short thick plate = −
        parts.append(
            '<path d="M-20 0H-4M4 0H20"/><path stroke-width="1.5" d="M-4 -13V13"/>'
            '<path stroke-width="4" d="M4 -7V7"/>'
        )
    elif k == "capacitor":
        parts.append(
            '<path d="M-20 0H-4M4 0H20"/><path stroke-width="2.2" d="M-4 -12V12M4 -12V12"/>'
        )
    elif k == "lamp":
        parts.append(
            '<path d="M-20 0H-11M11 0H20"/><circle r="11" fill="none"/>'
            '<path d="M-7.8 -7.8L7.8 7.8M-7.8 7.8L7.8 -7.8"/>'
        )
    elif k in ("ammeter", "voltmeter", "galvanometer"):
        letter = {"ammeter": "A", "voltmeter": "V", "galvanometer": "G"}[k]
        parts.append('<path d="M-20 0H-12M12 0H20"/><circle r="12" fill="none"/>')
        rot = ' transform="rotate(-90)"' if i.vertical else ""
        parts.append(
            f'<text y="5" text-anchor="middle" font-size="13" fill="currentColor" '
            f'stroke="none"{rot}>{letter}</text>'
        )
    elif k == "switch":
        parts.append(
            '<path d="M-20 0H-10M10 0H20M-10 0L9 -11"/>'
            '<circle cx="-10" r="2" fill="currentColor"/>'
            '<circle cx="10" r="2" fill="currentColor"/>'
        )
    elif k == "coil":
        bumps = "".join("a5 5 0 0 1 10 0" for _ in range(4))
        parts.append(f'<path d="M-20 0{bumps}"/>')
    turn = 90 if i.vertical else 0
    body = (
        f'<g stroke-width="1.6" transform="translate({_pt(i.at)}) rotate({turn})">'
        f"{''.join(parts)}</g>"
    )
    if i.label:
        off = 22 * i.label_side
        at = (
            (i.at[0] + off - 4 * i.label_side, i.at[1] + 5)
            if i.vertical
            else (
                i.at[0],
                i.at[1] + off + (5 if i.label_side > 0 else 0),
            )
        )
        anchor = ("end" if i.label_side < 0 else "start") if i.vertical else "middle"
        body += _text(at, i.label, anchor=anchor)
    return body


def _path(i: PathItem) -> str:
    d = html.escape(i.path)
    drawn = ' class="fig-draw" pathLength="1"' if i.animate == "draw" else ""
    body = (
        f'<path{drawn} {_fill_attrs(i.fill)} stroke-width="{_f(i.width)}"{_dash(i.dashed)} '
        f'stroke-linejoin="round" d="{d}"/>'
    )
    if i.mover:
        # Along the path in the first half of the loop, then waits at the end.
        body += (
            f'<circle class="fig-mover" r="{_f(i.width + 4)}" fill="currentColor" stroke="none">'
            f'<animateMotion dur="{CYCLE_S}s" repeatCount="indefinite" path="{d}" '
            'keyPoints="0;1;1" keyTimes="0;0.5;1" calcMode="linear"/></circle>'
        )
    return body


def _item(i: _Item) -> str:
    match i:
        case Line():
            body = _line(i)
        case Arrow():
            body = _arrow_item(i)
        case Circle():
            body = _circle(i)
        case Rect():
            body = _rect(i)
        case Text():
            body = _text(i.at, i.text, size=i.size, anchor=i.anchor)
        case Hatch():
            body = _hatch(i)
        case Spring():
            body = _spring(i)
        case Angle():
            body = _angle(i)
        case Sine():
            body = _sine(i)
        case Dots():
            body = _dots(i)
        case Element():
            body = _element(i)
        case PathItem():
            body = _path(i)
        case _:
            raise TypeError(type(i).__name__)
    if i.animate == "appear":
        body = f'<g class="fig-appear">{body}</g>'
    return _tone(i.tone, body)


def render_diagram(spec: DiagramSpec) -> str:
    w, h = spec.size
    body = "".join(_item(i) for i in spec.items)
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" '
        f'height="{h}" class="fig-svg" font-size="14" fill="none" stroke="currentColor" '
        f'stroke-linecap="round">{body}</svg>\n'
    )


# --- dispatch ---------------------------------------------------------------------------------

FigureSpec = Annotated[GraphSpec | DiagramSpec, Field(discriminator="kind")]
_SPEC: TypeAdapter[GraphSpec | DiagramSpec] = TypeAdapter(FigureSpec)


def render(spec: GraphSpec | DiagramSpec) -> str:
    return render_graph(spec) if isinstance(spec, GraphSpec) else render_diagram(spec)


# --- files ------------------------------------------------------------------------------------


def load_specs(exam_dir: Path) -> dict[str, GraphSpec | DiagramSpec]:
    """`figures/<name>.yaml` → spec; the SVG goes to `assets/<name>.svg`."""
    d = exam_dir / "figures"
    if not d.exists():
        return {}
    return {
        p.stem: _SPEC.validate_python(yaml.safe_load(p.read_text("utf-8")))
        for p in sorted(d.glob("*.yaml"))
    }


def generate(exam_dir: Path, *, check: bool = False) -> list[str]:
    """Write (or, with check=True, only compare) every generated SVG.

    Returns the asset names that were written, or that are stale when checking.
    """
    changed: list[str] = []
    for name, spec in load_specs(exam_dir).items():
        target = exam_dir / "assets" / f"{name}.svg"
        svg = render(spec)
        current = target.read_text("utf-8") if target.exists() else None
        if current != svg:
            changed.append(f"{name}.svg")
            if not check:
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(svg, "utf-8", newline="\n")
    return changed


# --- inlining ---------------------------------------------------------------------------------

# An image alone on its line, pointing at a local SVG.
_OWN_LINE_SVG = re.compile(r"^!\[([^\]]*)\]\(([^)\s]+\.svg)\)[ \t]*$", re.MULTILINE)


def figure_html(svg: str, alt: str) -> str:
    """One-line HTML block: Markdown keeps it raw, and CSS can theme the SVG inside."""
    svg = re.sub(r"<\?xml[^>]*\?>", "", svg)
    svg = re.sub(r"\s*\n\s*", " ", svg).strip()
    return f'<figure class="fig" role="img" aria-label="{html.escape(alt)}">{svg}</figure>'


def inline_svg_images(markdown: str, base: Path) -> str:
    """Replace `![alt](path.svg)` lines with the SVG itself (paths relative to `base`).

    `<img>` cannot follow the page theme, inline SVG can. Keep in sync with the remark plugin
    in web/markdown.config.mjs, which does the same for theory pages.
    """

    def sub(m: re.Match[str]) -> str:
        path = (base / m.group(2)).resolve()
        if not path.exists():
            return m.group(0)  # the loader already reports missing images
        return figure_html(path.read_text("utf-8"), m.group(1))

    return _OWN_LINE_SVG.sub(sub, markdown)
