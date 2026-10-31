"""Figure specs → SVG, and inlining SVG images into Markdown."""

import json
import shutil
import xml.etree.ElementTree as ET
from pathlib import Path

import pytest
from pydantic import ValidationError

from content_schema.build import build
from content_schema.figures import (
    GraphSpec,
    _num,
    figure_html,
    generate,
    inline_svg_images,
    render_graph,
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
