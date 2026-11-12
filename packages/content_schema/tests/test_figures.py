"""Figure specs → SVG, and inlining SVG images into Markdown."""

import json
import re
import shutil
import xml.etree.ElementTree as ET
from pathlib import Path

import pytest
from pydantic import ValidationError

from content_schema.build import build
from content_schema.figures import (
    DiagramSpec,
    GraphSpec,
    _num,
    figure_html,
    generate,
    inline_svg_images,
    render_diagram,
    render_graph,
    rich_text,
)
from content_schema.loader import load_exam_dir

SVG = "{http://www.w3.org/2000/svg}"


def graph(**over: object) -> GraphSpec:
    spec: dict[str, object] = {
        "kind": "graph",
        "x": {"var": "t", "unit": "с", "min": 0, "max": 5, "step": 1},
        "y": {"var": "v", "unit": "м/с", "min": 0, "max": 20, "step": 4},
        "series": [{"points": [[0, 0], [5, 20]]}],
    }
    spec.update(over)
    return GraphSpec.model_validate(spec)


@pytest.mark.parametrize(
    ("value", "label"),
    [(0, "0"), (0.5, "0,5"), (2.0, "2"), (1.25, "1,25"), (-3, "−3"), (0.1 + 0.2, "0,3")],
)
def test_tick_labels_use_decimal_comma(value: float, label: str) -> None:
    assert _num(value) == label


@pytest.mark.parametrize(
    ("over", "message"),
    [
        ({"x": {"var": "t", "unit": "с", "min": 5, "max": 0, "step": 1}}, "greater than min"),
        ({"x": {"var": "t", "unit": "с", "min": 0, "max": 100, "step": 1}}, "too many"),
        ({"series": [{"points": [[0, 0], [6, 20]]}]}, "outside the axes"),
        ({"series": [{"points": [[0, 0]]}]}, "at least 2"),
    ],
)
def test_invalid_specs(over: dict[str, object], message: str) -> None:
    with pytest.raises(ValidationError, match=message):
        graph(**over)


def test_graph_is_valid_svg_with_ticks_and_data() -> None:
    svg = render_graph(graph(guides=[[2, 8]]))
    root = ET.fromstring(svg)  # noqa: S314 — our own generator output, not untrusted input
    texts = ["".join(t.itertext()) for t in root.iter(f"{SVG}text")]
    assert " ".join(s for s in texts if s.isdigit()) == "0 1 2 3 4 5 4 8 12 16 20"
    assert "t, с" in texts
    assert "v, м/с" in texts
    (line,) = root.iter(f"{SVG}polyline")
    assert line.get("class") == "fig-line"
    assert len(line.get("points", "").split()) == 2
    assert any(p.get("class") == "fig-guide" for p in root.iter(f"{SVG}path"))
    # themable: no hard-coded colours, only currentColor and CSS classes
    assert "#" not in svg


def _axis_paths(svg: str) -> list[str]:
    root = ET.fromstring(svg)  # noqa: S314 — our own generator output
    return [p.get("d", "") for p in root.iter(f"{SVG}path") if p.get("class") == "fig-axis"]


def test_negative_values_fill_to_the_zero_line() -> None:
    # y from −4 to 8: value 0 is at screen y = 26 + 194 · 8/12 ≈ 155.3
    y = {"var": "v", "unit": "м/с", "min": -4, "max": 8, "step": 2}
    svg = render_graph(graph(y=y, series=[{"points": [[0, 6], [5, -4]], "fill": True}]))
    zero = "155.3"
    assert any(d == f"M52 {zero}H372" for d in _axis_paths(svg))
    (shade,) = re.findall(r'stroke="none" d="(M[^"]*Z)"', svg)
    assert shade.startswith(f"M52 {zero}")
    assert shade.endswith(f"{zero}Z")
    # all values non-negative: no extra line, the area sits on the t axis
    assert len(_axis_paths(render_graph(graph()))) == 2  # the axes and their arrowheads


def test_qualitative_graph_with_negative_values_puts_the_t_axis_at_zero() -> None:
    # No tick labels show where zero is, so the axis itself (arrow, name, «0») moves there.
    x = {"var": "t", "min": 0, "max": 5, "step": 1, "numbers": False}
    y = {"var": "", "min": -4, "max": 8, "step": 2, "numbers": False}
    svg = render_graph(graph(x=x, y=y, series=[{"points": [[0, 6], [5, -4]]}]))
    zero = "155.3"
    axes, heads = _axis_paths(svg)  # no separate zero line
    assert axes.startswith(f"M52 {zero}H392")
    assert heads.startswith(f"M396 {zero}")
    assert re.search(r'<text x="45" y="171.3"[^>]*>0</text>', svg)


def test_inline_replaces_only_own_line_svg_images(tmp_path: Path) -> None:
    (tmp_path / "a.svg").write_text('<?xml version="1.0"?>\n<svg>\n  <g/>\n</svg>\n', "utf-8")
    md = (
        "Текст.\n\n"
        '![Рисунок "1" <a>](a.svg)\n\n'
        "В строке ![x](a.svg) не трогаем.\n\n"
        "![нет файла](missing.svg)\n\n"
        "![png](a.png)\n"
    )
    out = inline_svg_images(md, tmp_path)
    assert (
        '<figure class="fig" role="img" aria-label="Рисунок &quot;1&quot; &lt;a&gt;">'
        "<svg> <g/> </svg></figure>"
    ) in out
    assert "В строке ![x](a.svg) не трогаем." in out
    assert "![нет файла](missing.svg)" in out
    assert "![png](a.png)" in out
    assert "<?xml" not in out


def test_figure_html_is_one_line() -> None:
    assert "\n" not in figure_html("<svg>\n\n<g/>\n</svg>", "alt")


def test_generate_writes_then_reports_up_to_date(tmp_path: Path) -> None:
    (tmp_path / "figures").mkdir()
    (tmp_path / "figures" / "g.yaml").write_text(
        graph().model_dump_json(), "utf-8"
    )  # JSON is valid YAML
    assert generate(tmp_path, check=True) == ["g.svg"]
    assert generate(tmp_path) == ["g.svg"]
    assert generate(tmp_path, check=True) == []
    (tmp_path / "assets" / "g.svg").write_text("<svg/>", "utf-8")
    assert generate(tmp_path, check=True) == ["g.svg"]


REPO = Path(__file__).resolve().parents[3]


def test_stale_repo_figure_is_a_validation_error(tmp_path: Path) -> None:
    root = tmp_path / "ege-physics"
    shutil.copytree(REPO / "content" / "ege-physics", root)
    (root / "assets" / "kin-0011.svg").write_text("<svg/>", "utf-8")
    assert any("kin-0011.svg is out of date" in e for e in load_exam_dir(root).errors)


def test_public_build_inlines_task_figures(tmp_path: Path) -> None:
    res = load_exam_dir(REPO / "content" / "ege-physics")
    assert res.bundle is not None
    build(res.bundle, tmp_path)
    public = json.loads((tmp_path / "public" / "ege-physics.json").read_text("utf-8"))
    (task,) = [t for t in public["tasks"] if t["id"] == "kin-0011"]
    assert '<figure class="fig"' in task["statement"]
    assert "assets/kin-0011.svg" not in task["statement"]


# --- diagrams -------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("markup", "expected"),
    [
        ("*v*", '<tspan font-style="italic">v</tspan>'),
        ("F_тр", 'F<tspan dy="4.2" font-size="10.1">тр</tspan>'),
        ("v^{2}", 'v<tspan dy="-4.2" font-size="10.1">2</tspan>'),
        ("a < b", "a &lt; b"),
    ],
)
def test_rich_text(markup: str, expected: str) -> None:
    assert expected in rich_text(markup, 14)


def diagram(*items: dict[str, object]) -> DiagramSpec:
    return DiagramSpec.model_validate({"kind": "diagram", "items": list(items)})


ALL_ITEMS: list[dict[str, object]] = [
    {"line": [[0, 0], [10, 10]], "fill": "surface"},
    {"arrow": [[0, 0], [50, 0]], "tone": "force", "label": "*F*"},
    {"circle": [20, 20], "r": 5, "label": "+"},
    {"rect": [0, 0, 10, 10], "rotate": 30},
    {"text": "*m*", "at": [5, 5]},
    {"hatch": [[0, 100], [100, 100]]},
    {"spring": [[0, 50], [100, 50]]},
    {"angle": [0, 0], "start": 0, "end": 30, "label": "*α*"},
    {"sine": [0, 50], "length": 100, "amplitude": 10},
    {"dots": [[1, 1], [2, 2]]},
    *(
        {"element": e, "at": [50, 50], "label": "*R*"}
        for e in (
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
        )
    ),
    {"path": "M0 0L10 10", "tone": "vel"},
]


@pytest.mark.parametrize("item", ALL_ITEMS, ids=lambda i: next(iter(i)))
def test_every_diagram_item_renders_valid_svg(item: dict[str, object]) -> None:
    svg = render_diagram(diagram(item))
    ET.fromstring(svg)  # noqa: S314 — our own generator output


def test_tones_are_classes_with_fallback_colour() -> None:
    svg = render_diagram(diagram({"arrow": [[0, 0], [50, 0]], "tone": "force"}))
    assert '<g class="fig-force" color="crimson">' in svg


def test_drawn_path_with_mover() -> None:
    svg = render_diagram(
        diagram({"path": "M0 0L10 10", "animate": "draw", "mover": True, "tone": "accent"})
    )
    ET.fromstring(svg)  # noqa: S314 — our own generator output
    assert '<path class="fig-draw" pathLength="1"' in svg
    assert '<circle class="fig-mover"' in svg
    assert 'path="M0 0L10 10"' in svg
    assert 'dur="6s"' in svg


def test_appear_wraps_any_item() -> None:
    svg = render_diagram(diagram({"arrow": [[0, 0], [50, 0]], "animate": "appear"}))
    assert '<g class="fig-appear"><' in svg


@pytest.mark.parametrize(
    ("item", "message"),
    [
        ({"path": "M0 0L1 1", "mover": True}, "mover needs animate: draw"),
        ({"path": "M0 0L1 1", "animate": "draw", "dashed": True}, "cannot be dashed"),
        ({"arrow": [[0, 0], [1, 0]], "animate": "draw"}, "appear"),
    ],
)
def test_invalid_animation(item: dict[str, object], message: str) -> None:
    with pytest.raises(ValidationError, match=message):
        diagram(item)


def test_unknown_item_is_rejected() -> None:
    with pytest.raises(ValidationError):
        diagram({"blob": [0, 0]})


def test_floor_hatch_strokes_go_below_the_line() -> None:
    svg = render_diagram(diagram({"hatch": [[0, 100], [100, 100]]}))
    stroke_path = svg.split('stroke-width="1" d="', 1)[1]
    strokes = re.findall(r"M[\d.]+ 100L[\d.]+ ([\d.]+)", stroke_path)
    assert strokes
    assert all(float(y) > 100 for y in strokes)
