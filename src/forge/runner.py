"""Runner — orchestration loop and runner abstractions."""

from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Protocol, runtime_checkable

import typer

from forge.git import (
    WorkingTreeSnapshot,
    commit_changes,
    revert_uncommitted,
    snapshot_working_tree,
    stage_changes,
)


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


def verify_and_fix(
    runner: Runner,
    check: Callable[[], tuple[bool, str]],
    fix_prompt: Callable[[str], str],
) -> tuple[bool, str]:
    """Single check → fix cycle.

    Runs *check*.  If it passes, returns immediately.  If it fails,
    spawns the *runner* with a prompt built from the error output, then
    runs the check once more.

    Returns ``(success, output)`` from the final check.
    """
    ok, output = check()
    if ok:
        return True, output
    runner.run(fix_prompt(output))
    return check()


def _commit_issue(
    runner: Runner,
    message: str,
    snapshot: WorkingTreeSnapshot,
    max_retries: int = 3,
) -> tuple[bool, str]:
    """Stage, commit, and retry on failure up to *max_retries* times.

    Returns ``(success, output)`` where *output* is the commit or error
    output from the last attempt.
    """
    stage_changes(snapshot)

    for _attempt in range(max_retries):
        ok, output = verify_and_fix(
            runner=runner,
            check=lambda: commit_changes(message),
            fix_prompt=lambda error: (
                "The git commit failed with the following output. "
                "Fix the issues and stop. Do not commit.\n\n"
                f"{error}"
            ),
        )
        if ok:
            return True, output
        # Re-stage after the fix attempt (runner may have changed files)
        stage_changes(snapshot)

    return False, output


def run_afk_loop(
    source: Any,
    iterations: int | str,
    render_prompt: Callable[[Any], str],
    display_name: Callable[[Any], str],
    commit_message: Callable[[Any], str],
    runner: Runner,
    runner_name: str = "claude",
    on_no_changes: Callable[[Any, str | None], None] | None = None,
) -> list[IterationResult]:
    """Run the autonomous loop over issues from any source.

    Uses the provided Runner instance to execute each issue's prompt.
    After each successful run, Forge stages and commits the changes.
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

        # Snapshot working tree before runner
        snapshot = snapshot_working_tree()

        prompt = render_prompt(issue)
        run_result = runner.run(prompt)

        if not run_result.success:
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
            continue

        # Runner succeeded — check for changes
        has_changes = stage_changes(snapshot)
        if not has_changes:
            error_msg = "runner produced no changes"
            typer.echo(
                f"Issue {issue.number}: failed — {error_msg} "
                f"({_fmt_time(run_result.duration_seconds)})"
            )
            if on_no_changes is not None:
                on_no_changes(issue, run_result.output)
            results.append(
                IterationResult(
                    issue_number=issue.number,
                    issue_filename=name,
                    success=False,
                    elapsed_seconds=run_result.duration_seconds,
                    error=error_msg,
                )
            )
            typer.echo("")
            continue

        # Commit the changes
        msg = commit_message(issue)
        committed, commit_output = _commit_issue(
            runner=runner,
            message=msg,
            snapshot=snapshot,
        )

        if not committed:
            typer.echo(
                f"Issue {issue.number}: failed — commit failed after retries "
                f"({_fmt_time(run_result.duration_seconds)})"
            )
            revert_uncommitted(snapshot)
            results.append(
                IterationResult(
                    issue_number=issue.number,
                    issue_filename=name,
                    success=False,
                    elapsed_seconds=run_result.duration_seconds,
                    error="commit failed after retries",
                )
            )
            # Stop the entire session
            typer.echo("Stopping session: unable to commit.")
            typer.echo("")
            break

        # Commit succeeded — mark issue complete
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
