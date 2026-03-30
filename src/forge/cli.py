"""Forge CLI — PRD-driven development workflow orchestrator."""

from __future__ import annotations

from importlib.metadata import version
from pathlib import Path
from typing import cast

import questionary
import typer

from forge.git import (
    checkout_or_create_branch,
    create_pr,
    default_branch,
    ensure_clean_tree,
    push_branch,
)
from forge.github import GitHubSource
from forge.local import LocalSource
from forge.naming import slugify_branch_component
from forge.prompt import (
    render_github,
    render_local,
)
from forge.runner import IterationResult, run_afk_loop
from forge.runners import get_runner

SKILL_NAMES = ["forge-interview", "forge-prd", "forge-issues"]


def _version_callback(value: bool) -> None:
    if value:
        typer.echo(f"forge {version('prd-forge')}")
        raise typer.Exit()


app = typer.Typer(
    help="Forge — execute PRD-driven development workflows using agentic coding CLIs.",
    add_completion=False,
)


@app.callback()
def main(
    version: bool = typer.Option(
        False,
        "--version",
        "-V",
        help="Show version and exit.",
        callback=_version_callback,
        is_eager=True,
    ),
) -> None:
    """Forge — execute PRD-driven development workflows using Claude Code."""


def _parse_iterations(value: str) -> int | str:
    """Parse --iterations value: positive integer or 'all'."""
    if value == "all":
        return "all"
    try:
        n = int(value)
    except ValueError as err:
        raise typer.BadParameter(
            f"Must be a positive integer or 'all', got '{value}'"
        ) from err
    if n <= 0:
        raise typer.BadParameter(f"Must be a positive integer or 'all', got '{value}'")
    return n


def _pre_execution(suggested_branch: str) -> tuple[str, str]:
    """Run pre-execution prompts and git checks. Returns (branch, base_branch)."""
    ensure_clean_tree()

    branch = questionary.text(
        "Branch name:",
        default=suggested_branch,
    ).unsafe_ask()

    base_branch = questionary.text(
        "Base branch / PR target:",
        default=default_branch(),
    ).unsafe_ask()

    checkout_or_create_branch(branch)
    typer.echo("")

    return branch, base_branch


def _build_forge_report(
    results: list[IterationResult],
    *,
    runner_name: str,
    prd_number: int | None = None,
) -> str:
    """Build the Forge Report section for a PR body."""
    lines = ["## Forge Report", f"**Runner:** {runner_name}", ""]
    for r in results:
        if r.success:
            lines.append(f"- #{r.issue_number} {r.issue_filename}: completed")
        else:
            reason = r.error or "unknown error"
            lines.append(f"- #{r.issue_number} {r.issue_filename}: failed — {reason}")

    if prd_number is not None:
        lines.append("")
        lines.append(f"Closes #{prd_number}")

    return "\n".join(lines)


def _push_and_create_pr(
    results: list[IterationResult],
    branch: str,
    base_branch: str,
    pr_title: str,
    *,
    runner_name: str,
    prd_number: int | None = None,
) -> None:
    """Push the branch and create a PR with a Forge Report after an afk run."""
    report = _build_forge_report(
        results, runner_name=runner_name, prd_number=prd_number
    )
    push_branch(branch)
    create_pr(title=pr_title, body=report, base_branch=base_branch)


def _run_local(name: str, iterations_raw: str, runner_name: str) -> None:
    """Execute issues from a local PRD at .forge/<name>/."""
    parsed_iterations = _parse_iterations(iterations_raw)
    runner_instance = get_runner(runner_name)

    source = LocalSource(name)
    local_slug = slugify_branch_component(name)
    suggested_branch = f"forge/{local_slug}" if local_slug else "forge/spec"
    branch, base_branch = _pre_execution(suggested_branch)

    prd_content = source.get_prd_content()
    results = run_afk_loop(
        source=source,
        iterations=parsed_iterations,
        render_prompt=lambda issue: render_local(
            prd_content=prd_content,
            issue_number=issue.number,
            issue_filename=issue.filename,
            issue_content=issue.content,
        ),
        display_name=lambda issue: issue.filename,
        runner=runner_instance,
    )
    if results:
        _push_and_create_pr(
            results=results,
            branch=branch,
            base_branch=base_branch,
            pr_title=f"Forge: {name}",
            runner_name=runner_name,
        )


def _run_github(number: int, iterations_raw: str, runner_name: str) -> None:
    """Execute issues from a GitHub PRD."""
    parsed_iterations = _parse_iterations(iterations_raw)
    runner_instance = get_runner(runner_name)

    source = GitHubSource(number)
    prd = source.get_prd()
    prd_slug = slugify_branch_component(prd.title)
    suggested_branch = f"forge/{prd_slug}" if prd_slug else f"forge/issue-{number}"
    pr_title = prd.title or f"PRD #{number}"
    branch, base_branch = _pre_execution(suggested_branch)

    prd_content = prd.body
    results = run_afk_loop(
        source=source,
        iterations=parsed_iterations,
        render_prompt=lambda issue: render_github(
            prd_content=prd_content,
            issue_number=issue.number,
            issue_title=issue.title,
            issue_content=issue.body,
        ),
        display_name=lambda issue: issue.title,
        runner=runner_instance,
    )
    if results:
        _push_and_create_pr(
            results=results,
            branch=branch,
            base_branch=base_branch,
            pr_title=pr_title,
            runner_name=runner_name,
            prd_number=number,
        )


def _validate_run_source(
    local: str | None, github: int | None
) -> tuple[str, str | int]:
    """Validate mutually exclusive source options for `forge run`."""
    if local is not None and github is not None:
        raise typer.BadParameter("Use exactly one of --local or --github.")
    if local is None and github is None:
        raise typer.BadParameter("One of --local or --github is required.")
    if local is not None:
        return "local", local
    return "github", github


@app.command()
def run(
    local: str | None = typer.Option(
        None,
        "--local",
        help="Local PRD name. Looks in .forge/<name>/ for prd.md and issues/.",
    ),
    github: int | None = typer.Option(
        None,
        "--github",
        help="GitHub PRD issue number.",
    ),
    iterations: str = typer.Option(
        ...,
        "--iterations",
        "-i",
        help="Number of issues to process, or 'all'.",
    ),
    runner_name: str = typer.Option(
        "claude",
        "--runner",
        help="Agentic CLI runner to use.",
    ),
) -> None:
    """Execute issues from a local PRD or GitHub PRD."""
    source_kind, source_value = _validate_run_source(local, github)
    if source_kind == "local":
        _run_local(cast(str, source_value), iterations, runner_name)
        return
    _run_github(cast(int, source_value), iterations, runner_name)


def _get_skills_source_dir() -> Path:
    """Return the path to the skills/ directory shipped with this package."""
    return Path(__file__).resolve().parent / "skills"


def _get_skills_target_dir(
    *, create: bool = True, claude_root: Path | None = None
) -> Path:
    """Return the skills directory, optionally creating it.

    When *claude_root* is provided the skills directory is
    ``claude_root / "skills"``; otherwise it defaults to
    ``~/.claude/skills/``.
    """
    if claude_root is not None:
        target = Path(claude_root).expanduser() / "skills"
    else:
        target = Path.home() / ".claude" / "skills"
    if create:
        target.mkdir(parents=True, exist_ok=True)
    return target


@app.command("setup-skills")
def setup_skills(
    target: Path | None = typer.Option(
        None,
        "--target",
        help=(
            "Claude root path (e.g. ~/.claude-acme)."
            " Skills are installed into <target>/skills/."
        ),
    ),
) -> None:
    """Install Forge skills as symlinks into ~/.claude/skills/."""
    source_dir = _get_skills_source_dir()

    if not source_dir.is_dir():
        typer.echo(f"Error: skills directory not found at {source_dir}", err=True)
        raise typer.Exit(code=1)

    target_dir = _get_skills_target_dir(claude_root=target)

    for name in SKILL_NAMES:
        source = source_dir / name
        target = target_dir / name

        if not source.is_dir():
            typer.echo(f"Warning: skill source not found: {source}", err=True)
            continue

        if target.is_symlink():
            existing = target.resolve()
            if existing == source.resolve():
                # Already points to the right place — skip silently
                continue
            typer.echo(
                f"Warning: {target} already exists as symlink "
                f"-> {target.readlink()}. Skipping.",
                err=True,
            )
            continue

        if target.exists():
            typer.echo(
                f"Warning: {target} already exists (not a symlink). Skipping.", err=True
            )
            continue

        target.symlink_to(source)
        typer.echo(f"Linked {name} -> {source}")


@app.command("remove-skills")
def remove_skills(
    target: Path | None = typer.Option(
        None,
        "--target",
        help=(
            "Claude root path (e.g. ~/.claude-acme)."
            " Skills are removed from <target>/skills/."
        ),
    ),
) -> None:
    """Remove Forge skill symlinks from ~/.claude/skills/."""
    source_dir = _get_skills_source_dir()
    target_dir = _get_skills_target_dir(create=False, claude_root=target)
    if not target_dir.is_dir():
        return

    for name in SKILL_NAMES:
        target = target_dir / name

        if not target.is_symlink():
            # Doesn't exist or is a regular file/directory — skip silently
            continue

        # Only remove if it points into the Forge package
        resolved = target.resolve()
        expected = (source_dir / name).resolve()
        if resolved != expected:
            continue

        target.unlink()
        typer.echo(f"Removed {name}")
