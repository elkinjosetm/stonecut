"""Forge CLI — PRD-driven development workflow orchestrator."""

from __future__ import annotations

from enum import Enum
from pathlib import Path

import questionary
import typer

from forge.git import (
    checkout_or_create_branch,
    create_pr,
    ensure_clean_tree,
    push_branch,
)
from forge.github import GitHubSource
from forge.local import LocalSource
from forge.prompt import (
    render_github_afk,
    render_github_once,
    render_local_afk,
    render_local_once,
)
from forge.runner import IterationResult, run_afk_loop, run_interactive

SKILL_NAMES = ["forge:interview", "forge:prd", "forge:issues"]

app = typer.Typer(
    help="Forge — execute PRD-driven development workflows using Claude Code.",
    add_completion=False,
)


class Mode(str, Enum):
    once = "once"
    afk = "afk"


def _parse_iterations(value: str | None) -> int | str | None:
    """Parse --iterations value: positive integer or 'all'."""
    if value is None:
        return None
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
        default="main",
    ).unsafe_ask()

    checkout_or_create_branch(branch)
    typer.echo("")

    return branch, base_branch


def _build_forge_report(
    results: list[IterationResult], *, prd_number: int | None = None
) -> str:
    """Build the Forge Report section for a PR body."""
    lines = ["## Forge Report"]
    for r in results:
        status = "completed" if r.success else "failed (non-zero exit code)"
        lines.append(f"- #{r.issue_number} {r.issue_filename}: {status}")

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
    prd_number: int | None = None,
) -> None:
    """Push the branch and create a PR with a Forge Report after an afk run."""
    report = _build_forge_report(results, prd_number=prd_number)
    push_branch(branch)
    create_pr(title=pr_title, body=report, base_branch=base_branch)


def _validate_iterations(mode: Mode, iterations_raw: str | None) -> int | str | None:
    """Validate and parse iterations flag for the given mode."""
    iterations = _parse_iterations(iterations_raw)

    if mode == Mode.afk and iterations is None:
        raise typer.BadParameter("--iterations / -i is required when mode is 'afk'.")

    # In once mode, silently ignore iterations
    if mode == Mode.once:
        iterations = None

    return iterations


@app.command()
def spec(
    name: str = typer.Argument(
        help="Name of the local spec (looks in .forge/<name>/)."
    ),
    mode: Mode = typer.Option(
        ...,
        "--mode",
        "-m",
        help="Execution mode: 'once' (interactive) or 'afk' (autonomous).",
    ),
    iterations: str | None = typer.Option(
        None,
        "--iterations",
        "-i",
        help="Number of issues to process, or 'all'. Required for afk mode.",
    ),
) -> None:
    """Execute issues from a local spec."""
    parsed_iterations = _validate_iterations(mode, iterations)

    source = LocalSource(name)
    branch, base_branch = _pre_execution(f"feature/{name}")

    if mode == Mode.once:
        issue = source.get_next_issue()

        if issue is None:
            typer.echo("All issues complete!")
            raise typer.Exit()

        remaining, total = source.get_remaining_count()
        typer.echo(f"Issue {issue.number}: {issue.filename}")
        typer.echo(f"Remaining: {remaining}/{total}")
        typer.echo("")

        prompt = render_local_once(
            prd_content=source.get_prd_content(),
            issue_number=issue.number,
            issue_filename=issue.filename,
            issue_content=issue.content,
            spec_dir=str(source.spec_dir),
        )
        run_interactive(prompt)

    elif mode == Mode.afk:
        prd_content = source.get_prd_content()
        results = run_afk_loop(
            source=source,
            iterations=parsed_iterations,
            render_prompt=lambda issue: render_local_afk(
                prd_content=prd_content,
                issue_number=issue.number,
                issue_filename=issue.filename,
                issue_content=issue.content,
            ),
            display_name=lambda issue: issue.filename,
        )
        if results:
            _push_and_create_pr(
                results=results,
                branch=branch,
                base_branch=base_branch,
                pr_title=f"Forge: {name}",
            )


@app.command()
def prd(
    number: int = typer.Argument(help="GitHub PRD issue number."),
    mode: Mode = typer.Option(
        ...,
        "--mode",
        "-m",
        help="Execution mode: 'once' (interactive) or 'afk' (autonomous).",
    ),
    iterations: str | None = typer.Option(
        None,
        "--iterations",
        "-i",
        help="Number of issues to process, or 'all'. Required for afk mode.",
    ),
) -> None:
    """Execute issues from a GitHub PRD."""
    parsed_iterations = _validate_iterations(mode, iterations)

    source = GitHubSource(number)
    branch, base_branch = _pre_execution(f"prd/{number}")

    if mode == Mode.once:
        issue = source.get_next_issue()

        if issue is None:
            typer.echo("All issues complete!")
            raise typer.Exit()

        remaining, total = source.get_remaining_count()
        typer.echo(f"Issue #{issue.number}: {issue.title}")
        typer.echo(f"Remaining: {remaining}/{total}")
        typer.echo("")

        prompt = render_github_once(
            prd_content=source.get_prd_content(),
            issue_number=issue.number,
            issue_title=issue.title,
            issue_content=issue.body,
        )
        run_interactive(prompt)

    elif mode == Mode.afk:
        prd_content = source.get_prd_content()
        results = run_afk_loop(
            source=source,
            iterations=parsed_iterations,
            render_prompt=lambda issue: render_github_afk(
                prd_content=prd_content,
                issue_number=issue.number,
                issue_title=issue.title,
                issue_content=issue.body,
            ),
            display_name=lambda issue: issue.title,
        )
        if results:
            _push_and_create_pr(
                results=results,
                branch=branch,
                base_branch=base_branch,
                pr_title=f"Forge: PRD #{number}",
                prd_number=number,
            )


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
