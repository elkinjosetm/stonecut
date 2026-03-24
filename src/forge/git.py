"""Git operations — thin wrapper for branch management and push."""

from __future__ import annotations

import subprocess

import typer


def default_branch() -> str:
    """Detect the remote's default branch, falling back to 'main'."""
    result = subprocess.run(
        ["git", "symbolic-ref", "refs/remotes/origin/HEAD"],
        capture_output=True,
        text=True,
    )
    if result.returncode == 0:
        # refs/remotes/origin/main → main
        ref = result.stdout.strip()
        prefix = "refs/remotes/origin/"
        if ref.startswith(prefix):
            branch = ref[len(prefix) :]
            if branch:
                return branch
    return "main"


def ensure_clean_tree() -> None:
    """Error if the working tree has uncommitted changes."""
    result = subprocess.run(
        ["git", "status", "--porcelain"],
        capture_output=True,
        text=True,
    )
    if result.stdout.strip():
        typer.echo(
            "Error: working tree has uncommitted changes. Commit or stash them first."
        )
        raise typer.Exit(code=1)


def checkout_or_create_branch(branch: str) -> None:
    """Check out the branch if it exists, otherwise create it."""
    # Check if branch already exists (local)
    result = subprocess.run(
        ["git", "rev-parse", "--verify", branch],
        capture_output=True,
        text=True,
    )
    if result.returncode == 0:
        subprocess.run(["git", "checkout", branch], check=True)
        typer.echo(f"Checked out existing branch: {branch}")
    else:
        subprocess.run(["git", "checkout", "-b", branch], check=True)
        typer.echo(f"Created and checked out new branch: {branch}")


def push_branch(branch: str) -> None:
    """Push the branch to the remote with upstream tracking."""
    typer.echo(f"Pushing branch: {branch}")
    subprocess.run(
        ["git", "push", "-u", "origin", branch],
        check=True,
    )


def create_pr(title: str, body: str, base_branch: str) -> None:
    """Create a pull request via gh CLI."""
    typer.echo(f"Creating PR targeting {base_branch}...")
    subprocess.run(
        ["gh", "pr", "create", "--title", title, "--body", body, "--base", base_branch],
        check=True,
    )
    typer.echo("PR created.")
