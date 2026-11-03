"""`content-build validate|build|figures` — run from the repo root."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from content_schema.build import build
from content_schema.figures import generate
from content_schema.loader import LoadResult, load_exam_dir


def _exam_dirs(content: Path) -> list[Path]:
    return sorted(p.parent for p in content.glob("*/exam.yaml"))


def _report(name: str, res: LoadResult) -> None:
    for w in res.warnings:
        print(f"[{name}] warning: {w}", file=sys.stderr)
    for e in res.errors:
        print(f"[{name}] error: {e}", file=sys.stderr)
    if res.ok and res.bundle:
        b = res.bundle
        print(
            f"[{name}] ok: {len(b.roadmap.topics())} topics, {len(b.theory)} theory pages, "
            f"{len(b.tasks)} tasks"
        )


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="content-build")
    ap.add_argument("command", choices=["validate", "build", "figures"])
    ap.add_argument("--content", type=Path, default=Path("content"))
    ap.add_argument("--out", type=Path, default=Path("build"))
    ap.add_argument(
        "--check", action="store_true", help="figures: only report stale SVGs, exit 1 if any"
    )
    args = ap.parse_args(argv)
    for stream in (sys.stdout, sys.stderr):
        stream.reconfigure(encoding="utf-8")  # type: ignore[union-attr]

    dirs = _exam_dirs(args.content)
    if not dirs:
        print(f"no */exam.yaml under {args.content}", file=sys.stderr)
        return 2

    if args.command == "figures":
        return _figures(dirs, check=args.check)

    failed = False
    for d in dirs:
        res = load_exam_dir(d)
        _report(d.name, res)
        if not res.ok:
            failed = True
            continue
        if args.command == "build" and res.bundle:
            version = build(res.bundle, args.out)
            print(f"[{d.name}] built content_version={version} -> {args.out}")
    return 1 if failed else 0


def _figures(dirs: list[Path], *, check: bool) -> int:
    stale = False
    for d in dirs:
        changed = generate(d, check=check)
        verb = "stale" if check else "wrote"
        for name in changed:
            print(f"[{d.name}] {verb} assets/{name}")
        stale = stale or bool(changed)
        if not changed:
            print(f"[{d.name}] figures up to date")
    return 1 if check and stale else 0


if __name__ == "__main__":
    raise SystemExit(main())
