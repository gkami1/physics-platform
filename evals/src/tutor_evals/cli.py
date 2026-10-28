"""`tutor-eval run`: play the suite against the configured models and gate on thresholds.

Models come from the same `API_LLM_*` settings as the API. With none configured the
scripted dev model answers, which only checks that the harness runs.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import subprocess
import sys
from dataclasses import asdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from platform_api.content import ContentStore
from platform_api.llm import ScriptedModel, make_models
from platform_api.prompt import PROMPT_VERSION
from platform_api.settings import Settings
from tutor_evals.report import gate, markdown, summarize
from tutor_evals.runner import TurnResult, run_suite
from tutor_evals.suite import load_suite

EVALS = Path(__file__).resolve().parents[2]


def _git_sha() -> str:
    if sha := os.environ.get("GITHUB_SHA"):
        return sha[:12]
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--short=12", "HEAD"],  # noqa: S607
            capture_output=True,
            text=True,
            check=True,
        )
    except (OSError, subprocess.CalledProcessError):
        return "unknown"
    return out.stdout.strip()


def _progress(done: int, total: int, turns: list[TurnResult]) -> None:
    first = turns[0] if turns else None
    fails = sum(bool(t.failures()) for t in turns)
    label = f"{first.persona} × {first.target}" if first else "?"
    print(
        f"[{done}/{total}] {label}: {len(turns)} turns, {fails} failed", file=sys.stderr, flush=True
    )


def _run(args: argparse.Namespace) -> int:
    settings = Settings()
    suite = load_suite(args.suite)
    store = ContentStore.load(args.content or settings.private_content_dir)
    models = make_models(settings)
    if args.provider:
        models = [m for m in models if m.name == args.provider]
    if not models:
        print("no models configured (API_LLM_BASE_URL / API_LLM_FALLBACK_BASE_URL)")
        return 2
    if all(isinstance(m, ScriptedModel) for m in models):
        print("warning: scripted dev model only; results say nothing about tutor quality")

    results = asyncio.run(
        run_suite(
            suite,
            store,
            models,
            repeats=args.repeats,
            concurrency=args.concurrency,
            personas=args.persona,
            on_done=_progress,
        )
    )
    summary = summarize(results)
    violations = gate(summary, suite.thresholds)
    started = datetime.now(UTC)
    meta = {
        "commit": _git_sha(),
        "prompt_version": PROMPT_VERSION,
        "content": ",".join(f"{k}@{v}" for k, v in sorted(store.versions.items())),
        "at": started.isoformat(timespec="seconds"),
    }
    previous = None
    if args.compare:
        previous = json.loads(args.compare.read_text("utf-8"))["summary"]
    report: dict[str, Any] = {
        "summary": {"meta": meta, **summary},
        "violations": violations,
        "turns": [asdict(r) for r in results],
    }
    out: Path = args.out or (EVALS / "results" / f"{started:%Y%m%d-%H%M%S}-{meta['commit']}.json")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, ensure_ascii=False, indent=1), "utf-8")
    md = markdown(report["summary"], results, violations, previous)
    if args.markdown:
        args.markdown.write_text(md, "utf-8")
    print(md)
    print(f"report: {out}")
    return 1 if violations else 0


def main(argv: list[str] | None = None) -> int:
    # Windows consoles default to a legacy code page; reports are Russian.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    p = argparse.ArgumentParser(prog="tutor-eval")
    sub = p.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run", help="run the suite and gate on thresholds")
    r.add_argument("--suite", type=Path, default=EVALS / "suite.yaml")
    r.add_argument("--content", type=Path, help="private bundle dir (default: settings)")
    r.add_argument("--provider", choices=["primary", "fallback", "scripted"])
    r.add_argument("--persona", action="append", help="only these personas (repeatable)")
    r.add_argument("--repeats", type=int, default=1, help="runs per conversation (sampling)")
    r.add_argument("--concurrency", type=int, default=4)
    r.add_argument("--out", type=Path, help="JSON report path (default: evals/results/)")
    r.add_argument("--markdown", type=Path, help="also write the Markdown report here")
    r.add_argument("--compare", type=Path, help="previous JSON report to compare against")
    args = p.parse_args(argv)
    return _run(args)


if __name__ == "__main__":
    sys.exit(main())
