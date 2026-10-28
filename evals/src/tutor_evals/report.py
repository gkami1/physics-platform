"""Summary rates, threshold gate and a Markdown report. Pure."""

from __future__ import annotations

from collections.abc import Sequence
from statistics import median
from typing import Any

from tutor_evals.runner import TurnResult
from tutor_evals.suite import Thresholds

# Summary key → threshold field.
GATES = {
    "leak_rate": "max_leak_rate",
    "not_russian_rate": "max_not_russian_rate",
    "cjk_rate": "max_cjk_rate",
    "think_tag_rate": "max_think_tag_rate",
    "empty_rate": "max_empty_rate",
    "too_long_rate": "max_too_long_rate",
    "error_rate": "max_error_rate",
}


def _rate(flags: Sequence[bool]) -> float | None:
    return round(sum(flags) / len(flags), 4) if flags else None


def summarize(results: Sequence[TurnResult]) -> dict[str, Any]:
    ok = [r for r in results if r.error is None]
    leak_checked = [r.leak for r in ok if r.leak is not None]
    task = [r for r in ok if r.kind == "task"]
    calls = [c for r in results for c in r.calls]
    answered = [c for c in calls if c["error"] is None]
    ttft = [c["ttft_ms"] for c in answered if c["ttft_ms"] is not None]
    latency = [c["latency_ms"] for c in answered if c["latency_ms"] is not None]
    cost = sum(c["cost_kop"] for c in calls)
    return {
        "turns": len(results),
        "conversations": len({(r.persona, r.target, r.repeat) for r in results}),
        "models": sorted({f"{c['provider']}:{c['model']}" for c in answered}),
        "leak_rate": _rate(leak_checked),
        "leak_checked_turns": len(leak_checked),
        "not_russian_rate": _rate([r.checks.not_russian for r in ok]),
        "cjk_rate": _rate([r.checks.cjk for r in ok]),
        "think_tag_rate": _rate([r.checks.think_tag for r in ok]),
        "empty_rate": _rate([r.checks.empty for r in ok]),
        "too_long_rate": _rate([r.checks.too_long for r in ok]),
        "error_rate": _rate([r.error is not None for r in results]),
        # A second provider answered vs. the same provider was asked again (429/503 retries).
        "fallback_rate": _rate([len({c["provider"] for c in r.calls}) > 1 for r in results]),
        "retry_rate": _rate([len(r.calls) > len({c["provider"] for c in r.calls}) for r in results]),
        "question_rate": _rate([r.checks.ends_with_question for r in task]),
        "median_chars": median([r.checks.chars for r in ok]) if ok else None,
        "median_ttft_ms": median(ttft) if ttft else None,
        "median_latency_ms": median(latency) if latency else None,
        "tokens_in": sum(c["tokens_in"] or 0 for c in calls),
        "tokens_out": sum(c["tokens_out"] or 0 for c in calls),
        "cost_kop": cost,
        "cost_kop_per_turn": round(cost / len(results), 2) if results else 0,
    }


def gate(summary: dict[str, Any], thresholds: Thresholds) -> list[str]:
    """Violations, empty if the run passes."""
    out = []
    for key, limit_name in GATES.items():
        value = summary.get(key)
        limit: float = getattr(thresholds, limit_name)
        if value is not None and value > limit:
            out.append(f"{key} = {value:.2%} > {limit:.2%}")
    return out


def _fmt(v: Any, key: str = "") -> str:
    if v is None:
        return "—"
    if key.endswith("_rate") and isinstance(v, float):
        return f"{v:.2%}"
    return f"{v:g}" if isinstance(v, float) else str(v)


def markdown(
    summary: dict[str, Any],
    results: Sequence[TurnResult],
    violations: Sequence[str],
    previous: dict[str, Any] | None = None,
    max_examples: int = 20,
) -> str:
    lines = [f"## Tutor evals: {'PASS' if not violations else 'FAIL'}", ""]
    meta = summary.get("meta", {})
    if meta:
        lines += [", ".join(f"{k}: `{v}`" for k, v in meta.items()), ""]
    head = "| metric | value |" + (" previous |" if previous else "")
    lines += [head, "|---|---|" + ("---|" if previous else "")]
    for k, v in summary.items():
        if k == "meta":
            continue
        row = f"| {k} | {_fmt(v, k)} |"
        if previous:
            row += f" {_fmt(previous.get(k), k)} |"
        lines.append(row)
    if violations:
        lines += ["", "**Over threshold:**", *(f"- {v}" for v in violations)]
    failed = [r for r in results if r.failures()]
    if failed:
        lines += ["", f"### Failed turns ({len(failed)})", ""]
        for r in failed[:max_examples]:
            reply = r.raw.strip().replace("\n", " ")
            lines += [
                f"- `{r.persona}` × `{r.target}` #{r.index} (level {_fmt(r.hint_level)}): "
                f"**{', '.join(r.failures())}**",
                f"  - student: {r.student}",
                f"  - tutor: {reply[:400]}{'…' if len(reply) > 400 else ''}",
            ]
        if len(failed) > max_examples:
            lines.append(f"- … and {len(failed) - max_examples} more in the JSON report")
    return "\n".join(lines) + "\n"
