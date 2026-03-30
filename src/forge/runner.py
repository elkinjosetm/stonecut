"""Runner — orchestration loop and runner abstractions."""

from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Protocol, runtime_checkable

import typer


@dataclass
class RunResult:
    """Structured result from a single runner execution."""

    success: bool
    exit_code: int
    duration_seconds: float
    output: str | None = None
    error: str | None = None


@runtime_checkable
class Runner(Protocol):
    """Protocol that all runner adapters must satisfy."""

    def run(self, prompt: str) -> RunResult: ...


@dataclass
class IterationResult:
    """Result of a single afk iteration."""

    issue_number: int
    issue_filename: str
    success: bool
    elapsed_seconds: float
    error: str | None = None


def run_afk_loop(
    source: Any,
    iterations: int | str,
    render_prompt: Callable[[Any], str],
    display_name: Callable[[Any], str],
    runner: Runner,
    runner_name: str = "claude",
) -> list[IterationResult]:
    """Run the autonomous loop over issues from any source.

    Uses the provided Runner instance to execute each issue's prompt.
    Works with both LocalSource and GitHubSource.
    """
    typer.echo(f"Runner: {runner_name}")
    typer.echo("")
    results: list[IterationResult] = []
    session_start = time.monotonic()
    iteration = 0

    while True:
        # Check iteration limit
        if isinstance(iterations, int) and iteration >= iterations:
            break

        issue = source.get_next_issue()
        if issue is None:
            if iteration == 0:
                typer.echo("All issues complete!")
            break

        iteration += 1
        name = display_name(issue)
        remaining, total = source.get_remaining_count()
        typer.echo(f"--- Iteration {iteration} ---")
        typer.echo(f"Issue {issue.number}: {name}")
        typer.echo(f"Remaining: {remaining}/{total}")
        typer.echo("")

        prompt = render_prompt(issue)
        run_result = runner.run(prompt)

        if run_result.success:
            source.complete_issue(issue)
            typer.echo(
                f"Issue {issue.number}: completed "
                f"({_fmt_time(run_result.duration_seconds)})"
            )
            results.append(
                IterationResult(
                    issue_number=issue.number,
                    issue_filename=name,
                    success=True,
                    elapsed_seconds=run_result.duration_seconds,
                )
            )
        else:
            error_detail = run_result.error or "unknown error"
            typer.echo(
                f"Issue {issue.number}: failed — {error_detail} "
                f"({_fmt_time(run_result.duration_seconds)})"
            )
            results.append(
                IterationResult(
                    issue_number=issue.number,
                    issue_filename=name,
                    success=False,
                    elapsed_seconds=run_result.duration_seconds,
                    error=run_result.error,
                )
            )

        typer.echo("")

    # Session summary
    total_elapsed = time.monotonic() - session_start
    _print_summary(results, total_elapsed)
    return results


def _fmt_time(seconds: float) -> str:
    """Format seconds as a human-readable duration."""
    if seconds < 60:
        return f"{seconds:.0f}s"
    minutes = int(seconds // 60)
    secs = int(seconds % 60)
    return f"{minutes}m {secs}s"


def _print_summary(results: list[IterationResult], total_seconds: float) -> None:
    """Print a summary of the afk session."""
    if not results:
        return

    typer.echo("=== Session Summary ===")
    succeeded = sum(1 for r in results if r.success)
    failed = sum(1 for r in results if not r.success)

    for r in results:
        status = "completed" if r.success else "failed"
        elapsed = _fmt_time(r.elapsed_seconds)
        typer.echo(
            f"  Issue {r.issue_number} ({r.issue_filename}): {status} ({elapsed})"
        )

    typer.echo("")
    typer.echo(f"Total: {len(results)} issues — {succeeded} completed, {failed} failed")
    typer.echo(f"Total time: {_fmt_time(total_seconds)}")
