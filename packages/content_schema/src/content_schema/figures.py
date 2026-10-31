"""Generated figures: YAML specs in `content/<exam>/figures/` → SVG files in `assets/`.

A figure spec lives next to the content it illustrates, so a graph is drawn from the same
numbers the task's answer was computed from. `content-build figures` regenerates the SVGs;
a test fails if a committed SVG is out of date with its spec.

SVGs are drawn with `currentColor` and CSS classes (`fig-grid`, `fig-line`, …) so that, once
inlined into a page (see `inline_svg_images`), they follow the site's light/dark theme.
"""

from __future__ import annotations

import html
import re
from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field, model_validator

# --- specs ------------------------------------------------------------------------------------


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class Axis(_Strict):
    var: str  # italic symbol, e.g. "t"
    unit: str  # upright unit, e.g. "с"
    min: float
    max: float
    step: float = Field(gt=0)  # grid and tick spacing
    label_every: int = Field(default=1, ge=1)  # label every n-th tick

    @model_validator(mode="after")
    def _range(self) -> Axis:
        if self.max <= self.min:
            raise ValueError("axis max must be greater than min")
        if (self.max - self.min) / self.step > 40:
            raise ValueError("too many grid lines; increase step")
        return self


class Series(_Strict):
    points: list[tuple[float, float]] = Field(min_length=2)


class GraphSpec(_Strict):
    kind: Literal["graph"]
    x: Axis
    y: Axis
    series: list[Series] = Field(min_length=1)
    # Points to mark with dashed lines to both axes (helps read values off the graph).
    guides: list[tuple[float, float]] = Field(default_factory=list)

    @model_validator(mode="after")
    def _inside(self) -> GraphSpec:
        for s in self.series:
            for px, py in s.points:
                if not (self.x.min <= px <= self.x.max and self.y.min <= py <= self.y.max):
                    raise ValueError(f"point ({px}, {py}) is outside the axes")
        return self


FigureSpec = GraphSpec  # more kinds (force diagrams, circuits) can join as a tagged union


# --- rendering --------------------------------------------------------------------------------

W, H = 400, 260
LEFT, RIGHT, TOP, BOTTOM = 52, 28, 26, 40


def _num(v: float) -> str:
    """Tick label: up to 3 decimals, trailing zeros stripped, Russian decimal comma."""
    s = f"{round(v, 3):.3f}".rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s.replace(".", ",").replace("-", "−")


def _ticks(a: Axis) -> list[float]:
    n = round((a.max - a.min) / a.step)
    return [round(a.min + i * a.step, 9) for i in range(n + 1)]


def _f(v: float) -> str:
    return f"{v:.1f}".rstrip("0").rstrip(".")


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

    # grid
    grid = [f"M{_f(sx(t))} {TOP}V{y0}" for t in _ticks(spec.x)[1:]]
    grid += [f"M{x0} {_f(sy(t))}H{x0 + pw}" for t in _ticks(spec.y)[1:]]
    out.append(f'<path class="fig-grid" stroke-width="1" opacity="0.35" d="{" ".join(grid)}"/>')

    # axes with arrowheads
    out.append(
        f'<path class="fig-axis" stroke-width="1.5" d="M{x0} {y0}H{W - 8}M{x0} {y0}V8"/>'
        f'<path class="fig-axis" fill="currentColor" stroke="none" '
        f'd="M{W - 4} {y0}l-9 -4v8zM{x0} 4l-4 9h8z"/>'
    )

    # tick labels
    labels: list[str] = []
    for i, t in enumerate(_ticks(spec.x)):
        if i % spec.x.label_every == 0:
            labels.append(
                f'<text x="{_f(sx(t))}" y="{y0 + 18}" text-anchor="middle">{_num(t)}</text>'
            )
    for i, t in enumerate(_ticks(spec.y)):
        # One shared "0" at the origin: the x axis already labels it.
        if i % spec.y.label_every == 0 and not (i == 0 and spec.x.min == 0 == spec.y.min):
            labels.append(
                f'<text x="{x0 - 7}" y="{_f(sy(t) + 4.5)}" text-anchor="end">{_num(t)}</text>'
            )
    out.append(f'<g class="fig-text" fill="currentColor" stroke="none">{"".join(labels)}')

    # axis names: italic symbol, upright unit
    def name(a: Axis) -> str:
        return f'<tspan font-style="italic">{html.escape(a.var)}</tspan>, {html.escape(a.unit)}'

    out.append(f'<text x="{W - 6}" y="{y0 - 10}" text-anchor="end">{name(spec.x)}</text>')
    out.append(f'<text x="{x0 + 10}" y="16">{name(spec.y)}</text></g>')

    # dashed guides
    if spec.guides:
        d = " ".join(f"M{_f(sx(gx))} {y0}V{_f(sy(gy))}H{x0}" for gx, gy in spec.guides)
        out.append(f'<path class="fig-guide" stroke-width="1" stroke-dasharray="4 3" d="{d}"/>')

    # data
    for s in spec.series:
        pts = " ".join(f"{_f(sx(px))},{_f(sy(py))}" for px, py in s.points)
        out.append(
            f'<polyline class="fig-line" stroke-width="2.5" stroke-linejoin="round" '
            f'points="{pts}"/>'
        )

    out.append("</svg>")
    return "".join(out) + "\n"


def render(spec: FigureSpec) -> str:
    return render_graph(spec)


# --- files ------------------------------------------------------------------------------------


def load_specs(exam_dir: Path) -> dict[str, FigureSpec]:
    """`figures/<name>.yaml` → spec; the SVG goes to `assets/<name>.svg`."""
    d = exam_dir / "figures"
    if not d.exists():
        return {}
    return {
        p.stem: GraphSpec.model_validate(yaml.safe_load(p.read_text("utf-8")))
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
