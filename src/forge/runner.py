"""Runner — spawns Claude Code sessions."""

from __future__ import annotations

import subprocess
import sys
import time
from dataclasses import dataclass
from typing import Any, Callable

import typer


@dataclass
class IterationResult:
    """Result of a single afk iteration."""

    issue_number: int
    issue_filename: str
    success: bool
    elapsed_seconds: float


def run_interactive(prompt: str) -> None:
    """Spawn an interactive Claude Code session with the prompt piped to stdin.

    Forge exits after spawning — the user takes over the session.
    """
    subprocess.run(
        ["claude", "--allowedTools", "Bash,Edit,Read,Write,Glob,Grep"],
        input=prompt,
        text=True,
    )
    sys.exit(0)


def run_headless(prompt: str) -> int:
    """Spawn a headless Claude Code session and return the exit code."""
    result = subprocess.run(
        ["claude", "-p", "--allowedTools", "Bash,Edit,Read,Write,Glob,Grep"],
        input=prompt,
        text=True,
        capture_output=True,
    )
    return result.returncode


def run_afk_loop(
    source: Any,
    iterations: int | str,
    render_prompt: Callable[[Any], str],
    display_name: Callable[[Any], str],
) -> list[IterationResult]:
    """Run the autonomous afk loop over issues from any source.

    Spawns headless Claude Code sessions, handles bookkeeping on success,
    and tracks results per issue. Works with both LocalSource and GitHubSource.
    """
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

        iter_start = time.monotonic()
        exit_code = run_headless(prompt)
        elapsed = time.monotonic() - iter_start

        if exit_code == 0:
            source.complete_issue(issue)
            typer.echo(f"Issue {issue.number}: completed ({_fmt_time(elapsed)})")
            results.append(IterationResult(
                issue_number=issue.number,
                issue_filename=name,
                success=True,
                elapsed_seconds=elapsed,
            ))
        else:
            typer.echo(f"Issue {issue.number}: failed (exit code {exit_code}, {_fmt_time(elapsed)})")
            results.append(IterationResult(
                issue_number=issue.number,
                issue_filename=name,
                success=False,
                elapsed_seconds=elapsed,
            ))

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
        typer.echo(f"  Issue {r.issue_number} ({r.issue_filename}): {status} ({_fmt_time(r.elapsed_seconds)})")

    typer.echo("")
    typer.echo(f"Total: {len(results)} issues — {succeeded} completed, {failed} failed")
    typer.echo(f"Total time: {_fmt_time(total_seconds)}")
