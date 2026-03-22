"""Forge CLI — PRD-driven development workflow orchestrator."""

from enum import Enum
from typing import Optional

import typer

from forge.local import LocalSource
from forge.prompt import render_local_once
from forge.runner import run_afk_loop, run_interactive

app = typer.Typer(
    help="Forge — execute PRD-driven development workflows using Claude Code.",
    add_completion=False,
)


class Mode(str, Enum):
    once = "once"
    afk = "afk"


def _parse_iterations(value: Optional[str]) -> Optional[int | str]:
    """Parse --iterations value: positive integer or 'all'."""
    if value is None:
        return None
    if value == "all":
        return "all"
    try:
        n = int(value)
    except ValueError:
        raise typer.BadParameter(f"Must be a positive integer or 'all', got '{value}'")
    if n <= 0:
        raise typer.BadParameter(f"Must be a positive integer or 'all', got '{value}'")
    return n


def _validate_iterations(mode: Mode, iterations_raw: Optional[str]) -> Optional[int | str]:
    """Validate and parse iterations flag for the given mode."""
    iterations = _parse_iterations(iterations_raw)

    if mode == Mode.afk and iterations is None:
        raise typer.BadParameter(
            "--iterations / -i is required when mode is 'afk'."
        )

    # In once mode, silently ignore iterations
    if mode == Mode.once:
        iterations = None

    return iterations


@app.command()
def spec(
    name: str = typer.Argument(help="Name of the local spec (looks in .forge/<name>/)."),
    mode: Mode = typer.Option(
        ...,
        "--mode",
        "-m",
        help="Execution mode: 'once' (interactive) or 'afk' (autonomous).",
    ),
    iterations: Optional[str] = typer.Option(
        None,
        "--iterations",
        "-i",
        help="Number of issues to process, or 'all'. Required for afk mode.",
    ),
) -> None:
    """Execute issues from a local spec."""
    parsed_iterations = _validate_iterations(mode, iterations)

    source = LocalSource(name)

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
        run_afk_loop(
            source=source,
            iterations=parsed_iterations,
            prd_content=source.get_prd_content(),
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
    iterations: Optional[str] = typer.Option(
        None,
        "--iterations",
        "-i",
        help="Number of issues to process, or 'all'. Required for afk mode.",
    ),
) -> None:
    """Execute issues from a GitHub PRD."""
    _validate_iterations(mode, iterations)
    typer.echo(f"Source:     prd")
    typer.echo(f"Identifier: {number}")
    typer.echo(f"Mode:       {mode.value}")
